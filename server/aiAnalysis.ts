/**
 * AI Analysis Engine for reviews and guest messages.
 * Uses LLM to detect issues, categorize sentiment, and extract actionable insights.
 */
import { invokeLLM } from "./_core/llm";
import {
  getReviewById,
  upsertReviewAnalysis,
  getUnanalyzedGuestMessages,
  updateGuestMessageAnalysis,
  getUnanalyzedReviewIds,
  countUnanalyzedReviews,
} from "./db";

// ── Review Analysis ──────────────────────────────────────────────────

const REVIEW_ANALYSIS_PROMPT = `You are an AI analyst for a vacation rental property management company. Analyze the following guest review and extract structured insights.

Review Text: "{reviewText}"
Rating: {rating}/10
Property: {propertyName}

Respond with a JSON object matching this exact schema:
{
  "categories": ["cleaning", "maintenance", "amenities", "location", "communication", "value", "experience"],
  "sentimentScore": <number from -100 to 100>,
  "issues": [
    {
      "type": "<cleaning|maintenance|safety|noise|amenity|pest|temperature|other>",
      "description": "<brief description of the issue>",
      "severity": "<low|medium|high|critical>",
      "quote": "<exact text from the review>"
    }
  ],
  "highlights": ["<positive aspects mentioned>"],
  "cleanerMentioned": "<name if a cleaner/housekeeper is mentioned, otherwise null>",
  "summary": "<one-sentence summary of the review>"
}

Rules:
- Only include categories that are actually discussed in the review
- sentimentScore: -100 = extremely negative, 0 = neutral, 100 = extremely positive
- Only include issues if there are actual problems mentioned
- highlights should capture specific positive mentions
- cleanerMentioned should be null if no specific cleaner/housekeeper name is mentioned
- Be precise with quotes — use exact text from the review`;

export async function analyzeReview(reviewId: number): Promise<boolean> {
  const review = await getReviewById(reviewId);
  if (!review || !review.text) return false;

  try {
    const prompt = REVIEW_ANALYSIS_PROMPT
      .replace("{reviewText}", review.text)
      .replace("{rating}", String(review.rating || 0))
      .replace("{propertyName}", "Property #" + review.listingId);

    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are a precise JSON-only analyst. Return only valid JSON, no markdown." },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "review_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              categories: { type: "array", items: { type: "string" } },
              sentimentScore: { type: "integer" },
              issues: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string" },
                    description: { type: "string" },
                    severity: { type: "string" },
                    quote: { type: "string" },
                  },
                  required: ["type", "description", "severity", "quote"],
                  additionalProperties: false,
                },
              },
              highlights: { type: "array", items: { type: "string" } },
              cleanerMentioned: { type: ["string", "null"] },
              summary: { type: "string" },
            },
            required: ["categories", "sentimentScore", "issues", "highlights", "cleanerMentioned", "summary"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content as string | undefined;
    if (!content) return false;

    const analysis = JSON.parse(content);

    await upsertReviewAnalysis({
      reviewId: review.id,
      listingId: review.listingId,
      categories: analysis.categories,
      sentimentScore: analysis.sentimentScore,
      issues: analysis.issues,
      highlights: analysis.highlights,
      cleanerMentioned: analysis.cleanerMentioned || null,
      summary: analysis.summary,
    });

    return true;
  } catch (err) {
    console.error(`[AI] Failed to analyze review ${reviewId}:`, err);
    return false;
  }
}

/**
 * Batch analyze unanalyzed reviews (small batch, synchronous)
 */
export async function analyzeUnanalyzedReviews(batchSize = 20): Promise<{
  analyzed: number;
  errors: number;
  remaining: number;
}> {
  const unanalyzedIds = await getUnanalyzedReviewIds(batchSize);
  let analyzed = 0;
  let errors = 0;

  for (const id of unanalyzedIds) {
    const success = await analyzeReview(id);
    if (success) analyzed++;
    else errors++;
    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 200));
  }

  // Check how many remain
  const remainingIds = await getUnanalyzedReviewIds(1);
  const remaining = remainingIds.length > 0 ? -1 : 0; // -1 means "more exist"

  return { analyzed, errors, remaining };
}

// ── Background Job System ────────────────────────────────────────────

export interface AnalysisJobStatus {
  jobId: string;
  status: "running" | "completed" | "stopped" | "error";
  analyzed: number;
  errors: number;
  total: number;
  startedAt: number;
  updatedAt: number;
  message?: string;
}

// In-memory job store (single server deployment)
const analysisJobs = new Map<string, AnalysisJobStatus>();

