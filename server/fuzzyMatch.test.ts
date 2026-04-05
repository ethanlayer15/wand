import { describe, it, expect } from "vitest";
import {
  normalise,
  significantTokens,
  matchScore,
  autoMapSuggestions,
} from "./fuzzyMatch";

describe("fuzzyMatch utilities", () => {
  describe("normalise", () => {
    it("lowercases and strips punctuation", () => {
      expect(normalise("Flat Top Cabins LLC")).toBe("flat top cabins llc");
    });

    it("collapses whitespace", () => {
      expect(normalise("  Modern   Asheville  ")).toBe("modern asheville");
    });

    it("replaces special characters with spaces", () => {
      expect(normalise("Laurel Creek Falls | Hot Tub")).toBe(
        "laurel creek falls hot tub"
      );
    });
  });

  describe("significantTokens", () => {
    it("filters out stop words and short tokens", () => {
      const tokens = significantTokens("The Flat Top Cabins LLC");
      expect(tokens).toContain("flat");
      expect(tokens).toContain("top");
      expect(tokens).toContain("cabins");
      expect(tokens).not.toContain("the");
      expect(tokens).not.toContain("llc");
    });

    it("returns empty array for all-stop-word input", () => {
      expect(significantTokens("the and a")).toEqual([]);
    });
  });

  describe("matchScore", () => {
    it("returns 1.0 for exact match", () => {
      expect(matchScore("Flat Top Cabins", "Flat Top Cabins")).toBe(1.0);
    });

    it("returns 1.0 for case-insensitive exact match", () => {
      expect(matchScore("flat top cabins", "Flat Top Cabins")).toBe(1.0);
    });

    it("returns high score for contains match", () => {
      const score = matchScore("Flat Top Cabins", "Flat Top Cabins LLC");
      expect(score).toBe(0.85);
    });

    it("returns moderate score for partial word overlap", () => {
      const score = matchScore("Countryside", "Countryside Properties");
      // "Countryside" is contained in "Countryside Properties"
      expect(score).toBeGreaterThanOrEqual(0.7);
    });

    it("returns low score for unrelated names", () => {
      const score = matchScore("Abbey View", "Travis Barber");
      expect(score).toBeLessThan(0.3);
    });

    it("handles empty strings gracefully", () => {
      expect(matchScore("", "Something")).toBe(0);
      expect(matchScore("Something", "")).toBe(0);
    });

    it("scores similar names with different suffixes well", () => {
      const score = matchScore("Kindling Cascades", "Kindling Cascades Rentals");
      expect(score).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("autoMapSuggestions", () => {
    const properties = [
      { id: "1", name: "Flat Top Cabins" },
      { id: "2", name: "Modern Asheville Retreat" },
      { id: "3", name: "Abbey View" },
      { id: "4", name: "Countryside" },
    ];

    const customers = [
      { id: "cus_001", name: "Flat Top Cabins LLC", email: "flattop@example.com" },
      { id: "cus_002", name: "Travis Barber", email: "travis@example.com" },
      { id: "cus_003", name: "City Wide", email: "finance@5strcleaning.com" },
    ];

    it("matches Flat Top Cabins to Flat Top Cabins LLC with high confidence", () => {
      const suggestions = autoMapSuggestions(properties, customers, new Set());
      const flatTop = suggestions.find((s) => s.breezewayPropertyId === "1");
      expect(flatTop).toBeDefined();
      expect(flatTop!.stripeCustomerId).toBe("cus_001");
      expect(flatTop!.confidence).toBe("high");
      expect(flatTop!.score).toBeGreaterThanOrEqual(0.7);
    });

    it("excludes already-mapped properties", () => {
      const mapped = new Set(["1"]); // Flat Top already mapped
      const suggestions = autoMapSuggestions(properties, customers, mapped);
      expect(suggestions.find((s) => s.breezewayPropertyId === "1")).toBeUndefined();
    });

    it("returns suggestions sorted by score descending", () => {
      const suggestions = autoMapSuggestions(properties, customers, new Set());
      for (let i = 1; i < suggestions.length; i++) {
        expect(suggestions[i].score).toBeLessThanOrEqual(suggestions[i - 1].score);
      }
    });

    it("does not suggest matches below threshold", () => {
      const suggestions = autoMapSuggestions(properties, customers, new Set());
      suggestions.forEach((s) => {
        expect(s.score).toBeGreaterThanOrEqual(0.4);
      });
    });

    it("returns empty array when no properties provided", () => {
      const suggestions = autoMapSuggestions([], customers, new Set());
      expect(suggestions).toEqual([]);
    });

    it("returns empty array when no customers provided", () => {
      const suggestions = autoMapSuggestions(properties, [], new Set());
      expect(suggestions).toEqual([]);
    });

    it("correctly assigns confidence levels", () => {
      const suggestions = autoMapSuggestions(properties, customers, new Set());
      suggestions.forEach((s) => {
        if (s.score >= 0.7) {
          expect(s.confidence).toBe("high");
        } else {
          expect(s.confidence).toBe("possible");
        }
      });
    });

    it("includes Stripe customer email in suggestions", () => {
      const suggestions = autoMapSuggestions(properties, customers, new Set());
      const flatTop = suggestions.find((s) => s.breezewayPropertyId === "1");
      expect(flatTop?.stripeCustomerEmail).toBe("flattop@example.com");
    });
  });
});
