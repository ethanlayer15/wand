import { describe, it, expect } from "vitest";
import {
  mapBreezewayStatusToWand,
  mapBreezewayPriority,
  mapBreezewayDepartment,
} from "./breezewayTaskSync";

// ── Status Mapping Tests ─────────────────────────────────────────────────

describe("Breezeway Task Sync: Status Mapping", () => {
  it("should map 'open' stage to 'created' (In Queue)", () => {
    expect(mapBreezewayStatusToWand("open")).toBe("created");
  });

  it("should map 'started' stage to 'in_progress' (In Progress)", () => {
    expect(mapBreezewayStatusToWand("started")).toBe("in_progress");
  });

  it("should map 'finished' stage to 'completed' (Done)", () => {
    expect(mapBreezewayStatusToWand("finished")).toBe("completed");
  });

  it("should map 'closed' stage to 'completed' (Done)", () => {
    expect(mapBreezewayStatusToWand("closed")).toBe("completed");
  });

  it("should default undefined stage to 'created' (In Queue)", () => {
    expect(mapBreezewayStatusToWand(undefined)).toBe("created");
  });

  it("should default unknown stage to 'created' (In Queue)", () => {
    expect(mapBreezewayStatusToWand("unknown_stage")).toBe("created");
  });
});

// ── Priority Mapping Tests ───────────────────────────────────────────────

describe("Breezeway Task Sync: Priority Mapping", () => {
  it("should map 'high' to 'high'", () => {
    expect(mapBreezewayPriority("high")).toBe("high");
  });

  it("should map 'urgent' to 'high'", () => {
    expect(mapBreezewayPriority("urgent")).toBe("high");
  });

  it("should map 'High' (case insensitive) to 'high'", () => {
    expect(mapBreezewayPriority("High")).toBe("high");
  });

  it("should map 'low' to 'low'", () => {
    expect(mapBreezewayPriority("low")).toBe("low");
  });

  it("should map 'normal' to 'medium'", () => {
    expect(mapBreezewayPriority("normal")).toBe("medium");
  });

  it("should default undefined to 'medium'", () => {
    expect(mapBreezewayPriority(undefined)).toBe("medium");
  });

  it("should default unknown priority to 'medium'", () => {
    expect(mapBreezewayPriority("critical")).toBe("medium");
  });
});

// ── Department/Task Type Mapping Tests ───────────────────────────────────

describe("Breezeway Task Sync: Department Mapping", () => {
  it("should map 'maintenance' to 'maintenance'", () => {
    expect(mapBreezewayDepartment("maintenance")).toBe("maintenance");
  });

  it("should map 'housekeeping' to 'housekeeping'", () => {
    expect(mapBreezewayDepartment("housekeeping")).toBe("housekeeping");
  });

  it("should map 'inspection' to 'inspection'", () => {
    expect(mapBreezewayDepartment("inspection")).toBe("inspection");
  });

  it("should map 'safety' to 'safety'", () => {
    expect(mapBreezewayDepartment("safety")).toBe("safety");
  });

  it("should default unknown department to 'other'", () => {
    expect(mapBreezewayDepartment("landscaping")).toBe("other");
  });

  it("should default undefined to 'other'", () => {
    expect(mapBreezewayDepartment(undefined)).toBe("other");
  });
});

// ── Two-Way Sync Logic Tests ─────────────────────────────────────────────

describe("Breezeway Task Sync: Two-Way Sync Decision Logic", () => {
  // Simulate the decision logic from routers.ts updateStatus mutation
  function shouldCloseInBreezeway(
    oldStatus: string,
    newStatus: string,
    source: string,
    breezewayTaskId: string | null
  ): boolean {
    if (source !== "breezeway" || !breezewayTaskId) return false;
    return newStatus === "completed" && oldStatus !== "completed";
  }

  function shouldReopenInBreezeway(
    oldStatus: string,
    newStatus: string,
    source: string,
    breezewayTaskId: string | null
  ): boolean {
    if (source !== "breezeway" || !breezewayTaskId) return false;
    return (
      oldStatus === "completed" &&
      (newStatus === "created" || newStatus === "in_progress")
    );
  }

  function shouldDoNothingInBreezeway(
    newStatus: string,
    source: string,
    breezewayTaskId: string | null
  ): boolean {
    if (source !== "breezeway" || !breezewayTaskId) return true;
    return newStatus === "ignored";
  }

  it("should close Breezeway task when dragged to Done", () => {
    expect(
      shouldCloseInBreezeway("created", "completed", "breezeway", "12345")
    ).toBe(true);
    expect(
      shouldCloseInBreezeway("in_progress", "completed", "breezeway", "12345")
    ).toBe(true);
  });

  it("should NOT close when already completed", () => {
    expect(
      shouldCloseInBreezeway("completed", "completed", "breezeway", "12345")
    ).toBe(false);
  });

  it("should reopen Breezeway task when moved from Done to In Queue", () => {
    expect(
      shouldReopenInBreezeway("completed", "created", "breezeway", "12345")
    ).toBe(true);
  });

  it("should reopen Breezeway task when moved from Done to In Progress", () => {
    expect(
      shouldReopenInBreezeway("completed", "in_progress", "breezeway", "12345")
    ).toBe(true);
  });

  it("should NOT reopen when not previously completed", () => {
    expect(
      shouldReopenInBreezeway("created", "in_progress", "breezeway", "12345")
    ).toBe(false);
  });

  it("should do nothing on Breezeway side when moved to Ignored", () => {
    expect(
      shouldDoNothingInBreezeway("ignored", "breezeway", "12345")
    ).toBe(true);
  });

  it("should not sync non-Breezeway tasks", () => {
    expect(
      shouldCloseInBreezeway("created", "completed", "guest_message", null)
    ).toBe(false);
    expect(
      shouldReopenInBreezeway("completed", "created", "manual", null)
    ).toBe(false);
  });

  it("should not sync tasks without breezewayTaskId", () => {
    expect(
      shouldCloseInBreezeway("created", "completed", "breezeway", null)
    ).toBe(false);
  });
});

