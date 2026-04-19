/**
 * Boards Router — department kanbans (Phase 1).
 *
 * Each board feeds one of: Leisr Ops, Leisr Mgmt, 5STR Ops.
 * Tasks belong to a board (visibility="board") OR to a single user
 * + agent (visibility="private"); the agent runner uses these tables to
 * decide what to surface and where.
 */
import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import {
  protectedProcedure,
  managerProcedure,
  adminProcedure,
  router,
} from "./_core/trpc";
import { boards, tasks } from "../drizzle/schema";
import { getDb } from "./db";
import { TRPCError } from "@trpc/server";

const departmentEnum = z.enum(["leisr_ops", "leisr_mgmt", "fivestr_ops"]);
const agentEnum = z.enum(["wanda", "starry"]);
const sourcesEnabledSchema = z
  .object({
    guestMessages: z.boolean().optional(),
    reviews: z.boolean().optional(),
    breezeway: z.boolean().optional(),
    slack: z.boolean().optional(),
    gmail: z.boolean().optional(),
    openphone: z.boolean().optional(),
  })
  .optional();
const columnConfigSchema = z
  .array(z.object({ status: z.string(), label: z.string() }))
  .optional();

export const boardsRouter = router({
  /** All active boards, with task counts. */
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(boards)
      .where(eq(boards.isActive, true))
      .orderBy(desc(boards.id));
    // attach task counts (small N — 3 boards in v1)
    const withCounts = await Promise.all(
      rows.map(async (b) => {
        const t = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.boardId, b.id));
        return { ...b, taskCount: t.length };
      })
    );
    return withCounts;
  }),

  /** Single board by id or slug. */
  get: protectedProcedure
    .input(
      z.union([z.object({ id: z.number() }), z.object({ slug: z.string() })])
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const where =
        "id" in input
          ? eq(boards.id, input.id)
          : eq(boards.slug, input.slug);
      const [b] = await db.select().from(boards).where(where).limit(1);
      return b ?? null;
    }),

  /** Create a new board. */
  create: adminProcedure
    .input(
      z.object({
        slug: z.string().min(1).max(64),
        name: z.string().min(1).max(128),
        department: departmentEnum,
        agent: agentEnum,
        sourcesEnabled: sourcesEnabledSchema,
        columnConfig: columnConfigSchema,
        slackChannelId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [res] = await db.insert(boards).values(input);
      return { id: res.insertId };
    }),

  /** Update board metadata / source toggles / channel routing. */
  update: managerProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(128).optional(),
        sourcesEnabled: sourcesEnabledSchema,
        columnConfig: columnConfigSchema,
        slackChannelId: z.string().nullable().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...rest } = input;
      await db.update(boards).set(rest).where(eq(boards.id, id));
      return { ok: true };
    }),

  /** Move a task between boards (or flip private↔board). */
  moveTask: protectedProcedure
    .input(
      z.object({
        taskId: z.number(),
        boardId: z.number().nullable(),
        visibility: z.enum(["board", "private"]),
        ownerUserId: z.number().nullable().optional(),
        ownerAgent: agentEnum.nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Private requires an owner; board requires a boardId
      if (input.visibility === "private" && !input.ownerUserId) {
        // default to current user
        input.ownerUserId = (ctx as any)?.user?.id ?? null;
        if (!input.ownerUserId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Private tasks need an ownerUserId",
          });
        }
      }
      if (input.visibility === "board" && !input.boardId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Board tasks need a boardId",
        });
      }

      await db
        .update(tasks)
        .set({
          boardId: input.boardId ?? null,
          visibility: input.visibility,
          ownerUserId: input.ownerUserId ?? null,
          ownerAgent: input.ownerAgent ?? null,
        })
        .where(eq(tasks.id, input.taskId));

      return { ok: true };
    }),
});
