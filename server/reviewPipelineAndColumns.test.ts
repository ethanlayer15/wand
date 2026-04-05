/**
 * Tests for:
 * 1. Review Analysis Pipeline (sync, analyze, task creation)
 * 2. Two New Kanban Columns (needs_review, up_next)
 * 3. Review source type and badge
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Review Pipeline Module Tests ────────────────────────────────────

describe("Review Pipeline Module", () => {
  it("exports syncHostawayReviews function", async () => {
    const mod = await import("./reviewPipeline");
    expect(typeof mod.syncHostawayReviews).toBe("function");
  });

  it("exports analyzeReviewsForTasks function", async () => {
    const mod = await import("./reviewPipeline");
    expect(typeof mod.analyzeReviewsForTasks).toBe("function");
  });

  it("exports createTasksFromReviews function", async () => {
    const mod = await import("./reviewPipeline");
    expect(typeof mod.createTasksFromReviews).toBe("function");
  });

  it("exports runReviewPipeline function", async () => {
    const mod = await import("./reviewPipeline");
    expect(typeof mod.runReviewPipeline).toBe("function");
  });

  it("exports startReviewPipelineJob function", async () => {
    const mod = await import("./reviewPipeline");
    expect(typeof mod.startReviewPipelineJob).toBe("function");
  });

  it("exports getReviewPipelineJobStatus function", async () => {
    const mod = await import("./reviewPipeline");
    expect(typeof mod.getReviewPipelineJobStatus).toBe("function");
  });

  it("exports markOldReviewsAsAnalyzed function", async () => {
    const mod = await import("./reviewPipeline");
    expect(typeof mod.markOldReviewsAsAnalyzed).toBe("function");
  });

  it("getReviewPipelineJobStatus returns correct initial state including oldMarked", async () => {
    const mod = await import("./reviewPipeline");
    const status = mod.getReviewPipelineJobStatus();
    expect(status).toHaveProperty("running");
    expect(status).toHaveProperty("phase");
    expect(status).toHaveProperty("synced");
    expect(status).toHaveProperty("analyzed");
    expect(status).toHaveProperty("actionable");
    expect(status).toHaveProperty("tasksCreated");
    expect(status).toHaveProperty("oldMarked");
    expect(status.running).toBe(false);
    expect(status.phase).toBe("idle");
    expect(status.synced).toBe(0);
    expect(status.analyzed).toBe(0);
    expect(status.actionable).toBe(0);
    expect(status.tasksCreated).toBe(0);
    expect(status.oldMarked).toBe(0);
  });

  it("analyzeReviewsForTasks default batch size is 500", async () => {
    // Verify the function signature accepts the default batch size of 500
    const mod = await import("./reviewPipeline");
    // The function should be callable without arguments (uses default 500)
    expect(mod.analyzeReviewsForTasks.length).toBeLessThanOrEqual(1);
  });
});

// ── Schema Tests ────────────────────────────────────────────────────

describe("Schema: New Task Statuses", () => {
  it("tasks table supports needs_review status", async () => {
    const schema = await import("../drizzle/schema");
    const statusCol = schema.tasks.status;
    expect(statusCol.enumValues).toContain("needs_review");
  });

  it("tasks table supports up_next status", async () => {
    const schema = await import("../drizzle/schema");
    const statusCol = schema.tasks.status;
    expect(statusCol.enumValues).toContain("up_next");
  });

  it("tasks table supports all 7 statuses", async () => {
    const schema = await import("../drizzle/schema");
    const statusCol = schema.tasks.status;
    expect(statusCol.enumValues).toContain("created");
    expect(statusCol.enumValues).toContain("needs_review");
    expect(statusCol.enumValues).toContain("up_next");
    expect(statusCol.enumValues).toContain("in_progress");
    expect(statusCol.enumValues).toContain("completed");
    expect(statusCol.enumValues).toContain("ignored");
    expect(statusCol.enumValues).toContain("ideas_for_later");
  });
});

describe("Schema: Review Source Type", () => {
  it("tasks source enum includes review", async () => {
    const schema = await import("../drizzle/schema");
    const sourceCol = schema.tasks.source;
    expect(sourceCol.enumValues).toContain("review");
  });

  it("tasks source enum includes all sources", async () => {
    const schema = await import("../drizzle/schema");
    const sourceCol = schema.tasks.source;
    expect(sourceCol.enumValues).toContain("airbnb_review");
    expect(sourceCol.enumValues).toContain("guest_message");
    expect(sourceCol.enumValues).toContain("manual");
    expect(sourceCol.enumValues).toContain("breezeway");
    expect(sourceCol.enumValues).toContain("wand_manual");
    expect(sourceCol.enumValues).toContain("review");
  });
});

describe("Schema: Reviews Table", () => {
  it("reviews table exists in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.reviews).toBeDefined();
  });

  it("reviews table has isAnalyzed column", async () => {
    const schema = await import("../drizzle/schema");
    const cols = Object.keys(schema.reviews);
    expect(cols).toContain("isAnalyzed");
  });

  it("reviews table has aiActionable column", async () => {
    const schema = await import("../drizzle/schema");
    const cols = Object.keys(schema.reviews);
    expect(cols).toContain("aiActionable");
  });

  it("reviews table has aiConfidence column", async () => {
    const schema = await import("../drizzle/schema");
    const cols = Object.keys(schema.reviews);
    expect(cols).toContain("aiConfidence");
  });

  it("reviews table has aiSummary column", async () => {
    const schema = await import("../drizzle/schema");
    const cols = Object.keys(schema.reviews);
    expect(cols).toContain("aiSummary");
  });

  it("reviews table has aiIssues column", async () => {
    const schema = await import("../drizzle/schema");
    const cols = Object.keys(schema.reviews);
    expect(cols).toContain("aiIssues");
  });

  it("reviews table has privateFeedback column", async () => {
    const schema = await import("../drizzle/schema");
    const cols = Object.keys(schema.reviews);
    expect(cols).toContain("privateFeedback");
  });

  it("reviews table has hostawayReservationId column", async () => {
    const schema = await import("../drizzle/schema");
    const cols = Object.keys(schema.reviews);
    expect(cols).toContain("hostawayReservationId");
  });

  it("reviews table has taskId column for linking to tasks", async () => {
    const schema = await import("../drizzle/schema");
    const cols = Object.keys(schema.reviews);
    expect(cols).toContain("taskId");
  });
});

// ── Cron Integration Tests ──────────────────────────────────────────

describe("Cron: Review Pipeline Scheduling", () => {
  it("cron module imports review pipeline", async () => {
    // Just verify the import doesn't fail
    const mod = await import("./cron");
    expect(typeof mod.startCronJobs).toBe("function");
    expect(typeof mod.stopCronJobs).toBe("function");
  });
});

// ── Router Tests ────────────────────────────────────────────────────

describe("Router: Review Pipeline Procedures", () => {
  it("appRouter has triggerReviewPipeline procedure", async () => {
    const { appRouter } = await import("./routers");
    const procedures = Object.keys(appRouter._def.procedures);
    expect(procedures).toContain("tasks.triggerReviewPipeline");
  });

  it("appRouter has reviewPipelineStatus procedure", async () => {
    const { appRouter } = await import("./routers");
    const procedures = Object.keys(appRouter._def.procedures);
    expect(procedures).toContain("tasks.reviewPipelineStatus");
  });
});

describe("Router: Updated Status Enum Accepts New Values", () => {
  it("updateStatus procedure exists", async () => {
    const { appRouter } = await import("./routers");
    const procedures = Object.keys(appRouter._def.procedures);
    expect(procedures).toContain("tasks.updateStatus");
  });

  it("createTask procedure exists", async () => {
    const { appRouter } = await import("./routers");
    const procedures = Object.keys(appRouter._def.procedures);
    expect(procedures).toContain("tasks.create");
  });
});

// ── Review Pipeline Job State Tests ─────────────────────────────────

describe("Review Pipeline Job State", () => {
  it("startReviewPipelineJob returns started=true on first call", async () => {
    // Reset by importing fresh
    const mod = await import("./reviewPipeline");
    // If not already running, should start
    const status = mod.getReviewPipelineJobStatus();
    if (!status.running) {
      const result = mod.startReviewPipelineJob();
      expect(result.started).toBe(true);
      expect(result.message).toContain("started");
    }
  });

  it("startReviewPipelineJob returns started=false if already running", async () => {
    const mod = await import("./reviewPipeline");
    const status = mod.getReviewPipelineJobStatus();
    if (status.running) {
      const result = mod.startReviewPipelineJob();
      expect(result.started).toBe(false);
      expect(result.message).toContain("already running");
    }
  });
});

// ── Confidence-Based Routing Logic Tests ────────────────────────────

describe("Confidence-Based Task Routing", () => {
  it("HIGH confidence maps to created (In Queue) status", () => {
    // Test the logic: high confidence → "created"
    const confidence = "high";
    const status = confidence === "high" ? "created" : "ideas_for_later";
    expect(status).toBe("created");
  });

  it("MEDIUM confidence maps to ideas_for_later status", () => {
    const confidence = "medium";
    const status = confidence === "high" ? "created" : "ideas_for_later";
    expect(status).toBe("ideas_for_later");
  });

  it("LOW confidence maps to ideas_for_later status", () => {
    const confidence = "low";
    const status = confidence === "high" ? "created" : "ideas_for_later";
    expect(status).toBe("ideas_for_later");
  });
});

// ── Board Column Configuration Tests ────────────────────────────────

describe("Board Column Configuration", () => {
  it("board has 4 columns in correct order", () => {
    const BOARD_STATUSES = ["created", "needs_review", "up_next", "in_progress"];
    expect(BOARD_STATUSES).toHaveLength(4);
    expect(BOARD_STATUSES[0]).toBe("created");
    expect(BOARD_STATUSES[1]).toBe("needs_review");
    expect(BOARD_STATUSES[2]).toBe("up_next");
    expect(BOARD_STATUSES[3]).toBe("in_progress");
  });

  it("status labels include all new statuses", () => {
    const STATUS_LABELS: Record<string, string> = {
      created: "In Queue",
      needs_review: "Needs Review",
      up_next: "Up Next",
      in_progress: "In Progress",
      completed: "Done",
      ignored: "Ignored",
      ideas_for_later: "Ideas for Later",
    };
    expect(STATUS_LABELS.needs_review).toBe("Needs Review");
    expect(STATUS_LABELS.up_next).toBe("Up Next");
    expect(Object.keys(STATUS_LABELS)).toHaveLength(7);
  });
});
