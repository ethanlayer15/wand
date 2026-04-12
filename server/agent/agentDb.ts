/**
 * Wand AI Agents — DB helpers.
 *
 * Thin wrappers around Drizzle for the agent tables (agentSuggestions,
 * agentActions, propertyPlaybooks). Kept separate from server/db.ts so
 * the agent module is self-contained and easy to reason about.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  agentActions,
  agentSuggestions,
  propertyPlaybooks,
  type AgentAction,
  type AgentSuggestion,
  type InsertAgentAction,
  type InsertAgentSuggestion,
  type InsertPropertyPlaybook,
  type PropertyPlaybook,
} from "../../drizzle/schema";

// ── Agent Suggestions ────────────────────────────────────────────────

export async function insertSuggestion(
  data: InsertAgentSuggestion
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(agentSuggestions).values(data);
  // mysql2 returns insertId on the first element
  const insertId = (result as any)?.[0]?.insertId ?? null;
  return insertId;
}

export async function listSuggestions(opts?: {
  status?: AgentSuggestion["status"] | AgentSuggestion["status"][];
  agentName?: string;
  limit?: number;
}): Promise<AgentSuggestion[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [] as any[];
  if (opts?.status) {
    if (Array.isArray(opts.status)) {
      conditions.push(inArray(agentSuggestions.status, opts.status));
    } else {
      conditions.push(eq(agentSuggestions.status, opts.status));
    }
  }
  if (opts?.agentName) {
    conditions.push(eq(agentSuggestions.agentName, opts.agentName));
  }

  const query = db
    .select()
    .from(agentSuggestions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agentSuggestions.createdAt))
    .limit(opts?.limit ?? 100);

  return query;
}

export async function getSuggestionById(
  id: number
): Promise<AgentSuggestion | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(agentSuggestions)
    .where(eq(agentSuggestions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateSuggestionStatus(
  id: number,
  status: AgentSuggestion["status"],
  reviewedBy?: number,
  reviewNotes?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const updates: Partial<InsertAgentSuggestion> = {
    status,
    reviewedAt: new Date(),
  };
  if (reviewedBy !== undefined) updates.reviewedBy = reviewedBy;
  if (reviewNotes !== undefined) updates.reviewNotes = reviewNotes;
  await db
    .update(agentSuggestions)
    .set(updates as any)
    .where(eq(agentSuggestions.id, id));
}

export async function markSuggestionExecuted(
  id: number,
  status: "executed" | "failed",
  executionResult: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(agentSuggestions)
    .set({
      status,
      executedAt: new Date(),
      executionResult,
    } as any)
    .where(eq(agentSuggestions.id, id));
}

export async function countPendingSuggestions(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(agentSuggestions)
    .where(eq(agentSuggestions.status, "pending"));
  return Number(rows[0]?.count ?? 0);
}

// ── Agent Actions (audit log) ────────────────────────────────────────

export async function logAgentAction(
  data: InsertAgentAction
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(agentActions).values(data);
  } catch (err: any) {
    // Audit logging should never break the main flow
    console.warn("[AgentDb] Failed to log agent action:", err?.message ?? err);
  }
}

export async function listRecentActionsByRun(
  runId: string,
  limit = 100
): Promise<AgentAction[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(agentActions)
    .where(eq(agentActions.runId, runId))
    .orderBy(desc(agentActions.createdAt))
    .limit(limit);
}

// ── Property Playbooks ───────────────────────────────────────────────

export async function getPlaybook(
  listingId: number
): Promise<PropertyPlaybook | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(propertyPlaybooks)
    .where(eq(propertyPlaybooks.listingId, listingId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertPlaybook(
  data: InsertPropertyPlaybook
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(propertyPlaybooks)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        quirks: data.quirks ?? null,
        frequentIssues: data.frequentIssues ?? null,
        preferredVendors: data.preferredVendors ?? null,
        guestFeedbackThemes: data.guestFeedbackThemes ?? null,
        manualNotes: data.manualNotes ?? null,
        agentSummary: data.agentSummary ?? null,
        lastAgentUpdateAt: data.lastAgentUpdateAt ?? null,
        lastManualUpdateAt: data.lastManualUpdateAt ?? null,
      } as any,
    });
}

export async function getPlaybooksForListings(
  listingIds: number[]
): Promise<Map<number, PropertyPlaybook>> {
  const db = await getDb();
  if (!db || listingIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(propertyPlaybooks)
    .where(inArray(propertyPlaybooks.listingId, listingIds));
  return new Map(rows.map((r) => [r.listingId, r]));
}
