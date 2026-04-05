/**
 * Auto-Resolution Detection Engine
 *
 * Monitors guest message conversations for signs that issues were resolved
 * through the thread itself. Triggered when new messages arrive on a
 * conversation tied to an open task (not on a timer).
 *
 * Flow:
 * 1. Cheap keyword pre-filter on new message text
 * 2. If resolution signal detected → LLM analysis with confidence scoring
 * 3. High confidence (>85%) → auto-resolve
 * 4. Medium (60-85%) → flag as "Likely Resolved"
 * 5. Low (<60%) → no action
 */

import { eq, and, inArray, isNotNull, desc, sql } from "drizzle-orm";
import { tasks, guestMessages } from "../drizzle/schema";
import type { Task, GuestMessage } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";

// ── Keyword Pre-Filter ─────────────────────────────────────────────────

/**
 * Resolution signal patterns — cheap text check before LLM.
 * Grouped by confidence weight to avoid false positives.
 */
const STRONG_RESOLUTION_PATTERNS = [
  /\bgot\s+in\b/i,
  /\bworking\s+now\b/i,
  /\ball\s+(good|set|sorted|fixed)\b/i,
  /\bnever\s*mind\b/i,
  /\bproblem\s+(solved|fixed|resolved)\b/i,
  /\bissue\s+(solved|fixed|resolved)\b/i,
  /\bthat\s+(fixed|solved|worked)\b/i,
  /\bwe('re|are)\s+(good|set|all\s+set)\b/i,
  /\bfigured\s+(it\s+)?out\b/i,
  /\bno\s+(longer|more)\s+(an?\s+)?(issue|problem)\b/i,
  /\bdisregard\b/i,
  /\bfalse\s+alarm\b/i,
];

const MODERATE_RESOLUTION_PATTERNS = [
  /\bthanks?\b/i,
  /\bthank\s+you\b/i,
  /\bappreciate\b/i,
  /\bgreat\b/i,
  /\bperfect\b/i,
  /\bawesome\b/i,
  /\bwonderful\b/i,
  /\bexcellent\b/i,
  /\bworks?\s+(great|fine|perfectly|well)\b/i,
  /\bgot\s+it\b/i,
  /\bmakes?\s+sense\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bstill\s+(not|broken|doesn't|won't|can't)\b/i,
  /\bnot\s+(working|fixed|resolved)\b/i,
  /\bworse\b/i,
  /\bsame\s+(issue|problem)\b/i,
  /\b(happening|broke|broken|failed)\s+again\b/i,
  /\b(need|send|get|please)\s+help\b/i,
  /\burgent\b/i,
  /\bemergency\b/i,
];

export interface PreFilterResult {
  hasResolutionSignal: boolean;
  strongSignals: string[];
  moderateSignals: string[];
  negativeSignals: string[];
  score: number; // 0-100 rough pre-filter score
}

/**
 * Cheap keyword pre-filter. Returns true if the message has any
 * resolution signal worth escalating to the LLM.
 */
export function preFilterResolutionSignal(messageText: string): PreFilterResult {
  const strongSignals: string[] = [];
  const moderateSignals: string[] = [];
  const negativeSignals: string[] = [];

  for (const pattern of STRONG_RESOLUTION_PATTERNS) {
    const match = messageText.match(pattern);
    if (match) strongSignals.push(match[0]);
  }

  for (const pattern of MODERATE_RESOLUTION_PATTERNS) {
    const match = messageText.match(pattern);
    if (match) moderateSignals.push(match[0]);
  }

  for (const pattern of NEGATIVE_PATTERNS) {
    const match = messageText.match(pattern);
    if (match) negativeSignals.push(match[0]);
  }

  // Score: strong signals worth more, negatives subtract
  let score = strongSignals.length * 30 + moderateSignals.length * 15 - negativeSignals.length * 25;
  score = Math.max(0, Math.min(100, score));

  // Only escalate to LLM if there's a net positive signal
  const hasResolutionSignal =
    (strongSignals.length > 0 || moderateSignals.length >= 2) &&
    negativeSignals.length === 0;

  return { hasResolutionSignal, strongSignals, moderateSignals, negativeSignals, score };
}

// ── LLM Analysis ───────────────────────────────────────────────────────

export interface ResolutionAnalysis {
  isResolved: boolean;
  confidence: number; // 0-100
  reason: string;
  triggerQuote: string; // the specific text that indicates resolution
}

/**
 * Send the original issue + new messages to the LLM for resolution analysis.
 * Returns a confidence score and explanation.
 */
export async function analyzeResolution(
  originalIssue: string,
  conversationMessages: Array<{ sender: string; body: string; isIncoming: boolean }>,
  newMessageBody: string
): Promise<ResolutionAnalysis> {
  const conversationContext = conversationMessages
    .map((m) => `[${m.isIncoming ? "Guest" : "Host"}] ${m.body}`)
    .join("\n\n");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an issue resolution detector for a vacation rental property management system. 
Your job is to analyze guest message conversations and determine if a reported issue has been resolved through the conversation thread.

IMPORTANT RULES:
- A "thank you" alone after a host provides instructions does NOT mean the issue is resolved — the guest may just be acknowledging receipt.
- Look for EXPLICIT confirmation that the problem is fixed (e.g., "got in", "working now", "all good").
- If the host provided a solution but the guest hasn't confirmed it worked, confidence should be LOW (under 50%).
- If the guest says something like "thanks, that worked" or "got in, thank you" — that IS resolution.
- Consider the full conversation context, not just the latest message.
- Be conservative — false positives (marking unresolved issues as resolved) are worse than false negatives.`,
      },
      {
        role: "user",
        content: `Original issue reported by guest:
"${originalIssue}"

Full conversation thread:
${conversationContext}

Latest message:
"${newMessageBody}"

Analyze whether this conversation indicates the original issue has been resolved. Return your analysis as JSON.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "resolution_analysis",
        strict: true,
        schema: {
          type: "object",
          properties: {
            is_resolved: {
              type: "boolean",
              description: "Whether the issue appears to be resolved",
            },
            confidence: {
              type: "integer",
              description: "Confidence score from 0 to 100",
            },
            reason: {
              type: "string",
              description:
                "Brief explanation of why you believe the issue is or is not resolved",
            },
            trigger_quote: {
              type: "string",
              description:
                "The specific quote from the conversation that most strongly indicates resolution (or empty string if not resolved)",
            },
          },
          required: ["is_resolved", "confidence", "reason", "trigger_quote"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices?.[0]?.message?.content as string | undefined;
  if (!content) {
    return {
      isResolved: false,
      confidence: 0,
      reason: "LLM returned no response",
      triggerQuote: "",
    };
  }

  try {
    const parsed = JSON.parse(content);
    return {
      isResolved: parsed.is_resolved ?? false,
      confidence: Math.max(0, Math.min(100, parsed.confidence ?? 0)),
      reason: parsed.reason ?? "",
      triggerQuote: parsed.trigger_quote ?? "",
    };
  } catch {
    return {
      isResolved: false,
      confidence: 0,
      reason: "Failed to parse LLM response",
      triggerQuote: "",
    };
  }
}

// ── Resolution Engine ──────────────────────────────────────────────────

export interface ResolutionCheckResult {
  taskId: number;
  action: "auto_resolved" | "likely_resolved" | "no_action" | "expired" | "skipped";
  confidence?: number;
  reason?: string;
  triggerMessageId?: number;
}

/**
 * Check a single task for resolution signals based on new messages.
 * Called when the message pipeline detects new messages on a conversation
 * tied to an open guest_message task.
 */
export async function checkTaskResolution(
  task: Task,
  newMessages: GuestMessage[]
): Promise<ResolutionCheckResult> {
  const taskId = task.id;

  // Skip if task is already completed, ignored, or auto-resolved
  if (
    task.status === "completed" ||
    task.status === "ignored" ||
    task.resolutionStatus === "auto_resolved"
  ) {
    return { taskId, action: "skipped", reason: "Task already resolved/completed" };
  }

  // Check 72-hour monitoring cap
  if (task.monitoringExpiresAt && new Date() > new Date(task.monitoringExpiresAt)) {
    return { taskId, action: "expired", reason: "72-hour monitoring window expired" };
  }

  // Only check incoming messages (from guest, not host)
  const incomingMessages = newMessages.filter((m) => m.isIncoming !== false);
  if (incomingMessages.length === 0) {
    return { taskId, action: "skipped", reason: "No incoming guest messages" };
  }

  // Get the latest incoming message for pre-filter
  const latestMessage = incomingMessages[incomingMessages.length - 1];
  const messageText = latestMessage.body || "";

  // Step 1: Cheap keyword pre-filter
  const preFilter = preFilterResolutionSignal(messageText);
  if (!preFilter.hasResolutionSignal) {
    return {
      taskId,
      action: "no_action",
      reason: `No resolution signal in message (pre-filter score: ${preFilter.score})`,
    };
  }

  // Step 2: Fetch full conversation thread for LLM context
  const db = await getDb();
  if (!db) return { taskId, action: "skipped", reason: "Database not available" };
  const conversationId = task.externalId;
  if (!conversationId) {
    return { taskId, action: "skipped", reason: "No conversation ID on task" };
  }

  const allMessages = await db
    .select({
      id: guestMessages.id,
      body: guestMessages.body,
      isIncoming: guestMessages.isIncoming,
      guestName: guestMessages.guestName,
      sentAt: guestMessages.sentAt,
    })
    .from(guestMessages)
    .where(eq(guestMessages.hostawayConversationId, conversationId))
    .orderBy(guestMessages.sentAt)
    .limit(20); // Cap at 20 messages for LLM context

  const conversationForLLM = allMessages.map((m) => ({
    sender: m.guestName || (m.isIncoming ? "Guest" : "Host"),
    body: m.body || "",
    isIncoming: m.isIncoming ?? true,
  }));

  // Step 3: LLM analysis
  const analysis = await analyzeResolution(
    task.title + (task.description ? "\n" + task.description.slice(0, 500) : ""),
    conversationForLLM,
    messageText
  );

  // Step 4: Apply thresholds
  if (analysis.confidence > 85) {
    // High confidence → auto-resolve
    await db
      .update(tasks)
      .set({
        resolutionStatus: "auto_resolved",
        resolutionConfidence: analysis.confidence,
        resolutionReason: analysis.reason,
        resolvedAt: new Date(),
        resolutionMessageId: latestMessage.id,
        status: "completed",
      })
      .where(eq(tasks.id, taskId));

    console.log(
      `[AutoResolution] Task #${taskId} auto-resolved (confidence: ${analysis.confidence}%): ${analysis.reason}`
    );

    return {
      taskId,
      action: "auto_resolved",
      confidence: analysis.confidence,
      reason: analysis.reason,
      triggerMessageId: latestMessage.id,
    };
  } else if (analysis.confidence >= 60) {
    // Medium confidence → flag for review
    await db
      .update(tasks)
      .set({
        resolutionStatus: "likely_resolved",
        resolutionConfidence: analysis.confidence,
        resolutionReason: analysis.reason,
        resolutionMessageId: latestMessage.id,
      })
      .where(eq(tasks.id, taskId));

    console.log(
      `[AutoResolution] Task #${taskId} flagged as likely resolved (confidence: ${analysis.confidence}%): ${analysis.reason}`
    );

    return {
      taskId,
      action: "likely_resolved",
      confidence: analysis.confidence,
      reason: analysis.reason,
      triggerMessageId: latestMessage.id,
    };
  } else {
    // Low confidence → no action
    console.log(
      `[AutoResolution] Task #${taskId} no action (confidence: ${analysis.confidence}%): ${analysis.reason}`
    );

    return {
      taskId,
      action: "no_action",
      confidence: analysis.confidence,
      reason: analysis.reason,
    };
  }
}

// ── Batch Check (called from pipeline) ─────────────────────────────────

/**
 * After the message pipeline syncs new messages, check all open guest_message
 * tasks that have active monitoring for resolution signals.
 *
 * This is the main entry point — called from taskCreator.ts after messages
 * are synced and tasks are updated.
 */
export async function checkResolutionsForNewMessages(
  updatedConversationIds: string[]
): Promise<{
  checked: number;
  autoResolved: number;
  likelyResolved: number;
}> {
  if (updatedConversationIds.length === 0) {
    return { checked: 0, autoResolved: 0, likelyResolved: 0 };
  }

  const db = await getDb();
  if (!db) return { checked: 0, autoResolved: 0, likelyResolved: 0 };
  const now = new Date();

  // Find open guest_message tasks for these conversations that are still being monitored
  const openTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.source, "guest_message"),
        inArray(tasks.externalId, updatedConversationIds),
        // Only check tasks that aren't already completed/ignored
        sql`${tasks.status} NOT IN ('completed', 'ignored')`,
        // Only check tasks that haven't been auto-resolved
        sql`(${tasks.resolutionStatus} IS NULL OR ${tasks.resolutionStatus} NOT IN ('auto_resolved'))`,
        // Only check tasks within the 72-hour monitoring window
        sql`(${tasks.monitoringExpiresAt} IS NULL OR ${tasks.monitoringExpiresAt} > ${now})`
      )
    );

  let autoResolved = 0;
  let likelyResolved = 0;

  for (const task of openTasks) {
    // Get new messages for this conversation (last 5 messages)
    const recentMessages = await db
      .select()
      .from(guestMessages)
      .where(eq(guestMessages.hostawayConversationId, task.externalId!))
      .orderBy(desc(guestMessages.sentAt))
      .limit(5);

    try {
      const result = await checkTaskResolution(task, recentMessages.reverse());
      if (result.action === "auto_resolved") autoResolved++;
      if (result.action === "likely_resolved") likelyResolved++;
    } catch (err: any) {
      console.error(
        `[AutoResolution] Error checking task #${task.id}:`,
        err.message
      );
    }
  }

  return { checked: openTasks.length, autoResolved, likelyResolved };
}
