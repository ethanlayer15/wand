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
import { onCallSchedule, tasks, users } from "../../drizzle/schema";

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
];

interface RunToolArgs {
  name: string;
  input: any;
  agent: "wanda" | "starry";
  wandUserId?: number;
}

export async function runAgentTool({ name, input, wandUserId }: RunToolArgs) {
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

  return { error: `Unknown tool: ${name}` };
}
