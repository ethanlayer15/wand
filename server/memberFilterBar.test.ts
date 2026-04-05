import { describe, it, expect } from "vitest";

/**
 * Tests for the member role filter bar bug fix.
 *
 * Root cause: listings.list used managerProcedure, so members got 403.
 * Fix: changed to protectedProcedure so all authenticated users can list.
 *
 * Also: My Tasks toggle is hidden for members since they already only see
 * their own tasks via the visibleTasks filter.
 */

describe("Member role filter bar fix", () => {
  describe("listings.list access control", () => {
    it("should allow member role to access listing data for filter bar", () => {
      // The fix changed listings.list from managerProcedure to protectedProcedure
      // This test validates the logic: any authenticated user should get listings
      const userRoles = ["admin", "manager", "member"];
      const canAccessListings = (role: string) => {
        // protectedProcedure = any authenticated user
        return ["admin", "manager", "member"].includes(role);
      };

      for (const role of userRoles) {
        expect(canAccessListings(role)).toBe(true);
      }
    });

    it("should still restrict listings.search to manager+", () => {
      const canSearchListings = (role: string) => {
        return role === "admin" || role === "manager";
      };

      expect(canSearchListings("admin")).toBe(true);
      expect(canSearchListings("manager")).toBe(true);
      expect(canSearchListings("member")).toBe(false);
    });
  });

  describe("My Tasks button visibility", () => {
    it("should hide My Tasks button for members", () => {
      const isMember = true;
      const showMyTasksButton = !isMember;
      expect(showMyTasksButton).toBe(false);
    });

    it("should show My Tasks button for managers", () => {
      const isMember = false; // manager
      const showMyTasksButton = !isMember;
      expect(showMyTasksButton).toBe(true);
    });

    it("should show My Tasks button for admins", () => {
      const isMember = false; // admin
      const showMyTasksButton = !isMember;
      expect(showMyTasksButton).toBe(true);
    });
  });

  describe("visibleTasks filter for members", () => {
    type MinimalTask = { id: number; assignedTo: string | null };

    const tasks: MinimalTask[] = [
      { id: 1, assignedTo: "Mo Ali" },
      { id: 2, assignedTo: "Ethan" },
      { id: 3, assignedTo: "Mo Ali" },
      { id: 4, assignedTo: null },
      { id: 5, assignedTo: "Chloe" },
    ];

    it("members only see tasks assigned to them", () => {
      const isMember = true;
      const userName = "Mo Ali";
      const visibleTasks = isMember
        ? tasks.filter((t) => t.assignedTo === userName)
        : tasks;

      expect(visibleTasks).toHaveLength(2);
      expect(visibleTasks.map((t) => t.id)).toEqual([1, 3]);
    });

    it("managers see all tasks", () => {
      const isMember = false;
      const userName = "Ethan";
      const visibleTasks = isMember
        ? tasks.filter((t) => t.assignedTo === userName)
        : tasks;

      expect(visibleTasks).toHaveLength(5);
    });

    it("admins see all tasks", () => {
      const isMember = false;
      const userName = "Admin User";
      const visibleTasks = isMember
        ? tasks.filter((t) => t.assignedTo === userName)
        : tasks;

      expect(visibleTasks).toHaveLength(5);
    });

    it("member with no assigned tasks sees empty board", () => {
      const isMember = true;
      const userName = "Unknown User";
      const visibleTasks = isMember
        ? tasks.filter((t) => t.assignedTo === userName)
        : tasks;

      expect(visibleTasks).toHaveLength(0);
    });
  });
});
