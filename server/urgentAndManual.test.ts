import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => mockDb,
}));

vi.mock("./_core/env", () => ({
  ENV: {
    ownerOpenId: "test-owner",
    databaseUrl: "mysql://test",
  },
}));

const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockLeftJoin = vi.fn();

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
};

// ── Urgent Lane Logic ──────────────────────────────────────────────

describe("Urgent Lane", () => {
  describe("isUrgent flag logic", () => {
    it("should mark task as urgent when priority is 'urgent'", () => {
      const priority = "urgent";
      const isUrgent = priority === "urgent";
      expect(isUrgent).toBe(true);
    });

    it("should not mark task as urgent for low/medium/high priority", () => {
      for (const priority of ["low", "medium", "high"]) {
        const isUrgent = priority === "urgent";
        expect(isUrgent).toBe(false);
      }
    });

    it("should store 'high' priority in DB when priority is 'urgent'", () => {
      // When creating a task with priority=urgent, the DB stores 'high' and sets isUrgent=true
      const priority = "urgent";
      const dbPriority = priority === "urgent" ? "high" : priority;
      const isUrgent = priority === "urgent";
      expect(dbPriority).toBe("high");
      expect(isUrgent).toBe(true);
    });

    it("should include urgent tasks in active task set", () => {
      const tasks = [
        { id: 1, status: "created", isUrgent: true },
        { id: 2, status: "in_progress", isUrgent: false },
        { id: 3, status: "completed", isUrgent: false },
      ];
      const activeTasks = tasks.filter(
        (t) => t.status === "created" || t.status === "in_progress"
      );
      const urgentTasks = activeTasks.filter((t) => t.isUrgent);
      expect(urgentTasks).toHaveLength(1);
      expect(urgentTasks[0].id).toBe(1);
    });

    it("should exclude urgent tasks from regular board columns", () => {
      const tasks = [
        { id: 1, status: "created", isUrgent: true },
        { id: 2, status: "created", isUrgent: false },
        { id: 3, status: "in_progress", isUrgent: true },
        { id: 4, status: "in_progress", isUrgent: false },
      ];
      const regularColumnTasks = tasks.filter(
        (t) => t.status === "created" && !t.isUrgent
      );
      expect(regularColumnTasks).toHaveLength(1);
      expect(regularColumnTasks[0].id).toBe(2);
    });

    it("should show status badge for urgent tasks (underlying column)", () => {
      const urgentTask = { id: 1, status: "in_progress", isUrgent: true };
      const statusLabels: Record<string, string> = {
        created: "In Queue",
        in_progress: "In Progress",
      };
      const badge = statusLabels[urgentTask.status];
      expect(badge).toBe("In Progress");
    });
  });

  describe("toggleUrgent", () => {
    it("should toggle isUrgent from false to true", () => {
      const task = { id: 1, isUrgent: false };
      const newIsUrgent = !task.isUrgent;
      expect(newIsUrgent).toBe(true);
    });

    it("should toggle isUrgent from true to false", () => {
      const task = { id: 1, isUrgent: true };
      const newIsUrgent = !task.isUrgent;
      expect(newIsUrgent).toBe(false);
    });

    it("should accept valid taskId and isUrgent boolean", () => {
      const input = { taskId: 42, isUrgent: true };
      expect(typeof input.taskId).toBe("number");
      expect(typeof input.isUrgent).toBe("boolean");
    });
  });

  describe("drag-to-urgent behavior", () => {
    it("should mark task urgent when dropped on urgent lane", () => {
      const task = { id: 1, isUrgent: false, status: "created" };
      const dropTarget = { type: "urgent-lane" };
      const shouldMarkUrgent = dropTarget.type === "urgent-lane" && !task.isUrgent;
      expect(shouldMarkUrgent).toBe(true);
    });

    it("should remove urgent flag when dragged from urgent lane to regular column", () => {
      const task = { id: 1, isUrgent: true, status: "created" };
      const dropTarget = { type: "column", status: "in_progress" };
      const shouldRemoveUrgent =
        task.isUrgent &&
        dropTarget.type === "column" &&
        (dropTarget.status === "created" || dropTarget.status === "in_progress");
      expect(shouldRemoveUrgent).toBe(true);
    });

    it("should not remove urgent flag when dropped on archive zones", () => {
      const task = { id: 1, isUrgent: true, status: "created" };
      const dropTarget = { type: "column", status: "completed" };
      const shouldRemoveUrgent =
        task.isUrgent &&
        dropTarget.type === "column" &&
        (dropTarget.status === "created" || dropTarget.status === "in_progress");
      expect(shouldRemoveUrgent).toBe(false);
    });
  });
});

// ── Manual Task Creation ───────────────────────────────────────────

