/**
 * Unified Review Intelligence Analyzer
 * ────────────────────────────────────────────────────────────────────────
 * This replaces the two overlapping review analyzers that used to live in
 * `reviewPipeline.ts` (task-oriented) and `aiAnalysis.ts` (sentiment-oriented).
 *
 * Single LLM call per review produces a UNION of both analyses:
 *   • Task-routing fields → written to reviews.ai* columns
 *     (actionable, confidence, summary, issues, taskTitle/Category/Priority)
 *   • Sentiment/category fields → mirrored into both reviews.ai* AND the
 *     reviewAnalysis table for backwards-compatible consumers
 *     (sentimentScore, categories, highlights, cleanerMentioned)
 *
 * Inputs fed to the model:
 *   • publicReview (reviews.text)
 *   • privateFeedback (reviews.privateFeedback)
 *   • hostResponse (reviews.hostResponse) — so the analyzer doesn't re-surface
 *     issues the host already addressed
 *   • rating, propertyName, guestName
 *
 * Consumers:
 *   • `reviewPipeline.analyzeReviewsForTasks` delegates to the batch wrapper
 *   • `aiAnalysis.analyzeReview` / `analyzeUnanalyzedReviews` delegate too
 *   • `compensationRouter.calculateCleanerRollingScore` reads from either
 *     reviews.aiIssues OR reviewAnalysis.issues and this keeps both alive.
 */

import { eq, and, isNull, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { reviews, listings, reviewAnalysis } from "../drizzle/schema";
import type { Review } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { ENV } from "./_core/env";

// Keep in sync with reviewPipeline.ANALYSIS_CUTOFF_DATE
import { ANALYSIS_CUTOFF_DATE } from "./reviewPipeline";

// ── Types ───────────────────────────────────────────────────────────────

export interface UnifiedReviewAnalysis {
  // Task-routing
  actionable: boolean;
  confidence: "high" | "medium" | "low";
  summary: string;
  issues: Array<{
    type: string;
    description: string;
    severity: "low" | "medium" | "high" | "critical";
    quote: string;
    confidence: "high" | "medium" | "low";
  }>;
  taskTitle: string | null;
  taskCategory: "maintenance" | "cleaning" | "improvements";
  taskPriority: "low" | "medium" | "high";

  // Sentiment / categorization
  sentimentScore: number;        // -100 to 100
  categories: string[];          // e.g. ["cleaning", "communication", "value"]
  highlights: string[];          // positive mentions
  cleanerMentioned: string | null;
}

async function getDb() {
  if (!ENV.databaseUrl) return null;
  return drizzle({ connection: { uri: ENV.databaseUrl } });
}

// ── Prompt ──────────────────────────────────────────────────────────────

const UNIFIED_PROMPT = `You are an AI analyst for a vacation rental property management company called Wand. Analyze the following guest review and produce BOTH a task-routing verdict AND a sentiment / category breakdown in a single JSON object.

PUBLIC REVIEW:
"{publicReview}"

PRIVATE FEEDBACK:
"{privateFeedback}"

EXISTING HOST RESPONSE (if any — do not re-surface issues the host already addressed):
"{hostResponse}"

Guest: {guestName}
Rating: {rating}/5
Property: {propertyName}

Respond with a JSON object matching this exact schema:
{
  "actionable": <true if there are concrete issues or improvements that can be acted on>,
  "confidence": "<high|medium|low>",
  "summary": "<one-sentence summary of the review — include actionable items if any>",
  "issues": [
    {
      "type": "<maintenance|cleaning|safety|amenity|temperature|pest|noise|other>",
      "description": "<brief description of the actionable item>",
      "severity": "<low|medium|high|critical>",
      "quote": "<exact text from the review>",
      "confidence": "<high|medium|low>"
    }
  ],
  "taskTitle": "<suggested task title if actionable, otherwise null>",
  "taskCategory": "<maintenance|cleaning|improvements>",
  "taskPriority": "<low|medium|high>",
  "sentimentScore": <number from -100 to 100>,
  "categories": ["<any of: cleaning, maintenance, amenities, location, communication, value, experience>"],
  "highlights": ["<specific positive aspects mentioned>"],
  "cleanerMentioned": "<name if a cleaner/housekeeper is mentioned by name, otherwise null>"
}

Rules:
- actionable = true ONLY for concrete, specific issues that can be fixed or improved.
  ACTIONABLE examples: "faucet was leaking", "AC wasn't working", "bathroom wasn't clean", "wish there was a coffee maker"
  NOT actionable: "everything was perfect", "great location", "loved the view", "host was responsive"
- If the host response already addressed an issue (apology, refund offered, fix confirmed), you may lower confidence or exclude it from issues — use judgement.
- confidence: high = clear specific issue, medium = somewhat vague but likely actionable, low = very vague or uncertain.
- Analyze BOTH the public review AND private feedback — private feedback is often more honest.
- taskPriority: high = safety/health/major malfunction, medium = comfort/cleanliness, low = nice-to-have improvement.
- sentimentScore: -100 = extremely negative, 0 = neutral, 100 = extremely positive.
- categories: only include categories actually discussed in the review.
- highlights: extract specific positive mentions (empty array if none).
- cleanerMentioned: null unless a specific cleaner/housekeeper name is mentioned.
- Be conservative: when in doubt, set confidence to "low" rather than "high".`;

const UNIFIED_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    actionable: { type: "boolean" },
    confidence: { type: "string" },
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          description: { type: "string" },
          severity: { type: "string" },
          quote: { type: "string" },
          confidence: { type: "string" },
        },
        required: ["type", "description", "severity", "quote", "confidence"],
        additionalProperties: false,
      },
    },
    taskTitle: { type: ["string", "null"] },
    taskCategory: { type: "string" },
    taskPriority: { type: "string" },
    sentimentScore: { type: "number" },
    categories: { type: "array", items: { type: "string" } },
    highlights: { type: "array", items: { type: "string" } },
    cleanerMentioned: { type: ["string", "null"] },
  },
  required: [
    "actionable",
    "confidence",
    "summary",
    "issues",
    "taskTitle",
    "taskCategory",
    "taskPriority",
    "sentimentScore",
    "categories",
    "highlights",
    "cleanerMentioned",
  ],
  additionalProperties: false,
};

