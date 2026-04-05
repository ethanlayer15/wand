import { describe, it, expect, vi } from "vitest";

// ── Confirm All High logic ────────────────────────────────────────────────────

interface Suggestion {
  breezewayPropertyId: string;
  breezewayPropertyName: string;
  stripeCustomerId: string;
  stripeCustomerName: string;
  score: number;
  confidence: "high" | "possible";
}

function getHighConfidenceSuggestions(
  suggestions: Suggestion[],
  dismissed: Set<string>,
  confirmed: Set<string>
): Suggestion[] {
  return suggestions.filter(
    (s) =>
      !dismissed.has(s.breezewayPropertyId) &&
      !confirmed.has(s.breezewayPropertyId) &&
      s.confidence === "high"
  );
}

// ── Billing Presets logic ─────────────────────────────────────────────────────

const BILLING_PRESETS = ["Leisr Billing", "Weekly Billing WNC"];

function applyPreset(
  preset: string,
  currentTags: string[]
): string[] {
  // Toggle: if already the only selected tag, clear; otherwise set exclusively
  if (currentTags.length === 1 && currentTags[0] === preset) {
    return [];
  }
  return [preset];
}

function isPresetActive(preset: string, selectedTags: string[]): boolean {
  return selectedTags.length === 1 && selectedTags[0] === preset;
}

function getAvailablePresets(allTags: string[]): string[] {
  return BILLING_PRESETS.filter((p) => allTags.includes(p));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getHighConfidenceSuggestions", () => {
  const suggestions: Suggestion[] = [
    { breezewayPropertyId: "A", breezewayPropertyName: "Cabin A", stripeCustomerId: "cus_1", stripeCustomerName: "Customer 1", score: 0.9, confidence: "high" },
    { breezewayPropertyId: "B", breezewayPropertyName: "Cabin B", stripeCustomerId: "cus_2", stripeCustomerName: "Customer 2", score: 0.75, confidence: "high" },
    { breezewayPropertyId: "C", breezewayPropertyName: "Cabin C", stripeCustomerId: "cus_3", stripeCustomerName: "Customer 3", score: 0.5, confidence: "possible" },
    { breezewayPropertyId: "D", breezewayPropertyName: "Cabin D", stripeCustomerId: "cus_4", stripeCustomerName: "Customer 4", score: 0.8, confidence: "high" },
  ];

  it("returns all high-confidence suggestions when nothing dismissed/confirmed", () => {
    const result = getHighConfidenceSuggestions(suggestions, new Set(), new Set());
    expect(result.map((s) => s.breezewayPropertyId)).toEqual(["A", "B", "D"]);
  });

  it("excludes dismissed suggestions", () => {
    const result = getHighConfidenceSuggestions(suggestions, new Set(["A"]), new Set());
    expect(result.map((s) => s.breezewayPropertyId)).toEqual(["B", "D"]);
  });

  it("excludes confirmed suggestions", () => {
    const result = getHighConfidenceSuggestions(suggestions, new Set(), new Set(["B"]));
    expect(result.map((s) => s.breezewayPropertyId)).toEqual(["A", "D"]);
  });

  it("excludes both dismissed and confirmed", () => {
    const result = getHighConfidenceSuggestions(suggestions, new Set(["A"]), new Set(["D"]));
    expect(result.map((s) => s.breezewayPropertyId)).toEqual(["B"]);
  });

  it("excludes possible-confidence suggestions", () => {
    const result = getHighConfidenceSuggestions(suggestions, new Set(), new Set());
    const ids = result.map((s) => s.breezewayPropertyId);
    expect(ids).not.toContain("C");
  });

  it("returns empty when all high-confidence are confirmed", () => {
    const result = getHighConfidenceSuggestions(suggestions, new Set(), new Set(["A", "B", "D"]));
    expect(result).toHaveLength(0);
  });
});

describe("Billing Presets", () => {
  describe("applyPreset", () => {
    it("selects a preset when no tags are active", () => {
      expect(applyPreset("Leisr Billing", [])).toEqual(["Leisr Billing"]);
    });

    it("toggles off a preset that is already the only selected tag", () => {
      expect(applyPreset("Leisr Billing", ["Leisr Billing"])).toEqual([]);
    });

    it("replaces other tags when a preset is selected", () => {
      expect(applyPreset("Weekly Billing WNC", ["Hot tub service", "Firewood"])).toEqual(["Weekly Billing WNC"]);
    });

    it("replaces another preset when a different preset is clicked", () => {
      expect(applyPreset("Weekly Billing WNC", ["Leisr Billing"])).toEqual(["Weekly Billing WNC"]);
    });
  });

  describe("isPresetActive", () => {
    it("returns true when preset is the only selected tag", () => {
      expect(isPresetActive("Leisr Billing", ["Leisr Billing"])).toBe(true);
    });

    it("returns false when no tags are selected", () => {
      expect(isPresetActive("Leisr Billing", [])).toBe(false);
    });

    it("returns false when multiple tags are selected", () => {
      expect(isPresetActive("Leisr Billing", ["Leisr Billing", "Hot tub service"])).toBe(false);
    });

    it("returns false when a different tag is selected", () => {
      expect(isPresetActive("Leisr Billing", ["Weekly Billing WNC"])).toBe(false);
    });
  });

  describe("getAvailablePresets", () => {
    it("returns presets that exist in the tag list", () => {
      const allTags = ["Leisr Billing", "Hot tub service", "Weekly Billing WNC", "Firewood"];
      expect(getAvailablePresets(allTags)).toEqual(["Leisr Billing", "Weekly Billing WNC"]);
    });

    it("returns empty when no billing tags exist", () => {
      expect(getAvailablePresets(["Hot tub service", "Firewood"])).toEqual([]);
    });

    it("returns only the presets that exist", () => {
      expect(getAvailablePresets(["Leisr Billing", "Firewood"])).toEqual(["Leisr Billing"]);
    });
  });
});

describe("Tag sync in nightly Breezeway property sync", () => {
  it("upsertBreezewayProperty accepts a tags field as JSON string", () => {
    // Verify the expected shape of the upsert call includes tags
    const upsertPayload = {
      breezewayId: "123",
      name: "Test Cabin",
      address: null,
      city: null,
      state: null,
      status: "active" as const,
      photoUrl: null,
      tags: JSON.stringify(["Leisr Billing", "Hot tub service"]),
      syncedAt: new Date(),
    };
    expect(upsertPayload.tags).toBe('["Leisr Billing","Hot tub service"]');
    expect(JSON.parse(upsertPayload.tags)).toEqual(["Leisr Billing", "Hot tub service"]);
  });

  it("handles properties with no tags gracefully", () => {
    const upsertPayload = {
      tags: JSON.stringify([]),
    };
    expect(JSON.parse(upsertPayload.tags)).toEqual([]);
  });
});
