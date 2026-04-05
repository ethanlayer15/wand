/**
 * Compensation Configuration
 * Multiplier tiers, volume tiers, mileage rates, and reimbursement rules.
 *
 * NOTE: Top portion was truncated during Manus zip export. Types and defaults
 * have been reconstructed from usage patterns across the codebase.
 */

// ── Multiplier Tiers ──────────────────────────────────────────────────

export interface MultiplierTier {
  label: string;
  minScore: number;
  multiplier: number;
}

export const DEFAULT_MULTIPLIER_TIERS: MultiplierTier[] = [
  { label: "Elite", minScore: 95, multiplier: 1.15 },
  { label: "Premium", minScore: 85, multiplier: 1.10 },
  { label: "Standard", minScore: 70, multiplier: 1.00 },
  { label: "Training", minScore: 0, multiplier: 0.90 },
];

/**
 * Get the multiplier tier for a given rolling score.
 */
export function getMultiplierTier(
  score: number | null,
  tiers: MultiplierTier[] = DEFAULT_MULTIPLIER_TIERS
): MultiplierTier {
  const s = score ?? 0;
  for (const tier of tiers) {
    if (s >= tier.minScore) return tier;
  }
  return tiers[tiers.length - 1];
}

/**
 * Get the next tier info (what score is needed to reach the next level).
 */
export function getNextTierInfo(
  score: number | null,
  tiers: MultiplierTier[] = DEFAULT_MULTIPLIER_TIERS
): { nextTier: MultiplierTier | null; pointsNeeded: number } {
  const s = score ?? 0;
  const currentIdx = tiers.findIndex((t) => s >= t.minScore);
  if (currentIdx <= 0) return { nextTier: null, pointsNeeded: 0 };
  const nextTier = tiers[currentIdx - 1];
  return { nextTier, pointsNeeded: nextTier.minScore - s };
}

// ── Volume Tiers ──────────────────────────────────────────────────────

export interface VolumeTier {
  label: string;
  minWeeklyRevenue: number;
  minQualityScore: number;
  bonusPercent: number;
}

export const DEFAULT_VOLUME_TIERS: VolumeTier[] = [
  { label: "Gold", minWeeklyRevenue: 2000, minQualityScore: 85, bonusPercent: 5 },
  { label: "Silver", minWeeklyRevenue: 1200, minQualityScore: 70, bonusPercent: 3 },
  { label: "Standard", minWeeklyRevenue: 0, minQualityScore: 0, bonusPercent: 0 },
];

/**
 * Get the volume tier for a given weekly revenue and quality score.
 * Quality gate: must meet BOTH revenue AND quality thresholds.
 */
export function getVolumeTier(
  weeklyRevenue: number,
  qualityScore: number | null,
  tiers: VolumeTier[] = DEFAULT_VOLUME_TIERS
): VolumeTier {
  const score = qualityScore ?? 0;
  for (const tier of tiers) {
    if (weeklyRevenue >= tier.minWeeklyRevenue && score >= tier.minQualityScore) {
      return tier;
    }
  }
  return tiers[tiers.length - 1];
}

// ── Mileage Configuration ──────────────────────────────────────────

export const MILEAGE_RATE_PER_MILE = 0.70; // $0.70/mile round-trip

// ── Reimbursement Configuration ────────────────────────────────────

export interface ReimbursementTier {
  volumeTierLabel: string;
  cellPhone: number;
  vehicleMaintenance: number;
}

export const DEFAULT_REIMBURSEMENT_TIERS: ReimbursementTier[] = [
  { volumeTierLabel: "Gold", cellPhone: 75, vehicleMaintenance: 150 },
  { volumeTierLabel: "Silver", cellPhone: 50, vehicleMaintenance: 100 },
  { volumeTierLabel: "Standard", cellPhone: 25, vehicleMaintenance: 50 },
];

export function getReimbursementForTier(
  volumeTierLabel: string,
  tiers: ReimbursementTier[] = DEFAULT_REIMBURSEMENT_TIERS
): { cellPhone: number; vehicleMaintenance: number } {
  const match = tiers.find((t) => t.volumeTierLabel === volumeTierLabel);
  return match ?? { cellPhone: 0, vehicleMaintenance: 0 };
}

export function validateTierConfiguration(tiers: MultiplierTier[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (tiers.length === 0) {
    errors.push("At least one tier is required");
  }
  for (let i = 0; i < tiers.length - 1; i++) {
    if (tiers[i].minScore <= tiers[i + 1].minScore) {
      errors.push(`Tier ${i}: minScore (${tiers[i].minScore}) must be > tier ${i + 1} minScore (${tiers[i + 1].minScore})`);
    }
  }
  return { valid: errors.length === 0, errors };
}
