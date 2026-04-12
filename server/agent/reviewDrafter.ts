/**
 * Review Reply Drafter — first Wand agent workflow.
 *
 * Runs on a schedule (or manually). Finds reviews that need host replies,
 * drafts a response using Claude with property context, and queues it as
 * a suggestion in the Ops Inbox for approval.
 *
 * When a review_reply suggestion is approved, the executor saves the draft
 * to the review record (and in Phase 2, posts it to Hostaway).
 */
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { reviews, listings, propertyPlaybooks } from "../../drizzle/schema";
import { insertSuggestion, listSuggestions } from "./agentDb";
import { ENV } from "../_core/env";

// ── Types ───────────────────────────────────────────────────────────

interface ReviewToDraft {
  id: number;
  hostawayReviewId: string;
  listingId: number;
  listingName: string;
  internalName: string | null;
  guestName: string | null;
  rating: number | null;
  cleanlinessRating: number | null;
  text: string | null;
  privateFeedback: string | null;
  source: string;
  sentiment: string | null;
  aiSummary: string | null;
  aiIssues: any;
  aiHighlights: string[] | null;
  submittedAt: Date | null;
}

interface DraftResult {
  reviewed: number;
  drafted: number;
  skipped: number;
  errors: number;
}

// ── Prompt ──────────────────────────────────────────────────────────

function buildDraftPrompt(review: ReviewToDraft, playbook: any): string {
  const propertyName = review.internalName || review.listingName;
  const parts: string[] = [];

  parts.push(`You are drafting a host response for a guest review of "${propertyName}".`);
  parts.push("");
  parts.push("## Guidelines");
  parts.push("- Warm, genuine, and personal — never robotic or templated");
  parts.push("- Thank the guest by first name if available");
  parts.push("- If the review is positive (4-5 stars), keep it short (2-3 sentences), express gratitude, invite them back");
  parts.push("- If the review mentions specific positives, acknowledge one briefly");
  parts.push("- If the review is negative or mixed (1-3 stars), be empathetic and specific about what you're fixing");
  parts.push("- Never be defensive. Own any issues.");
  parts.push("- Never mention other guests, reviews, or compensate publicly");
  parts.push("- Don't repeat their review back to them verbatim");
  parts.push("- End with an invitation to return");
  parts.push("- Keep it under 150 words");
  parts.push("- Write the reply text only — no greeting prefix like 'Dear X,' (Airbnb adds that)");
  parts.push("");

  // Review details
  parts.push("## Review");
  parts.push(`Guest: ${review.guestName || "Anonymous"}`);
  parts.push(`Rating: ${review.rating || "?"}/5`);
  if (review.cleanlinessRating) parts.push(`Cleanliness: ${review.cleanlinessRating}/5`);
  parts.push(`Source: ${review.source}`);
  if (review.submittedAt) parts.push(`Date: ${new Date(review.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`);
  parts.push("");
  if (review.text) parts.push(`Public review:\n"${review.text}"`);
  if (review.privateFeedback) parts.push(`\nPrivate feedback:\n"${review.privateFeedback}"`);
  parts.push("");

  // AI analysis
  if (review.aiSummary) parts.push(`AI summary: ${review.aiSummary}`);
  if (review.aiHighlights?.length) parts.push(`Highlights: ${review.aiHighlights.join(", ")}`);
  if (review.aiIssues?.length) {
    parts.push("Issues flagged:");
    for (const issue of review.aiIssues) {
      parts.push(`  - [${issue.severity}] ${issue.description}`);
    }
  }

  // Property playbook context
  if (playbook) {
    parts.push("");
    parts.push("## Property Context");
    if (playbook.quirks?.length) {
      parts.push("Known quirks: " + playbook.quirks.map((q: any) => q.note).join("; "));
    }
    if (playbook.frequentIssues?.length) {
      parts.push("Frequent issues: " + playbook.frequentIssues.map((i: any) => `${i.issue} (${i.count}x)`).join("; "));
    }
    if (playbook.guestFeedbackThemes?.length) {
      const positives = playbook.guestFeedbackThemes.filter((t: any) => t.sentiment === "positive");
      const negatives = playbook.guestFeedbackThemes.filter((t: any) => t.sentiment === "negative");
      if (positives.length) parts.push("Common praises: " + positives.map((t: any) => t.theme).join(", "));
      if (negatives.length) parts.push("Common complaints: " + negatives.map((t: any) => t.theme).join(", "));
    }
    if (playbook.agentSummary) parts.push(`Property notes: ${playbook.agentSummary}`);
  }

  parts.push("");
  parts.push("Write the host reply now. Text only, no markdown formatting.");

  return parts.join("\n");
}

// ── Core Logic ──────────────────────────────────────────────────────

/**
 * Find reviews that need a host reply draft.
 * Criteria:
 * - Has review text (not empty)
 * - No existing host response
 * - No existing draft
 * - Not already in the suggestion queue
 * - Has been analyzed by AI
 */
