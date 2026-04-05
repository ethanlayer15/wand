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

import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  cleaners,
  completedCleans,
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

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Get the Monday of the week for a given date (ISO week: Mon-Sun).
 */
export function getWeekOfMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  d.setDate(diff);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Get the current week's Monday.
 */
export function getCurrentWeekMonday(): string {
  return getWeekOfMonday(new Date());
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

  // Calculate base pay applying split ratio for paired cleans
  // - Solo clean: splitRatio = 1.00 (full cleaning fee)
  // - Paired clean: splitRatio = 0.50 (half the cleaning fee)
  const totalCleaningFees = cleans.reduce(
    (sum, c) => sum + Number(c.cleaningFee ?? 0) * Number(c.splitRatio ?? 1),
    0
  );
  const basePay = totalCleaningFees;

  // Volume credit also uses split ratio (each cleaner gets half toward their tier)
  const volumeCredit = cleans.reduce(
    (sum, c) => sum + Number(c.cleaningFee ?? 0) * Number(c.splitRatio ?? 1),
    0
  );

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
      return {
        propertyName: c.propertyName ?? "Unknown",
        cleaningFee: fee,
        effectiveFee: Number((fee * ratio).toFixed(2)),
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
