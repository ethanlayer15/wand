/**
 * On-Call Router (Phase 1).
 *
 * Single source of truth for "who is responsible for X right now".
 * Wanda + Starry call `getCurrent` whenever they need to escalate or route
 * a question. Admin UI lets ops manage shifts directly in Wand.
 */
import { z } from "zod";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import {
  protectedProcedure,
  managerProcedure,
  router,
} from "./_core/trpc";
import { onCallSchedule, users } from "../drizzle/schema";
import { getDb } from "./db";
import { TRPCError } from "@trpc/server";

const departmentEnum = z.enum(["leisr_ops", "leisr_mgmt", "fivestr_ops"]);

export const onCallRouter = router({
  /** All shifts (optionally filtered by department + window). */
  list: protectedProcedure
    .input(
      z
        .object({
          department: departmentEnum.optional(),
          from: z.date().optional(),
          to: z.date().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conds = [] as any[];
      if (input?.department) conds.push(eq(onCallSchedule.department, input.department));
      if (input?.from) conds.push(gte(onCallSchedule.endsAt, input.from));
      if (input?.to) conds.push(lte(onCallSchedule.startsAt, input.to));

      const rows = await db
        .select({
          shift: onCallSchedule,
          userName: users.name,
          userEmail: users.email,
        })
        .from(onCallSchedule)
        .leftJoin(users, eq(users.id, onCallSchedule.userId))
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(onCallSchedule.startsAt));

      return rows.map((r) => ({
        ...r.shift,
        userName: r.userName,
        userEmail: r.userEmail,
      }));
    }),

  /** Create or update a single shift. */
  upsertShift: managerProcedure
    .input(
      z.object({
        id: z.number().optional(),
        department: departmentEnum,
        role: z.string().min(1).max(64).default("primary"),
        userId: z.number(),
        startsAt: z.date(),
        endsAt: z.date(),
        notes: z.string().optional(),
        slackUserId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (input.endsAt <= input.startsAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Shift end must be after start",
        });
      }
      const createdBy = (ctx as any)?.user?.id ?? null;
      const { id, ...values } = input;
      if (id) {
        await db.update(onCallSchedule).set(values).where(eq(onCallSchedule.id, id));
        return { id };
      }
      const [res] = await db
        .insert(onCallSchedule)
        .values({ ...values, createdBy });
      return { id: res.insertId };
    }),

  /** Bulk-create shifts for a recurring rule (admin UI expands client-side). */
  bulkCreate: managerProcedure
    .input(
      z.object({
        shifts: z
          .array(
            z.object({
              department: departmentEnum,
              role: z.string().min(1).max(64),
              userId: z.number(),
              startsAt: z.date(),
              endsAt: z.date(),
              notes: z.string().optional(),
              slackUserId: z.string().optional(),
            })
          )
          .min(1)
          .max(200),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const createdBy = (ctx as any)?.user?.id ?? null;
      await db
        .insert(onCallSchedule)
        .values(input.shifts.map((s) => ({ ...s, createdBy })));
      return { ok: true, inserted: input.shifts.length };
    }),

  deleteShift: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(onCallSchedule).where(eq(onCallSchedule.id, input.id));
      return { ok: true };
    }),

  /**
   * Look up the on-call user for a department + role at a given time
   * (defaults to now). Used by Wanda/Starry routing logic.
   */
  getCurrent: protectedProcedure
    .input(
      z.object({
        department: departmentEnum,
        role: z.string().default("primary"),
        at: z.date().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const at = input.at ?? new Date();
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
            eq(onCallSchedule.department, input.department),
            eq(onCallSchedule.role, input.role),
            lte(onCallSchedule.startsAt, at),
            gte(onCallSchedule.endsAt, at)
          )
        )
        .orderBy(desc(onCallSchedule.createdAt))
        .limit(1);
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        ...r.shift,
        userName: r.userName,
        userEmail: r.userEmail,
      };
    }),
});
