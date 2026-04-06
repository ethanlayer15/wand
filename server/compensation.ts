/**
 * Compensation Engine — Phase 1: Rolling Score Engine
 *
 * Calculates each cleaner's trailing 30-day average Wand score from
 * Hostaway review data (AI-analyzed), applies the multiplier brackets,
 * and caches the result on the cleaner record.
 *
 * Multiplier brackets:
 *   5.0        → 1.5x (Max Reward)
 *   4.8 – 4.9  → 1.1x
 *   4.6 – 4.7  → 1.0x (Base Bonus)
 *   Below 4.6  → 0.0x (+ $10 docking penalty per house)
 *
 * New cleaners default to 1.0x until they establish a 30-day score history.
 */

import { eq, sql, and, gte, lte } from "drizzle-orm";
import { getDb } from "./db";
import {
  cleaners,
  cleanerScoreHistory,
  reviewAnalysis,
  reviews,
  completedCleans,
  Cleaner,
} from "../drizzle/schema";

// ── Tier configuration ──────────────────────────────────────────────

export const BEDROOM_TIERS = [
  { tier: 1, label: "1 Bedroom / Studio", expectedHours: 1.35, baseBonus: 10 },
  { tier: 2, label: "2 Bedrooms", expectedHours: 1.80, baseBonus: 18 },
  { tier: 3, label: "3 Bedrooms", expectedHours: 2.48, baseBonus: 26 },
  { tier: 4, label: "4 Bedrooms", expectedHours: 3.15, baseBonus: 36 },
  { tier: 5, label: "5+ Bedrooms", expectedHours: 4.50, baseBonus: 50 },
] as const;

export const BASE_HOURLY_RATE = 14.0;
export const IRS_MILEAGE_RATE = 0.725; // 2026 IRS standard rate
export const DOCKING_PENALTY = 10.0;

// ── Multiplier logic ────────────────────────────────────────────────

// Import configurable tier system
import { getMultiplierTier, getNextTierInfo as getNextTierInfoFromConfig, DEFAULT_MULTIPLIER_TIERS } from "./compensationConfig";

export function getMultiplierForScore(score: number | null): number {
  const tier = getMultiplierTier(score, DEFAULT_MULTIPLIER_TIERS);
  return tier.multiplier;
}

export function getMultiplierLabel(multiplier: number): string {
  const tier = DEFAULT_MULTIPLIER_TIERS.find((t) => t.multiplier === multiplier);
  return tier?.label ?? `${multiplier}x`;
}

export function getNextTierInfo(score: number | null): {
  nextTierScore: number;
  nextMultiplier: number;
  pointsNeeded: number;
  label: string;
} | null {
  const nextInfo = getNextTierInfoFromConfig(score, DEFAULT_MULTIPLIER_TIERS);
  if (!nextInfo) return null;

  return {
    nextTierScore: nextInfo.nextTier.minScore,
    nextMultiplier: nextInfo.nextTier.multiplier,
    pointsNeeded: nextInfo.pointsNeeded,
    label: nextInfo.label,
  };
}

// ── Rolling Score Calculation ───────────────────────────────────────

/**
 * Calculate a single cleaner's rolling 30-day cleaning score.
 *
 * Attribution: Cross-references review departure dates with completedCleans
 * to find which cleaner cleaned the property before the guest's stay.
 *
 * Scoring rules:
 * 1. Airbnb reviews: use the cleanlinessRating sub-score (1-5)
 * 2. Non-Airbnb reviews: default to 5 UNLESS AI analysis detects negative
 *    cleaning sentiment — then use the overall review rating
 * 3. If overall rating < 5 but no cleaning issues mentioned → skip (don't count)
 */