// ── Core: analyze one review ────────────────────────────────────────────

/**
 * Run the unified analyzer on a single review and persist the results to
 * BOTH the reviews.ai* columns AND the reviewAnalysis table.
 *
 * Returns the analysis object so callers can use it for task creation.
 */
export async function analyzeReviewUnified(
  review: Review,
  opts?: { propertyName?: string }
): Promise<UnifiedReviewAnalysis | null> {
  const publicText = review.text?.trim() || "";
  const privateText = review.privateFeedback?.trim() || "";

  // Nothing to analyze — mark as analyzed with neutral defaults so we don't
  // keep picking this row up on every pipeline run.
  if (!publicText && !privateText) {
    await writeAnalysisToDb(review, {
      actionable: false,
      confidence: "low",
      summary: "No review text available",
      issues: [],
      taskTitle: null,
      taskCategory: "maintenance",
      taskPriority: "low",
      sentimentScore: 0,
      categories: [],
      highlights: [],
      cleanerMentioned: null,
    });
    return null;
  }

  const prompt = UNIFIED_PROMPT
    .replace("{publicReview}", publicText.slice(0, 2000) || "(none)")
    .replace("{privateFeedback}", privateText.slice(0, 2000) || "(none)")
    .replace("{hostResponse}", (review.hostResponse || "(none)").slice(0, 1000))
    .replace("{guestName}", review.guestName || "Unknown")
    .replace("{rating}", String(review.rating || "N/A"))
    .replace("{propertyName}", opts?.propertyName || `Property #${review.listingId}`);

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "You are a precise JSON-only analyst. Return only valid JSON, no markdown." },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "unified_review_analysis",
        strict: true,
        schema: UNIFIED_JSON_SCHEMA,
      },
    },
  });

  const content = response.choices?.[0]?.message?.content as string | undefined;
  if (!content) throw new Error("LLM returned empty content");

  const parsed = JSON.parse(content) as UnifiedReviewAnalysis;

  // Defensive normalization — LLM sometimes returns strings outside the enum.
  const confidence = normalizeConfidence(parsed.confidence);
  const taskPriority = normalizeTaskPriority(parsed.taskPriority);
  const taskCategory = normalizeTaskCategory(parsed.taskCategory);

  const normalized: UnifiedReviewAnalysis = {
    ...parsed,
    confidence,
    taskPriority,
    taskCategory,
    issues: (parsed.issues || []).map((i) => ({
      ...i,
      severity: normalizeSeverity(i.severity),
      confidence: normalizeConfidence(i.confidence),
    })),
    categories: parsed.categories || [],
    highlights: parsed.highlights || [],
    cleanerMentioned: parsed.cleanerMentioned || null,
    sentimentScore:
      typeof parsed.sentimentScore === "number" ? clamp(parsed.sentimentScore, -100, 100) : 0,
  };

  await writeAnalysisToDb(review, normalized);
  return normalized;
}

// ── Persistence ─────────────────────────────────────────────────────────

