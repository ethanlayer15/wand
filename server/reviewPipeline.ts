/**
 * Review Pipeline — syncs reviews from Hostaway, runs AI analysis,
 * and creates tasks from actionable items.
 *
 * Flow:
 * 1. Sync reviews from Hostaway API (both public reviews and private feedback)
 * 2. Mark pre-2026 unanalyzed reviews as analyzed (skip AI) to clear backlog
 * 3. Run AI analysis on unanalyzed 2026+ reviews to detect actionable items
 * 4. Create tasks from actionable reviews (confidence-based routing)
 *
 * Deduplication: keyed on hostawayReviewId — only one task per review.
 * HIGH confidence actionable items → task in "In Queue" (created)
 * LOWER confidence items → task in "Ideas for Later" (ideas_for_later)
 */

import { eq, and, isNull, sql, gte, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { reviews, tasks, listings } from "../drizzle/schema";
import type { Review, InsertTask } from "../drizzle/schema";
import { getHostawayClient } from "./hostaway";
import { invokeLLM } from "./_core/llm";
import { ENV } from "./_core/env";

// ── Constants ─────────────────────────────────────────────────────────────

/** Only run AI analysis + task creation for reviews from March 20, 2026 onward.
 *  Older reviews are still synced to the DB for the Analyze page scores/stats.
 *  Exported so other modules (aiAnalysis, db helpers) can share the same cutoff. */
export const ANALYSIS_CUTOFF_DATE = new Date("2026-03-20T00:00:00Z");

// ── Helpers ─────────────────────────────────────────────────────────────

async function getDb() {
  if (!ENV.databaseUrl) return null;
  return drizzle({ connection: { uri: ENV.databaseUrl } });
}

// ── Step 1: Sync Reviews from Hostaway ─────────────────────────────────

export async function syncHostawayReviews(): Promise<{ synced: number; total: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, total: 0 };

  const client = getHostawayClient();
  let synced = 0;

  // Fetch all reviews (paginated)
  const allReviews = await client.getAllReviews();
  console.log(`[ReviewPipeline] Fetched ${allReviews.length} reviews from Hostaway`);

  // Get existing review IDs to avoid re-inserting
  const existingReviews = await db
    .select({ hostawayReviewId: reviews.hostawayReviewId })
    .from(reviews);
  const existingIds = new Set(existingReviews.map((r) => r.hostawayReviewId));

  // Look up listing IDs from our DB
  const listingRows = await db
    .select({ id: listings.id, hostawayId: listings.hostawayId })
    .from(listings);
  const listingMap = new Map(listingRows.map((l) => [l.hostawayId, l.id]));

  for (const review of allReviews) {
    const reviewIdStr = String(review.id);
    if (existingIds.has(reviewIdStr)) continue;

    // Only sync published guest reviews
    // 1. Must be published (skip drafts, pending, etc.)
    if (review.status && review.status !== "published") continue;
    // 2. Must be from guest, not host (guest-to-host)
    if (review.type && review.type !== "guest-to-host") continue;

    const localListingId = listingMap.get(String(review.listingMapId));
    if (!localListingId) {
      console.warn(`[ReviewPipeline] No local listing for Hostaway listing ${review.listingMapId}, skipping review ${review.id}`);
      continue;
    }

    // Map channel to source
    let source: "airbnb" | "vrbo" | "booking" | "direct" = "airbnb";
    if (review.channelId) {
      // Common Hostaway channel IDs: 2005 = Airbnb, 2004 = VRBO, 2003 = Booking.com
      if (review.channelId === 2004) source = "vrbo";
      else if (review.channelId === 2003) source = "booking";
      else if (review.channelId === 2005) source = "airbnb";
      else source = "direct";
    }

    // Extract Airbnb cleanliness sub-score from category ratings
    // Hostaway returns categoryRatings as an object like { cleanliness: 5, accuracy: 4, ... }
    let cleanlinessRating: number | null = null;
    if (review.categoryRatings?.cleanliness) {
      cleanlinessRating = Number(review.categoryRatings.cleanliness);
    } else if (review.subRatings?.cleanliness) {
      cleanlinessRating = Number(review.subRatings.cleanliness);
    }

    try {
      await db.insert(reviews).values({
        hostawayReviewId: reviewIdStr,
        listingId: localListingId,
        hostawayReservationId: review.reservationId ? String(review.reservationId) : null,
        rating: review.rating || null,
        cleanlinessRating,
        text: review.publicReview || null,
        privateFeedback: review.privateFeedback || null,
        guestName: review.guestName || review.reviewerName || null,
        source,
        reviewStatus: review.status || null,
        reviewType: review.type || "guest-to-host",
        submittedAt: review.submittedAt ? new Date(review.submittedAt) : null,
        arrivalDate: review.arrivalDate ? new Date(review.arrivalDate) : null,
        departureDate: review.departureDate ? new Date(review.departureDate) : null,
        channelId: review.channelId || null,
        isAnalyzed: false,
        aiActionable: false,
      });
      synced++;
    } catch (err: any) {
      // Duplicate key errors are expected for concurrent syncs
      if (!err.message?.includes("Duplicate entry")) {
        console.error(`[ReviewPipeline] Failed to insert review ${review.id}:`, err.message);
      }
    }
  }

  console.log(`[ReviewPipeline] Synced ${synced} new reviews (${allReviews.length} total from Hostaway)`);
  return { synced, total: allReviews.length };
}