async function findReviewsNeedingDrafts(limit = 10): Promise<ReviewToDraft[]> {
  const db = await getDb();
  if (!db) return [];

  // Get IDs of reviews already in the suggestion queue
  const existingSuggestions = await listSuggestions({
    agentName: "review_drafter",
    status: ["pending", "approved", "edited", "snoozed"],
  });
  const existingReviewIds = new Set(
    existingSuggestions
      .filter((s) => s.relatedReviewId)
      .map((s) => s.relatedReviewId!)
  );

  const rows = await db
    .select({
      id: reviews.id,
      hostawayReviewId: reviews.hostawayReviewId,
      listingId: reviews.listingId,
      listingName: listings.name,
      internalName: listings.internalName,
      guestName: reviews.guestName,
      rating: reviews.rating,
      cleanlinessRating: reviews.cleanlinessRating,
      text: reviews.text,
      privateFeedback: reviews.privateFeedback,
      source: reviews.source,
      sentiment: reviews.sentiment,
      aiSummary: reviews.aiSummary,
      aiIssues: reviews.aiIssues,
      aiHighlights: reviews.aiHighlights,
      submittedAt: reviews.submittedAt,
    })
    .from(reviews)
    .innerJoin(listings, eq(reviews.listingId, listings.id))
    .where(
      and(
        isNull(reviews.hostResponse),           // no existing reply
        or(
          isNull(reviews.hostResponseStatus),
          eq(reviews.hostResponseStatus, "none")
        ),
        eq(reviews.isAnalyzed, true),            // AI has analyzed it
        sql`${reviews.text} IS NOT NULL AND ${reviews.text} != ''`, // has review text
      )
    )
    .orderBy(desc(reviews.submittedAt))
    .limit(limit + existingReviewIds.size); // fetch extra to compensate for filtering

  // Filter out reviews already in the queue
  return rows
    .filter((r) => !existingReviewIds.has(r.id))
    .slice(0, limit) as ReviewToDraft[];
}

/**
 * Draft a reply for a single review using Claude.
 */
async function draftReply(review: ReviewToDraft, playbook: any): Promise<string> {
  const anthropic = new Anthropic({ apiKey: ENV.anthropicApiKey });

  const prompt = buildDraftPrompt(review, playbook);

  const response = await anthropic.messages.create({
    model: ENV.anthropicModel,
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("");

  return text.trim();
}

/**
 * Run the review reply drafter.
 * Finds unreplied reviews, drafts responses, and queues suggestions.
 */
export async function runReviewDrafter(limit = 10): Promise<DraftResult> {
  const result: DraftResult = { reviewed: 0, drafted: 0, skipped: 0, errors: 0 };

  if (!ENV.anthropicApiKey) {
    console.warn("[ReviewDrafter] ANTHROPIC_API_KEY not configured — skipping");
    return result;
  }

  console.log("[ReviewDrafter] Starting review reply draft run...");

  const reviewsToDraft = await findReviewsNeedingDrafts(limit);
  result.reviewed = reviewsToDraft.length;

  if (reviewsToDraft.length === 0) {
    console.log("[ReviewDrafter] No reviews need drafts");
    return result;
  }

  console.log(`[ReviewDrafter] Found ${reviewsToDraft.length} reviews needing drafts`);

  // Batch-fetch playbooks for all listings
  const db = await getDb();
  const listingIds = [...new Set(reviewsToDraft.map((r) => r.listingId))];
  const playbooks = new Map<number, any>();
  if (db) {
    const pbRows = await db
      .select()
      .from(propertyPlaybooks)
      .where(sql`${propertyPlaybooks.listingId} IN (${sql.join(listingIds.map(id => sql`${id}`), sql`, `)})`);
    for (const pb of pbRows) {
      playbooks.set(pb.listingId, pb);
    }
  }

  for (const review of reviewsToDraft) {
    try {
      const propertyName = review.internalName || review.listingName;
      const playbook = playbooks.get(review.listingId) || null;

      const draft = await draftReply(review, playbook);

      if (!draft) {
        result.skipped++;
        continue;
      }

      // Determine confidence based on rating
      const confidence = review.rating && review.rating >= 4 ? 0.90 : 0.75;

      const title = `Reply to ${review.guestName || "guest"} — ${propertyName} (${review.rating || "?"}★)`;
      // Show a preview of the draft as the summary (first ~120 chars)
      const draftPreview = draft.length > 120 ? draft.slice(0, 120) + "…" : draft;
      const summary = `${review.sentiment === "negative" ? "⚠️" : review.rating && review.rating >= 4 ? "✅" : "💬"} "${draftPreview}"`;

      await insertSuggestion({
        agentName: "review_drafter",
        kind: "review_reply",
        title,
        summary,
        reasoning: `This ${review.source} review from ${review.guestName || "a guest"} (${review.rating}★) has no host response yet. ${
          review.sentiment === "negative"
            ? "The review is negative — a thoughtful reply is important for reputation management."
            : review.sentiment === "positive"
              ? "A brief, warm thank-you reinforces the guest relationship."
              : "A balanced response acknowledges the feedback."
        }`,
        proposedAction: {
          type: "review_reply",
          reviewId: review.id,
          hostawayReviewId: review.hostawayReviewId,
          listingId: review.listingId,
          draft,
          // Context for display in Ops Inbox
          guestName: review.guestName,
          rating: review.rating,
          reviewText: review.text,
          source: review.source,
        },
        confidence: String(confidence),
        relatedListingId: review.listingId,
        relatedReviewId: review.id,
      });

      console.log(`[ReviewDrafter] Drafted reply for ${propertyName} — ${review.guestName} (${review.rating}★)`);
      result.drafted++;
    } catch (err: any) {
      console.error(`[ReviewDrafter] Error drafting for review ${review.id}:`, err.message);
      result.errors++;
    }
  }

  console.log(
    `[ReviewDrafter] Done: ${result.drafted} drafted, ${result.skipped} skipped, ${result.errors} errors`
  );
  return result;
}
