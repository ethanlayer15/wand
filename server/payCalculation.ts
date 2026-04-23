/**
 * Pay Calculation Engine
 *
 * Full weekly pay formula per cleaner:
 *   Base Pay (cleaning fee per property × number of cleans)
 *   × Quality Multiplier (3-tier: 1.5x / 1.2x / 0.8x based on trailing 30-day rating)
 *   × Volume Multiplier (Gold 1.2x / Silver 1.1x / Standard 1.0x based on weekly revenue + quality gate)
 *   + Mileage Pay (round-trip distance from pod storage × $0.70/mile × number of trips)
 *   + Reimbursements (cell phone + vehicle maintenance, monthly, volume-tiered, receipt-gated)
 *   = Total Weekly Pay
 *
 * IMPORTANT: Cleaning fee amounts are NEVER shown to cleaners.
 * They see "base pay per clean" and tier names only.
 */

import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  cleaners,
  completedCleans,
  listings,
  weeklyPaySnapshots,
  cleanerReceipts,
  Cleaner,
} from "../drizzle/schema";
import {
  getMultiplierTier,
  getVolumeTier,
  getReimbursementForTier,
  MILEAGE_RATE_PER_MILE,
  DEFAULT_MULTIPLIER_TIERS,
  DEFAULT_VOLUME_TIERS,
  DEFAULT_REIMBURSEMENT_TIERS,
} from "./compensationConfig";
import { baseBonusFromCleaningFee } from "./compensation";

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Pay period = Wednesday through the following Tuesday. Returns the
 * Wednesday (YYYY-MM-DD) of the pay period containing `date`. If `date`
 * is a Wednesday the result is the same date; earlier in the week (Mon,
 * Tue) it steps BACK to the prior Wednesday; later (Thu–Sun) it steps
 * back to the week's Wednesday.
 */
