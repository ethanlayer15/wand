/**
 * Wand AI Agents — Context Bundler
 *
 * Builds a rich system prompt for every Claude run.
 *
 * The goal: the agent should open each run with a compact-but-dense snapshot
 * of "what's happening right now in Wand" — today's check-ins, open urgent
 * tasks, pending suggestions, the calling ops user, etc. — so it can reason
 * about the right action without needing round-trips to tools just to get
 * basic situational awareness.
 *
 * Context is intentionally bounded in size. Anything more specific (a
 * particular listing's playbook, a cleaner's history) is fetched by the
 * agent via tools.
 */
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  listings,
  tasks,
  cleaners,
  completedCleans,
  pods,
  type User,
} from "../../drizzle/schema";
import { countPendingSuggestions } from "./agentDb";

const DEFAULT_SYSTEM = `You are Wanda — the in-house AI teammate for a short-term rental operations team.

PERSONA
You're a friendly, sharp, no-fluff ops colleague. Think of yourself as the new hire who has somehow already memorized every listing, every cleaner's rolling score, every open task, and every property's quirks — and who genuinely enjoys the work. You speak like a real person on the ops team, not like a chatbot. Warmth + competence. A little humor when it fits. You sign off with things like "— Wanda" when it feels natural, but don't overdo it.

When you greet someone, use their first name if you know it. Never sound corporate. Never say things like "As an AI assistant…" or "I'd be happy to help!" — just help.

WHAT YOU KNOW
The team runs on Hostaway (the PMS / booking system), Breezeway (housekeeping & tasks), and Wand itself (the platform you live inside). Guest communications are handled by a separate tool, Hostbuddy.ai — that is NOT your job. Never try to draft or send replies to guests.

WHAT YOU DO
- Answer questions about listings, cleaners, tasks, reviews, pods, vendors, and completed cleans
- Surface things the ops team should know about (stale tasks, missing cleaner links, pending suggestions)
- When something needs an action that touches the outside world, propose it via the propose_suggestion tool so a human can approve it in the Ops Inbox

CRITICAL RULES (non-negotiable)
1. You CANNOT take actions that change external state — no sending messages, no reassigning tasks in Breezeway, no posting review replies, no dispatching vendors. You can only read data and queue suggestions. If you want something done, propose it via propose_suggestion and tell the human it's waiting in their Ops Inbox.
2. Never pretend you did something you didn't. If a tool fails, say so plainly.
3. Always look things up with the provided tools before answering — don't guess at names, numbers, or IDs. If you don't know, say "I don't know, let me check" and use a tool.
4. Be concise. The ops team is busy. Lead with the answer, cite specifics (listing names, cleaner names, task IDs), and skip the preamble.
5. Never fabricate numbers. Empty tool results mean "no data" — say so.
6. Protect the company's data. Never share credentials, API keys, or financial account numbers.
`;

export type AgentContextInput = {
  user?: User | null;
  /** Override the default system preamble (useful for specialized agents). */
  systemPreamble?: string;
  /** Name of the calling agent (e.g. "chat", "task_triage"). Used for audit log. */
  agentName?: string;
};

export type AgentContextBundle = {
  systemPrompt: string;
  runId: string;
  agentName: string;
  userId: number | null;
};

/** Format a Date to a short local-style string. */
function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function buildAgentContext(
  input: AgentContextInput = {}
): Promise<AgentContextBundle> {
  const db = await getDb();
  const now = new Date();
  const runId = `run_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
  const agentName = input.agentName ?? "chat";

  // ── Gather lightweight, broadly useful context ────────────────────
  let listingCount = 0;
  let activeCleanerCount = 0;
  let podCount = 0;
  let openTaskCount = 0;
  let urgentTaskCount = 0;
  let todaysCheckoutsCount = 0;
  let pendingSuggestionCount = 0;
  let topUrgentTasks: Array<{
    id: number;
    title: string;
    listingName: string | null;
    createdAt: Date;
  }> = [];
  let podList: Array<{ id: number; name: string; region: string | null }> = [];

  if (db) {
    try {
      const [
        listingCountRow,
        cleanerCountRow,
        podRowsRaw,
        openTaskRows,
        urgentRows,
      ] = await Promise.all([
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(listings)
          .where(eq(listings.status, "active")),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(cleaners)
          .where(eq(cleaners.active, true)),
        db
          .select({ id: pods.id, name: pods.name, region: pods.region })
          .from(pods)
          .orderBy(pods.name),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(tasks)
          .where(
            inArray(tasks.status, [
              "created",
              "needs_review",
              "up_next",
              "in_progress",
            ] as any)
          ),
        db
          .select({
            id: tasks.id,
            title: tasks.title,
            listingName: listings.name,
            createdAt: tasks.createdAt,
          })
          .from(tasks)
          .leftJoin(listings, eq(tasks.listingId, listings.id))
          .where(
            and(
              eq(tasks.isUrgent, true),
              inArray(tasks.status, [
                "created",
                "needs_review",
                "up_next",
                "in_progress",
              ] as any)
            )
          )
          .orderBy(desc(tasks.createdAt))
          .limit(5),
      ]);

      listingCount = Number(listingCountRow[0]?.count ?? 0);
      activeCleanerCount = Number(cleanerCountRow[0]?.count ?? 0);
      podList = podRowsRaw;
      podCount = podRowsRaw.length;
      openTaskCount = Number(openTaskRows[0]?.count ?? 0);
      urgentTaskCount = urgentRows.length;
      topUrgentTasks = urgentRows;
    } catch (err: any) {
      console.warn("[AgentContext] Failed to load snapshot:", err?.message ?? err);
    }
  }

  try {
    pendingSuggestionCount = await countPendingSuggestions();
  } catch {
    // non-fatal
  }

  // ── Build the system prompt ───────────────────────────────────────
  const preamble = input.systemPreamble ?? DEFAULT_SYSTEM;
  const whoLine = input.user
    ? `You are speaking with ${input.user.name ?? input.user.email ?? "a user"} (role: ${input.user.role}, id: ${input.user.id}).`
    : "No authenticated user — treat this as a system-level run.";

  const podsBlock =
    podList.length > 0
      ? podList.map((p) => `  - ${p.name}${p.region ? ` — ${p.region}` : ""}`).join("\n")
      : "  (no pods configured)";

  const urgentBlock =
    topUrgentTasks.length > 0
      ? topUrgentTasks
          .map(
            (t) =>
              `  - [#${t.id}] ${t.title} — ${t.listingName ?? "(no listing)"} (opened ${fmtDate(t.createdAt)})`
          )
          .join("\n")
      : "  (none)";

  const systemPrompt = `${preamble}

## Current Context (auto-generated)
Time: ${now.toISOString()}
${whoLine}

### Wand snapshot
- Active listings: ${listingCount}
- Active cleaners: ${activeCleanerCount}
- Pods: ${podCount}
- Open tasks: ${openTaskCount} (urgent: ${urgentTaskCount})
- Pending Ops Inbox suggestions: ${pendingSuggestionCount}

### Pods
${podsBlock}

### Top urgent open tasks
${urgentBlock}

### Agent run metadata
- Agent: ${agentName}
- Run ID: ${runId}

Use the provided tools to fetch anything more specific. Keep responses short and specific.`;

  return {
    systemPrompt,
    runId,
    agentName,
    userId: input.user?.id ?? null,
  };
}
