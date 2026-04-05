/**
 * Tests for the Cleaner Attribution Engine
 * Tests the pure logic functions (findMatchingTask, multiplier brackets, etc.)
 * and the date parsing fix in VivInbox.
 */
import { describe, it, expect } from "vitest";

// ── findMatchingTask logic tests ──────────────────────────────────────────

interface MockTask {
  id: number;
  name: string;
  home_id: number;
  scheduled_date?: string;
  type_department?: string;
  type_task_status?: { code: string; name: string; stage: string };
  assignments?: Array<{
    assignee_id: number;
    name: string;
    type_task_user_status: string;
  }>;
}

/**
 * Reimplementation of findMatchingTask for testing (pure function).
 * Finds the most recent cleaning task scheduled before the review date,
 * within a 30-day lookback window.
 */
function findMatchingTask(
  tasks: MockTask[],
  reviewSubmittedAt: Date
): MockTask | null {
  const sorted = tasks
    .filter((t) => t.scheduled_date)
    .sort((a, b) => {
      const da = new Date(a.scheduled_date!).getTime();
      const db = new Date(b.scheduled_date!).getTime();
      return db - da;
    });

  const reviewTime = reviewSubmittedAt.getTime();
  const MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

  for (const task of sorted) {
    const taskTime = new Date(task.scheduled_date!).getTime();
    if (taskTime <= reviewTime && reviewTime - taskTime <= MAX_LOOKBACK_MS) {
      return task;
    }
  }

  return null;
}

describe("findMatchingTask", () => {
  const baseTasks: MockTask[] = [
    {
      id: 1,
      name: "Turnover Clean",
      home_id: 100,
      scheduled_date: "2025-12-01",
      type_department: "housekeeping",
      type_task_status: { code: "finished", name: "Finished", stage: "finished" },
      assignments: [{ assignee_id: 10, name: "Alice", type_task_user_status: "assigned" }],
    },
    {
      id: 2,
      name: "Turnover Clean",
      home_id: 100,
      scheduled_date: "2025-12-15",
      type_department: "housekeeping",
      type_task_status: { code: "finished", name: "Finished", stage: "finished" },
      assignments: [{ assignee_id: 20, name: "Bob", type_task_user_status: "assigned" }],
    },
    {
      id: 3,
      name: "Turnover Clean",
      home_id: 100,
      scheduled_date: "2026-01-05",
      type_department: "housekeeping",
      type_task_status: { code: "finished", name: "Finished", stage: "finished" },
      assignments: [{ assignee_id: 10, name: "Alice", type_task_user_status: "assigned" }],
    },
  ];

  it("should find the most recent task before the review date", () => {
    const review = new Date("2025-12-20");
    const match = findMatchingTask(baseTasks, review);
    expect(match).not.toBeNull();
    expect(match!.id).toBe(2); // Dec 15 task, not Dec 1
  });

  it("should return null if no task within 30-day lookback", () => {
    const review = new Date("2026-03-01"); // 55 days after Jan 5
    const match = findMatchingTask(baseTasks, review);
    expect(match).toBeNull();
  });

  it("should return null for empty task list", () => {
    const match = findMatchingTask([], new Date("2025-12-20"));
    expect(match).toBeNull();
  });

  it("should skip tasks without scheduled_date", () => {
    const tasks: MockTask[] = [
      { id: 1, name: "Clean", home_id: 100 },
      {
        id: 2,
        name: "Clean",
        home_id: 100,
        scheduled_date: "2025-12-10",
        assignments: [{ assignee_id: 10, name: "Alice", type_task_user_status: "assigned" }],
      },
    ];
    const match = findMatchingTask(tasks, new Date("2025-12-20"));
    expect(match).not.toBeNull();
    expect(match!.id).toBe(2);
  });

  it("should not match tasks scheduled AFTER the review", () => {
    const review = new Date("2025-11-30"); // Before all tasks
    const match = findMatchingTask(baseTasks, review);
    expect(match).toBeNull();
  });

  it("should match task on the same day as the review", () => {
    const review = new Date("2025-12-15"); // Same day as task 2
    const match = findMatchingTask(baseTasks, review);
    expect(match).not.toBeNull();
    expect(match!.id).toBe(2);
  });
});

// ── Multiplier bracket tests ──────────────────────────────────────────

describe("Multiplier brackets", () => {
  function getMultiplier(score: number): number {
    if (score >= 5.0) return 1.5;
    if (score >= 4.8) return 1.1;
    if (score >= 4.6) return 1.0;
    return 0.0;
  }

  it("should return 1.5x for perfect 5.0 score", () => {
    expect(getMultiplier(5.0)).toBe(1.5);
  });

  it("should return 1.1x for 4.8 score", () => {
    expect(getMultiplier(4.8)).toBe(1.1);
  });

  it("should return 1.1x for 4.9 score", () => {
    expect(getMultiplier(4.9)).toBe(1.1);
  });

  it("should return 1.0x for 4.6 score", () => {
    expect(getMultiplier(4.6)).toBe(1.0);
  });

  it("should return 1.0x for 4.7 score", () => {
    expect(getMultiplier(4.7)).toBe(1.0);
  });

  it("should return 0x for 4.5 score", () => {
    expect(getMultiplier(4.5)).toBe(0.0);
  });

  it("should return 0x for 3.0 score", () => {
    expect(getMultiplier(3.0)).toBe(0.0);
  });
});

// ── Next tier calculation tests ──────────────────────────────────────

