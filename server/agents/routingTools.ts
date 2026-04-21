/**
 * Phase 4 — cleaner escalation routing tools.
 *
 * Four tools the agent runner can call once Starry is processing a cleaner
 * DM, plus the shared env-var-driven fallback logic for on-call lookup.
 *
 *   classifyCleanerMessage        — re-classify mid-conversation if the
 *                                    picture shifts (pre-classification
 *                                    happens in slackApp.ts).
 *   getCleanerActiveBreezewayTasks — resolve the cleaner's Slack identity
 *                                    to open Breezeway tasks assigned to
 *                                    them (for picking the right task ref).
 *   openGroupDm                    — lower-level: open a Slack mpim.
 *   routeEscalation                — top-level: dedupe → on-call lookup +
 *                                    fallback → openGroupDm → summary post
 *                                    → cleaner-thread ack. Writes one
 *                                    escalationGroupDms row + one
 *                                    agentActions row.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gt, inArray, isNull, lte, gte } from "drizzle-orm";
import { getDb } from "../db";
import {
  breezewayTeam,
  escalationGroupDms,
  listings,
  onCallSchedule,
  slackBots,
  slackUserLinks,
  users,
} from "../../drizzle/schema";
import { AGENTS } from "./identities";
import type { AgentName } from "./types";
import {
  classifyCleanerMessage,
  getIntentRouting,
  INTENTS,
  type Intent,
} from "./classifier";
import {
  getSlackUserEmail,
  openSlackGroupDm,
  postSlackMessage,
} from "./slack";
import { createBreezewayClient } from "../breezeway";

const ESCALATION_WINDOW_MS = 60 * 60 * 1000; // 60 min dedupe window

export interface SlackContext {
  userId: string;
  channelId: string;
  threadTs?: string;
  teamId: string;
}

export const ROUTING_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "classifyCleanerMessage",
    description:
      "Re-classify the current cleaner DM into one of the 8 intent buckets. Call this only if the conversation has shifted meaningfully since the pre-classification; the caller has already run a classification at the top of the DM flow. Returns { intent, confidence, listingHint, taskHint, reasoning }.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "The cleaner's most recent message, verbatim. Do not paraphrase.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "getCleanerActiveBreezewayTasks",
    description:
      "Resolve the current Slack sender to their Breezeway team row (via email match) and return the open Breezeway tasks assigned to them. Use this when the cleaner references 'the task', 'my clean', 'the ticket' — so routeEscalation can attach a real breezewayTaskId. Returns [] if the Slack user has no matching breezewayTeam.email row; escalation can still proceed without a task ref.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "openGroupDm",
    description:
      "Open a Slack multi-party DM (mpim) with the given user ids. Used internally by routeEscalation; only call directly if you need an ad-hoc group DM outside the escalation flow. Slack caps mpims at 8 users including the initiating bot.",
    input_schema: {
      type: "object",
      properties: {
        userIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Slack user ids (U0XXXX format) to include. The initiating bot is added automatically.",
        },
      },
      required: ["userIds"],
    },
  },
  {
    name: "routeEscalation",
    description:
      "Route a cleaner's escalation to the right on-call manager by opening a private group DM and posting a one-line summary. This is the primary tool Starry calls after classification: it handles dedupe (reuses an existing DM for the same issue within 60 min), on-call lookup with backup + leadership fallback, cross-agent tagging for guest-related intents (pulls Wanda + Leisr Ops on-call into the DM), and writes audit rows. The cleaner's original Starry DM thread gets a short 'looped in <person>' reply.",
    input_schema: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: [...INTENTS],
          description: "The classified intent for this escalation.",
        },
        department: {
          type: "string",
          enum: ["leisr_ops", "fivestr_ops"],
          description:
            "The department that owns this intent. Usually derived from the intent — pass what getIntentRouting would return.",
        },
        breezewayTaskId: {
          type: "string",
          description:
            "Optional Breezeway task id (varchar) if the cleaner's message refers to a specific task. Get this from getCleanerActiveBreezewayTasks.",
        },
        listingId: {
          type: "number",
          description:
            "Optional Wand listing id if a property was identified. Only pass when findListing returned an 'exact' match.",
        },
        paraphrase: {
          type: "string",
          description:
            "One-line paraphrase of the cleaner's message for the group DM summary. Keep under 140 chars.",
        },
        originalText: {
          type: "string",
          description:
            "The cleaner's original message, verbatim. Will be quoted in the summary.",
        },
      },
      required: ["intent", "department", "paraphrase", "originalText"],
    },
  },
];

/**
 * Top-level dispatcher for Phase 4 tools. Called from runAgentTool in tools.ts.
 */
