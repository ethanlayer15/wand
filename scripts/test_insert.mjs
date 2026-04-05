import { drizzle } from "drizzle-orm/mysql2";
import { eq, and, isNull } from "drizzle-orm";
import { tasks, reviews, listings } from "./drizzle/schema.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("No DATABASE_URL"); process.exit(1); }

const db = drizzle({ connection: { uri: DATABASE_URL } });

// Get one actionable review
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
  .limit(1);

console.log("Found actionable reviews:", actionableReviews.length);
if (actionableReviews.length === 0) {
  console.log("No actionable reviews to test with");
  process.exit(0);
}

const review = actionableReviews[0];
console.log("Review ID:", review.id, "| aiConfidence:", review.aiConfidence);
console.log("aiIssues type:", typeof review.aiIssues, "| isArray:", Array.isArray(review.aiIssues));

const issues = review.aiIssues || [];
console.log("Issues length:", issues.length);

// Try the exact same insert pattern as reviewPipeline.ts
try {
  const taskValues = {
    externalId: review.hostawayReviewId,
    externalSource: "hostaway",
    listingId: review.listingId,
    title: `Review: ${(review.aiSummary || "test").slice(0, 100)}`,
    description: "Test task from review pipeline debug",
    priority: "low",
    status: "ideas_for_later",
    category: "maintenance",
    taskType: "other",
    source: "review",
    hostawayReservationId: review.hostawayReservationId || undefined,
    arrivalDate: review.arrivalDate || undefined,
    departureDate: review.departureDate || undefined,
  };
  
  console.log("\nAttempting insert with values:");
  console.log("  externalId:", taskValues.externalId);
  console.log("  listingId:", taskValues.listingId);
  console.log("  hostawayReservationId:", taskValues.hostawayReservationId);
  console.log("  arrivalDate:", taskValues.arrivalDate);
  console.log("  departureDate:", taskValues.departureDate);
  
  const [insertResult] = await db.insert(tasks).values(taskValues);
  console.log("\nSUCCESS! insertResult:", insertResult);
  console.log("insertId:", insertResult?.insertId);
  
  // Clean up
  if (insertResult?.insertId) {
    await db.delete(tasks).where(eq(tasks.id, insertResult.insertId));
    console.log("Cleaned up test task ID:", insertResult.insertId);
  }
} catch (err) {
  console.error("\nINSERT FAILED:", err.message);
  if (err.cause) console.error("Cause:", err.cause.message);
}

process.exit(0);
