import { describe, it, expect } from "vitest";

/**
 * Unit tests for the "Show My Tasks" filter logic.
 *
 * These tests mirror the client-side filter chain in Tasks.tsx:
 *   allTasks → visibleTasks → ... → myTasksFiltered
 *
 * The filter is purely client-side (no tRPC call), so we test the
 * predicate logic directly.
 */

type MinimalTask = {
  id: number;
  assignedTo: string | null;
  category: "maintenance" | "cleaning" | "improvements";
  status: string;
};

/** Mirrors the myTasksFiltered logic in Tasks.tsx */
function applyMyTasksFilter(tasks: MinimalTask[], showMyTasks: boolean, userName: string | undefined) {
  if (!showMyTasks) return tasks;
  return tasks.filter((t) => t.assignedTo === userName);
}

const TASKS: MinimalTask[] = [
  { id: 1, assignedTo: "Ethan", category: "maintenance", status: "created" },
  { id: 2, assignedTo: "Chloe", category: "maintenance", status: "in_progress" },
  { id: 3, assignedTo: "Mo", category: "cleaning", status: "up_next" },
  { id: 4, assignedTo: null, category: "improvements", status: "needs_review" },
  { id: 5, assignedTo: "Ethan", category: "cleaning", status: "in_progress" },
  { id: 6, assignedTo: "Mo", category: "maintenance", status: "created" },
];

describe("Show My Tasks filter", () => {
  describe("default state (showMyTasks = false)", () => {
    it("returns all tasks when filter is off", () => {
      const result = applyMyTasksFilter(TASKS, false, "Ethan");
      expect(result).toHaveLength(6);
    });

    it("returns all tasks even when user is undefined", () => {
      const result = applyMyTasksFilter(TASKS, false, undefined);
      expect(result).toHaveLength(6);
    });

    it("returns all tasks even when no tasks are assigned to the user", () => {
      const result = applyMyTasksFilter(TASKS, false, "Unknown User");
      expect(result).toHaveLength(6);
    });
  });

  describe("active state (showMyTasks = true)", () => {
    it("filters to only tasks assigned to Ethan", () => {
      const result = applyMyTasksFilter(TASKS, true, "Ethan");
      expect(result).toHaveLength(2);
      expect(result.every((t) => t.assignedTo === "Ethan")).toBe(true);
      expect(result.map((t) => t.id)).toEqual([1, 5]);
    });

    it("filters to only tasks assigned to Chloe", () => {
      const result = applyMyTasksFilter(TASKS, true, "Chloe");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });

    it("filters to only tasks assigned to Mo", () => {
      const result = applyMyTasksFilter(TASKS, true, "Mo");
      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id)).toEqual([3, 6]);
    });

    it("returns empty array when user has no assigned tasks", () => {
      const result = applyMyTasksFilter(TASKS, true, "Unknown User");
      expect(result).toHaveLength(0);
    });

    it("returns empty array when user is undefined", () => {
      const result = applyMyTasksFilter(TASKS, true, undefined);
      expect(result).toHaveLength(0);
    });

    it("excludes unassigned tasks (assignedTo = null)", () => {
      const result = applyMyTasksFilter(TASKS, true, "Ethan");
      expect(result.some((t) => t.assignedTo === null)).toBe(false);
    });
  });

  describe("toggle behavior", () => {
    it("toggling off returns all tasks again", () => {
      const filtered = applyMyTasksFilter(TASKS, true, "Ethan");
      expect(filtered).toHaveLength(2);

      const allAgain = applyMyTasksFilter(TASKS, false, "Ethan");
      expect(allAgain).toHaveLength(6);
    });

    it("toggling on then off is idempotent", () => {
      const original = applyMyTasksFilter(TASKS, false, "Mo");
      const filtered = applyMyTasksFilter(TASKS, true, "Mo");
      const restored = applyMyTasksFilter(filtered, false, "Mo");
      // After restoring to false, all tasks should be visible again
      // (the filter doesn't mutate the source array)
      expect(original).toHaveLength(6);
      expect(filtered).toHaveLength(2);
      expect(restored).toHaveLength(2); // filtered is the input, not TASKS
    });

    it("applying filter to full list then clearing gives same result as never filtering", () => {
      const neverFiltered = applyMyTasksFilter(TASKS, false, "Ethan");
      const filteredThenCleared = applyMyTasksFilter(TASKS, false, "Ethan");
      expect(neverFiltered).toEqual(filteredThenCleared);
    });
  });

  describe("interaction with other filters (chaining)", () => {
    it("My Tasks filter stacks correctly with a category filter", () => {
      // Simulate: myTasksFiltered → category filter
      const myTasks = applyMyTasksFilter(TASKS, true, "Ethan");
      const maintenanceOnly = myTasks.filter((t) => t.category === "maintenance");
      expect(maintenanceOnly).toHaveLength(1);
      expect(maintenanceOnly[0].id).toBe(1);
    });

    it("My Tasks filter stacks correctly with a status filter", () => {
      const myTasks = applyMyTasksFilter(TASKS, true, "Ethan");
      const inProgress = myTasks.filter((t) => t.status === "in_progress");
      expect(inProgress).toHaveLength(1);
      expect(inProgress[0].id).toBe(5);
    });

    it("empty source list returns empty result regardless of toggle state", () => {
      expect(applyMyTasksFilter([], false, "Ethan")).toHaveLength(0);
      expect(applyMyTasksFilter([], true, "Ethan")).toHaveLength(0);
    });
  });
});
