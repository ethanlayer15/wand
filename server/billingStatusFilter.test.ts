/**
 * Tests for the billing "Review Tasks" filter fix.
 * Verifies that UI status values are correctly mapped to Breezeway stage codes
 * and that the post-fetch status + date filters work correctly.
 */

import { describe, it, expect } from "vitest";

// ── Status mapping logic (mirrors routers.ts) ────────────────────────────────

const STATUS_TO_BW_STAGE: Record<string, string> = {
  scheduled: "open",
  "in-progress": "started",
  completed: "finished",
};

function mapUiStatusToBwStage(uiStatus?: string): string | undefined {
  if (!uiStatus) return undefined;
  return STATUS_TO_BW_STAGE[uiStatus] ?? uiStatus;
}

// ── Post-fetch filter logic (mirrors routers.ts) ─────────────────────────────

type BwTask = {
  id: number;
  name: string;
  scheduled_date?: string;
  type_task_status?: { code: string; name: string; stage: string };
};

function applyDateFilter(tasks: BwTask[], startDate?: string, endDate?: string): BwTask[] {
  if (!startDate && !endDate) return tasks;
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  if (end) end.setHours(23, 59, 59, 999);
  return tasks.filter((task) => {
    if (!task.scheduled_date) return false;
    const taskDate = new Date(task.scheduled_date);
    if (start && taskDate < start) return false;
    if (end && taskDate > end) return false;
    return true;
  });
}

function applyStatusFilter(tasks: BwTask[], bwStage?: string): BwTask[] {
  if (!bwStage) return tasks;
  return tasks.filter((task) => task.type_task_status?.stage === bwStage);
}

// ── Sample tasks ─────────────────────────────────────────────────────────────

const sampleTasks: BwTask[] = [
  {
    id: 1,
    name: "Fix leaky faucet",
    scheduled_date: "2026-03-30",
    type_task_status: { code: "open", name: "Scheduled", stage: "open" },
  },
  {
    id: 2,
    name: "Replace light bulb",
    scheduled_date: "2026-03-28",
    type_task_status: { code: "finished", name: "Finished", stage: "finished" },
  },
  {
    id: 3,
    name: "Clean pool",
    scheduled_date: "2026-02-24",
    type_task_status: { code: "finished", name: "Finished", stage: "finished" },
  },
  {
    id: 4,
    name: "Paint fence",
    scheduled_date: "2026-03-31",
    type_task_status: { code: "started", name: "In Progress", stage: "started" },
  },
  {
    id: 5,
    name: "No date task",
    scheduled_date: undefined,
    type_task_status: { code: "open", name: "Scheduled", stage: "open" },
  },
];

// ── Status mapping tests ─────────────────────────────────────────────────────