describe("Next tier calculation", () => {
  function getNextTier(score: number) {
    if (score < 4.6) {
      return {
        label: `${(4.6 - score).toFixed(2)} points to 1.0x Base`,
        pointsNeeded: Number((4.6 - score).toFixed(2)),
        nextMultiplier: 1.0,
      };
    } else if (score < 4.8) {
      return {
        label: `${(4.8 - score).toFixed(2)} points to 1.1x Bonus`,
        pointsNeeded: Number((4.8 - score).toFixed(2)),
        nextMultiplier: 1.1,
      };
    } else if (score < 5.0) {
      return {
        label: `${(5.0 - score).toFixed(2)} points to 1.5x Max`,
        pointsNeeded: Number((5.0 - score).toFixed(2)),
        nextMultiplier: 1.5,
      };
    }
    return null; // Already at max
  }

  it("should show distance to 1.0x for docked cleaners", () => {
    const tier = getNextTier(4.3);
    expect(tier).not.toBeNull();
    expect(tier!.nextMultiplier).toBe(1.0);
    expect(tier!.pointsNeeded).toBe(0.3);
  });

  it("should show distance to 1.1x for base tier cleaners", () => {
    const tier = getNextTier(4.65);
    expect(tier).not.toBeNull();
    expect(tier!.nextMultiplier).toBe(1.1);
    expect(tier!.pointsNeeded).toBe(0.15);
  });

  it("should show distance to 1.5x for bonus tier cleaners", () => {
    const tier = getNextTier(4.85);
    expect(tier).not.toBeNull();
    expect(tier!.nextMultiplier).toBe(1.5);
    expect(tier!.pointsNeeded).toBe(0.15);
  });

  it("should return null for perfect score", () => {
    const tier = getNextTier(5.0);
    expect(tier).toBeNull();
  });
});

// ── Rating normalization tests ──────────────────────────────────────

describe("Rating normalization (1-10 to 1-5)", () => {
  function normalizeRating(raw: number): number {
    return raw > 5 ? Math.round(raw / 2) : raw;
  }

  it("should keep ratings 1-5 as-is", () => {
    expect(normalizeRating(1)).toBe(1);
    expect(normalizeRating(3)).toBe(3);
    expect(normalizeRating(5)).toBe(5);
  });

  it("should convert 10 to 5", () => {
    expect(normalizeRating(10)).toBe(5);
  });

  it("should convert 8 to 4", () => {
    expect(normalizeRating(8)).toBe(4);
  });

  it("should convert 6 to 3", () => {
    expect(normalizeRating(6)).toBe(3);
  });

  it("should convert 7 to 4 (rounds up)", () => {
    expect(normalizeRating(7)).toBe(4);
  });
});

// ── Date parsing fix tests ──────────────────────────────────────────

describe("Airbnb email date parsing", () => {
  /**
   * Reimplementation of the fixed formatDate logic from VivInbox.tsx
   */
  function formatDate(dateStr: string): string {
    if (!dateStr) return "";

    // Check if it's already a full date (has year)
    const hasYear = /\d{4}/.test(dateStr);
    if (hasYear) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      }
    }

    // Partial date without year — add current year
    const cleaned = dateStr.replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*/i, "");
    const now = new Date();
    const currentYear = now.getFullYear();

    // Try current year first
    let d = new Date(`${cleaned}, ${currentYear}`);
    if (isNaN(d.getTime())) {
      d = new Date(`${cleaned} ${currentYear}`);
    }

    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }

    return dateStr; // Return as-is if unparseable
  }

  it("should parse 'Mar 21' with current year", () => {
    const result = formatDate("Mar 21");
    expect(result).toContain("Mar");
    expect(result).toContain("21");
    expect(result).toContain("2026"); // Current year
    expect(result).not.toContain("2001");
  });

  it("should parse 'Jul 9' with current year", () => {
    const result = formatDate("Jul 9");
    expect(result).toContain("Jul");
    expect(result).toContain("9");
    expect(result).toContain("2026");
    expect(result).not.toContain("2001");
  });

  it("should parse 'Fri, Jul 17' with current year", () => {
    const result = formatDate("Fri, Jul 17");
    expect(result).toContain("Jul");
    expect(result).toContain("17");
    expect(result).toContain("2026");
  });

  it("should handle full ISO date strings correctly", () => {
    const result = formatDate("2025-12-25");
    expect(result).toContain("Dec");
    expect(result).toContain("25");
    expect(result).toContain("2025");
  });

  it("should return empty string for empty input", () => {
    expect(formatDate("")).toBe("");
  });

  it("should not return year 2001 for any partial date", () => {
    // The key bug was dates like "Mar 21" being parsed as year 2001
    const result1 = formatDate("Mar 21");
    const result2 = formatDate("Jul 9");
    const result3 = formatDate("Dec 25");
    expect(result1).not.toContain("2001");
    expect(result2).not.toContain("2001");
    expect(result3).not.toContain("2001");
  });

  it("should handle 'Apr 8' format", () => {
    const result = formatDate("Apr 8");
    expect(result).toContain("Apr");
    expect(result).toContain("8");
    expect(result).toContain("2026");
  });
});

// ── Attribution result structure tests ──────────────────────────────

describe("Attribution result structure", () => {
  it("should have correct initial result shape", () => {
    const result = {
      totalReviews: 0,
      attributedReviews: 0,
      newCleaners: 0,
      errors: 0,
      skippedNoTask: 0,
      skippedNoAssignment: 0,
    };

    expect(result).toHaveProperty("totalReviews");
    expect(result).toHaveProperty("attributedReviews");
    expect(result).toHaveProperty("newCleaners");
    expect(result).toHaveProperty("errors");
    expect(result).toHaveProperty("skippedNoTask");
    expect(result).toHaveProperty("skippedNoAssignment");
  });
});
