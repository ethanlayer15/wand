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

import { eq, sql, and, or, gte, lte, isNull, inArray } from "drizzle-orm";
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
  if (!nextInfo || !nextInfo.nextTier) return null;

  return {
    nextTierScore: nextInfo.nextTier.minScore,
    nextMultiplier: nextInfo.nextTier.multiplier,
    pointsNeeded: nextInfo.pointsNeeded,
    label: nextInfo.nextTier.label,
  };
}

// ── Task title filter ──────────────────────────────────────────────

/**
 * Only turnover cleans and deep cleans should count toward review scores.
 * Matches titles like "Turnover Clean", "Same Day Turnover Clean",
 * "11 am checkout Turnover Clean", "Deep Clean", "DEEP CLEAN", etc.
 *
 * Does NOT match maintenance tasks that merely contain "deep clean" as a
 * substring (e.g. "Deep clean shower grout") — the title must be primarily
 * a deep clean task, not a targeted maintenance item.
 */
export function isScorableClean(taskTitle: string | null | undefined): boolean {
  if (!taskTitle) return false;
  const t = taskTitle.toLowerCase().trim();
  if (t.includes("turnover clean")) return true;
  // "Deep Clean" or "DEEP CLEAN" as the primary task — not a substring
  // in a longer maintenance description like "Deep clean shower grout"
  // Match: "deep clean", "DEEP CLEAN", "Monthly deep clean", etc.
  // But NOT: "Deep clean shower grout" (has words after "deep clean" that aren't generic)
  if (/^(?:.*\s)?deep\s+clean(?:\s*[-–]\s*.*)?$/i.test(t)) return true;
  // Also match "initial clean" and "cleaning" tasks that are full property cleans
  if (t === "initial clean" || t.startsWith("initial clean ")) return true;
  return false;
}

// ── Shared review scoring + attribution helpers ────────────────────

export type CleanForMatching = {
  id: number;
  scheduledDate: Date;
  taskTitle: string | null;
  cleanerId: number | null;
  pairedCleanerId: number | null;
  breezewayTaskId: string;
};

const MAX_ATTRIBUTION_LOOKBACK_DAYS = 14;

/**
 * Pick THE clean responsible for a guest's stay: the most recent scorable
 * clean on the listing that happened on or before the review's arrival
 * (allowing up to 1 day after, for same-day turnovers logged late).
 *
 * Returns null if no clean on that listing happened within
 * MAX_ATTRIBUTION_LOOKBACK_DAYS of arrival — this prevents an unrelated
 * old clean from being attributed to a much-later guest stay.
 */