// ── Step 1b: Mark pre-2026 reviews as analyzed ─────────────────────────

/**
 * Bulk-mark all unanalyzed reviews from before 2026 as analyzed (no AI).
 * This clears the backlog so the pipeline only processes recent reviews.
 */
export async function markOldReviewsAsAnalyzed(): Promise<{ marked: number }> {
  const db = await getDb();
  if (!db) return { marked: 0 };

  // Mark reviews with submittedAt before 2026 OR submittedAt is NULL as analyzed
  const result = await db
    .update(reviews)
    .set({
      isAnalyzed: true,
      aiActionable: false,
      aiConfidence: "low",
      aiSummary: "Skipped — review predates 2026 analysis cutoff",
    })
    .where(
      and(
        eq(reviews.isAnalyzed, false),
        or(
          lt(reviews.submittedAt, ANALYSIS_CUTOFF_DATE),
          isNull(reviews.submittedAt)
        )
      )
    );

  const marked = (result as any)[0]?.affectedRows ?? 0;
  console.log(`[ReviewPipeline] Marked ${marked} pre-2026 reviews as analyzed (skipped AI)`);
  return { marked };
}

// ── Step 2: AI Analysis ────────────────────────────────────────────────

const REVIEW_TASK_ANALYSIS_PROMPT = `You are an AI analyst for a vacation rental property management company called Wand. Analyze the following guest review and determine if it contains actionable items that should become maintenance/improvement tasks.

PUBLIC REVIEW:
"{publicReview}"

PRIVATE FEEDBACK:
"{privateFeedback}"

Guest: {guestName}
Rating: {rating}/5
Property: {propertyName}

Respond with a JSON object matching this exact schema:
{
  "actionable": <true if there are concrete issues or improvements that can be acted on>,
  "confidence": "<high|medium|low>",
  "summary": "<one-sentence summary of actionable items, or 'No actionable items' if none>",
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
  "taskPriority": "<low|medium|high>"
}

Rules:
- actionable = true ONLY for concrete, specific issues that can be fixed or improved
  Examples of ACTIONABLE: "faucet was leaking", "AC wasn't working", "bathroom wasn't clean", "wish there was a coffee maker"
  Examples of NOT ACTIONABLE: "everything was perfect", "great location", "loved the view", "host was responsive"
- confidence: high = clear specific issue, medium = somewhat vague but likely actionable, low = very vague or uncertain
- Analyze BOTH the public review AND private feedback — private feedback is often more honest
- If the review is purely positive praise with no actionable items, set actionable=false and issues=[]
- taskPriority: high = safety/health/major malfunction, medium = comfort/cleanliness, low = nice-to-have improvement
- Be conservative: when in doubt, set confidence to "low" rather than "high"`;