export async function calculateCleanerRollingScore(cleanerName: string, cleanerId?: number): Promise<{
  score: number | null;
  reviewCount: number;
  multiplier: number;
}> {
  const db = await getDb();
  if (!db) return { score: null, reviewCount: 0, multiplier: 1.0 };

  // If no cleanerId provided, look it up by name
  let cId = cleanerId;
  if (!cId) {
    const [cleaner] = await db.select({ id: cleaners.id })
      .from(cleaners)
      .where(eq(cleaners.name, cleanerName))
      .limit(1);
    if (!cleaner) return { score: null, reviewCount: 0, multiplier: 1.0 };
    cId = cleaner.id;
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Get this cleaner's completed cleans from the last 45 days
  // (wider window to catch cleans whose reviews arrive later)
  const fortyFiveDaysAgo = new Date();
  fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);

  const cleanerCleans = await db.select()
    .from(completedCleans)
    .where(
      and(
        eq(completedCleans.cleanerId, cId),
        gte(completedCleans.scheduledDate, fortyFiveDaysAgo)
      )
    );

  if (cleanerCleans.length === 0) {
    return { score: null, reviewCount: 0, multiplier: 1.0 };
  }

  // Build a map: listingId → clean dates for this cleaner
  const cleansByListing = new Map<number, Date[]>();
  for (const clean of cleanerCleans) {
    if (!clean.listingId || !clean.scheduledDate) continue;
    const existing = cleansByListing.get(clean.listingId) || [];
    existing.push(new Date(clean.scheduledDate));
    cleansByListing.set(clean.listingId, existing);
  }

  // Get reviews from the last 30 days for properties this cleaner has cleaned
  const listingIds = [...cleansByListing.keys()];
  if (listingIds.length === 0) {
    return { score: null, reviewCount: 0, multiplier: 1.0 };
  }

  const recentReviews = await db.select()
    .from(reviews)
    .where(gte(reviews.submittedAt, thirtyDaysAgo));

  // Get AI analyses for cleaning issue detection (for non-Airbnb reviews)
  const allAnalyses = await db.select().from(reviewAnalysis);
  const analysisMap = new Map(allAnalyses.map((a) => [a.reviewId, a]));

  // Match reviews to this cleaner's cleans
  const cleaningScores: number[] = [];

  for (const review of recentReviews) {
    if (!review.listingId) continue;
    const cleanDates = cleansByListing.get(review.listingId);
    if (!cleanDates) continue; // This cleaner didn't clean this property

    // Check if the cleaner's clean date was before the review's arrival/departure
    // The clean should have happened before or on the arrival date
    const reviewArrival = review.arrivalDate ? new Date(review.arrivalDate) : null;
    const reviewDeparture = review.departureDate ? new Date(review.departureDate) : null;
    const reviewDate = reviewArrival || review.submittedAt;
    if (!reviewDate) continue;

    // Find a clean that was scheduled within 3 days before the guest's arrival
    // (turnover cleans typically happen same day or day before check-in)
    const matchingClean = cleanDates.find((cleanDate) => {
      const diffMs = reviewDate.getTime() - cleanDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays >= -1 && diffDays <= 3; // clean was 1 day after to 3 days before arrival
    });

    if (!matchingClean) continue; // No matching clean for this review

    // Determine the cleaning score for this review
    const isAirbnb = review.source === "airbnb";

    if (isAirbnb && review.cleanlinessRating) {
      // Rule 1: Airbnb reviews — use cleanliness sub-score directly
      cleaningScores.push(review.cleanlinessRating);
    } else if (!isAirbnb) {
      // Rule 2: Non-Airbnb reviews
      const analysis = analysisMap.get(review.id);
      const hasCleaningIssue = analysis?.issues?.some(
        (i) => i.type === "cleaning"
      ) ?? false;

      if (hasCleaningIssue) {
        // Negative cleaning mentioned → use overall rating (normalized to 5)
        const rating = review.rating
          ? (review.rating > 5 ? review.rating / 2 : review.rating)
          : 3;
        cleaningScores.push(rating);
      } else {
        // No cleaning issues → count as 5
        cleaningScores.push(5);
      }
    } else if (isAirbnb && !review.cleanlinessRating) {
      // Airbnb but no cleanliness sub-score available — fall back to AI analysis
      const analysis = analysisMap.get(review.id);
      const hasCleaningIssue = analysis?.issues?.some(
        (i) => i.type === "cleaning"
      ) ?? false;

      if (hasCleaningIssue) {
        const rating = review.rating
          ? (review.rating > 5 ? review.rating / 2 : review.rating)
          : 3;
        cleaningScores.push(rating);
      } else {
        // No cleaning issues and it's Airbnb → count as 5
        cleaningScores.push(5);
      }
    }
  }

  if (cleaningScores.length === 0) {
    return { score: null, reviewCount: 0, multiplier: 1.0 };
  }

  const avgScore = Number(
    (cleaningScores.reduce((a, b) => a + b, 0) / cleaningScores.length).toFixed(2)
  );
  const multiplier = getMultiplierForScore(avgScore);

  return { score: avgScore, reviewCount: cleaningScores.length, multiplier };
}

/**
 * Recalculate rolling scores for ALL active cleaners.
 * This is the daily cron job entry point.
 */