export function findResponsibleClean(
  arrivalDate: Date,
  cleansForListing: CleanForMatching[],
): CleanForMatching | null {
  if (cleansForListing.length === 0) return null;
  const arrivalMs = arrivalDate.getTime();
  const maxLookbackMs = MAX_ATTRIBUTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const oneDayAfterMs = 1 * 24 * 60 * 60 * 1000;

  let best: CleanForMatching | null = null;
  let bestDelta = Infinity;
  for (const clean of cleansForListing) {
    if (!isScorableClean(clean.taskTitle)) continue;
    const delta = arrivalMs - clean.scheduledDate.getTime();
    if (delta < -oneDayAfterMs) continue; // clean too far after arrival
    if (delta > maxLookbackMs) continue; // clean too far before arrival
    if (delta < bestDelta) {
      best = clean;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Return the set of cleaner IDs responsible for a given clean.
 * Includes `cleanerId` and `pairedCleanerId` if present.
 */
export function cleanAssigneeIds(clean: CleanForMatching): number[] {
  const ids: number[] = [];
  if (clean.cleanerId != null) ids.push(clean.cleanerId);
  if (clean.pairedCleanerId != null) ids.push(clean.pairedCleanerId);
  return ids;
}

/**
 * Breezeway paired cleans are stored as two rows per logical clean
 * (a primary and a "<taskId>-partner" record). For attribution we only
 * need the primary row — its cleanerId + pairedCleanerId already name
 * both assignees.
 */
export function isPartnerDupeClean(clean: Pick<CleanForMatching, "breezewayTaskId">): boolean {
  return clean.breezewayTaskId.endsWith("-partner");
}

export type ReviewForScoring = {
  source: string | null;
  rating: number | null;
  cleanlinessRating: number | null;
};

export type ReviewAnalysisForScoring = {
  issues?: Array<{ type?: string | null }> | null;
} | null | undefined;

export type ReviewScoreResult = {
  score: number;
  reason: string;
};

/**
 * Pick the 1-5 cleaning score for a review.
 *
 * Priority:
 * 1. If the review has an explicit cleanlinessRating sub-score (primarily
 *    Airbnb, but any platform that provides one), use it directly.
 * 2. Otherwise, if AI analysis detected a cleaning issue, normalize the
 *    overall rating to a 1-5 scale.
 * 3. Otherwise, count as 5 (no cleaning issues).
 */
export function cleaningScoreForReview(
  review: ReviewForScoring,
  analysis: ReviewAnalysisForScoring,
): ReviewScoreResult {
  if (review.cleanlinessRating != null) {
    return {
      score: review.cleanlinessRating,
      reason:
        review.source === "airbnb"
          ? "Airbnb cleanliness sub-score"
          : "Cleanliness sub-score",
    };
  }

  const hasCleaningIssue = analysis?.issues?.some((i) => i?.type === "cleaning") ?? false;
  const isAirbnb = review.source === "airbnb";
  if (hasCleaningIssue) {
    const normalized = review.rating
      ? review.rating > 5
        ? review.rating / 2
        : review.rating
      : 3;
    return {
      score: normalized,
      reason: isAirbnb
        ? "Airbnb (no sub-score) — cleaning issue detected"
        : "Cleaning issue detected — used overall rating",
    };
  }
  return {
    score: 5,
    reason: isAirbnb
      ? "Airbnb (no sub-score) — no issues"
      : "No cleaning issues — default 5",
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

  // Listings this cleaner has worked on recently (as primary OR paired)
  const cleanerCleans = await db.select()
    .from(completedCleans)
    .where(
      and(
        or(
          eq(completedCleans.cleanerId, cId),
          eq(completedCleans.pairedCleanerId, cId),
        ),
        gte(completedCleans.scheduledDate, fortyFiveDaysAgo),
      ),
    );

  if (cleanerCleans.length === 0) {
    return { score: null, reviewCount: 0, multiplier: 1.0 };
  }

  const listingIds = Array.from(
    new Set(cleanerCleans.map((c) => c.listingId).filter((id): id is number => id != null)),
  );
  if (listingIds.length === 0) {
    return { score: null, reviewCount: 0, multiplier: 1.0 };
  }

  // ALL scorable cleans on those listings within a window that covers the
  // full review range (30 days) plus the attribution lookback. We need the
  // full picture — not just this cleaner's rows — so we can identify THE
  // clean responsible for each guest stay instead of attributing unrelated
  // old cleans via a too-broad fallback.
  const cleanWindowStart = new Date();
  cleanWindowStart.setDate(cleanWindowStart.getDate() - (45 + MAX_ATTRIBUTION_LOOKBACK_DAYS));

  const allListingCleans = await db
    .select()
    .from(completedCleans)
    .where(
      and(
        inArray(completedCleans.listingId, listingIds),
        gte(completedCleans.scheduledDate, cleanWindowStart),
      ),
    );

  const cleansByListing = new Map<number, CleanForMatching[]>();
  for (const clean of allListingCleans) {
    if (!clean.listingId || !clean.scheduledDate) continue;
    if (isPartnerDupeClean(clean)) continue;
    if (!isScorableClean(clean.taskTitle)) continue;
    const entry: CleanForMatching = {
      id: clean.id,
      scheduledDate: new Date(clean.scheduledDate),
      taskTitle: clean.taskTitle,
      cleanerId: clean.cleanerId,
      pairedCleanerId: clean.pairedCleanerId,
      breezewayTaskId: clean.breezewayTaskId,
    };
    const list = cleansByListing.get(clean.listingId) ?? [];
    list.push(entry);
    cleansByListing.set(clean.listingId, list);
  }

  // Reviews from the last 30 days anchored on check-out date. Fall back to
  // submittedAt for older rows where Hostaway never populated departureDate.
  const recentReviews = await db.select()
    .from(reviews)
    .where(
      or(
        gte(reviews.departureDate, thirtyDaysAgo),
        and(
          isNull(reviews.departureDate),
          gte(reviews.submittedAt, thirtyDaysAgo)
        )
      )
    );

  const allAnalyses = await db.select().from(reviewAnalysis);
  const analysisMap = new Map(allAnalyses.map((a) => [a.reviewId, a]));

  const cleaningScores: number[] = [];

  for (const review of recentReviews) {
    if (!review.listingId) continue;
    const cleansOnListing = cleansByListing.get(review.listingId);
    if (!cleansOnListing) continue;

    const arrival = review.arrivalDate ? new Date(review.arrivalDate) : review.submittedAt;
    if (!arrival) continue;

    const responsible = findResponsibleClean(arrival, cleansOnListing);
    if (!responsible) continue;
    if (!cleanAssigneeIds(responsible).includes(cId)) continue;

    const { score } = cleaningScoreForReview(review, analysisMap.get(review.id) ?? null);
    cleaningScores.push(score);
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
