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

  let updated = 0;
  for (const review of allReviews) {
    const reviewIdStr = String(review.id);
    // Only sync published guest reviews with content
    // 1. Must be published (skip drafts, pending, empty)
    if (review.status !== "published") continue;
    // 2. Must be from guest, not host (guest-to-host)
    if (review.type !== "guest-to-host") continue;
    // 3. Must have some content (skip empty shells)
    if (!review.publicReview && !review.privateFeedback && !review.rating) continue;

    const localListingId = listingMap.get(String(review.listingMapId));
    if (!localListingId) {
      console.warn(`[ReviewPipeline] No local listing for Hostaway listing ${review.listingMapId}, skipping review ${review.id}`);
      continue;
    }

    // Extract Airbnb cleanliness sub-score.
    // Hostaway returns sub-scores in a `reviewCategory` array (singular)
    // of { category: "cleanliness", rating: N } objects — NOT the nested
    // `categoryRatings` / `subRatings` objects we were previously checking.
    // Airbnb uses a 10-point scale; normalize to 5-point for consistency.
    let cleanlinessRating: number | null = null;
    if (Array.isArray(review.reviewCategory)) {
      const cleanCat = review.reviewCategory.find(
        (c: any) => c && typeof c.category === "string" && c.category.toLowerCase() === "cleanliness"
      );
      if (cleanCat?.rating != null) {
        const raw = Number(cleanCat.rating);
        if (!Number.isNaN(raw)) {
          cleanlinessRating = raw > 5 ? Math.round(raw / 2) : raw;
        }
      }
    }
    // Legacy fallbacks — older Hostaway payload shapes we used to see
    if (cleanlinessRating == null && review.categoryRatings?.cleanliness) {
      cleanlinessRating = Number(review.categoryRatings.cleanliness);
    } else if (cleanlinessRating == null && review.subRatings?.cleanliness) {
      cleanlinessRating = Number(review.subRatings.cleanliness);
    }

    // Map channel to source. Hostaway channel IDs: 2005/2018 = Airbnb,
    // 2004 = VRBO, 2003 = Booking.com. When channelId is missing or an
    // unrecognized value, fall back to the cleanlinessRating signal —
    // it's an Airbnb-exclusive field, so its presence is authoritative.
    let source: "airbnb" | "vrbo" | "booking" | "direct";
    if (review.channelId === 2004) source = "vrbo";
    else if (review.channelId === 2003) source = "booking";
    else if (review.channelId === 2005 || review.channelId === 2018) source = "airbnb";
    else if (cleanlinessRating != null) source = "airbnb";
    else if (review.channelId) source = "direct";
    else source = "airbnb";

    // Extract host response from Hostaway payload. Hostaway exposes this in
    // a few possible shapes depending on channel — check all of them.
    const hostResponseText: string | null =
      (typeof review.hostReview === "string" && review.hostReview.trim()) ||
      (typeof review.hostResponse === "string" && review.hostResponse.trim()) ||
      (typeof review.reply === "string" && review.reply.trim()) ||
      null;
    const hostResponseAt: Date | null = review.hostReviewAt
      ? new Date(review.hostReviewAt)
      : review.hostResponseAt
        ? new Date(review.hostResponseAt)
        : null;

    try {
      const isExisting = existingIds.has(reviewIdStr);

      // UPSERT — we need to pick up host-response changes on every sync,
      // not just on first insert. `isAnalyzed`/aiActionable/host-response-draft
      // fields are ONLY set on initial insert; re-syncs never clobber them.
      await db
        .insert(reviews)
        .values({
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
          hostResponse: hostResponseText,
          hostResponseSubmittedAt: hostResponseAt,
          hostResponseStatus: hostResponseText ? "submitted" : "none",
          isAnalyzed: false,
          aiActionable: false,
        })
        .onDuplicateKeyUpdate({
          set: {
            // Re-sync updatable Hostaway-owned fields. We intentionally skip
            // isAnalyzed / aiActionable / hostResponseDraft / hostResponseStatus
            // so re-syncs don't wipe our internal state.
            rating: review.rating || null,
            cleanlinessRating,
            text: review.publicReview || null,
            privateFeedback: review.privateFeedback || null,
            guestName: review.guestName || review.reviewerName || null,
            reviewStatus: review.status || null,
            submittedAt: review.submittedAt ? new Date(review.submittedAt) : null,
            arrivalDate: review.arrivalDate ? new Date(review.arrivalDate) : null,
            departureDate: review.departureDate ? new Date(review.departureDate) : null,
            channelId: review.channelId || null,
            hostResponse: hostResponseText,
            hostResponseSubmittedAt: hostResponseAt,
          },
        });
      if (isExisting) updated++;
      else synced++;
    } catch (err: any) {
      console.error(`[ReviewPipeline] Failed to upsert review ${review.id}:`, err.message);
    }
  }

  console.log(
    `[ReviewPipeline] Synced ${synced} new, ${updated} updated (${allReviews.length} total from Hostaway)`
  );
  return { synced, total: allReviews.length };
}