export async function analyzeReviewsForTasks(batchSize = 500): Promise<{
  analyzed: number;
  actionable: number;
  errors: number;
}> {
  const db = await getDb();
  if (!db) return { analyzed: 0, actionable: 0, errors: 0 };

  // Get unanalyzed reviews from 2026 onward only
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

  console.log(`[ReviewPipeline] Found ${unanalyzed.length} unanalyzed 2026+ reviews (batch limit: ${batchSize})`);

  let analyzed = 0;
  let actionableCount = 0;
  let errors = 0;

  // Get listing names for context
  const listingRows = await db
    .select({ id: listings.id, name: listings.name })
    .from(listings);
  const listingNameMap = new Map(listingRows.map((l) => [l.id, l.name]));

  for (const review of unanalyzed) {
    const publicText = review.text || "";
    const privateText = review.privateFeedback || "";

    // Skip reviews with no text content at all
    if (!publicText.trim() && !privateText.trim()) {
      await db
        .update(reviews)
        .set({
          isAnalyzed: true,
          aiActionable: false,
          aiConfidence: "low",
          aiSummary: "No review text available",
          aiIssues: [],
        })
        .where(eq(reviews.id, review.id));
      analyzed++;
      continue;
    }

    try {
      const propertyName = listingNameMap.get(review.listingId) || `Property #${review.listingId}`;
      const prompt = REVIEW_TASK_ANALYSIS_PROMPT
        .replace("{publicReview}", publicText.slice(0, 2000))
        .replace("{privateFeedback}", privateText.slice(0, 2000))
        .replace("{guestName}", review.guestName || "Unknown")
        .replace("{rating}", String(review.rating || "N/A"))
        .replace("{propertyName}", propertyName);

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are a precise JSON-only analyst. Return only valid JSON, no markdown." },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "review_task_analysis",
            strict: true,
            schema: {
              type: "object",
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
              },
              required: ["actionable", "confidence", "summary", "issues", "taskTitle", "taskCategory", "taskPriority"],
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

      await db
        .update(reviews)
        .set({
          isAnalyzed: true,
          aiActionable: result.actionable === true,
          aiConfidence: result.confidence || "low",
          aiSummary: result.summary || null,
          aiIssues: result.issues || [],
        })
        .where(eq(reviews.id, review.id));

      if (result.actionable) actionableCount++;
      analyzed++;
    } catch (err: any) {
      console.error(`[ReviewPipeline] Failed to analyze review ${review.id}:`, err.message);
      errors++;
    }

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[ReviewPipeline] Analyzed ${analyzed} reviews, ${actionableCount} actionable, ${errors} errors`);
  return { analyzed, actionable: actionableCount, errors };
}

// ── Step 3: Create Tasks from Actionable Reviews ───────────────────────

function mapReviewCategoryToTaskCategory(
  cat: string | null
): "maintenance" | "cleaning" | "improvements" {
  switch (cat) {
    case "cleaning":
      return "cleaning";
    case "improvements":
      return "improvements";
    default:
      return "maintenance";
  }
}

function mapReviewIssueTypeToTaskType(
  issueType: string | null
): "maintenance" | "housekeeping" | "inspection" | "safety" | "improvements" | "other" {
  switch (issueType) {
    case "cleaning":
      return "housekeeping";
    case "maintenance":
      return "maintenance";
    case "safety":
      return "safety";
    case "amenity":
      return "improvements";
    case "temperature":
      return "maintenance";
    case "pest":
      return "maintenance";
    default:
      return "other";
  }
}

function mapReviewPriorityToTaskPriority(
  priority: string | null
): "low" | "medium" | "high" {
  switch (priority) {
    case "high":
      return "high";
    case "medium":
      return "medium";
    default:
      return "low";
  }
}

export async function createTasksFromReviews(): Promise<{
  created: number;
  skipped: number;
}> {
  const db = await getDb();
  if (!db) return { created: 0, skipped: 0 };

  let created = 0;
  let skipped = 0;

  // Get analyzed, actionable reviews that don't have a task yet
  const actionableReviews = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.isAnalyzed, true),
        eq(reviews.aiActionable, true),
        isNull(reviews.taskId)
      )
    )
    .limit(500);

  console.log(`[ReviewPipeline] Found ${actionableReviews.length} actionable reviews without tasks`);

  // Get listing names for task descriptions
  const listingRows = await db
    .select({ id: listings.id, name: listings.name })
    .from(listings);
  const listingNameMap = new Map(listingRows.map((l) => [l.id, l.name]));

  for (const review of actionableReviews) {
    // Parse AI issues to build task description
    const issues = review.aiIssues || [];
    const propertyName = listingNameMap.get(review.listingId) || `Property #${review.listingId}`;

    // Determine status based on confidence
    // HIGH confidence → "created" (In Queue)
    // MEDIUM/LOW confidence → "ideas_for_later"
    const confidence = review.aiConfidence || "low";
    const status: "created" | "ideas_for_later" = confidence === "high" ? "created" : "ideas_for_later";

    // Build task title
    const title = review.aiSummary
      ? `Review: ${review.aiSummary.slice(0, 100)}`
      : `Review issue at ${propertyName}`;

    // Build task description with review context
    const descParts: string[] = [];
    descParts.push(`AI Summary: ${review.aiSummary || "N/A"}`);
    descParts.push(`Confidence: ${confidence}`);
    descParts.push(`Property: ${propertyName}`);
    descParts.push(`Guest: ${review.guestName || "Unknown"}`);
    if (review.rating) descParts.push(`Rating: ${review.rating}/5`);

    if (review.text) {
      descParts.push(`\nPublic Review:\n"${review.text.slice(0, 500)}"`);
    }
    if (review.privateFeedback) {
      descParts.push(`\nPrivate Feedback:\n"${review.privateFeedback.slice(0, 500)}"`);
    }

    if (issues.length > 0) {
      descParts.push(`\nDetected Issues:`);
      for (const issue of issues) {
        descParts.push(`  • [${issue.severity}] ${issue.description} — "${issue.quote}"`);
      }
    }

    if (review.submittedAt) {
      descParts.push(`\nReview Date: ${new Date(review.submittedAt).toLocaleDateString()}`);
    }

    // Determine category from issues
    let category: "maintenance" | "cleaning" | "improvements" = "maintenance";
    if (issues.length > 0) {
      const firstIssueType = issues[0].type;
      if (firstIssueType === "cleaning") category = "cleaning";
      else if (firstIssueType === "amenity") category = "improvements";
    }

    // Determine priority from issues
    let priority: "low" | "medium" | "high" = "low";
    if (issues.some((i: any) => i.severity === "critical" || i.severity === "high")) {
      priority = "high";
    } else if (issues.some((i: any) => i.severity === "medium")) {
      priority = "medium";
    }

    try {
      const taskValues: typeof tasks.$inferInsert = {
        externalId: review.hostawayReviewId,
        externalSource: "hostaway",
        listingId: review.listingId,
        title,
        description: descParts.join("\n"),
        priority,
        status,
        category,
        taskType: issues.length > 0 ? mapReviewIssueTypeToTaskType(issues[0].type) : "other",
        source: "review",
        hostawayReservationId: review.hostawayReservationId || undefined,
        arrivalDate: review.arrivalDate || undefined,
        departureDate: review.departureDate || undefined,
      };

      const result = await db.insert(tasks).values(taskValues);
      const newTaskId = (result as any)[0]?.insertId;

      if (!newTaskId) {
        console.error(`[ReviewPipeline] Insert succeeded but no insertId returned for review ${review.id}`);
        skipped++;
        continue;
      }

      // Link review to the task
      await db
        .update(reviews)
        .set({ taskId: newTaskId })
        .where(eq(reviews.id, review.id));

      console.log(`[ReviewPipeline] Created task ${newTaskId} from review ${review.id} (${confidence} confidence → ${status})`);
      created++;
    } catch (err: any) {
      console.error(`[ReviewPipeline] Failed to create task for review ${review.id}:`, err.message);
      skipped++;
    }
  }

  console.log(`[ReviewPipeline] Created ${created} tasks from reviews, skipped ${skipped}`);
  return { created, skipped };
}