export function getAnalysisJobStatus(jobId: string): AnalysisJobStatus | null {
  return analysisJobs.get(jobId) || null;
}

export function getLatestAnalysisJob(): AnalysisJobStatus | null {
  if (analysisJobs.size === 0) return null;
  // Return the most recently started job
  let latest: AnalysisJobStatus | null = null;
  for (const job of analysisJobs.values()) {
    if (!latest || job.startedAt > latest.startedAt) latest = job;
  }
  return latest;
}

export function stopAnalysisJob(jobId: string): boolean {
  const job = analysisJobs.get(jobId);
  if (!job || job.status !== "running") return false;
  job.status = "stopped";
  job.updatedAt = Date.now();
  job.message = "Stopped by user";
  return true;
}

/**
 * Start a background analysis job that processes ALL unanalyzed reviews.
 * Returns immediately with a job ID — use getAnalysisJobStatus to poll progress.
 * Processes in batches of 50 with delays to avoid rate limiting.
 */
export async function startBackgroundAnalysisJob(): Promise<string> {
  // Check if there's already a running job
  for (const job of analysisJobs.values()) {
    if (job.status === "running") {
      return job.jobId; // Return existing job ID
    }
  }

  const jobId = `job_${Date.now()}`;
  const totalCount = await countUnanalyzedReviews();

  const jobStatus: AnalysisJobStatus = {
    jobId,
    status: "running",
    analyzed: 0,
    errors: 0,
    total: totalCount,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    message: `Starting analysis of ${totalCount} reviews...`,
  };
  analysisJobs.set(jobId, jobStatus);

  // Clean up old completed jobs (keep last 5)
  const allJobs = [...analysisJobs.entries()].sort(([, a], [, b]) => b.startedAt - a.startedAt);
  if (allJobs.length > 5) {
    for (const [id] of allJobs.slice(5)) {
      analysisJobs.delete(id);
    }
  }

  // Run background processing (non-blocking)
  setImmediate(async () => {
    const BATCH_SIZE = 50;
    let totalAnalyzed = 0;
    let totalErrors = 0;

    try {
      while (true) {
        // Check if stopped
        const currentJob = analysisJobs.get(jobId);
        if (!currentJob || currentJob.status !== "running") break;

        // Get next batch of unanalyzed review IDs
        const ids = await getUnanalyzedReviewIds(BATCH_SIZE);
        if (ids.length === 0) break; // All done

        // Process each review in the batch
        for (const id of ids) {
          const currentJob2 = analysisJobs.get(jobId);
          if (!currentJob2 || currentJob2.status !== "running") break;

          const success = await analyzeReview(id);
          if (success) totalAnalyzed++;
          else totalErrors++;

          // Update progress
          currentJob2.analyzed = totalAnalyzed;
          currentJob2.errors = totalErrors;
          currentJob2.updatedAt = Date.now();
          currentJob2.message = `Analyzing... ${totalAnalyzed} done, ${totalErrors} errors`;

          // Small delay between reviews to avoid rate limiting
          await new Promise((r) => setTimeout(r, 150));
        }

        // Small delay between batches
        await new Promise((r) => setTimeout(r, 500));
      }

      // Mark as completed
      const finalJob = analysisJobs.get(jobId);
      if (finalJob && finalJob.status === "running") {
        finalJob.status = "completed";
        finalJob.updatedAt = Date.now();
        finalJob.message = `Completed! Analyzed ${totalAnalyzed} reviews (${totalErrors} errors)`;
        console.log(`[AnalysisJob] ${jobId} completed: ${totalAnalyzed} analyzed, ${totalErrors} errors`);
      }
    } catch (err: any) {
      const errJob = analysisJobs.get(jobId);
      if (errJob) {
        errJob.status = "error";
        errJob.updatedAt = Date.now();
        errJob.message = `Error: ${err.message}`;
        console.error(`[AnalysisJob] ${jobId} failed:`, err.message);
      }
    }
  });

  return jobId;
}

// ── Guest Message Analysis ───────────────────────────────────────────

