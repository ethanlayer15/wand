/**
 * Agent tool registry — Phase 1 starter set.
 *
 * Two tools so we can prove the loop end-to-end:
 *   - getOnCall: who is currently on-call for a department/role
 *   - listMyTasks: tasks assigned to the calling user (board + private)
 *
 * Phase 2 expands this: Hostaway send-message, Breezeway add-comment,
 * Slack open-DM, Wand task CRUD, etc.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, like, lte, gte, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { boards, listings, onCallSchedule, slackUserLinks, tasks, users } from "../../drizzle/schema";
import { ROUTING_TOOLS, runRoutingTool, type SlackContext } from "./routingTools";

/**
 * Default board slug each agent owns. The reaction-to-task flow uses this
 * unless the user explicitly moves the resulting task elsewhere afterward.
 */
const AGENT_DEFAULT_BOARD: Record<"wanda" | "starry", string> = {
  wanda: "leisr_ops",
  starry: "fivestr_ops",
};

const PHASE_1_2_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "getOnCall",
    description:
      "Look up the on-call team member for a department + role at a given time (defaults to now). Use this before escalating an issue or asking the team to act.",
    input_schema: {
      type: "object",
      properties: {
        department: {
          type: "string",
          enum: ["leisr_ops", "leisr_mgmt", "fivestr_ops"],
          description: "Which department's on-call to look up.",
        },
        role: {
          type: "string",
          description:
            "Role within the department. Defaults to 'primary'. Common values: primary, backup, guest_relations.",
          default: "primary",
        },
      },
      required: ["department"],
    },
  },
  {
    name: "listMyTasks",
    description:
      "List Wand tasks the calling user owns or is assigned to. Includes both board tasks and private tasks owned by this user.",
    input_schema: {
      type: "object",
      properties: {
        statuses: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional status filter (e.g. ['created','in_progress']). Default: all open statuses.",
        },
      },
    },
  },
  {
    name: "findListing",
    description:
      "Search for a Wand listing (property) by name. Use this BEFORE createTaskDraft when the message names a property. Returns up to 10 candidates each tagged with a matchType: 'exact' (name equals the query), 'word' (query is a whole word inside a name), 'contains' (query is a substring), or 'none'. CRITICAL RULES: (1) Only pass listingId to createTaskDraft when you get an 'exact' match. (2) Never substitute lookalike property names — 'Skylar' and 'Skyland' are different properties even though they look similar. (3) Never call findListing again with a shorter or modified query trying to force a match — if the literal name has no exact result, the property either doesn't exist in Wand yet or the user used a typo, and a human needs to attach it manually.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The property name as it appears in the message, verbatim. Case-insensitive. Do not abbreviate or transform.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "createTaskDraft",
    description:
      "Create a new Wand task on this agent's default board (Wanda → Leisr Ops, Starry → 5STR Ops). Use this when reacting to a Slack message or when the user explicitly asks for a task to be created. Always include a clear short imperative title, a useful description (with the original Slack quote when applicable), and an honest priority/category. Whenever the message mentions a property, call findListing FIRST and pass the matched listingId so the task is associated with the right home (so it can be pushed to Breezeway later).",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "Short imperative task title (≤80 chars). Example: 'Replace torn carpet in master bedroom at Skyland'.",
        },
        description: {
          type: "string",
          description:
            "Full context for the task. Include the original quoted message and any relevant Slack/property details.",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description:
            "Task priority. Default to 'medium' unless there's a clear signal of urgency or it's truly trivial.",
        },
        category: {
          type: "string",
          enum: ["maintenance", "cleaning", "improvements"],
          description: "Category of task. Default to 'maintenance' if uncertain.",
        },
        listingId: {
          type: "number",
          description:
            "Wand listing id from findListing. ONLY pass this when findListing returned an 'exact' matchType for the property name in the message. Never substitute a different listing's id (e.g. don't use Skyland's id when the message says Skylar). When no exact match exists, omit this field and add a short note in the description like '(property X not found — please attach manually)'.",
        },
      },
      required: ["title", "description"],
    },
  },
];

export const AGENT_TOOLS: Anthropic.Messages.Tool[] = [
  ...PHASE_1_2_TOOLS,
  ...ROUTING_TOOLS,
];

const ROUTING_TOOL_NAMES = new Set(ROUTING_TOOLS.map((t) => t.name));

interface RunToolArgs {
  name: string;
  input: any;
  agent: "wanda" | "starry";
  wandUserId?: number;
  slackContext?: SlackContext;
}

