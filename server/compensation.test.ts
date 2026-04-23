 * Tests for the Compensation Engine — 3-Tier Multiplier System
 * Covers: new 3-tier multiplier brackets (4.93+=1.5x Platinum, 4.85+=1.2x Gold, <4.85=0.8x),
 * next-tier info, mileage, bonus calculations, tier data, and configurable tiers.
 */
import { describe, it, expect } from "vitest";
import {
  getMultiplierForScore,
  getMultiplierLabel,
  getNextTierInfo,
  calculateMileageReimbursement,
  IRS_MILEAGE_RATE,
  DOCKING_PENALTY,
} from "./compensation";
import {
  getMultiplierTier,
  getNextTierInfo as getNextTierInfoFromConfig,
  DEFAULT_MULTIPLIER_TIERS,
  validateTierConfiguration,
} from "../shared/compensationConfig";

// ── New 3-Tier Multiplier bracket tests ─────────────────────────────

describe("getMultiplierForScore (3-tier system)", () => {
  it("returns 1.5x for a platinum 4.93+ score", () => {
    expect(getMultiplierForScore(4.93)).toBe(1.5);
  });

  it("returns 1.2x for 4.9 score (above 4.85 threshold)", () => {
    expect(getMultiplierForScore(4.9)).toBe(1.2);
  });

  it("returns 1.2x for 4.85 score (exact threshold)", () => {
    expect(getMultiplierForScore(4.85)).toBe(1.2);
  });

  it("returns 0.8x for 4.84 score (below 4.85 threshold)", () => {
    expect(getMultiplierForScore(4.84)).toBe(0.8);
  });

  it("returns 0.8x for 4.7 score", () => {
    expect(getMultiplierForScore(4.7)).toBe(0.8);
  });

  it("returns 0.8x for 4.5 score", () => {
    expect(getMultiplierForScore(4.5)).toBe(0.8);
  });

  it("returns 0.8x for 3.0 score", () => {
    expect(getMultiplierForScore(3.0)).toBe(0.8);
  });

  it("returns 1.2x default for null score (new cleaner)", () => {
    expect(getMultiplierForScore(null)).toBe(1.2);
  });

  it("handles exact boundary at 4.93", () => {