const MESSAGE_ANALYSIS_PROMPT = `You are an AI analyst for a vacation rental property management company. Analyze the following guest message and categorize it.

Message: "{messageBody}"
Guest: {guestName}

Respond with a JSON object matching this exact schema:
{
  "category": "<cleaning|maintenance|improvement|compliment|question|complaint|other>",
  "sentiment": "<positive|neutral|negative>",
  "urgency": "<low|medium|high|critical>",
  "summary": "<one-sentence summary>",
  "issues": ["<specific issues mentioned, if any>"],
  "actionItems": ["<suggested steps to resolve or prevent this issue next time>"]
}

Rules:
- category: the primary topic of the message
- urgency: critical = safety/health hazard, high = needs same-day response, medium = within 24h, low = informational
- issues: extract specific actionable items (e.g., "broken AC", "stained towels")
- actionItems: for negative sentiment or actionable categories (maintenance, cleaning, complaint), suggest concrete steps to resolve or prevent the issue. For compliments/questions, return an empty array.
- Be concise and precise

IMPORTANT CLASSIFICATION RULES:

1. QUESTIONS ARE QUESTIONS: If a guest is simply asking a question — about checkout time, directions, recommendations, trash disposal, local attractions, how something works, etc. — classify as "question" with "low" urgency. These are routine guest communications that the team answers in real time. Do NOT reclassify questions as complaints or maintenance unless the guest is clearly reporting something broken or not working.

2. ONLY FLAG REAL PROBLEMS: Only classify as "maintenance", "cleaning", or "complaint" when the guest is reporting an actual issue — something broken, dirty, not working, missing, or malfunctioning. Examples: "The AC isn't cooling", "There's a leak under the sink", "The bathroom wasn't clean". NOT: "Where's the trash can?", "What time is checkout?", "Can you recommend restaurants?"

3. IMPROVEMENT SUGGESTIONS: If a guest says "it would be nice if...", "the only thing missing is...", "I wish there was...", or similar phrasing, classify as "improvement" with "low" urgency.

4. ESCALATION DETECTION: If the guest mentions "refund", "leaving early", "calling Airbnb", "calling VRBO", "contacting support", "disappointed", "unacceptable", "worst", "disgusting", "health department", "unsafe", or similar escalation language, ALWAYS set urgency to "critical" regardless of other factors.

5. APPLIANCE/SYSTEM ISSUES: Any mention of AC, heating, hot water, plumbing, electrical, appliance not working, strange noises, or temperature problems should be classified as "maintenance" with at least "high" urgency — these are real problems that need same-day resolution.

6. WHEN IN DOUBT — CLASSIFY AS "question" WITH "low" URGENCY. It is far better to miss a borderline case than to create unnecessary tasks from routine guest communications.`;

export async function analyzeGuestMessages(batchSize = 20): Promise<{
  analyzed: number;
  errors: number;
}> {
  const messages = await getUnanalyzedGuestMessages(batchSize);
  let analyzed = 0;
  let errors = 0;

  for (const msg of messages) {
    if (!msg.body || msg.body.trim().length < 10) {
      // Skip very short messages
      await updateGuestMessageAnalysis(msg.id, {
        aiCategory: "other",
        aiSentiment: "neutral",
        aiUrgency: "low",
        aiSummary: "Short/empty message",
        aiIssues: [],
      });
      analyzed++;
      continue;
    }

    try {
      const prompt = MESSAGE_ANALYSIS_PROMPT
        .replace("{messageBody}", msg.body.slice(0, 2000))
        .replace("{guestName}", msg.guestName || "Unknown");

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are a precise JSON-only analyst. Return only valid JSON, no markdown." },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "message_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                category: { type: "string" },
                sentiment: { type: "string" },
                urgency: { type: "string" },
                summary: { type: "string" },
                issues: { type: "array", items: { type: "string" } },
                actionItems: { type: "array", items: { type: "string" } },
              },
              required: ["category", "sentiment", "urgency", "summary", "issues", "actionItems"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string | undefined;
      if (!content) {
        errors++;
        continue;
      }

      const result = JSON.parse(content);

      // Map to valid enum values
      const validCategories = ["cleaning", "maintenance", "improvement", "compliment", "question", "complaint", "other"] as const;
      const validSentiments = ["positive", "neutral", "negative"] as const;
      const validUrgencies = ["low", "medium", "high", "critical"] as const;

      const category = validCategories.includes(result.category) ? result.category : "other";
      const sentiment = validSentiments.includes(result.sentiment) ? result.sentiment : "neutral";
      const urgency = validUrgencies.includes(result.urgency) ? result.urgency : "low";

      await updateGuestMessageAnalysis(msg.id, {
        aiCategory: category as any,
        aiSentiment: sentiment as any,
        aiUrgency: urgency as any,
        aiSummary: result.summary || null,
        aiIssues: result.issues || [],
        aiActionItems: result.actionItems || [],
      });

      analyzed++;
    } catch (err) {
      console.error(`[AI] Failed to analyze message ${msg.id}:`, err);
      errors++;
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  return { analyzed, errors };
}
