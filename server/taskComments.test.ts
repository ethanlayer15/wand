import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the DB layer ──────────────────────────────────────────────────

const mockComments: Array<{
  id: number;
  taskId: number;
  userId: number;
  userName: string;
  content: string;
  createdAt: Date;
}> = [];

let nextId = 1;

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({}),
  getTaskComments: vi.fn(async (taskId: number) =>
    mockComments
      .filter((c) => c.taskId === taskId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  ),
  addTaskComment: vi.fn(async (data: { taskId: number; userId: number; userName: string; content: string }) => {
    const comment = {
      id: nextId++,
      taskId: data.taskId,
      userId: data.userId,
      userName: data.userName,
      content: data.content,
      createdAt: new Date(),
    };
    mockComments.push(comment);
    return { id: comment.id };
  }),
}));

import { getTaskComments, addTaskComment } from "./db";

describe("Task Comments", () => {
  beforeEach(() => {
    mockComments.length = 0;
    nextId = 1;
  });

  // ── addTaskComment ──────────────────────────────────────────────────

  describe("addTaskComment", () => {
    it("creates a comment and returns its id", async () => {
      const result = await addTaskComment({
        taskId: 42,
        userId: 1,
        userName: "Ethan Layer",
        content: "Scheduled plumber for Tuesday",
      });
      expect(result).toHaveProperty("id");
      expect(result.id).toBe(1);
    });

    it("stores the comment with correct fields", async () => {
      await addTaskComment({
        taskId: 42,
        userId: 1,
        userName: "Ethan Layer",
        content: "Called the vendor, waiting for callback",
      });
      expect(mockComments).toHaveLength(1);
      expect(mockComments[0]).toMatchObject({
        taskId: 42,
        userId: 1,
        userName: "Ethan Layer",
        content: "Called the vendor, waiting for callback",
      });
    });

    it("auto-increments comment IDs", async () => {
      const r1 = await addTaskComment({
        taskId: 42,
        userId: 1,
        userName: "Ethan",
        content: "First note",
      });
      const r2 = await addTaskComment({
        taskId: 42,
        userId: 2,
        userName: "Sarah",
        content: "Second note",
      });
      expect(r2.id).toBe(r1.id + 1);
    });

    it("allows multiple comments on the same task", async () => {
      await addTaskComment({ taskId: 10, userId: 1, userName: "A", content: "Note 1" });
      await addTaskComment({ taskId: 10, userId: 2, userName: "B", content: "Note 2" });
      await addTaskComment({ taskId: 10, userId: 1, userName: "A", content: "Note 3" });
      expect(mockComments.filter((c) => c.taskId === 10)).toHaveLength(3);
    });

    it("isolates comments across different tasks", async () => {
      await addTaskComment({ taskId: 10, userId: 1, userName: "A", content: "Task 10 note" });
      await addTaskComment({ taskId: 20, userId: 1, userName: "A", content: "Task 20 note" });
      expect(mockComments.filter((c) => c.taskId === 10)).toHaveLength(1);
      expect(mockComments.filter((c) => c.taskId === 20)).toHaveLength(1);
    });
  });

  // ── getTaskComments ─────────────────────────────────────────────────

  describe("getTaskComments", () => {
    it("returns empty array for task with no comments", async () => {
      const result = await getTaskComments(999);
      expect(result).toEqual([]);
    });

    it("returns comments for the specified task only", async () => {
      await addTaskComment({ taskId: 10, userId: 1, userName: "A", content: "Note for 10" });
      await addTaskComment({ taskId: 20, userId: 1, userName: "A", content: "Note for 20" });
      await addTaskComment({ taskId: 10, userId: 2, userName: "B", content: "Another for 10" });

      const result = await getTaskComments(10);
      expect(result).toHaveLength(2);
      expect(result.every((c) => c.taskId === 10)).toBe(true);
    });

    it("returns comments sorted by createdAt ascending", async () => {
      // Manually push with controlled timestamps
      mockComments.push(
        { id: 100, taskId: 5, userId: 1, userName: "A", content: "Oldest", createdAt: new Date("2026-01-01") },
        { id: 101, taskId: 5, userId: 1, userName: "A", content: "Newest", createdAt: new Date("2026-03-01") },
        { id: 102, taskId: 5, userId: 1, userName: "A", content: "Middle", createdAt: new Date("2026-02-01") },
      );

      const result = await getTaskComments(5);
      expect(result[0].content).toBe("Oldest");
      expect(result[1].content).toBe("Middle");
      expect(result[2].content).toBe("Newest");
    });

    it("includes all expected fields in returned comments", async () => {
      await addTaskComment({
        taskId: 42,
        userId: 7,
        userName: "Test User",
        content: "Checking fields",
      });

      const result = await getTaskComments(42);
      expect(result).toHaveLength(1);
      const comment = result[0];
      expect(comment).toHaveProperty("id");
      expect(comment).toHaveProperty("taskId", 42);
      expect(comment).toHaveProperty("userId", 7);
      expect(comment).toHaveProperty("userName", "Test User");
      expect(comment).toHaveProperty("content", "Checking fields");
      expect(comment).toHaveProperty("createdAt");
      expect(comment.createdAt).toBeInstanceOf(Date);
    });
  });

  // ── Schema / validation expectations ────────────────────────────────

  describe("schema expectations", () => {
    it("taskComments table has the expected columns", async () => {
      // Import schema directly to verify structure
      const { taskComments } = await import("../drizzle/schema");
      const columns = Object.keys(taskComments);
      // mysqlTable returns an object with column accessors
      expect(columns).toContain("id");
      expect(columns).toContain("taskId");
      expect(columns).toContain("userId");
      expect(columns).toContain("userName");
      expect(columns).toContain("content");
      expect(columns).toContain("createdAt");
    });
  });
});