// ── Background Job State ────────────────────────────────────────────────

export interface ReviewPipelineJobStatus {
  running: boolean;
  phase: "idle" | "syncing" | "analyzing" | "creating_tasks" | "done" | "error";
  synced: number;
  analyzed: number;
  actionable: number;
  tasksCreated: number;
  oldMarked: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

let reviewPipelineJob: ReviewPipelineJobStatus = {
  running: false,
  phase: "idle",
  synced: 0,
  analyzed: 0,
  actionable: 0,
  tasksCreated: 0,
  oldMarked: 0,
};

export function getReviewPipelineJobStatus(): ReviewPipelineJobStatus {
  return { ...reviewPipelineJob };
}

// ── Main Pipeline ───────────────────────────────────────────────────────

export async function runReviewPipeline(): Promise<{
  synced: number;
  analyzed: number;
  actionable: number;
  tasksCreated: number;
  oldMarked: number;
}> {
  let synced = 0;
  let analyzed = 0;
  let actionable = 0;
  let tasksCreated = 0;
  let oldMarked = 0;

  // Step 1: Sync reviews from Hostaway
  reviewPipelineJob.phase = "syncing";
  try {
    const syncResult = await syncHostawayReviews();
    synced = syncResult.synced;
    reviewPipelineJob.synced = synced;
    console.log(`[ReviewPipeline] Synced ${synced} reviews`);
  } catch (err: any) {
    console.error("[ReviewPipeline] Review sync failed:", err.message);
  }

  // Step 1b: Mark pre-2026 reviews as analyzed (skip AI)
  try {
    const markResult = await markOldReviewsAsAnalyzed();
    oldMarked = markResult.marked;
    reviewPipelineJob.oldMarked = oldMarked;
    if (oldMarked > 0) {
      console.log(`[ReviewPipeline] Marked ${oldMarked} pre-2026 reviews as analyzed`);
    }
  } catch (err: any) {
    console.error("[ReviewPipeline] Marking old reviews failed:", err.message);
  }

  // Step 2: AI analysis on unanalyzed 2026+ reviews (up to 500 per run)
  reviewPipelineJob.phase = "analyzing";
  try {
    const analysisResult = await analyzeReviewsForTasks(500);
    analyzed = analysisResult.analyzed;
    actionable = analysisResult.actionable;
    reviewPipelineJob.analyzed = analyzed;
    reviewPipelineJob.actionable = actionable;
    console.log(`[ReviewPipeline] Analyzed ${analyzed} reviews, ${actionable} actionable`);
  } catch (err: any) {
    console.error("[ReviewPipeline] Review analysis failed:", err.message);
  }

  // Step 3: Create tasks from actionable reviews
  reviewPipelineJob.phase = "creating_tasks";
  try {
    const taskResult = await createTasksFromReviews();
    tasksCreated = taskResult.created;
    reviewPipelineJob.tasksCreated = tasksCreated;
    console.log(`[ReviewPipeline] Created ${tasksCreated} tasks from reviews`);
  } catch (err: any) {
    console.error("[ReviewPipeline] Task creation from reviews failed:", err.message);
  }

  return { synced, analyzed, actionable, tasksCreated, oldMarked };
}

/**
 * Start the review pipeline as a background job. Returns immediately.
 * Use getReviewPipelineJobStatus() to poll for progress.
 */
export function startReviewPipelineJob(): { started: boolean; message: string } {
  if (reviewPipelineJob.running) {
    return { started: false, message: "Review pipeline is already running" };
  }

  reviewPipelineJob = {
    running: true,
    phase: "syncing",
    synced: 0,
    analyzed: 0,
    actionable: 0,
    tasksCreated: 0,
    oldMarked: 0,
    startedAt: Date.now(),
  };

  // Run in background — do NOT await
  runReviewPipeline()
    .then((result) => {
      reviewPipelineJob = {
        ...reviewPipelineJob,
        running: false,
        phase: "done",
        synced: result.synced,
        analyzed: result.analyzed,
        actionable: result.actionable,
        tasksCreated: result.tasksCreated,
        oldMarked: result.oldMarked,
        completedAt: Date.now(),
      };
      console.log("[ReviewPipeline] Background pipeline completed:", result);
    })
    .catch((err) => {
      reviewPipelineJob = {
        ...reviewPipelineJob,
        running: false,
        phase: "error",
        error: err.message,
        completedAt: Date.now(),
      };
      console.error("[ReviewPipeline] Background pipeline failed:", err.message);
    });

  return { started: true, message: "Review pipeline started in background" };
}
