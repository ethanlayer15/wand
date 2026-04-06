/**
 * Task Creator — creates tasks from AI-analyzed guest messages.
 * Runs as part of the 5x-daily guest message pipeline.
 *
 * Flow:
 * 1. Sync new messages from Hostaway
 * 2. Run AI analysis on unanalyzed messages
 * 3. Create tasks from analyzed messages (this module)
 *
 * Deduplication: keyed on hostawayConversationId — only one task per conversation.
 * When new messages arrive in the same conversation, the existing task description
 * is appended rather than creating a duplicate.
 */

import { eq, desc, and, isNull, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { guestMessages, tasks, listings } from "../drizzle/schema";
import type { GuestMessage, InsertTask } from "../drizzle/schema";
import { syncHostawayMessages } from "./sync";
import { analyzeGuestMessages } from "./aiAnalysis";
import { createBreezewayClient } from "./breezeway";
import { getHostawayClient } from "./hostaway";
import { ENV } from "./_core/env";
import { checkResolutionsForNewMessages } from "./autoResolution";

// ── Helpers ─────────────────────────────────────────────────────────────

async function getDb() {
  if (!ENV.databaseUrl) return null;
  return drizzle({ connection: { uri: ENV.databaseUrl } });
}

/** Categories that should trigger task creation.
 *  Only real property issues — NOT questions, compliments, or vague complaints. */
const TASK_TRIGGER_CATEGORIES = new Set([
  "maintenance",
  "cleaning",
  "improvement",
]);

/**
 * Keywords that indicate a maintenance/operational issue even when the AI
 * classifies the message as a "question" or "other". Case-insensitive match
 * against the message body.
 */
const MAINTENANCE_OVERRIDE_KEYWORDS = [
  "ac", "a/c", "air condition", "heat", "heater", "heating",
  "hot water", "broken", "not working", "doesn't work", "won't work",
  "leak", "leaking", "smell", "smells", "noise", "noisy", "loud",
  "bug", "bugs", "insect", "insects", "ant", "ants", "roach", "cockroach", "spider",
  "dirty", "stain", "stained", "mold", "mildew",
  "clogged", "drain", "toilet", "fridge", "refrigerator", "freezer",
  "oven", "stove", "microwave", "dishwasher", "washer", "dryer",
  "wifi", "wi-fi", "internet", "no signal",
  "lockbox", "lock box", "door code", "key", "can't get in", "locked out",
  "parking", "garage",
  "water", "flood", "flooded",
  "power", "electricity", "outlet", "light", "lights",
];

/**
 * Escalation keywords that should flag a message as CRITICAL urgency.
 * If any of these appear in the message body, the task should be created
 * regardless of AI category.
 */
const ESCALATION_KEYWORDS = [
  "refund", "leaving early", "checking out early", "cut our trip short",
  "calling airbnb", "calling vrbo", "contacting airbnb", "contacting vrbo",
  "contacting support", "filing a complaint",
  "disappointed", "unacceptable", "disgusting", "worst",
  "health department", "unsafe", "dangerous", "hazard",
  "lawsuit", "lawyer", "attorney", "legal action",
];

/**
 * Check if a message body contains any keywords from a list (case-insensitive).
 */
function bodyContainsKeyword(body: string | null | undefined, keywords: string[]): boolean {
  if (!body) return false;
  const lower = body.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function shouldCreateTask(msg: GuestMessage): boolean {
  if (!msg.aiAnalyzed) return false;
  // Only create tasks from incoming guest messages, never from host-sent messages
  if (msg.isIncoming === false) return false;
  // Create task for actionable categories (maintenance, cleaning, improvement)
  if (msg.aiCategory && TASK_TRIGGER_CATEGORIES.has(msg.aiCategory)) return true;
  // Create task for critical urgency only (escalation situations)
  if (msg.aiUrgency === "critical") return true;

  // KEYWORD OVERRIDE: If AI classified as "question" or "other" but the message
  // body contains maintenance-related keywords, override and create a task.
  if (msg.aiCategory === "question" || msg.aiCategory === "other") {
    if (bodyContainsKeyword(msg.body, MAINTENANCE_OVERRIDE_KEYWORDS)) {
      return true;
    }
  }

  // ESCALATION OVERRIDE: If message contains escalation language, always create a task.
  if (bodyContainsKeyword(msg.body, ESCALATION_KEYWORDS)) {
    return true;
  }

  return false;
}

function mapCategoryToTaskCategory(
  aiCategory: string | null
): "maintenance" | "cleaning" | "improvements" {
  switch (aiCategory) {
    case "cleaning":
      return "cleaning";
    case "improvement":
      return "improvements";
    default:
      return "maintenance";
  }
}

function mapCategoryToTaskType(
  aiCategory: string | null
): "maintenance" | "housekeeping" | "inspection" | "safety" | "improvements" | "other" {
  switch (aiCategory) {
    case "cleaning":
      return "housekeeping";
    case "improvement":
      return "improvements";
    case "maintenance":
      return "maintenance";
    case "complaint":
      return "maintenance";
    default:
      return "other";
  }
}

function mapUrgencyToPriority(
  aiUrgency: string | null
): "low" | "medium" | "high" {
  switch (aiUrgency) {
    case "critical":
    case "high":
      return "high";
    case "medium":
      return "medium";
    default:
      return "low";
  }
}

function buildTaskDescription(msg: GuestMessage): string {
  const parts: string[] = [];

  if (msg.aiSummary) {
    parts.push(`Summary: ${msg.aiSummary}`);
  }

  if (msg.aiIssues && msg.aiIssues.length > 0) {
    parts.push(`Issues: ${msg.aiIssues.join(", ")}`);
  }

  if (msg.aiActionItems && msg.aiActionItems.length > 0) {
    parts.push(`Suggested actions:\n${msg.aiActionItems.map((a) => `  • ${a}`).join("\n")}`);
  }

  parts.push(`\nGuest: ${msg.guestName || "Unknown"}`);
  parts.push(`Message: "${(msg.body || "").slice(0, 500)}"`);
  parts.push(`Conversation ID: ${msg.hostawayConversationId}`);

  if (msg.sentAt) {
    parts.push(`Sent: ${new Date(msg.sentAt).toLocaleString()}`);
  }

  return parts.join("\n");
}

function buildTaskTitle(msg: GuestMessage): string {
  const prefix =
    msg.aiUrgency === "critical"
      ? "🚨 "
      : msg.aiUrgency === "high"
        ? "⚠️ "
        : "";
  const category = msg.aiCategory
    ? msg.aiCategory.charAt(0).toUpperCase() + msg.aiCategory.slice(1)
    : "Issue";
  const guest = msg.guestName || "Guest";
  const summary = msg.aiSummary
    ? `: ${msg.aiSummary.slice(0, 80)}`
    : "";
  return `${prefix}${category} from ${guest}${summary}`;
}

// ── Background Job State ────────────────────────────────────────────────

export interface PipelineJobStatus {
  running: boolean;
  phase: "idle" | "syncing" | "analyzing" | "creating_tasks" | "resolution_check" | "done" | "error";
  synced: number;
  analyzed: number;
  tasksCreated: number;
  tasksUpdated: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

let pipelineJob: PipelineJobStatus = {
  running: false,
  phase: "idle",
  synced: 0,
  analyzed: 0,
  tasksCreated: 0,
  tasksUpdated: 0,
};

export function getPipelineJobStatus(): PipelineJobStatus {
  return { ...pipelineJob };
}

// ── Main Pipeline ───────────────────────────────────────────────────────

export interface GuestMessagePipelineResult {
  synced: number;
  analyzed: number;
  tasksCreated: number;
  tasksUpdated: number;
  resolutionsChecked: number;
  autoResolved: number;
  likelyResolved: number;
}

/**
 * Start the pipeline as a background job. Returns immediately.
 * Use getPipelineJobStatus() to poll for progress.
 */
export function startGuestMessagePipelineJob(): { started: boolean; message: string } {
  if (pipelineJob.running) {
    return { started: false, message: "Pipeline is already running" };
  }

  pipelineJob = {
    running: true,
    phase: "syncing",
    synced: 0,
    analyzed: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    startedAt: Date.now(),
  };

  // Run in background — do NOT await
  runGuestMessagePipeline()
    .then((result) => {
      pipelineJob = {
        ...pipelineJob,
        running: false,
        phase: "done",
        synced: result.synced,
        analyzed: result.analyzed,
        tasksCreated: result.tasksCreated,
        tasksUpdated: result.tasksUpdated,
        completedAt: Date.now(),
      };
      console.log("[TaskCreator] Background pipeline completed:", result);
    })
    .catch((err) => {
      pipelineJob = {
        ...pipelineJob,
        running: false,
        phase: "error",
        error: err.message,
        completedAt: Date.now(),
      };
      console.error("[TaskCreator] Background pipeline failed:", err.message);
    });

  return { started: true, message: "Pipeline started in background" };
}

/**
 * Run the full guest message pipeline:
 * 1. Sync new messages from Hostaway
 * 2. Run AI analysis on unanalyzed messages
 * 3. Create tasks from analyzed messages
 */
export async function runGuestMessagePipeline(): Promise<GuestMessagePipelineResult> {
  let synced = 0;
  let analyzed = 0;
  let tasksCreated = 0;
  let tasksUpdated = 0;
  let resolutionsChecked = 0;
  let autoResolved = 0;
  let likelyResolved = 0;

  // Step 1: Sync messages from Hostaway
  pipelineJob.phase = "syncing";
  try {
    const syncResult = await syncHostawayMessages();
    synced = syncResult?.synced ?? 0;
    pipelineJob.synced = synced;
    console.log(`[TaskCreator] Synced ${synced} messages from Hostaway`);
  } catch (err: any) {
    console.error("[TaskCreator] Message sync failed:", err.message);
  }

  // Step 2: Run AI analysis on unanalyzed messages (up to 100 per run)
  pipelineJob.phase = "analyzing";
  try {
    const analysisResult = await analyzeGuestMessages(100);
    analyzed = analysisResult?.analyzed ?? 0;
    pipelineJob.analyzed = analyzed;
    console.log(`[TaskCreator] Analyzed ${analyzed} messages`);
  } catch (err: any) {
    console.error("[TaskCreator] Message analysis failed:", err.message);
  }

  // Step 3: Create tasks from analyzed messages
  let updatedConversationIds: string[] = [];
  pipelineJob.phase = "creating_tasks";
  try {
    const taskResult = await createTasksFromAnalyzedMessages();
    tasksCreated = taskResult.created;
    tasksUpdated = taskResult.updated;
    updatedConversationIds = taskResult.updatedConversationIds;
    pipelineJob.tasksCreated = tasksCreated;
    pipelineJob.tasksUpdated = tasksUpdated;
    console.log(
      `[TaskCreator] Created ${tasksCreated} tasks, updated ${tasksUpdated} tasks`
    );
  } catch (err: any) {
    console.error("[TaskCreator] Task creation failed:", err.message);
  }

  // Step 4: Auto-resolution detection — check conversations with updated tasks
  if (updatedConversationIds.length > 0) {
    pipelineJob.phase = "resolution_check";
    try {
      const resResult = await checkResolutionsForNewMessages(updatedConversationIds);
      resolutionsChecked = resResult.checked;
      autoResolved = resResult.autoResolved;
      likelyResolved = resResult.likelyResolved;
      console.log(
        `[TaskCreator] Resolution check: ${resolutionsChecked} checked, ${autoResolved} auto-resolved, ${likelyResolved} likely resolved`
      );
    } catch (err: any) {
      console.error("[TaskCreator] Resolution check failed:", err.message);
    }
  }

  return { synced, analyzed, tasksCreated, tasksUpdated, resolutionsChecked, autoResolved, likelyResolved };
}

/**
 * Scan recently analyzed guest messages and create tasks for actionable ones.
 * Deduplicates by hostawayConversationId to avoid duplicate tasks.
 */
async function createTasksFromAnalyzedMessages(): Promise<{
  created: number;
  updated: number;
  updatedConversationIds: string[];
}> {
  const db = await getDb();
  if (!db) return { created: 0, updated: 0, updatedConversationIds: [] };

  let created = 0;
  let updated = 0;
  const updatedConvIds = new Set<string>();

  // Get analyzed messages that don't have a task yet and are actionable
  const actionableMessages = await db
    .select()
    .from(guestMessages)
    .where(
      and(
        eq(guestMessages.aiAnalyzed, true),
        isNull(guestMessages.taskId)
      )
    )
    .orderBy(desc(guestMessages.sentAt))
    .limit(200);

  // Group by conversation ID to handle deduplication
  const byConversation = new Map<string, GuestMessage[]>();
  for (const msg of actionableMessages) {
    if (!shouldCreateTask(msg)) continue;
    const convId = msg.hostawayConversationId;
    if (!byConversation.has(convId)) {
      byConversation.set(convId, []);
    }
    byConversation.get(convId)!.push(msg);
  }

  for (const [convId, msgs] of byConversation) {
    // Check if a task already exists for this conversation
    const existingTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.source, "guest_message"),
          eq(tasks.externalId, convId),
          eq(tasks.externalSource, "hostaway")
        )
      )
      .limit(1);

    if (existingTasks.length > 0) {
      // Task already exists — append new message info to description
      const existingTask = existingTasks[0];
      const newInfo = msgs
        .map(
          (m) =>
            `\n---\n[${new Date(m.sentAt || Date.now()).toLocaleString()}] ${m.guestName || "Guest"}: ${(m.body || "").slice(0, 300)}`
        )
        .join("");

      const updatedDescription =
        (existingTask.description || "") + newInfo;

      // Escalate priority if any new message is higher urgency
      const highestUrgency = msgs.reduce((max, m) => {
        const order = { critical: 4, high: 3, medium: 2, low: 1 };
        const msgLevel = order[m.aiUrgency as keyof typeof order] || 1;
        return msgLevel > max ? msgLevel : max;
      }, 0);

      const currentPriorityOrder = { high: 3, medium: 2, low: 1 };
      const currentLevel =
        currentPriorityOrder[
          existingTask.priority as keyof typeof currentPriorityOrder
        ] || 1;

      const shouldEscalate = highestUrgency > currentLevel;

      await db
        .update(tasks)
        .set({
          description: updatedDescription,
          ...(shouldEscalate
            ? {
                priority: highestUrgency >= 3 ? "high" : "medium",
              }
            : {}),
        })
        .where(eq(tasks.id, existingTask.id));

      // Link messages to the existing task
      const msgIds = msgs.map((m) => m.id);
      await db
        .update(guestMessages)
        .set({ taskId: existingTask.id })
        .where(inArray(guestMessages.id, msgIds));

      updatedConvIds.add(convId);
      updated++;
    } else {
      // Create a new task — use the most urgent/recent message as primary
      const primaryMsg = msgs.sort((a, b) => {
        const urgencyOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const aLevel =
          urgencyOrder[a.aiUrgency as keyof typeof urgencyOrder] || 1;
        const bLevel =
          urgencyOrder[b.aiUrgency as keyof typeof urgencyOrder] || 1;
        return bLevel - aLevel;
      })[0];

      // Use reservation ID from primary message (or first message with one)
      const reservationId = primaryMsg.hostawayReservationId
        || msgs.find((m) => m.hostawayReservationId)?.hostawayReservationId
        || null;

      // Fetch arrival/departure dates from Hostaway reservation
      let arrivalDate: Date | undefined;
      let departureDate: Date | undefined;
      if (reservationId) {
        try {
          const hwClient = getHostawayClient();
          if (hwClient) {
            const reservation = await hwClient.getReservation(Number(reservationId));
            if (reservation?.arrivalDate) arrivalDate = new Date(reservation.arrivalDate);
            if (reservation?.departureDate) departureDate = new Date(reservation.departureDate);
          }
        } catch (err) {
          console.error(`[TaskCreator] Failed to fetch reservation dates for ${reservationId}:`, err);
        }
      }

      // Set 72-hour monitoring window from now
      const monitoringExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

      const taskValues: typeof tasks.$inferInsert = {
        externalId: convId,
        externalSource: "hostaway",
        listingId: primaryMsg.listingId,
        title: buildTaskTitle(primaryMsg),
        description: buildTaskDescription(primaryMsg),
        priority: mapUrgencyToPriority(primaryMsg.aiUrgency),
        status: "created",
        category: mapCategoryToTaskCategory(primaryMsg.aiCategory),
        taskType: mapCategoryToTaskType(primaryMsg.aiCategory),
        source: "guest_message",
        hostawayReservationId: reservationId ?? undefined,
        arrivalDate,
        departureDate,
        resolutionStatus: "monitoring",
        monitoringExpiresAt,
      };

      const [insertResult] = await db.insert(tasks).values(taskValues);
      const newTaskId = insertResult.insertId;

      // Link all messages in this conversation to the new task
      const msgIds = msgs.map((m) => m.id);
      await db
        .update(guestMessages)
        .set({ taskId: newTaskId })
        .where(inArray(guestMessages.id, msgIds));

      created++;
    }
  }

  return { created, updated, updatedConversationIds: [...updatedConvIds] };
}

