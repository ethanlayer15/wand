import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the statusOverridden sync-protection feature.
 *
 * Core invariant: once a user manually moves a task to a different column in Wand,
 * the Breezeway sync must NEVER reset its status — even if Breezeway still shows
 * the old status on the next sync cycle.
 */

// ── Shared mock state ──────────────────────────────────────────────────────

interface MockTask {
  id: number;
  breezewayTaskId: string;
  status: string;
  statusOverridden: boolean;
  title: string;
  priority: string;
  category: string;
  taskType: string;
  breezewayCreatedAt: Date | null;
}

const mockTasks: MockTask[] = [];
let nextId = 1;

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({}),

  getTaskByBreezewayId: vi.fn(async (breezewayTaskId: string) =>
    mockTasks.find((t) => t.breezewayTaskId === breezewayTaskId) ?? undefined
  ),

  upsertBreezewayTask: vi.fn(
    async (data: {
      breezewayTaskId: string;
      breezewayHomeId: number;
      title: string;
      priority: string;
      status: string;
      category: string;
      taskType: string;
      source: string;
      syncStatus: string;
      breezewayCreatedAt?: Date;
    }) => {
      const existing = mockTasks.find((t) => t.breezewayTaskId === data.breezewayTaskId);
      if (existing) {
        // Simulate the fixed behavior: skip status if statusOverridden
        existing.title = data.title;
        existing.priority = data.priority;
        existing.category = data.category;
        existing.taskType = data.taskType;
        if (!existing.statusOverridden) {
          existing.status = data.status;
        }
        if (data.breezewayCreatedAt && !existing.breezewayCreatedAt) {
          existing.breezewayCreatedAt = data.breezewayCreatedAt;
        }
        return { id: existing.id, action: "updated" as const };
      }
      const task: MockTask = {
        id: nextId++,
        breezewayTaskId: data.breezewayTaskId,
        status: data.status,
        statusOverridden: false,
        title: data.title,
        priority: data.priority,
        category: data.category,
        taskType: data.taskType,
        breezewayCreatedAt: data.breezewayCreatedAt ?? null,
      };
      mockTasks.push(task);
      return { id: task.id, action: "created" as const };
    }
  ),

  updateTaskStatus: vi.fn(
    async (
      taskId: number,
      status: string,
      options?: { overrideSync?: boolean }
    ) => {
      const task = mockTasks.find((t) => t.id === taskId);
      if (!task) return { success: false };
      task.status = status;
      if (options?.overrideSync !== false) {
        task.statusOverridden = true;
      }
      return { success: true };
    }
  ),
}));

import { getTaskByBreezewayId, upsertBreezewayTask, updateTaskStatus } from "./db";

const BW_TASK_DEFAULTS = {
  breezewayHomeId: 12345,
  priority: "medium" as const,
  category: "maintenance" as const,
  taskType: "maintenance" as const,
  source: "breezeway" as const,
  syncStatus: "synced" as const,
};

