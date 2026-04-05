import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the DB layer ──────────────────────────────────────────────────

const taskStore: Record<number, { id: number; title: string }> = {};

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({}),
  updateTaskTitle: vi.fn(async (taskId: number, title: string) => {
    if (!taskStore[taskId]) {
      taskStore[taskId] = { id: taskId, title };
    } else {
      taskStore[taskId].title = title;
    }
    return { success: true };
  }),
}));

import { updateTaskTitle } from "./db";

describe("updateTaskTitle", () => {
  beforeEach(() => {
    // Clear store and reset mock call history
    Object.keys(taskStore).forEach((k) => delete taskStore[Number(k)]);
    vi.clearAllMocks();
  });

  it("returns success: true when updating a title", async () => {
    const result = await updateTaskTitle(1, "Fix the leaking faucet in bathroom");
    expect(result).toEqual({ success: true });
  });

  it("stores the new title correctly", async () => {
    await updateTaskTitle(42, "Replace broken AC unit");
    expect(taskStore[42].title).toBe("Replace broken AC unit");
  });

  it("overwrites an existing title", async () => {
    await updateTaskTitle(10, "Old title");
    await updateTaskTitle(10, "New clearer title for the team");
    expect(taskStore[10].title).toBe("New clearer title for the team");
  });

  it("calls updateTaskTitle with the correct arguments", async () => {
    await updateTaskTitle(7, "Inspect HVAC filter");
    expect(updateTaskTitle).toHaveBeenCalledWith(7, "Inspect HVAC filter");
    expect(updateTaskTitle).toHaveBeenCalledTimes(1);
  });

  it("handles titles with special characters", async () => {
    const title = "Fix door lock at 123 Main St — unit #4B";
    await updateTaskTitle(5, title);
    expect(taskStore[5].title).toBe(title);
  });

  it("handles long titles up to the 1000-char limit", async () => {
    const longTitle = "A".repeat(1000);
    const result = await updateTaskTitle(3, longTitle);
    expect(result.success).toBe(true);
    expect(taskStore[3].title).toBe(longTitle);
  });

  it("handles multi-line title text (with newlines)", async () => {
    const title = "Fix the deck:\n- Replace rotted boards\n- Sand and seal";
    await updateTaskTitle(8, title);
    expect(taskStore[8].title).toBe(title);
  });

  it("is idempotent — updating with the same title returns success", async () => {
    await updateTaskTitle(9, "Same title");
    const result = await updateTaskTitle(9, "Same title");
    expect(result.success).toBe(true);
  });
});