// ── Step 1a: Backfill cleanliness sub-scores ──────────────────────────

/**
 * One-shot backfill for reviews that were synced before the cleanliness
 * sub-score extraction bug was fixed. Re-fetches all reviews from Hostaway
 * and updates cleanlinessRating for rows where it's null but the Hostaway
 * payload has a `reviewCategory` entry with `category: "cleanliness"`.
 *
 * Safe to run multiple times — only updates rows with null cleanlinessRating.
 */
export async function backfillCleanlinessRatings(): Promise<{ updated: number; scanned: number }> {
  const db = await getDb();
  if (!db) return { updated: 0, scanned: 0 };

  const client = getHostawayClient();
  const allReviews = await client.getAllReviews();
  console.log(`[ReviewPipeline:backfill] Fetched ${allReviews.length} reviews from Hostaway`);

  let updated = 0;
  let scanned = 0;

  for (const review of allReviews) {
    scanned++;
    if (!Array.isArray(review.reviewCategory)) continue;
    const cleanCat = review.reviewCategory.find(
      (c: any) => c && typeof c.category === "string" && c.category.toLowerCase() === "cleanliness"
    );
    if (cleanCat?.rating == null) continue;
    const raw = Number(cleanCat.rating);
    if (Number.isNaN(raw)) continue;
    const normalized = raw > 5 ? Math.round(raw / 2) : raw;

    try {
      const result = await db
        .update(reviews)
        .set({ cleanlinessRating: normalized })
        .where(
          and(
            eq(reviews.hostawayReviewId, String(review.id)),
            isNull(reviews.cleanlinessRating)
          )
        );
      const affected = (result as any)[0]?.affectedRows ?? 0;
      if (affected > 0) updated++;
    } catch (err: any) {
      console.error(`[ReviewPipeline:backfill] Failed to update review ${review.id}:`, err.message);
    }
  }

  console.log(`[ReviewPipeline:backfill] Updated ${updated} reviews (scanned ${scanned})`);
  return { updated, scanned };
}

// ── Step 1b: Mark pre-2026 reviews as analyzed ─────────────────────────

/**
 * Bulk-mark all unanalyzed reviews from before 2026 as analyzed (no AI).
 * This clears the backlog so the pipeline only processes recent reviews.
 */
export async function markOldReviewsAsAnalyzed(): Promise<{ marked: number }> {
  const db = await getDb();
  if (!db) return { marked: 0 };

  // Mark reviews with submittedAt before the cutoff as analyzed.
  // IMPORTANT: Do NOT mark submittedAt=NULL reviews — they may be newly synced
  // reviews where Hostaway hasn't populated submittedAt yet. Those will get
  // a real submittedAt on the next sync and should be analyzed then.
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
        lt(reviews.submittedAt, ANALYSIS_CUTOFF_DATE)
      )
    );

  const marked = (result as any)[0]?.affectedRows ?? 0;
  console.log(`[ReviewPipeline] Marked ${marked} pre-2026 reviews as analyzed (skipped AI)`);
  return { marked };
}