export async function runRoutingTool(args: {
  name: string;
  input: any;
  agent: AgentName;
  slackContext?: SlackContext;
}): Promise<any> {
  switch (args.name) {
    case "classifyCleanerMessage":
      return runClassifyTool(args.input);
    case "getCleanerActiveBreezewayTasks":
      return runGetCleanerTasks({
        agent: args.agent,
        slackContext: args.slackContext,
      });
    case "openGroupDm":
      return runOpenGroupDm({ agent: args.agent, input: args.input });
    case "routeEscalation":
      return runRouteEscalation({
        agent: args.agent,
        input: args.input,
        slackContext: args.slackContext,
      });
    default:
      return { error: `Unknown routing tool: ${args.name}` };
  }
}

async function runClassifyTool(input: any) {
  const text = String(input?.text ?? "").trim();
  if (!text) return { error: "text is required" };
  return await classifyCleanerMessage(text);
}

async function runGetCleanerTasks(opts: {
  agent: AgentName;
  slackContext?: SlackContext;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  if (!opts.slackContext?.userId) {
    return { error: "No Slack context — tool only runs inside a Slack DM flow." };
  }
  const botToken = AGENTS[opts.agent].slackBotToken;
  if (!botToken) return { error: `${opts.agent} bot token not configured` };

  const email = await getSlackUserEmail(botToken, opts.slackContext.userId);
  if (!email) {
    return {
      tasks: [],
      note: "Could not resolve Slack user email (missing users:read.email scope or private profile).",
    };
  }

  const [member] = await db
    .select()
    .from(breezewayTeam)
    .where(eq(breezewayTeam.email, email))
    .limit(1);
  if (!member) {
    return {
      tasks: [],
      note: `No breezewayTeam row matches Slack email ${email}. Cleaner may not be onboarded in Breezeway; escalation can still proceed without a task ref.`,
    };
  }

  // Live Breezeway lookup — the local `tasks` table only syncs org-level
  // assignments, not per-cleaner. If the API call fails the tool still
  // returns an empty list so the agent can continue without a task ref.
  let bzResults: any[] = [];
  try {
    const client = createBreezewayClient();
    const resp = await client.get<{ results?: any[] }>("/task/", {
      assignee_ids: Number(member.breezewayId),
      limit: 20,
    });
    bzResults = resp.results ?? [];
  } catch (err: any) {
    return {
      tasks: [],
      note: `Breezeway API call failed: ${err.message}. Escalation can still proceed without a task ref.`,
    };
  }

  const open = bzResults.filter(
    (t) => (t.type_task_status?.stage ?? "").toLowerCase() !== "completed"
  );

  // Enrich with Wand listingId where possible via reference_property_id →
  // hostawayId lookup. Not all BZ properties map to Wand listings.
  const refIds = [
    ...new Set(
      open
        .map((t) => t.reference_property_id)
        .filter((id): id is number => typeof id === "number")
    ),
  ];
  const listingRows =
    refIds.length > 0
      ? await db
          .select({ id: listings.id, hostawayId: listings.hostawayId, name: listings.name })
          .from(listings)
          // BZ reference_property_id is the Hostaway id for imported listings.
          .where(inArray(listings.hostawayId, refIds.map(String)))
      : [];
  const hostawayToListing = new Map<string, { id: number; name: string | null }>();
  for (const l of listingRows) {
    if (l.hostawayId) hostawayToListing.set(l.hostawayId, { id: l.id, name: l.name });
  }

  return {
    breezewayTeamMember: {
      breezewayId: member.breezewayId,
      name: `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim(),
      email: member.email,
    },
    tasks: open.map((t) => {
      const listing = t.reference_property_id
        ? hostawayToListing.get(String(t.reference_property_id))
        : undefined;
      return {
        breezewayTaskId: String(t.id),
        name: t.name,
        department: t.type_department,
        stage: t.type_task_status?.stage,
        listingId: listing?.id ?? null,
        listingName: listing?.name ?? null,
        url: `https://app.breezeway.io/task/${t.id}`,
        updatedAt: t.updated_at,
      };
    }),
  };
}