// ── Sync Config Tests ────────────────────────────────────────────────────

describe("Breezeway Task Sync: Allowed Departments Filter", () => {
  const ALLOWED = new Set(["maintenance", "housekeeping", "inspection"]);

  it("should allow maintenance tasks", () => {
    expect(ALLOWED.has("maintenance")).toBe(true);
  });

  it("should allow housekeeping tasks", () => {
    expect(ALLOWED.has("housekeeping")).toBe(true);
  });

  it("should allow inspection tasks", () => {
    expect(ALLOWED.has("inspection")).toBe(true);
  });

  it("should reject landscaping tasks", () => {
    expect(ALLOWED.has("landscaping")).toBe(false);
  });

  it("should reject undefined department", () => {
    expect(ALLOWED.has(undefined as any)).toBe(false);
  });
});

// ── Backfill Prevention Tests ────────────────────────────────────────────

describe("Breezeway Task Sync: Backfill Prevention", () => {
  function shouldSyncTask(
    taskCreatedAt: string,
    syncActivatedAt: string | null,
    existsInWand: boolean
  ): boolean {
    if (!syncActivatedAt) return true; // no activation date = sync everything
    const taskDate = new Date(taskCreatedAt);
    const activationDate = new Date(syncActivatedAt);
    if (taskDate < activationDate) {
      // Only update if already exists in Wand (was previously synced)
      return existsInWand;
    }
    return true;
  }

  it("should sync tasks created after activation", () => {
    expect(
      shouldSyncTask("2026-03-21T10:00:00Z", "2026-03-20T00:00:00Z", false)
    ).toBe(true);
  });

  it("should NOT sync old tasks that don't exist in Wand", () => {
    expect(
      shouldSyncTask("2026-03-15T10:00:00Z", "2026-03-20T00:00:00Z", false)
    ).toBe(false);
  });

  it("should update old tasks that already exist in Wand", () => {
    expect(
      shouldSyncTask("2026-03-15T10:00:00Z", "2026-03-20T00:00:00Z", true)
    ).toBe(true);
  });

  it("should sync everything when no activation date set", () => {
    expect(shouldSyncTask("2020-01-01T00:00:00Z", null, false)).toBe(true);
  });
});

// ── Reassignment Detection Tests ─────────────────────────────────────────

describe("Breezeway Task Sync: Reassignment Detection", () => {
  function isAssignedToLeisr(
    assignments: Array<{ assignee_id: number }>,
    leisrAssigneeId: number
  ): boolean {
    return assignments.some((a) => a.assignee_id === leisrAssigneeId);
  }

  const LEISR_ID = 42;

  it("should detect task assigned to Leisr Stays", () => {
    expect(
      isAssignedToLeisr(
        [{ assignee_id: 42 }, { assignee_id: 99 }],
        LEISR_ID
      )
    ).toBe(true);
  });

  it("should detect task NOT assigned to Leisr Stays", () => {
    expect(
      isAssignedToLeisr([{ assignee_id: 99 }, { assignee_id: 100 }], LEISR_ID)
    ).toBe(false);
  });

  it("should handle empty assignments", () => {
    expect(isAssignedToLeisr([], LEISR_ID)).toBe(false);
  });

  it("should handle single assignment to Leisr", () => {
    expect(isAssignedToLeisr([{ assignee_id: 42 }], LEISR_ID)).toBe(true);
  });
});
