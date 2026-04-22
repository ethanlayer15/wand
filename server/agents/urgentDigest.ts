/**
 * Wanda urgent-task digest — posts to the Leisr Ops Slack channel twice
 * a day (9 AM + 2 PM ET) listing urgent tasks that have had no activity
 * in the last 24 hours. Silent when nothing is stale.
 *
 * Activity = MAX(tasks.updatedAt, latest taskComments.createdAt).
 * Dedupe = agentActions log; skip if we already posted in the last hour.
 */

import { and, desc, eq, inArray, gt, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  tasks,
  taskComments,
  listings,
  agentActions,
} from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { postSlackMessage } from "./slack";

const DIGEST_TOOL_NAME = "urgent_task_digest_post";
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const DEDUPE_WINDOW_MS = 60 * 60 * 1000;
// Statuses that shouldn't be nudged — either terminal or intentionally parked.
const EXCLUDED_STATUSES = new Set(["completed", "ignored", "ideas_for_later"]);

type UrgentRow = {
  id: number;
  title: string;
  status: string;
  updatedAt: Date;
  listingId: number | null;
  propertyName: string | null;
  lastCommentAt: Date | null;
};

type DigestOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "empty" }
  | { kind: "posted"; taskIds: number[]; ts?: string };

/**
 * Main entry point. Safe to call from cron or manually; handles its own
 * dedupe, so accidental double-invocations within the window are no-ops.
 */
export async function runUrgentTaskDigest(): Promise<DigestOutcome> {
  const db = await getDb();
  if (!db) return { kind: "skipped", reason: "db unavailable" };

  if (!ENV.slackWandaBotToken) {
    return { kind: "skipped", reason: "SLACK_WANDA_BOT_TOKEN not set" };
  }
  if (!ENV.leisrOpsSlackChannelId) {
    return { kind: "skipped", reason: "LEISR_OPS_SLACK_CHANNEL_ID not set" };
  }

  // Dedupe: if Wanda already posted a digest in the last hour, skip.
  const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const recent = await db
    .select({ id: agentActions.id })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.agentName, "wanda"),
        eq(agentActions.toolName, DIGEST_TOOL_NAME),
        eq(agentActions.success, true),
        gt(agentActions.createdAt, dedupeSince),
      ),
    )
    .limit(1);
  if (recent.length > 0) {
    return { kind: "skipped", reason: "already posted within dedupe window" };
  }

  const stale = await findStaleUrgentTasks(db);
  if (stale.length === 0) {
    return { kind: "empty" };
  }

  const text = formatDigestMessage(stale);
  const result = await postSlackMessage(
    ENV.slackWandaBotToken,
    ENV.leisrOpsSlackChannelId,
    text,
  );

  await db.insert(agentActions).values({
    agentName: "wanda",
    toolName: DIGEST_TOOL_NAME,
    triggeredBy: "cron",
    input: { taskIds: stale.map((t) => t.id) },
    output: result.ok
      ? { ts: result.ts ?? null, count: stale.length }
      : { error: result.error ?? "unknown" },
    success: result.ok,
    errorMessage: result.ok ? null : (result.error ?? "post failed"),
  });

  if (!result.ok) {
    return { kind: "skipped", reason: `post failed: ${result.error}` };
  }
  return { kind: "posted", taskIds: stale.map((t) => t.id), ts: result.ts };
}

async function findStaleUrgentTasks(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
): Promise<UrgentRow[]> {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);

  const urgent = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      updatedAt: tasks.updatedAt,
      listingId: tasks.listingId,
      hiddenFromBoard: tasks.hiddenFromBoard,
      propertyName: listings.internalName,
      propertyFallback: listings.name,
    })
    .from(tasks)
    .leftJoin(listings, eq(tasks.listingId, listings.id))
    .where(eq(tasks.isUrgent, true));

  const activeUrgent = urgent.filter(
    (t) => !t.hiddenFromBoard && !EXCLUDED_STATUSES.has(t.status),
  );
  if (activeUrgent.length === 0) return [];

  const taskIds = activeUrgent.map((t) => t.id);
  const latestCommentRows = await db
    .select({
      taskId: taskComments.taskId,
      latestAt: sql<Date>`MAX(${taskComments.createdAt})`.as("latestAt"),
    })
    .from(taskComments)
    .where(inArray(taskComments.taskId, taskIds))
    .groupBy(taskComments.taskId);

  const latestCommentByTaskId = new Map<number, Date>();
  for (const row of latestCommentRows) {
    if (row.latestAt) latestCommentByTaskId.set(row.taskId, new Date(row.latestAt));
  }

  const rows: UrgentRow[] = [];
  for (const t of activeUrgent) {
    const lastCommentAt = latestCommentByTaskId.get(t.id) ?? null;
    const lastActivity = lastCommentAt && lastCommentAt > t.updatedAt ? lastCommentAt : t.updatedAt;
    if (lastActivity >= staleBefore) continue;
    rows.push({
      id: t.id,
      title: t.title,
      status: t.status,
      updatedAt: t.updatedAt,
      listingId: t.listingId,
      propertyName: t.propertyName || t.propertyFallback || null,
      lastCommentAt,
    });
  }

  rows.sort((a, b) => {
    const aAct = a.lastCommentAt && a.lastCommentAt > a.updatedAt ? a.lastCommentAt : a.updatedAt;
    const bAct = b.lastCommentAt && b.lastCommentAt > b.updatedAt ? b.lastCommentAt : b.updatedAt;
    return aAct.getTime() - bAct.getTime();
  });
  return rows;
}

function formatDigestMessage(rows: UrgentRow[]): string {
  const header = `:rotating_light: *Urgent tasks needing movement* — ${rows.length} task${rows.length === 1 ? "" : "s"} with no updates in the last 24h`;
  const now = Date.now();
  const body = rows
    .map((r) => {
      const lastActivity = r.lastCommentAt && r.lastCommentAt > r.updatedAt ? r.lastCommentAt : r.updatedAt;
      const idle = formatIdle(now - lastActivity.getTime());
      const property = r.propertyName ? `*${r.propertyName}* — ` : "";
      const statusLabel = statusCopy(r.status);
      return `• ${property}${r.title} _(${statusLabel} · last touched ${idle} ago)_`;
    })
    .join("\n");
  return `${header}\n${body}`;
}

function statusCopy(status: string): string {
  switch (status) {
    case "in_progress":
      return "In Progress";
    case "up_next":
      return "Up Next";
    case "needs_review":
      return "Needs Review";
    case "created":
      return "In Queue";
    default:
      return status;
  }
}

function formatIdle(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