export async function recalculateAllRollingScores(): Promise<{
  processed: number;
  updated: number;
  errors: string[];
}> {
  const db = await getDb();
  if (!db) return { processed: 0, updated: 0, errors: ["Database not available"] };

  const allCleaners = await db.select().from(cleaners).where(eq(cleaners.active, true));
  let updated = 0;
  const errors: string[] = [];

  for (const cleaner of allCleaners) {
    try {
      const { score, reviewCount, multiplier } = await calculateCleanerRollingScore(cleaner.name, cleaner.id);

      // Update the cleaner record
      await db
        .update(cleaners)
        .set({
          currentRollingScore: score !== null ? String(score) : null,
          currentMultiplier: String(multiplier),
          scoreLastCalculatedAt: new Date(),
        })
        .where(eq(cleaners.id, cleaner.id));

      // Write to score history for audit trail
      await db.insert(cleanerScoreHistory).values({
        cleanerId: cleaner.id,
        rollingScore: String(score ?? 0),
        multiplier: String(multiplier),
        reviewCount,
      });

      updated++;
    } catch (err: any) {
      errors.push(`Cleaner ${cleaner.name} (ID ${cleaner.id}): ${err.message}`);
    }
  }

  console.log(`[Compensation] Rolling score recalculation complete: ${updated}/${allCleaners.length} cleaners updated`);
  if (errors.length > 0) {
    console.warn(`[Compensation] Errors:`, errors);
  }

  return { processed: allCleaners.length, updated, errors };
}

// ── DB helpers ──────────────────────────────────────────────────────

export async function getCleaners(): Promise<Cleaner[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(cleaners);
}

export async function getCleanerById(id: number): Promise<Cleaner | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(cleaners).where(eq(cleaners.id, id));
  return rows[0] ?? null;
}

export async function upsertCleaner(data: {
  name: string;
  email?: string | null;
  breezewayTeamId?: number | null;
  quickbooksEmployeeId?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Check if cleaner already exists by name
  const existing = await db
    .select()
    .from(cleaners)
    .where(eq(cleaners.name, data.name));

  if (existing.length > 0) {
    await db
      .update(cleaners)
      .set({
        email: data.email ?? existing[0].email,
        breezewayTeamId: data.breezewayTeamId ?? existing[0].breezewayTeamId,
        quickbooksEmployeeId: data.quickbooksEmployeeId ?? existing[0].quickbooksEmployeeId,
      })
      .where(eq(cleaners.id, existing[0].id));
  } else {
    await db.insert(cleaners).values({
      name: data.name,
      email: data.email ?? null,
      breezewayTeamId: data.breezewayTeamId ?? null,
      quickbooksEmployeeId: data.quickbooksEmployeeId ?? null,
      currentMultiplier: "1.0", // Default for new cleaners
    });
  }
}

export async function getCleanerScoreHistory(cleanerId: number, limit = 30) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(cleanerScoreHistory)
    .where(eq(cleanerScoreHistory.cleanerId, cleanerId))
    .orderBy(sql`${cleanerScoreHistory.calculatedAt} DESC`)
    .limit(limit);
}

// ── Property compensation helpers ───────────────────────────────────

export async function updatePropertyCompensationFields(
  listingId: number,
  data: {
    bedroomTier?: number | null;
    distanceFromStorage?: string | null;
    cleaningFeeCharge?: string | null;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const { listings } = await import("../drizzle/schema");
  const updateData: Record<string, any> = {};
  if (data.bedroomTier !== undefined) updateData.bedroomTier = data.bedroomTier;
  if (data.distanceFromStorage !== undefined) updateData.distanceFromStorage = data.distanceFromStorage;
  if (data.cleaningFeeCharge !== undefined) updateData.cleaningFeeCharge = data.cleaningFeeCharge;

  if (Object.keys(updateData).length > 0) {
    await db.update(listings).set(updateData).where(eq(listings.id, listingId));
  }
}

export async function bulkUpdatePropertyCompensation(
  updates: Array<{
    listingId: number;
    bedroomTier?: number | null;
    distanceFromStorage?: string | null;
    cleaningFeeCharge?: string | null;
  }>
): Promise<{ updated: number; errors: string[] }> {
  let updated = 0;
  const errors: string[] = [];

  for (const u of updates) {
    try {
      await updatePropertyCompensationFields(u.listingId, u);
      updated++;
    } catch (err: any) {
      errors.push(`Listing ${u.listingId}: ${err.message}`);
    }
  }

  return { updated, errors };
}

// ── Mileage calculation ─────────────────────────────────────────────

export function calculateMileageReimbursement(
  distanceFromStorage: number, // one-way miles
  isThirdHouseOrMore: boolean = false
): number {
  if (isThirdHouseOrMore) return 5.0; // Flat $5 for 3rd+ house
  const roundTrip = distanceFromStorage * 2;
  return Number((roundTrip * IRS_MILEAGE_RATE).toFixed(2));
}

// ── Bonus calculation ───────────────────────────────────────────────

export function calculateCleanBonus(
  bedroomTier: number,
  multiplier: number
): { baseBonus: number; adjustedBonus: number; dockPenalty: number } {
  const tier = BEDROOM_TIERS.find((t) => t.tier === bedroomTier) ?? BEDROOM_TIERS[0];
  const baseBonus = tier.baseBonus;
  const adjustedBonus = Number((baseBonus * multiplier).toFixed(2));
  const dockPenalty = multiplier === 0 ? DOCKING_PENALTY : 0;

  return { baseBonus, adjustedBonus, dockPenalty };
}