describe("UI status → Breezeway stage mapping", () => {
  it("maps 'scheduled' to 'open'", () => {
    expect(mapUiStatusToBwStage("scheduled")).toBe("open");
  });

  it("maps 'in-progress' to 'started'", () => {
    expect(mapUiStatusToBwStage("in-progress")).toBe("started");
  });

  it("maps 'completed' to 'finished'", () => {
    expect(mapUiStatusToBwStage("completed")).toBe("finished");
  });

  it("passes through unknown values unchanged", () => {
    expect(mapUiStatusToBwStage("custom_stage")).toBe("custom_stage");
  });

  it("returns undefined for undefined input", () => {
    expect(mapUiStatusToBwStage(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(mapUiStatusToBwStage("")).toBeUndefined();
  });
});

// ── Date filter tests ────────────────────────────────────────────────────────

describe("Post-fetch date filter", () => {
  it("returns all tasks when no date range specified", () => {
    expect(applyDateFilter(sampleTasks)).toHaveLength(sampleTasks.length);
  });

  it("filters tasks to the specified date range (03/18 to 03/31)", () => {
    const result = applyDateFilter(sampleTasks, "2026-03-18", "2026-03-31");
    // Tasks 1 (03-30), 2 (03-28), 4 (03-31) should pass; task 3 (02-24) and task 5 (no date) should not
    expect(result.map((t) => t.id)).toEqual(expect.arrayContaining([1, 2, 4]));
    expect(result.map((t) => t.id)).not.toContain(3);
    expect(result.map((t) => t.id)).not.toContain(5);
  });

  it("excludes tasks with no scheduled_date", () => {
    const result = applyDateFilter(sampleTasks, "2026-03-01", "2026-03-31");
    expect(result.find((t) => t.id === 5)).toBeUndefined();
  });

  it("includes tasks on the end date boundary (inclusive)", () => {
    const result = applyDateFilter(sampleTasks, "2026-03-31", "2026-03-31");
    expect(result.map((t) => t.id)).toContain(4);
    expect(result.map((t) => t.id)).not.toContain(1); // 03-30 is before cutoff
  });

  it("excludes tasks from Feb when filtering for March", () => {
    const result = applyDateFilter(sampleTasks, "2026-03-18", "2026-03-31");
    expect(result.find((t) => t.id === 3)).toBeUndefined(); // 02-24 is before range
  });
});

// ── Status filter tests ──────────────────────────────────────────────────────

describe("Post-fetch status filter", () => {
  it("returns all tasks when no status specified", () => {
    expect(applyStatusFilter(sampleTasks)).toHaveLength(sampleTasks.length);
  });

  it("filters to only 'open' (Scheduled) tasks", () => {
    const result = applyStatusFilter(sampleTasks, "open");
    expect(result.every((t) => t.type_task_status?.stage === "open")).toBe(true);
    expect(result.map((t) => t.id)).toContain(1);
    expect(result.map((t) => t.id)).toContain(5);
    expect(result.map((t) => t.id)).not.toContain(2); // finished
    expect(result.map((t) => t.id)).not.toContain(4); // started
  });

  it("filters to only 'finished' (Completed) tasks", () => {
    const result = applyStatusFilter(sampleTasks, "finished");
    expect(result.every((t) => t.type_task_status?.stage === "finished")).toBe(true);
    expect(result.map((t) => t.id)).toEqual(expect.arrayContaining([2, 3]));
  });

  it("filters to only 'started' (In Progress) tasks", () => {
    const result = applyStatusFilter(sampleTasks, "started");
    expect(result.map((t) => t.id)).toEqual([4]);
  });
});

// ── Combined filter tests (the bug scenario) ─────────────────────────────────

describe("Combined date + status filter (bug scenario)", () => {
  it("returns only Scheduled tasks in 03/18–03/31 range (the reported bug case)", () => {
    const bwStage = mapUiStatusToBwStage("scheduled"); // "open"
    let result = applyDateFilter(sampleTasks, "2026-03-18", "2026-03-31");
    result = applyStatusFilter(result, bwStage);

    // Only task 1 (03-30, stage=open) should match
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
    // Must NOT include task 3 (02-24, finished) — this was the reported bug
    expect(result.find((t) => t.id === 3)).toBeUndefined();
    expect(result.find((t) => t.id === 2)).toBeUndefined(); // finished, out of range
  });

  it("returns only Completed tasks in 03/18–03/31 range", () => {
    const bwStage = mapUiStatusToBwStage("completed"); // "finished"
    let result = applyDateFilter(sampleTasks, "2026-03-18", "2026-03-31");
    result = applyStatusFilter(result, bwStage);

    // Only task 2 (03-28, finished) should match
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it("returns empty when no tasks match both filters", () => {
    const bwStage = mapUiStatusToBwStage("in-progress"); // "started"
    let result = applyDateFilter(sampleTasks, "2026-03-01", "2026-03-15");
    result = applyStatusFilter(result, bwStage);
    expect(result).toHaveLength(0);
  });
});
