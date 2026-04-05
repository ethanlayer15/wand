import { preFilterResolutionSignal } from "./autoResolution";

describe("Auto-Resolution Detection", () => {
  describe("preFilterResolutionSignal", () => {
    // ── Strong resolution signals ──────────────────────────────────
    it("detects 'got in' as a strong resolution signal", () => {
      const result = preFilterResolutionSignal("We got in, thanks!");
      expect(result.hasResolutionSignal).toBe(true);
      expect(result.strongSignals.length).toBeGreaterThan(0);
      expect(result.score).toBeGreaterThanOrEqual(30);
    });

    it("detects 'working now' as a strong resolution signal", () => {
      const result = preFilterResolutionSignal("The door code is working now");
      expect(result.hasResolutionSignal).toBe(true);
      expect(result.strongSignals).toContainEqual(expect.stringMatching(/working now/i));
    });

    it("detects 'all good' as a strong resolution signal", () => {
      const result = preFilterResolutionSignal("All good, we figured it out");
      expect(result.hasResolutionSignal).toBe(true);
      expect(result.strongSignals.length).toBeGreaterThanOrEqual(1);
    });

    it("detects 'never mind' as a strong resolution signal", () => {
      const result = preFilterResolutionSignal("Never mind, it was user error");
      expect(result.hasResolutionSignal).toBe(true);
      expect(result.strongSignals).toContainEqual(expect.stringMatching(/never\s*mind/i));
    });

    it("detects 'problem solved' as a strong resolution signal", () => {
      const result = preFilterResolutionSignal("Problem solved!");
      expect(result.hasResolutionSignal).toBe(true);
      expect(result.strongSignals.length).toBeGreaterThan(0);
    });

    it("detects 'figured it out' as a strong resolution signal", () => {
      const result = preFilterResolutionSignal("We figured it out ourselves");
      expect(result.hasResolutionSignal).toBe(true);
      expect(result.strongSignals).toContainEqual(expect.stringMatching(/figured/i));
    });

    it("detects 'no longer an issue' as a strong resolution signal", () => {
      const result = preFilterResolutionSignal("It's no longer an issue");
      expect(result.hasResolutionSignal).toBe(true);
      expect(result.strongSignals.length).toBeGreaterThan(0);
    });

    it("detects 'false alarm' as a strong resolution signal", () => {
      const result = preFilterResolutionSignal("Sorry, false alarm!");
      expect(result.hasResolutionSignal).toBe(true);
      expect(result.strongSignals).toContainEqual(expect.stringMatching(/false alarm/i));
    });

    it("detects 'disregard' as a strong resolution signal", () => {
      const result = preFilterResolutionSignal("Please disregard my last message");
      expect(result.hasResolutionSignal).toBe(true);
    });

    it("detects 'we're all set' as a strong resolution signal", () => {
      const result = preFilterResolutionSignal("We're all set now, thank you");
      expect(result.hasResolutionSignal).toBe(true);
      expect(result.strongSignals.length).toBeGreaterThanOrEqual(1);
    });

    it("detects 'that fixed it' as a strong resolution signal", () => {
      const result = preFilterResolutionSignal("That fixed it, thanks!");
      expect(result.hasResolutionSignal).toBe(true);
    });

    // ── Moderate resolution signals ────────────────────────────────
    it("detects moderate signals like 'thanks' and 'great'", () => {
      const result = preFilterResolutionSignal("Thanks, that's great!");
      expect(result.moderateSignals.length).toBeGreaterThanOrEqual(2);
    });

    it("requires at least 2 moderate signals to trigger (single 'thanks' is not enough)", () => {
      const result = preFilterResolutionSignal("Thanks");
      expect(result.hasResolutionSignal).toBe(false);