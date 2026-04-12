/**
 * Suggestion Executors — run side effects when a suggestion is approved.
 *
 * Each executor handles a specific `kind` of suggestion. When ops clicks
 * "Approve" in the Ops Inbox, the router calls `executeSuggestion()` which
 * dispatches to the right executor based on the suggestion's kind.
 *
 * Phase 1: review_reply → saves draft to review record
 * Phase 2: review_reply → also posts to Hostaway
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { reviews } from "../../drizzle/schema";
import { markSuggestionExecuted, getSuggestionById } from "./agentDb";

interface ExecutionResult {
  success: boolean;
  message: string;
}

/**
 * Execute a review reply suggestion — save the draft to the review record.
 */
async function executeReviewReply(
  suggestionId: number,
  proposedAction: any,
  editedDraft?: string
): Promise<ExecutionResult> {
  const db = await getDb();
  if (!db) return { success: false, message: "Database not available" };

  const reviewId = proposedAction?.reviewId;
  if (!reviewId) {
    return { success: false, message: "No reviewId in proposed action" };
  }

  const draft = editedDraft || proposedAction?.draft;
  if (!draft) {
    return { success: false, message: "No draft text found" };
  }

  // Save the draft to the review record
  await db
    .update(reviews)
    .set({
      hostResponseDraft: draft,
      hostResponseStatus: "draft",
      hostResponseError: null,
    })
    .where(eq(reviews.id, reviewId));

  return {
    success: true,
    message: `Draft saved for review #${reviewId}. Ready for Phase 2 Hostaway submission.`,
  };
}

/**
 * Main dispatcher — routes approved suggestions to the right executor.
 */
export async function executeSuggestion(
  suggestionId: number,
  editedContent?: string
): Promise<ExecutionResult> {
  const suggestion = await getSuggestionById(suggestionId);
  if (!suggestion) {
    return { success: false, message: "Suggestion not found" };
  }

  let result: ExecutionResult;

  switch (suggestion.kind) {
    case "review_reply":
      result = await executeReviewReply(
        suggestionId,
        suggestion.proposedAction,
        editedContent
      );
      break;
    default:
      result = {
        success: false,
        message: `No executor for suggestion kind: ${suggestion.kind}`,
      };
  }

  // Record execution result
  await markSuggestionExecuted(
    suggestionId,
    result.success ? "executed" : "failed",
    result.message
  );

  return result;
}