export function getPayWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun ... 3=Wed ... 6=Sat
  // How many days back to the Wednesday that starts this pay period.
  const daysBack = (day - 3 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

/**
 * Wednesday (YYYY-MM-DD) of the pay period that contains today.
 */
export function getCurrentPayWeekStart(): string {
  return getPayWeekStart(new Date());
}

// ── Weekly Pay Calculation ───────────────────────────────────────────

export interface WeeklyPayBreakdown {
  cleanerId: number;
  cleanerName: string;
  weekOf: string;
  // Base pay
  totalCleans: number;
  totalCleaningFees: number; // HIDDEN from cleaner
  basePay: number;           // = totalCleaningFees (shown as "base pay per clean")
  // Quality multiplier
  qualityScore: number | null;
  qualityMultiplier: number;
  qualityTierLabel: string;
  // Volume multiplier
  weeklyRevenue: number;     // HIDDEN from cleaner
  volumeMultiplier: number;
  volumeTierLabel: string;
  // Mileage
  totalMileage: number;
  mileageRate: number;
  mileagePay: number;
  // Reimbursements (monthly, prorated to week)
  cellPhoneReimbursement: number;
  vehicleReimbursement: number;
  // Total
  totalPay: number;
  // Detail: per-clean breakdown
  cleans: Array<{
    propertyName: string;
    cleaningFee: number;       // HIDDEN from cleaner — actual fee
    effectiveFee: number;      // splitRatio-adjusted fee (what's counted toward base pay)
    distanceMiles: number;
    scheduledDate: Date | null;
    isPaired: boolean;         // true if this was a paired clean
    pairedCleanerId: number | null;
    splitRatio: number;
  }>;
}

/**
 * Calculate weekly pay for a single cleaner for a given week.
 */
export async function calculateWeeklyPay(
  cleanerId: number,
  weekOf: string // YYYY-MM-DD of Monday
): Promise<WeeklyPayBreakdown | null> {
  const db = await getDb();
  if (!db) return null;

  // Get the cleaner
  const [cleaner] = await db.select().from(cleaners).where(eq(cleaners.id, cleanerId));
  if (!cleaner) return null;

  // Get completed cleans for this week
  const weekStart = new Date(weekOf + "T00:00:00Z");
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const cleans = await db
    .select()
    .from(completedCleans)
    .where(
      and(
        eq(completedCleans.cleanerId, cleanerId),
        eq(completedCleans.weekOf, weekOf)
      )
    );

  // Base pay per clean = 10% of the customer's cleaning fee, rounded up to
  // the nearest $10 (via baseBonusFromCleaningFee). splitRatio halves the
  // amount for paired cleans. Replaces the older "full cleaning fee =
  // base pay" formula as of the 2026-04-22 pay period.
  const basePay = Number(
    cleans
      .reduce(
        (sum, c) =>
          sum + baseBonusFromCleaningFee(c.cleaningFee) * Number(c.splitRatio ?? 1),
        0,
      )
      .toFixed(2),
  );

  // weeklyRevenue tracks the customer-facing cleaning fee total (hidden
  // from cleaners) so we can report back business-side revenue.
  const totalCleaningFees = Number(
    cleans
      .reduce(
        (sum, c) => sum + Number(c.cleaningFee ?? 0) * Number(c.splitRatio ?? 1),
        0,
      )
      .toFixed(2),
  );

  // Volume credit uses the new base-bonus amount (so a cleaner's volume
  // tier reflects what they actually earn, not the customer-facing fee).
  const volumeCredit = basePay;

  // Quality multiplier (trailing 30-day score from cleaner record)
  // Quality score from paired cleans is attributed equally to both cleaners
  // (the rolling score is already per-cleaner, so no split needed here)
  const qualityScore = cleaner.currentRollingScore
    ? Number(cleaner.currentRollingScore)
    : null;
  const qualityTier = getMultiplierTier(qualityScore, DEFAULT_MULTIPLIER_TIERS);
  const qualityMultiplier = qualityTier.multiplier;

  // Volume multiplier (weekly revenue credit + quality gate)
  const volumeTier = getVolumeTier(volumeCredit, qualityScore, DEFAULT_VOLUME_TIERS);
  const volumeMultiplier = volumeTier.multiplier;

  // Mileage pay (round-trip distance × rate × number of trips)
  // Mileage is NOT split — each cleaner drove to the property independently
  const totalMileage = cleans.reduce((sum, c) => {
    const oneWay = Number(c.distanceMiles ?? 0);
    return sum + oneWay * 2; // round-trip
  }, 0);
  const mileagePay = Number((totalMileage * MILEAGE_RATE_PER_MILE).toFixed(2));

  // Reimbursements (monthly, prorated to week = monthly / 4.33)
  const reimbursement = getReimbursementForTier(volumeTier.label, DEFAULT_REIMBURSEMENT_TIERS);

  // Check if receipts were submitted for this month
  const monthStr = weekOf.slice(0, 7); // YYYY-MM
  const receipts = await db
    .select()
    .from(cleanerReceipts)
    .where(
      and(
        eq(cleanerReceipts.cleanerId, cleanerId),
        eq(cleanerReceipts.month, monthStr),
        eq(cleanerReceipts.status, "approved")
      )
    );

  const hasPhoneReceipt = receipts.some((r) => r.type === "cell_phone");
  const hasVehicleReceipt = receipts.some((r) => r.type === "vehicle_maintenance");

  // Prorate monthly to weekly (÷ 4.33)
  const weeklyProrate = 4.33;
  const cellPhoneReimbursement = hasPhoneReceipt
    ? Number((reimbursement.cellPhone / weeklyProrate).toFixed(2))
    : 0;
  const vehicleReimbursement = hasVehicleReceipt
    ? Number((reimbursement.vehicleMaintenance / weeklyProrate).toFixed(2))
    : 0;

  // Total pay formula:
  // (basePay × qualityMultiplier × volumeMultiplier) + mileagePay + reimbursements
  const adjustedPay = Number((basePay * qualityMultiplier * volumeMultiplier).toFixed(2));
  const totalPay = Number(
    (adjustedPay + mileagePay + cellPhoneReimbursement + vehicleReimbursement).toFixed(2)
  );

  return {
    cleanerId,
    cleanerName: cleaner.name,
    weekOf,
    totalCleans: cleans.length,
    totalCleaningFees,
    basePay,
    qualityScore,
    qualityMultiplier,
    qualityTierLabel: qualityTier.label,
    weeklyRevenue: totalCleaningFees,
    volumeMultiplier,
    volumeTierLabel: volumeTier.label,
    totalMileage,
    mileageRate: MILEAGE_RATE_PER_MILE,
    mileagePay,
    cellPhoneReimbursement,
    vehicleReimbursement,
    totalPay,
    cleans: cleans.map((c) => {
      const fee = Number(c.cleaningFee ?? 0);
      const ratio = Number(c.splitRatio ?? 1);
      const basePerClean = baseBonusFromCleaningFee(c.cleaningFee);
      return {
        propertyName: c.propertyName ?? "Unknown",
        cleaningFee: fee,
        // effectiveFee is now the cleaner's actual pay contribution from
        // this clean: ceil(fee * 10% / 10) * 10 × splitRatio.
        effectiveFee: Number((basePerClean * ratio).toFixed(2)),
        distanceMiles: Number(c.distanceMiles ?? 0),
        scheduledDate: c.scheduledDate,
        isPaired: c.pairedCleanerId !== null && c.pairedCleanerId !== undefined,
        pairedCleanerId: c.pairedCleanerId ?? null,
        splitRatio: ratio,
      };
    }),
  };
}

/**
 * Sanity-check before running payroll: every scorable clean in the week
 * must live on a listing that has already been onboarded (i.e. has a
 * cleaningFeeCharge set). If any clean in the period points at a listing
 * with a null fee, surface the property names so the admin can finish
 * onboarding before payroll is generated.
 */
export async function assertAllCleansOnboarded(weekOf: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const offenders = await db
    .select({
      listingId: listings.id,
      listingName: listings.name,
      internalName: listings.internalName,
    })
    .from(completedCleans)
    .leftJoin(listings, eq(completedCleans.listingId, listings.id))
    .where(
      and(
        eq(completedCleans.weekOf, weekOf),
        sql`(${listings.cleaningFeeCharge} IS NULL OR ${listings.onboardingStatus} = 'pending')`,
      ),
    )
    .groupBy(listings.id, listings.name, listings.internalName);

  if (offenders.length === 0) return;
  const names = offenders
    .map((o) => o.internalName || o.listingName || `listing #${o.listingId}`)
    .join(", ");
  throw new Error(
    `Cannot run payroll for week ${weekOf}: ${offenders.length} ` +
      `${offenders.length === 1 ? "property has" : "properties have"} ` +
      `cleans in this week but no cleaning fee set — onboard them first: ${names}`,
  );
}

/**
 * Calculate weekly pay for ALL active cleaners for a given week.
 */
export async function calculateAllWeeklyPay(
  weekOf: string
): Promise<WeeklyPayBreakdown[]> {
  const db = await getDb();
  if (!db) return [];

  const allCleaners = await db
    .select()
    .from(cleaners)
    .where(eq(cleaners.active, true));

  const results: WeeklyPayBreakdown[] = [];

  for (const cleaner of allCleaners) {
    const pay = await calculateWeeklyPay(cleaner.id, weekOf);
    if (pay) {
      results.push(pay);
    }
  }

  return results;
}

/**
 * Save a weekly pay snapshot to the database.
 */
export async function saveWeeklyPaySnapshot(
  breakdown: WeeklyPayBreakdown
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Upsert: delete existing snapshot for this cleaner+week, then insert
  await db
    .delete(weeklyPaySnapshots)
    .where(
      and(
        eq(weeklyPaySnapshots.cleanerId, breakdown.cleanerId),
        eq(weeklyPaySnapshots.weekOf, breakdown.weekOf)
      )
    );

  await db.insert(weeklyPaySnapshots).values({
    cleanerId: breakdown.cleanerId,
    weekOf: breakdown.weekOf,
    totalCleans: breakdown.totalCleans,
    totalCleaningFees: String(breakdown.totalCleaningFees),
    basePay: String(breakdown.basePay),
    qualityScore: breakdown.qualityScore !== null ? String(breakdown.qualityScore) : null,
    qualityMultiplier: String(breakdown.qualityMultiplier),
    qualityTierLabel: breakdown.qualityTierLabel,
    weeklyRevenue: String(breakdown.weeklyRevenue),
    volumeMultiplier: String(breakdown.volumeMultiplier),
    volumeTierLabel: breakdown.volumeTierLabel,
    totalMileage: String(breakdown.totalMileage),
    mileageRate: String(breakdown.mileageRate),
    mileagePay: String(breakdown.mileagePay),
    cellPhoneReimbursement: String(breakdown.cellPhoneReimbursement),
    vehicleReimbursement: String(breakdown.vehicleReimbursement),
    totalPay: String(breakdown.totalPay),
  });
}

/**
 * Calculate and save weekly pay for all active cleaners.
 */
export async function runWeeklyPayCalculation(
  weekOf: string
): Promise<{ processed: number; saved: number; errors: string[] }> {
  await assertAllCleansOnboarded(weekOf);
  const breakdowns = await calculateAllWeeklyPay(weekOf);
  let saved = 0;
  const errors: string[] = [];

  for (const b of breakdowns) {
    try {
      await saveWeeklyPaySnapshot(b);
      saved++;
    } catch (err: any) {
      errors.push(`Cleaner ${b.cleanerName}: ${err.message}`);
    }
  }

  return { processed: breakdowns.length, saved, errors };
}