async function runOpenGroupDm(opts: { agent: AgentName; input: any }) {
  const userIds: string[] = Array.isArray(opts.input?.userIds)
    ? opts.input.userIds.filter((u: unknown) => typeof u === "string" && u.length > 0)
    : [];
  if (userIds.length === 0) return { error: "userIds must be a non-empty array" };
  const botToken = AGENTS[opts.agent].slackBotToken;
  if (!botToken) return { error: `${opts.agent} bot token not configured` };
  const { channelId, error } = await openSlackGroupDm(botToken, userIds);
  if (!channelId) return { error: error ?? "conversations.open failed" };
  return { channelId, users: userIds };
}

/**
 * On-call lookup with backup + leadership fallback. Returns the Slack user
 * id of the person who should own this escalation, plus which tier answered.
 */
async function lookupOnCallWithFallback(
  department: "leisr_ops" | "fivestr_ops"
): Promise<{ slackUserId: string | null; tier: "primary" | "backup" | "leadership" | "none"; name?: string | null }> {
  const db = await getDb();
  if (!db) return { slackUserId: null, tier: "none" };
  const now = new Date();

  for (const role of ["primary", "backup"] as const) {
    const rows = await db
      .select({
        shiftSlackUserId: onCallSchedule.slackUserId,
        linkSlackUserId: slackUserLinks.slackUserId,
        name: users.name,
      })
      .from(onCallSchedule)
      .leftJoin(users, eq(users.id, onCallSchedule.userId))
      // Fall back to the user's Slack link when the shift row doesn't have
      // an explicit slackUserId. Phase 1's /on-call UI didn't always populate
      // that field, but anyone linked via /team has a slackUserLinks row.
      .leftJoin(slackUserLinks, eq(slackUserLinks.userId, onCallSchedule.userId))
      .where(
        and(
          eq(onCallSchedule.department, department),
          eq(onCallSchedule.role, role),
          lte(onCallSchedule.startsAt, now),
          gte(onCallSchedule.endsAt, now)
        )
      )
      .orderBy(desc(onCallSchedule.createdAt))
      .limit(1);
    if (rows.length > 0) {
      const resolved = rows[0].shiftSlackUserId ?? rows[0].linkSlackUserId;
      if (resolved) {
        return { slackUserId: resolved, tier: role, name: rows[0].name };
      }
    }
  }

  // Fall through to leadership env var (comma-separated Slack user ids).
  const envKey =
    department === "leisr_ops"
      ? "LEISR_OPS_LEADERSHIP_SLACK_USER_IDS"
      : "FIVESTR_OPS_LEADERSHIP_SLACK_USER_IDS";
  const raw = process.env[envKey] ?? "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length > 0) {
    return { slackUserId: ids[0], tier: "leadership" };
  }
  return { slackUserId: null, tier: "none" };
}