async function writeAnalysisToDb(
  review: Review,
  a: UnifiedReviewAnalysis
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // 1. Update reviews.ai* — the columns reviewPipeline + compensationRouter read.
  await db
    .update(reviews)
    .set({
      isAnalyzed: true,
      aiActionable: a.actionable === true,
      aiConfidence: a.confidence,
      aiSummary: a.summary || null,
      aiIssues: a.issues,
      aiSentimentScore: Math.round(a.sentimentScore),
      aiCategories: a.categories,
      aiHighlights: a.highlights,
      aiCleanerMentioned: a.cleanerMentioned || null,
    })
    .where(eq(reviews.id, review.id));

  // 2. Mirror into reviewAnalysis — legacy Analyze page + db.getReviewsWithAnalysis
  //    still read from this table. Keep it consistent via upsert.
  await db
    .insert(reviewAnalysis)
    .values({
      reviewId: review.id,
      listingId: review.listingId,
      categories: a.categories,
      sentimentScore: Math.round(a.sentimentScore),
      issues: a.issues.map((i) => ({
        type: i.type,
        description: i.description,
        severity: i.severity,
        quote: i.quote,
      })),
      highlights: a.highlights,
      cleanerMentioned: a.cleanerMentioned,
      summary: a.summary,
    })
    .onDuplicateKeyUpdate({
      set: {
        categories: a.categories,
        sentimentScore: Math.round(a.sentimentScore),
        issues: a.issues.map((i) => ({
          type: i.type,
          description: i.description,
          severity: i.severity,
          quote: i.quote,
        })),
        highlights: a.highlights,
        cleanerMentioned: a.cleanerMentioned,
        summary: a.summary,
        analyzedAt: new Date(),
      },
    });
}

// ── Batch wrapper used by reviewPipeline + aiAnalysis ──────────────────

/**
 * Analyze every un-analyzed 2026+ review in batches.
 *
 * Returns counts compatible with the legacy `analyzeReviewsForTasks` signature
 * so `reviewPipeline.runReviewPipeline` can swap to this without changing its
 * result shape.
 */
export async function analyzeUnanalyzedReviewsUnified(
  batchSize = 500
): Promise<{ analyzed: number; actionable: number; errors: number }> {
  const db = await getDb();
  if (!db) return { analyzed: 0, actionable: 0, errors: 0 };

  const unanalyzed = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.isAnalyzed, false),
        gte(reviews.submittedAt, ANALYSIS_CUTOFF_DATE)
      )
    )
    .limit(batchSize);

  console.log(`[ReviewAnalyzer] Analyzing ${unanalyzed.length} reviews (batch ${batchSize})`);

  // Preload listing names for prompt context
  const listingRows = await db
    .select({ id: listings.id, name: listings.name })
    .from(listings);
  const listingNameMap = new Map(listingRows.map((l) => [l.id, l.name]));

  let analyzed = 0;
  let actionable = 0;
  let errors = 0;

  for (const review of unanalyzed) {
    try {
      const result = await analyzeReviewUnified(review, {
        propertyName: listingNameMap.get(review.listingId) || undefined,
      });
      analyzed++;
      if (result?.actionable) actionable++;
    } catch (err: any) {
      console.error(`[ReviewAnalyzer] Failed review ${review.id}:`, err?.message || err);
      errors++;
    }
    // Rate-limit pacing
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(
    `[ReviewAnalyzer] Done: ${analyzed} analyzed, ${actionable} actionable, ${errors} errors`
  );
  return { analyzed, actionable, errors };
}

/**
 * Analyze one review by ID (used by the single-review path in aiAnalysis).
 */
export async function analyzeReviewByIdUnified(reviewId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const rows = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1);
  const review = rows[0];
  if (!review) return false;
  if (!review.text && !review.privateFeedback) return false;

  // Look up property name for better prompt context
  const listingRows = await db
    .select({ name: listings.name })
    .from(listings)
    .where(eq(listings.id, review.listingId))
    .limit(1);
  const propertyName = listingRows[0]?.name;

  try {
    await analyzeReviewUnified(review, { propertyName });
    return true;
  } catch (err: any) {
    console.error(`[ReviewAnalyzer] Failed to analyze review ${reviewId}:`, err?.message || err);
    return false;
  }
}

// ── Re-analyze all reviews (admin mutation) ─────────────────────────────

/**
 * Clear isAnalyzed on all 2026+ reviews so the next pipeline run re-analyzes
 * them with the unified analyzer. Safe to run — we keep reviewAnalysis rows
 * and just upsert them on re-run.
 */
export async function resetAnalysisState(): Promise<{ reset: number }> {
  const db = await getDb();
  if (!db) return { reset: 0 };

  const result = await db
    .update(reviews)
    .set({ isAnalyzed: false })
    .where(gte(reviews.submittedAt, ANALYSIS_CUTOFF_DATE));

  const reset = (result as any)[0]?.affectedRows ?? 0;
  console.log(`[ReviewAnalyzer] Reset isAnalyzed on ${reset} reviews`);
  return { reset };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function normalizeConfidence(v: string | null | undefined): "high" | "medium" | "low" {
  const s = (v || "").toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  return "low";
}

function normalizeSeverity(
  v: string | null | undefined
): "low" | "medium" | "high" | "critical" {
  const s = (v || "").toLowerCase();
  if (s === "low" || s === "medium" || s === "high" || s === "critical") return s;
  return "low";
}

function normalizeTaskPriority(v: string | null | undefined): "low" | "medium" | "high" {
  const s = (v || "").toLowerCase();
  if (s === "low" || s === "medium" || s === "high") return s;
  return "low";
}

function normalizeTaskCategory(
  v: string | null | undefined
): "maintenance" | "cleaning" | "improvements" {
  const s = (v || "").toLowerCase();
  if (s === "cleaning" || s === "improvements") return s;
  return "maintenance";
}