// ── Step 2: AI Analysis ────────────────────────────────────────────────
//
// The real work lives in `./reviewAnalyzer.ts` now — a single LLM call that
// produces BOTH the task-routing verdict AND the sentiment/category/highlights
// schema, and writes to BOTH reviews.ai* and reviewAnalysis in one shot.
// `analyzeReviewsForTasks` below is kept as a thin wrapper so runReviewPipeline
// and the existing tests don't need to change.

// ── Legacy prompt (kept only for the optional private test harness) ────
// Left verbatim so `server/reviewPipelineAndColumns.test.ts` and any
// downstream imports still resolve. Not used by runReviewPipeline anymore.
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

/**
 * Run the unified review analyzer on any un-analyzed 2026+ reviews.
 *
 * This is now a thin wrapper around `reviewAnalyzer.analyzeUnanalyzedReviewsUnified`
 * — it exists for backwards compatibility with the pipeline orchestrator
 * below and any tests that import `analyzeReviewsForTasks`.
 */
export async function analyzeReviewsForTasks(batchSize = 500): Promise<{
  analyzed: number;
  actionable: number;
  errors: number;
}> {
  // Lazy import to avoid circular dependency on ANALYSIS_CUTOFF_DATE
  const { analyzeUnanalyzedReviewsUnified } = await import("./reviewAnalyzer");
  return analyzeUnanalyzedReviewsUnified(batchSize);
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

    // Build task title — use AI-generated action title when available
    const title = review.aiTaskTitle
      ? review.aiTaskTitle
      : review.aiSummary
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
      const { getDefaultBoardId } = await import("./db");
      const boardId = await getDefaultBoardId();

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
        boardId: boardId ?? undefined,
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

  // Step 1: Sync reviews from Hostaway (upsert — updates host-response too)
  reviewPipelineJob.phase = "syncing";
  try {
    const syncResult = await syncHostawayReviews();
    synced = syncResult.synced;
    reviewPipelineJob.synced = synced;
    console.log(`[ReviewPipeline] Synced ${synced} reviews`);
  } catch (err: any) {
    console.error("[ReviewPipeline] Review sync failed:", err.message);
  }

  // Step 1a: Backfill any reviews where we have the Hostaway payload cached
  // but cleanlinessRating is still null (only touches rows where it's null —
  // safe to run on every pipeline invocation).
  try {
    const backfillResult = await backfillCleanlinessRatings();
    if (backfillResult.updated > 0) {
      console.log(
        `[ReviewPipeline] Backfilled cleanliness on ${backfillResult.updated} reviews`
      );
    }
  } catch (err: any) {
    console.error("[ReviewPipeline] Cleanliness backfill failed:", err.message);
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

  // Step 1c: Repair reviews that were wrongly marked as "Skipped" —
  // these have submittedAt >= cutoff but got caught by the old NULL check.
  // Also reset reviews that now have text/rating but were marked skipped.
  try {
    const db = await getDb();
    if (db) {
      const repairResult = await db
        .update(reviews)
        .set({
          isAnalyzed: false,
          aiActionable: false,
          aiSummary: null,
          aiConfidence: null,
        })
        .where(
          and(
            eq(reviews.isAnalyzed, true),
            eq(reviews.aiSummary, "Skipped — review predates 2026 analysis cutoff"),
            gte(reviews.submittedAt, ANALYSIS_CUTOFF_DATE)
          )
        );
      const repaired = (repairResult as any)[0]?.affectedRows ?? 0;
      if (repaired > 0) {
        console.log(`[ReviewPipeline] Repaired ${repaired} wrongly-skipped reviews for re-analysis`);
      }
    }
  } catch (err: any) {
    console.error("[ReviewPipeline] Repair step failed:", err.message);
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