async function runRouteEscalation(opts: {
  agent: AgentName;
  input: any;
  slackContext?: SlackContext;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  if (!opts.slackContext?.userId) {
    return { error: "No Slack context — routeEscalation only runs inside a Slack DM flow." };
  }

  const intent: Intent = INTENTS.includes(opts.input?.intent)
    ? opts.input.intent
    : "other";
  const routing = getIntentRouting(intent);
  // `department` from the caller is trusted unless it disagrees with the
  // intent's canonical routing — if so, prefer the canonical one to avoid
  // the agent miswiring a guest issue to 5STR.
  const department: "leisr_ops" | "fivestr_ops" =
    opts.input?.department === "leisr_ops" || opts.input?.department === "fivestr_ops"
      ? opts.input.department
      : routing.department;
  const canonicalDept = routing.department;
  const effectiveDept = department === canonicalDept ? department : canonicalDept;

  const paraphrase = String(opts.input?.paraphrase ?? "").slice(0, 240).trim();
  const originalText = String(opts.input?.originalText ?? "").slice(0, 4000).trim();
  if (!paraphrase || !originalText) {
    return { error: "paraphrase and originalText are required" };
  }

  const breezewayTaskId =
    typeof opts.input?.breezewayTaskId === "string" && opts.input.breezewayTaskId.length > 0
      ? opts.input.breezewayTaskId
      : null;
  const listingId =
    typeof opts.input?.listingId === "number" && opts.input.listingId > 0
      ? opts.input.listingId
      : null;

  // ── Dedupe check ──────────────────────────────────────────────────────
  const now = new Date();
  const triggerSlackUserId = opts.slackContext.userId;
  const dedupeRows = await db
    .select()
    .from(escalationGroupDms)
    .where(
      and(
        eq(escalationGroupDms.agent, opts.agent),
        eq(escalationGroupDms.triggerSlackUserId, triggerSlackUserId),
        eq(escalationGroupDms.intent, intent),
        gt(escalationGroupDms.expiresAt, now),
        breezewayTaskId
          ? eq(escalationGroupDms.breezewayTaskId, breezewayTaskId)
          : listingId
            ? and(
                eq(escalationGroupDms.listingId, listingId),
                isNull(escalationGroupDms.breezewayTaskId)
              )
            : and(
                isNull(escalationGroupDms.listingId),
                isNull(escalationGroupDms.breezewayTaskId)
              )
      )
    )
    .orderBy(desc(escalationGroupDms.createdAt))
    .limit(1);

  // ── On-call lookup with fallback ──────────────────────────────────────
  const primary = await lookupOnCallWithFallback(effectiveDept);
  const onCallUserIds: string[] = [];
  if (primary.slackUserId) onCallUserIds.push(primary.slackUserId);

  // Cross-agent tagging: pull in Leisr Ops on-call + Wanda for guest-y intents
  let secondary: { slackUserId: string | null; tier: string } = {
    slackUserId: null,
    tier: "none",
  };
  if (routing.includeWanda && effectiveDept !== "leisr_ops") {
    secondary = await lookupOnCallWithFallback("leisr_ops");
    if (secondary.slackUserId && !onCallUserIds.includes(secondary.slackUserId)) {
      onCallUserIds.push(secondary.slackUserId);
    }
  }

  const starryToken = AGENTS.starry.slackBotToken;
  const [wandaBotRow] = routing.includeWanda
    ? await db.select().from(slackBots).where(eq(slackBots.agent, "wanda")).limit(1)
    : [];
  const wandaBotUserId = wandaBotRow?.botUserId;

  if (onCallUserIds.length === 0) {
    // Nobody reachable — apologize to the cleaner and log it.
    await postSlackMessage(
      AGENTS[opts.agent].slackBotToken,
      opts.slackContext.channelId,
      `No on-call manager is available right now. A human will pick this up shortly — logged for ${effectiveDept}.`,
      opts.slackContext.threadTs
    );
    await db.insert(escalationGroupDms).values({
      agent: opts.agent,
      triggerSlackUserId,
      intent,
      listingId,
      breezewayTaskId,
      groupDmChannelId: "",
      onCallUserIds: [],
      fallbackTier: "none",
      expiresAt: new Date(now.getTime() + ESCALATION_WINDOW_MS),
    });
    return {
      groupDmChannelId: null,
      onCallUserIds: [],
      fallbackTier: "none",
      reused: false,
      note: "No on-call available; cleaner notified, manual handoff required.",
    };
  }

  // ── Reuse existing DM if dedupe hit ──────────────────────────────────
  if (dedupeRows.length > 0) {
    const existing = dedupeRows[0];
    if (existing.groupDmChannelId) {
      const summary = buildSummaryMessage({
        agent: opts.agent,
        triggerSlackUserId,
        paraphrase,
        originalText,
        intent,
        listingId,
        breezewayTaskId,
        onCallSlackUserId: primary.slackUserId,
        reused: true,
      });
      await postSlackMessage(starryToken, existing.groupDmChannelId, summary);
      return {
        groupDmChannelId: existing.groupDmChannelId,
        onCallUserIds: existing.onCallUserIds ?? [],
        fallbackTier: existing.fallbackTier,
        reused: true,
      };
    }
  }

  // ── Open fresh group DM ──────────────────────────────────────────────
  const participants = [triggerSlackUserId, ...onCallUserIds];
  if (routing.includeWanda && wandaBotUserId && !participants.includes(wandaBotUserId)) {
    participants.push(wandaBotUserId);
  }

  const { channelId, error: openErr } = await openSlackGroupDm(starryToken, participants);
  if (!channelId) {
    return {
      error: `Failed to open group DM: ${openErr ?? "unknown"}`,
      participants,
    };
  }

  const summary = buildSummaryMessage({
    agent: opts.agent,
    triggerSlackUserId,
    paraphrase,
    originalText,
    intent,
    listingId,
    breezewayTaskId,
    onCallSlackUserId: primary.slackUserId,
    reused: false,
  });
  await postSlackMessage(starryToken, channelId, summary);

  // Ack the cleaner's original thread so they know it's handled.
  const onCallLabel = primary.name
    ? `*${primary.name}*`
    : primary.slackUserId
      ? `<@${primary.slackUserId}>`
      : "the on-call manager";
  await postSlackMessage(
    AGENTS[opts.agent].slackBotToken,
    opts.slackContext.channelId,
    `Looped in ${onCallLabel} — they'll pick it up.`,
    opts.slackContext.threadTs
  );

  await db.insert(escalationGroupDms).values({
    agent: opts.agent,
    triggerSlackUserId,
    intent,
    listingId,
    breezewayTaskId,
    groupDmChannelId: channelId,
    onCallUserIds,
    fallbackTier: primary.tier,
    expiresAt: new Date(now.getTime() + ESCALATION_WINDOW_MS),
  });

  return {
    groupDmChannelId: channelId,
    onCallUserIds,
    fallbackTier: primary.tier,
    reused: false,
  };
}

function buildSummaryMessage(p: {
  agent: AgentName;
  triggerSlackUserId: string;
  paraphrase: string;
  originalText: string;
  intent: Intent;
  listingId: number | null;
  breezewayTaskId: string | null;
  onCallSlackUserId: string | null;
  reused: boolean;
}): string {
  const quote = p.originalText
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const taskLine = p.breezewayTaskId
    ? `Breezeway task: <https://app.breezeway.io/task/${p.breezewayTaskId}|#${p.breezewayTaskId}>`
    : "Cleaner did not reference a specific task — please confirm in-thread.";
  const mention = p.onCallSlackUserId ? `<@${p.onCallSlackUserId}>` : "team";
  const prefix = p.reused ? "_(follow-up on this escalation)_\n" : "";
  return `${prefix}From <@${p.triggerSlackUserId}>: ${p.paraphrase}
Intent: \`${p.intent}\`
${taskLine}
${mention}, can you pick this up?

${quote}`;
}