// ── Push to Breezeway ───────────────────────────────────────────────────

export interface PushToBreezewayResult {
  success: boolean;
  breezewayTaskId?: string;
  error?: string;
}

/**
 * Push a Wand task to Breezeway as a new Breezeway task.
 * Requires the task to have a listingId that maps to a Breezeway property.
 */
export async function pushTaskToBreezeway(
  taskId: number
): Promise<PushToBreezewayResult> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database not available" };

  // Get the task
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!task) return { success: false, error: "Task not found" };
  if (task.breezewayTaskId) {
    return {
      success: true,
      breezewayTaskId: task.breezewayTaskId,
      error: "Task already pushed to Breezeway",
    };
  }

  // Find the Breezeway property ID for this listing
  // We need to look up the listing to get the property name, then find the matching Breezeway property
  let breezewayHomeId: number | null = null;

  if (task.listingId) {
    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, task.listingId))
      .limit(1);

    if (listing) {
      // Try to find matching Breezeway property by name
      const { breezewayProperties } = await import("../drizzle/schema");
      const bwProps = await db
        .select()
        .from(breezewayProperties)
        .where(eq(breezewayProperties.name, listing.name as string));

      if (bwProps.length > 0) {
        breezewayHomeId = parseInt(bwProps[0].breezewayId, 10);
      }
    }
  }

  if (!breezewayHomeId) {
    return {
      success: false,
      error:
        "Could not find matching Breezeway property for this listing. Please push manually.",
    };
  }

  // Map task category to Breezeway department
  const departmentMap: Record<string, string> = {
    maintenance: "maintenance",
    cleaning: "housekeeping",
    improvements: "maintenance",
  };

  const priorityMap: Record<string, string> = {
    high: "high",
    medium: "normal",
    low: "low",
  };

  try {
    const client = createBreezewayClient();
    const result = await client.post<{ id: number; name: string }>(
      "/task/",
      {
        home_id: breezewayHomeId,
        name: task.title.slice(0, 200),
        notes: task.description?.slice(0, 2000) || "",
        type_priority:
          priorityMap[task.priority] || "normal",
        type_department:
          departmentMap[task.category] || "maintenance",
      }
    );

    // Update the task with the Breezeway reference
    await db
      .update(tasks)
      .set({
        breezewayTaskId: String(result.id),
        breezewayPushedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    return {
      success: true,
      breezewayTaskId: String(result.id),
    };
  } catch (err: any) {
    console.error(
      `[TaskCreator] Failed to push task ${taskId} to Breezeway:`,
      err.message
    );
    return {
      success: false,
      error: `Breezeway API error: ${err.message}`,
    };
  }
}
