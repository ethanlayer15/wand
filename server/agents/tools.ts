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
import { and, desc, eq, lte, gte, or } from "drizzle-orm";
import { getDb } from "../db";
import { boards, onCallSchedule, tasks, users } from "../../drizzle/schema";

/**
 * Default board slug each agent owns. The reaction-to-task flow uses this
 * unless the user explicitly moves the resulting task elsewhere afterward.
 */
const AGENT_DEFAULT_BOARD: Record<"wanda" | "starry", string> = {
  wanda: "leisr_ops",
  starry: "fivestr_ops",
};

export const AGENT_TOOLS: Anthropic.Messages.Tool[] = [
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
    name: "createTaskDraft",
    description:
      "Create a new Wand task on this agent's default board (Wanda → Leisr Ops, Starry → 5STR Ops). Use this when reacting to a Slack message or when the user explicitly asks for a task to be created. Always include a clear short imperative title, a useful description (with the original Slack quote when applicable), and an honest priority/category.",
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
      },
      required: ["title", "description"],
    },
  },
];

interface RunToolArgs {
  name: string;
  input: any;
  agent: "wanda" | "starry";
  wandUserId?: number;
}

export async function runAgentTool({ name, input, agent, wandUserId }: RunToolArgs) {
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
      })
      .from(onCallSchedule)
      .leftJoin(users, eq(users.id, onCallSchedule.userId))
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
        slackUserId: r.shift.slackUserId,
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
    });
    return {
      taskId: res.insertId,
      board: { id: board.id, slug: board.slug, name: board.name },
      url: `/task/${res.insertId}`,
    };
  }

  return { error: `Unknown tool: ${name}` };
}