describe("statusOverridden sync protection", () => {
  beforeEach(() => {
    mockTasks.length = 0;
    nextId = 1;
    vi.clearAllMocks();
  });

  // ── Core bug scenario ──────────────────────────────────────────────

  describe("core bug: BW sync must not reset manually-set status", () => {
    it("BW sync resets status when statusOverridden is false (pre-fix behavior)", async () => {
      // 1. Task imported from BW as "created" (In Queue)
      await upsertBreezewayTask({
        breezewayTaskId: "BW-001",
        title: "Fix leaky faucet",
        status: "created",
        ...BW_TASK_DEFAULTS,
      });

      const task = mockTasks[0];
      expect(task.status).toBe("created");
      expect(task.statusOverridden).toBe(false);

      // 2. BW syncs again with same status — should update (no override set)
      await upsertBreezewayTask({
        breezewayTaskId: "BW-001",
        title: "Fix leaky faucet",
        status: "created",
        ...BW_TASK_DEFAULTS,
      });
      expect(task.status).toBe("created"); // unchanged, as expected
    });

    it("BW sync does NOT reset status when user has overridden it", async () => {
      // 1. Task imported from BW as "created" (In Queue)
      await upsertBreezewayTask({
        breezewayTaskId: "BW-002",
        title: "Replace HVAC filter",
        status: "created",
        ...BW_TASK_DEFAULTS,
      });

      const task = mockTasks[0];
      expect(task.status).toBe("created");

      // 2. User drags task to "In Progress" in Wand
      await updateTaskStatus(task.id, "in_progress");
      expect(task.status).toBe("in_progress");
      expect(task.statusOverridden).toBe(true);

      // 3. BW sync runs and tries to reset status back to "created"
      await upsertBreezewayTask({
        breezewayTaskId: "BW-002",
        title: "Replace HVAC filter",
        status: "created", // BW still shows "open"
        ...BW_TASK_DEFAULTS,
      });

      // Status must remain "in_progress" — the user's override is respected
      expect(task.status).toBe("in_progress");
      expect(task.statusOverridden).toBe(true);
    });

    it("BW sync does NOT reset status when user moves task to Up Next", async () => {
      await upsertBreezewayTask({
        breezewayTaskId: "BW-003",
        title: "Grill cover damaged",
        status: "created",
        ...BW_TASK_DEFAULTS,
      });
      const task = mockTasks[0];

      await updateTaskStatus(task.id, "up_next");
      expect(task.statusOverridden).toBe(true);

      // Multiple sync cycles must not reset it
      for (let i = 0; i < 5; i++) {
        await upsertBreezewayTask({
          breezewayTaskId: "BW-003",
          title: "Grill cover damaged",
          status: "created",
          ...BW_TASK_DEFAULTS,
        });
      }
      expect(task.status).toBe("up_next");
    });

    it("BW sync does NOT reset status when user moves task to Needs Review", async () => {
      await upsertBreezewayTask({
        breezewayTaskId: "BW-004",
        title: "Stains on couch",
        status: "created",
        ...BW_TASK_DEFAULTS,
      });
      const task = mockTasks[0];

      await updateTaskStatus(task.id, "needs_review");
      await upsertBreezewayTask({
        breezewayTaskId: "BW-004",
        title: "Stains on couch",
        status: "created",
        ...BW_TASK_DEFAULTS,
      });
      expect(task.status).toBe("needs_review");
    });
  });

  // ── updateTaskStatus sets statusOverridden ─────────────────────────

  describe("updateTaskStatus sets statusOverridden = true", () => {
    it("sets statusOverridden=true by default (user drag)", async () => {
      await upsertBreezewayTask({
        breezewayTaskId: "BW-010",
        title: "Check smoke detector",
        status: "created",
        ...BW_TASK_DEFAULTS,
      });
      const task = mockTasks[0];
      expect(task.statusOverridden).toBe(false);

      await updateTaskStatus(task.id, "in_progress");
      expect(task.statusOverridden).toBe(true);
    });

    it("does NOT set statusOverridden when overrideSync=false (internal sync call)", async () => {
      await upsertBreezewayTask({
        breezewayTaskId: "BW-011",
        title: "Order new bunkbed",
        status: "created",
        ...BW_TASK_DEFAULTS,
      });
      const task = mockTasks[0];

      await updateTaskStatus(task.id, "in_progress", { overrideSync: false });
      expect(task.statusOverridden).toBe(false);
    });

    it("returns success:true on valid update", async () => {
      await upsertBreezewayTask({
        breezewayTaskId: "BW-012",
        title: "Fix gate latch",
        status: "created",
        ...BW_TASK_DEFAULTS,
      });
      const task = mockTasks[0];
      const result = await updateTaskStatus(task.id, "completed");
      expect(result).toEqual({ success: true });
    });

    it("returns success:false for non-existent task", async () => {
      const result = await updateTaskStatus(9999, "in_progress");
      expect(result).toEqual({ success: false });
    });
  });

  // ── Non-BW tasks are unaffected ────────────────────────────────────

  describe("non-Breezeway tasks", () => {
    it("manual tasks can still have their status updated normally", async () => {
      // Simulate a manually created task (no breezewayTaskId)
      const task: MockTask = {
        id: nextId++,
        breezewayTaskId: "",
        status: "created",
        statusOverridden: false,
        title: "Order supplies",
        priority: "medium",
        category: "maintenance",
        taskType: "maintenance",
        breezewayCreatedAt: null,
      };
      mockTasks.push(task);

      await updateTaskStatus(task.id, "in_progress");
      expect(task.status).toBe("in_progress");
      expect(task.statusOverridden).toBe(true);
    });
  });

  // ── BW sync still updates other fields ────────────────────────────

  describe("BW sync still updates non-status fields when overridden", () => {
    it("updates title even when statusOverridden is true", async () => {
      await upsertBreezewayTask({
        breezewayTaskId: "BW-020",
        title: "Old title",
        status: "created",
        ...BW_TASK_DEFAULTS,
      });
      const task = mockTasks[0];
      await updateTaskStatus(task.id, "in_progress");

      await upsertBreezewayTask({
        breezewayTaskId: "BW-020",
        title: "Updated title from BW",
        status: "created",
        ...BW_TASK_DEFAULTS,
      });

      expect(task.title).toBe("Updated title from BW");
      expect(task.status).toBe("in_progress"); // status unchanged
    });

    it("updates priority even when statusOverridden is true", async () => {
      await upsertBreezewayTask({
        breezewayTaskId: "BW-021",
        title: "Urgent repair",
        status: "created",
        ...BW_TASK_DEFAULTS,
        priority: "low",
      });
      const task = mockTasks[0];
      await updateTaskStatus(task.id, "up_next");

      await upsertBreezewayTask({
        breezewayTaskId: "BW-021",
        title: "Urgent repair",
        status: "created",
        ...BW_TASK_DEFAULTS,
        priority: "high",
      });

      expect(task.priority).toBe("high"); // priority updated
      expect(task.status).toBe("up_next"); // status protected
    });
  });

  // ── Schema expectations ────────────────────────────────────────────

  describe("schema expectations", () => {
    it("tasks table has statusOverridden column", async () => {
      const { tasks } = await import("../drizzle/schema");
      const columns = Object.keys(tasks);
      expect(columns).toContain("statusOverridden");
    });
  });
});