export async function runAgentTool({ name, input, agent, wandUserId, slackContext }: RunToolArgs) {
  if (ROUTING_TOOL_NAMES.has(name)) {
    return runRoutingTool({ name, input, agent, slackContext });
  }
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };

  if (name === "getOnCall") {
    const department = input?.department;
    const role = input?.role ?? "primary";
    if (!department) return { error: "department is required" };
    const now = new Date();
    const rows = await db
      .select({
        shift: onCallSchedule,
        userName: users.name,
        userEmail: users.email,
        linkSlackUserId: slackUserLinks.slackUserId,
      })
      .from(onCallSchedule)
      .leftJoin(users, eq(users.id, onCallSchedule.userId))
      // Fall back to slackUserLinks when the shift doesn't have an explicit
      // slackUserId — /on-call's UI doesn't always populate that field.
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
    if (rows.length === 0) {
      return { onCall: null, message: `No one is on-call for ${department}/${role} right now.` };
    }
    const r = rows[0];
    return {
      onCall: {
        userId: r.shift.userId,
        name: r.userName,
        email: r.userEmail,
        slackUserId: r.shift.slackUserId ?? r.linkSlackUserId,
        endsAt: r.shift.endsAt,
        notes: r.shift.notes,
      },
    };
  }

  if (name === "listMyTasks") {
    if (!wandUserId) {
      return { error: "Caller is not a known Wand user; cannot list tasks." };
    }
    const statuses: string[] = Array.isArray(input?.statuses) && input.statuses.length > 0
      ? input.statuses
      : ["created", "needs_review", "up_next", "in_progress"];

    // Pull tasks assigned to this user (we identify via users.openId stored on tasks.assignedTo)
    const [user] = await db.select().from(users).where(eq(users.id, wandUserId)).limit(1);
    const assignedKey = user?.openId ?? "";

    const rows = await db
      .select()
      .from(tasks)
      .where(
        or(
          eq(tasks.ownerUserId, wandUserId),
          assignedKey ? eq(tasks.assignedTo, assignedKey) : undefined as any
        )
      )
      .limit(50);

    return {
      tasks: rows
        .filter((t) => statuses.includes(t.status as string))
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          visibility: t.visibility,
          boardId: t.boardId,
          dueDate: t.dueDate,
        })),
    };
  }

  if (name === "findListing") {
    const query = String(input?.query ?? "").trim();
    if (!query) return { error: "query is required" };
    const q = query.toLowerCase();
    const pattern = `%${q}%`;
    const rows = await db
      .select({
        id: listings.id,
        name: listings.name,
        internalName: listings.internalName,
        city: listings.city,
        status: listings.status,
      })
      .from(listings)
      .where(
        or(
          sql`LOWER(${listings.name}) LIKE ${pattern}`,
          sql`LOWER(${listings.internalName}) LIKE ${pattern}`
        )
      )
      .limit(10);

    // Score each row so the agent has explicit signal — not just "5 results."
    // exact:    a name equals the query (case-insensitive)
    // word:     query is a whitespace-bounded word inside a name
    // contains: query is a substring of a name
    function scoreOne(s: string | null | undefined): "exact" | "word" | "contains" | "none" {
      if (!s) return "none";
      const lower = s.toLowerCase();
      if (lower === q) return "exact";
      if (new RegExp(`(^|\\W)${q.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(\\W|$)`).test(lower)) return "word";
      if (lower.includes(q)) return "contains";
      return "none";
    }
    const ranked = rows
      .map((r) => {
        const a = scoreOne(r.name);
        const b = scoreOne(r.internalName);
        const order = { exact: 3, word: 2, contains: 1, none: 0 } as const;
        const best = order[a] >= order[b] ? a : b;
        return {
          id: r.id,
          displayName: r.internalName || r.name,
          name: r.name,
          internalName: r.internalName,
          city: r.city,
          status: r.status,
          matchType: best,
        };
      })
      .sort(
        (x, y) =>
          ({ exact: 3, word: 2, contains: 1, none: 0 }[y.matchType] -
           { exact: 3, word: 2, contains: 1, none: 0 }[x.matchType])
      );

    const hasExact = ranked.some((r) => r.matchType === "exact");
    return {
      query,
      matches: ranked,
      // Explicit guidance the model should obey:
      guidance: hasExact
        ? `One or more listings exactly match "${query}". Use the exact-match listingId.`
        : `No listing exactly matches "${query}". DO NOT substitute a different property name (e.g. don't use "Skyland" when the message says "Skylar"). Omit listingId in createTaskDraft and add a short note in the description like "(property '${query}' not found in Wand listings — please attach manually)".`,
    };
  }

  if (name === "createTaskDraft") {
    const title = String(input?.title ?? "").slice(0, 200).trim();
    const description = String(input?.description ?? "").slice(0, 8000).trim();
    if (!title) return { error: "title is required" };

    const priority = (["low", "medium", "high"] as const).includes(input?.priority)
      ? input.priority
      : "medium";
    const category = (["maintenance", "cleaning", "improvements"] as const).includes(
      input?.category
    )
      ? input.category
      : "maintenance";

    // Resolve agent's default board id by slug
    const slug = AGENT_DEFAULT_BOARD[agent];
    const [board] = await db
      .select()
      .from(boards)
      .where(eq(boards.slug, slug))
      .limit(1);
    if (!board) {
      return { error: `Default board for ${agent} (slug=${slug}) not found.` };
    }

    const listingId =
      typeof input?.listingId === "number" && input.listingId > 0
        ? input.listingId
        : undefined;

    const [res] = await db.insert(tasks).values({
      title,
      description,
      priority,
      status: "created",
      category,
      taskType: category === "cleaning" ? "housekeeping" : "maintenance",
      source: "wand_manual" as any,
      boardId: board.id,
      visibility: "board" as any,
      ownerAgent: agent,
      listingId,
    });
    return {
      taskId: res.insertId,
      board: { id: board.id, slug: board.slug, name: board.name },
      listingId: listingId ?? null,
      url: `/task/${res.insertId}`,
    };
  }

  return { error: `Unknown tool: ${name}` };
}
