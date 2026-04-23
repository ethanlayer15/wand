/**
 * Tests for the Pay Calculation Engine
 * Covers: getPayWeekStart, volume tier logic, pair/split logic
 */
import { describe, it, expect } from "vitest";
import { getPayWeekStart, getCurrentPayWeekStart } from "./payCalculation";
import {
  getVolumeTier,
  DEFAULT_VOLUME_TIERS,
  getReimbursementForTier,
  DEFAULT_REIMBURSEMENT_TIERS,
} from "../shared/compensationConfig";

// ── getPayWeekStart tests (Wednesday anchor) ─────────────────────────

describe("getPayWeekStart", () => {
  it("returns the Wednesday itself for a Wednesday input", () => {
    // 2026-04-22 is a Wednesday
    const result = getPayWeekStart(new Date("2026-04-22T12:00:00Z"));
    expect(result).toBe("2026-04-22");
  });

  it("returns prior Wednesday for a Tuesday (end of period)", () => {
    // 2026-04-28 is a Tuesday → pay period started 2026-04-22
    const result = getPayWeekStart(new Date("2026-04-28T12:00:00Z"));
    expect(result).toBe("2026-04-22");
  });

  it("returns prior Wednesday for a Monday", () => {
    // 2026-04-27 is a Monday → pay period started 2026-04-22
    const result = getPayWeekStart(new Date("2026-04-27T12:00:00Z"));
    expect(result).toBe("2026-04-22");
  });

  it("returns prior Wednesday for a Sunday", () => {
    // 2026-04-26 is a Sunday → pay period started 2026-04-22
    const result = getPayWeekStart(new Date("2026-04-26T12:00:00Z"));
    expect(result).toBe("2026-04-22");
  });

  it("getCurrentPayWeekStart returns a valid YYYY-MM-DD string", () => {
    const result = getCurrentPayWeekStart();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── Volume tier tests ($3,000/$2,200 thresholds) ─────────────────────

describe("getVolumeTier (new $3,000/$2,200 thresholds)", () => {
  it("returns Gold for $3,000+ weekly revenue with quality gate met", () => {
    const tier = getVolumeTier(3000, 4.85, DEFAULT_VOLUME_TIERS);
    expect(tier.label).toBe("Gold");
    expect(tier.multiplier).toBe(1.2);
  });

  it("returns Gold for $5,000 weekly revenue with quality gate met", () => {
    const tier = getVolumeTier(5000, 4.9, DEFAULT_VOLUME_TIERS);
    expect(tier.label).toBe("Gold");
    expect(tier.multiplier).toBe(1.2);
  });

  it("returns Silver for $2,200-$2,999 weekly revenue with quality gate met", () => {
    const tier = getVolumeTier(2200, 4.85, DEFAULT_VOLUME_TIERS);
    expect(tier.label).toBe("Silver");
    expect(tier.multiplier).toBe(1.1);
  });

  it("returns Silver for $2,500 weekly revenue with quality gate met", () => {
    const tier = getVolumeTier(2500, 4.9, DEFAULT_VOLUME_TIERS);
    expect(tier.label).toBe("Silver");
    expect(tier.multiplier).toBe(1.1);
  });

  it("returns Silver for $2,999 weekly revenue with quality gate met", () => {
    const tier = getVolumeTier(2999, 4.85, DEFAULT_VOLUME_TIERS);
    expect(tier.label).toBe("Silver");
    expect(tier.multiplier).toBe(1.1);
  });

  it("returns Standard for under $2,200 weekly revenue", () => {
    const tier = getVolumeTier(2199, 4.9, DEFAULT_VOLUME_TIERS);
    expect(tier.label).toBe("Standard");
    expect(tier.multiplier).toBe(1.0);
  });

  it("returns Standard for $0 weekly revenue", () => {
    const tier = getVolumeTier(0, 4.9, DEFAULT_VOLUME_TIERS);
    expect(tier.label).toBe("Standard");
    expect(tier.multiplier).toBe(1.0);
  });

  it("returns Standard when quality gate not met for Gold threshold", () => {
    // $3,000+ but quality below 4.85 → Standard (quality gate blocks Gold and Silver)
    const tier = getVolumeTier(3000, 4.84, DEFAULT_VOLUME_TIERS);
    expect(tier.label).toBe("Standard");
    expect(tier.multiplier).toBe(1.0);
  });

  it("returns Standard when quality gate not met for Silver threshold", () => {
    // $2,200+ but quality below 4.85 → Standard
    const tier = getVolumeTier(2500, 4.84, DEFAULT_VOLUME_TIERS);
    expect(tier.label).toBe("Standard");
    expect(tier.multiplier).toBe(1.0);
  });

  it("returns Standard for null quality score (new cleaner)", () => {
    const tier = getVolumeTier(3000, null, DEFAULT_VOLUME_TIERS);
    expect(tier.label).toBe("Standard");
    expect(tier.multiplier).toBe(1.0);
  });

  it("Gold threshold is exactly $3,000 (not $4,000 old value)", () => {
    // Verify new threshold — $3,000 should qualify for Gold
    const goldTier = DEFAULT_VOLUME_TIERS[0];
    expect(goldTier.minWeeklyRevenue).toBe(3000);
    expect(goldTier.label).toBe("Gold");
  });

  it("Silver threshold is exactly $2,200 (not $2,500 old value)", () => {
    // Verify new threshold — $2,200 should qualify for Silver
    const silverTier = DEFAULT_VOLUME_TIERS[1];
    expect(silverTier.minWeeklyRevenue).toBe(2200);
    expect(silverTier.label).toBe("Silver");
  });
});

// ── Pair/split logic tests ───────────────────────────────────────────

describe("Pair/split logic (manual calculation)", () => {
  /**
   * When 2 cleaners share a clean:
   * - splitRatio = 0.50 for each
   * - Base pay = cleaningFee × 0.50 per cleaner
   * - Volume credit = cleaningFee × 0.50 per cleaner
   * - Mileage is NOT split (each cleaner drives independently)
   * - Quality score is attributed to both (no split needed)
   */

  it("solo clean: splitRatio 1.0 means full cleaning fee counts toward base pay", () => {
    const cleaningFee = 200;
    const splitRatio = 1.0;
    const effectiveFee = cleaningFee * splitRatio;
    expect(effectiveFee).toBe(200);
  });

  it("paired clean: splitRatio 0.5 means half cleaning fee counts toward base pay", () => {
    const cleaningFee = 200;
    const splitRatio = 0.5;
    const effectiveFee = cleaningFee * splitRatio;
    expect(effectiveFee).toBe(100);
  });

  it("paired clean: volume credit is also halved (50/50 split)", () => {
    const cleaningFee = 200;
    const splitRatio = 0.5;
    const volumeCredit = cleaningFee * splitRatio;
    expect(volumeCredit).toBe(100);
  });

  it("paired clean: two cleaners together get full fee value (100 + 100 = 200)", () => {
    const cleaningFee = 200;
    const splitRatio = 0.5;
    const cleaner1Share = cleaningFee * splitRatio;
    const cleaner2Share = cleaningFee * splitRatio;
    expect(cleaner1Share + cleaner2Share).toBe(cleaningFee);
  });

  it("paired clean: mileage is NOT split — each cleaner gets full round-trip mileage", () => {
    const distanceMiles = 10; // one-way
    const mileageRate = 0.70;
    const roundTrip = distanceMiles * 2;
    const mileagePay = roundTrip * mileageRate;
    // Each cleaner gets the full $14 mileage (not split)
    expect(mileagePay).toBe(14.0);
  });

  it("paired clean: volume tier based on split credit (not full fee)", () => {
    // If a cleaner does 10 paired cleans at $350 each, their volume credit is $1,750
    // (10 × $350 × 0.5 = $1,750) — below $2,200, so Standard tier
    const cleaningFee = 350;
    const splitRatio = 0.5;
    const cleanCount = 10;
    const volumeCredit = cleaningFee * splitRatio * cleanCount;
    expect(volumeCredit).toBe(1750);
    const tier = getVolumeTier(volumeCredit, 4.9, DEFAULT_VOLUME_TIERS);
    expect(tier.label).toBe("Standard");
  });

  it("paired clean: volume tier reaches Silver if split credit exceeds $2,200", () => {
    // 14 paired cleans at $350 each → $2,450 volume credit → Silver
    const cleaningFee = 350;
    const splitRatio = 0.5;
    const cleanCount = 14;
    const volumeCredit = cleaningFee * splitRatio * cleanCount;
    expect(volumeCredit).toBe(2450);
    const tier = getVolumeTier(volumeCredit, 4.9, DEFAULT_VOLUME_TIERS);
    expect(tier.label).toBe("Silver");
  });

  it("paired clean: volume tier reaches Gold if split credit exceeds $3,000", () => {
    // 20 paired cleans at $350 each → $3,500 volume credit → Gold
    const cleaningFee = 350;
    const splitRatio = 0.5;
    const cleanCount = 20;
    const volumeCredit = cleaningFee * splitRatio * cleanCount;
    expect(volumeCredit).toBe(3500);
    const tier = getVolumeTier(volumeCredit, 4.9, DEFAULT_VOLUME_TIERS);
    expect(tier.label).toBe("Gold");
  });
});

// ── Reimbursement tier tests ─────────────────────────────────────────

describe("getReimbursementForTier", () => {
  it("Gold tier gets $75 cell phone and $150 vehicle maintenance", () => {
    const r = getReimbursementForTier("Gold", DEFAULT_REIMBURSEMENT_TIERS);
    expect(r.cellPhone).toBe(75);
    expect(r.vehicleMaintenance).toBe(150);
  });

  it("Silver tier gets $50 cell phone and $100 vehicle maintenance", () => {
    const r = getReimbursementForTier("Silver", DEFAULT_REIMBURSEMENT_TIERS);
    expect(r.cellPhone).toBe(50);
    expect(r.vehicleMaintenance).toBe(100);
  });

  it("Standard tier gets $25 cell phone and $50 vehicle maintenance", () => {
    const r = getReimbursementForTier("Standard", DEFAULT_REIMBURSEMENT_TIERS);
    expect(r.cellPhone).toBe(25);
    expect(r.vehicleMaintenance).toBe(50);
  });

  it("unknown tier returns $0 for both", () => {
    const r = getReimbursementForTier("Unknown", DEFAULT_REIMBURSEMENT_TIERS);
    expect(r.cellPhone).toBe(0);
    expect(r.vehicleMaintenance).toBe(0);
  });
});

// ── Full pay formula tests (manual, no DB) ───────────────────────────

describe("Full pay formula (manual calculation)", () => {
  /**
   * Formula: (basePay × qualityMultiplier × volumeMultiplier) + mileagePay + reimbursements
   */

  it("solo clean: $200 fee × 1.2 quality × 1.0 volume + $14 mileage = $254", () => {
    const basePay = 200;
    const qualityMultiplier = 1.2;
    const volumeMultiplier = 1.0;
    const mileagePay = 14.0;
    const total = Number((basePay * qualityMultiplier * volumeMultiplier + mileagePay).toFixed(2));
    expect(total).toBe(254.0);
  });

  it("paired clean: $200 fee × 0.5 split × 1.2 quality × 1.0 volume + $14 mileage = $134", () => {
    const cleaningFee = 200;
    const splitRatio = 0.5;
    const basePay = cleaningFee * splitRatio; // $100
    const qualityMultiplier = 1.2;
    const volumeMultiplier = 1.0;
    const mileagePay = 14.0; // NOT split
    const total = Number((basePay * qualityMultiplier * volumeMultiplier + mileagePay).toFixed(2));
    expect(total).toBe(134.0);
  });

  it("paired clean: both cleaners together earn more than solo due to double mileage", () => {
    // Solo cleaner: $200 fee × 1.2 × 1.0 + $14 mileage = $254
    // Paired: each gets $100 × 1.2 × 1.0 + $14 mileage = $134 each → $268 total
    const soloTotal = 200 * 1.2 * 1.0 + 14.0;
    const pairedTotal = (100 * 1.2 * 1.0 + 14.0) * 2;
    expect(Number(soloTotal.toFixed(2))).toBe(254.0);
    expect(Number(pairedTotal.toFixed(2))).toBe(268.0);
    expect(pairedTotal).toBeGreaterThan(soloTotal);
  });
});
