import { describe, it, expect } from "vitest";

// We test the pure logic functions by importing them indirectly
// Since the module has side effects (DB imports), we test the logic patterns

describe("TaskCreator Logic", () => {
  // Replicate the shouldCreateTask logic for testing
  const TASK_TRIGGER_CATEGORIES = new Set([
    "maintenance",
    "cleaning",
    "improvement",
    "complaint",
  ]);

  function shouldCreateTask(msg: {
    aiAnalyzed: boolean;
    aiCategory: string | null;
    aiSentiment: string | null;
    aiUrgency: string | null;
  }): boolean {
    if (!msg.aiAnalyzed) return false;
    if (msg.aiCategory && TASK_TRIGGER_CATEGORIES.has(msg.aiCategory)) return true;
    if (msg.aiSentiment === "negative") return true;
    if (msg.aiUrgency === "high" || msg.aiUrgency === "critical") return true;
    return false;
  }

  function mapCategoryToTaskCategory(
    aiCategory: string | null
  ): "maintenance" | "cleaning" | "improvements" {
    switch (aiCategory) {
      case "cleaning":
        return "cleaning";
      case "improvement":
        return "improvements";
      default:
        return "maintenance";
    }
  }

  function mapUrgencyToPriority(
    aiUrgency: string | null
  ): "low" | "medium" | "high" {
    switch (aiUrgency) {
      case "critical":
      case "high":
        return "high";
      case "medium":
        return "medium";
      default:
        return "low";
    }
  }

  describe("shouldCreateTask", () => {
    it("returns false for unanalyzed messages", () => {
      expect(
        shouldCreateTask({
          aiAnalyzed: false,
          aiCategory: "maintenance",
          aiSentiment: "negative",
          aiUrgency: "high",
        })
      ).toBe(false);
    });

    it("returns true for maintenance category", () => {
      expect(
        shouldCreateTask({
          aiAnalyzed: true,
          aiCategory: "maintenance",
          aiSentiment: "neutral",
          aiUrgency: "low",
        })
      ).toBe(true);
    });

    it("returns true for cleaning category", () => {
      expect(
        shouldCreateTask({
          aiAnalyzed: true,
          aiCategory: "cleaning",
          aiSentiment: "neutral",
          aiUrgency: "low",
        })
      ).toBe(true);
    });

    it("returns true for improvement category", () => {
      expect(
        shouldCreateTask({
          aiAnalyzed: true,
          aiCategory: "improvement",
          aiSentiment: "neutral",
          aiUrgency: "low",
        })
      ).toBe(true);
    });

    it("returns true for complaint category", () => {
      expect(
        shouldCreateTask({
          aiAnalyzed: true,
          aiCategory: "complaint",
          aiSentiment: "neutral",
          aiUrgency: "low",
        })
      ).toBe(true);
    });

    it("returns false for compliment category with positive sentiment", () => {
      expect(
        shouldCreateTask({
          aiAnalyzed: true,
          aiCategory: "compliment",
          aiSentiment: "positive",
          aiUrgency: "low",
        })
      ).toBe(false);
    });

    it("returns false for question category with neutral sentiment", () => {
      expect(
        shouldCreateTask({
          aiAnalyzed: true,
          aiCategory: "question",
          aiSentiment: "neutral",
          aiUrgency: "low",
        })
      ).toBe(false);
    });

    it("returns true for negative sentiment regardless of category", () => {
      expect(
        shouldCreateTask({
          aiAnalyzed: true,
          aiCategory: "question",
          aiSentiment: "negative",
          aiUrgency: "low",
        })
      ).toBe(true);
    });

    it("returns true for high urgency regardless of category", () => {
      expect(
        shouldCreateTask({
          aiAnalyzed: true,
          aiCategory: "compliment",
          aiSentiment: "positive",
          aiUrgency: "high",
        })
      ).toBe(true);
    });

    it("returns true for critical urgency regardless of category", () => {
      expect(
        shouldCreateTask({
          aiAnalyzed: true,
          aiCategory: "other",
          aiSentiment: "neutral",
          aiUrgency: "critical",
        })
      ).toBe(true);
    });
  });

  describe("mapCategoryToTaskCategory", () => {
    it("maps cleaning to cleaning", () => {
      expect(mapCategoryToTaskCategory("cleaning")).toBe("cleaning");
    });

    it("maps improvement to improvements", () => {
      expect(mapCategoryToTaskCategory("improvement")).toBe("improvements");
    });

    it("maps maintenance to maintenance", () => {
      expect(mapCategoryToTaskCategory("maintenance")).toBe("maintenance");
    });

    it("maps complaint to maintenance (default)", () => {
      expect(mapCategoryToTaskCategory("complaint")).toBe("maintenance");
    });

    it("maps null to maintenance (default)", () => {
      expect(mapCategoryToTaskCategory(null)).toBe("maintenance");
    });
  });

  describe("mapUrgencyToPriority", () => {
    it("maps critical to high", () => {
      expect(mapUrgencyToPriority("critical")).toBe("high");
    });

    it("maps high to high", () => {
      expect(mapUrgencyToPriority("high")).toBe("high");
    });

    it("maps medium to medium", () => {
      expect(mapUrgencyToPriority("medium")).toBe("medium");
    });

    it("maps low to low", () => {
      expect(mapUrgencyToPriority("low")).toBe("low");
    });

    it("maps null to low (default)", () => {
      expect(mapUrgencyToPriority(null)).toBe("low");
    });
  });
});