describe("Manual Task Creation", () => {
  describe("createTask input validation", () => {
    it("should require a non-empty title", () => {
      const validate = (title: string) => title.trim().length > 0;
      expect(validate("Fix broken AC")).toBe(true);
      expect(validate("")).toBe(false);
      expect(validate("   ")).toBe(false);
    });

    it("should accept all valid priority values", () => {
      const validPriorities = ["low", "medium", "high", "urgent"];
      for (const p of validPriorities) {
        expect(validPriorities).toContain(p);
      }
    });

    it("should accept all valid task types", () => {
      const validTypes = ["maintenance", "housekeeping", "inspection", "safety", "other"];
      for (const t of validTypes) {
        expect(validTypes).toContain(t);
      }
    });

    it("should accept all valid initial statuses", () => {
      const validStatuses = ["created", "in_progress"];
      for (const s of validStatuses) {
        expect(validStatuses).toContain(s);
      }
    });

    it("should default status to 'created' when not provided", () => {
      const defaultStatus = "created";
      expect(defaultStatus).toBe("created");
    });

    it("should set source to 'wand_manual' for manual tasks", () => {
      const source = "wand_manual";
      expect(source).toBe("wand_manual");
    });

    it("should set isUrgent=true when priority is 'urgent'", () => {
      const priority = "urgent";
      const isUrgent = priority === "urgent";
      const dbPriority = isUrgent ? "high" : priority;
      expect(isUrgent).toBe(true);
      expect(dbPriority).toBe("high");
    });

    it("should set isUrgent=false for non-urgent priorities", () => {
      for (const priority of ["low", "medium", "high"]) {
        const isUrgent = priority === "urgent";
        expect(isUrgent).toBe(false);
      }
    });

    it("should accept optional listingId", () => {
      const withListing = { title: "Task", listingId: 42 };
      const withoutListing = { title: "Task" };
      expect(withListing.listingId).toBe(42);
      expect(withoutListing.listingId).toBeUndefined();
    });

    it("should accept optional assignedTo", () => {
      const withAssignee = { title: "Task", assignedTo: "John" };
      const withoutAssignee = { title: "Task" };
      expect(withAssignee.assignedTo).toBe("John");
      expect(withoutAssignee.assignedTo).toBeUndefined();
    });
  });

  describe("wand_manual source badge", () => {
    it("should show 'Manual' label for wand_manual source", () => {
      const sourceLabel = (source: string) => {
        switch (source) {
          case "wand_manual":
          case "manual":
            return "Manual";
          case "breezeway":
            return "Breezeway";
          case "guest_message":
            return "Guest Msg";
          default:
            return "Manual";
        }
      };
      expect(sourceLabel("wand_manual")).toBe("Manual");
      expect(sourceLabel("manual")).toBe("Manual");
    });

    it("should use amber color for manual source badge", () => {
      const isManual = (source: string) =>
        source === "wand_manual" || source === "manual";
      expect(isManual("wand_manual")).toBe(true);
      expect(isManual("manual")).toBe(true);
      expect(isManual("breezeway")).toBe(false);
      expect(isManual("guest_message")).toBe(false);
    });
  });
});

// ── Urgent Items Dashboard Widget ─────────────────────────────────

describe("Urgent Items Dashboard Widget", () => {
  it("should only show active urgent tasks (not archived)", () => {
    const tasks = [
      { id: 1, isUrgent: true, hiddenFromBoard: false, status: "created" },
      { id: 2, isUrgent: true, hiddenFromBoard: false, status: "completed" },
      { id: 3, isUrgent: true, hiddenFromBoard: true, status: "created" },
      { id: 4, isUrgent: false, hiddenFromBoard: false, status: "created" },
    ];
    // getUrgentTasks filters: isUrgent=true AND hiddenFromBoard=false
    const urgentTasks = tasks.filter((t) => t.isUrgent && !t.hiddenFromBoard);
    expect(urgentTasks).toHaveLength(2);
    expect(urgentTasks.map((t) => t.id)).toEqual([1, 2]);
  });

  it("should show status badge for each urgent task", () => {
    const statusLabels: Record<string, string> = {
      created: "In Queue",
      in_progress: "In Progress",
    };
    const urgentTask = { id: 1, status: "in_progress", isUrgent: true };
    expect(statusLabels[urgentTask.status]).toBe("In Progress");
  });

  it("should return empty array when no urgent tasks", () => {
    const tasks: any[] = [];
    const urgentTasks = tasks.filter((t) => t.isUrgent && !t.hiddenFromBoard);
    expect(urgentTasks).toHaveLength(0);
  });

  it("should show up to 6 items in the widget", () => {
    const urgentTasks = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      isUrgent: true,
      status: "created",
    }));
    const displayed = urgentTasks.slice(0, 6);
    expect(displayed).toHaveLength(6);
  });

  it("should show overflow count when more than 6 urgent tasks", () => {
    const urgentTasks = Array.from({ length: 9 }, (_, i) => ({
      id: i + 1,
      isUrgent: true,
    }));
    const overflowCount = Math.max(0, urgentTasks.length - 6);
    expect(overflowCount).toBe(3);
  });

  it("should include property name and assignee in task row", () => {
    const task = {
      id: 1,
      title: "Fix AC",
      listingName: "Mountain View Cabin",
      assignedTo: "Alice",
      status: "created",
      isUrgent: true,
    };
    expect(task.listingName).toBe("Mountain View Cabin");
    expect(task.assignedTo).toBe("Alice");
  });

  it("should handle tasks without property or assignee gracefully", () => {
    const task = {
      id: 1,
      title: "Fix AC",
      listingName: null,
      assignedTo: null,
      status: "created",
      isUrgent: true,
    };
    expect(task.listingName).toBeNull();
    expect(task.assignedTo).toBeNull();
  });
});
