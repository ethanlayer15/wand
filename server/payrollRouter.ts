/**
 * Payroll Router — admin-only tRPC endpoints for the QBO Payroll Elite flow.
 *
 * Workflow:
 *   list           → payroll runs summary (UI listing)
 *   get            → single run + all its lines (drill-down Sheet)
 *   generate       → draft run for a given weekOf (Wednesday trigger)
 *   approve        → lock a draft
 *   markSubmitted  → record that CSV was sent to accountant / imported
 *   exportCsv      → return CSV text for client-side download
 *   regenerateDraft → wipe + recompute a draft (if admin edits upstream data)
 */

import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { payrollRuns, payrollRunLines } from "../drizzle/schema";
import { adminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  approveRun,
  buildCsv,
  generatePayrollRun,
  getPayPeriodMondayFor,
  markSubmitted,
} from "./payrollRun";

export const payrollRouter = router({
  list: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const limit = input?.limit ?? 20;
      const runs = await db
        .select()
        .from(payrollRuns)
        .orderBy(desc(payrollRuns.weekOf))
        .limit(limit);
      return runs;
    }),

  get: adminProcedure
    .input(z.object({ runId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, input.runId));
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });

      const lines = await db
        .select()
        .from(payrollRunLines)
        .where(eq(payrollRunLines.payrollRunId, input.runId));

      return { run, lines };
    }),

  /**
   * Generate (or replace a draft) for a given week.
   * If weekOf is omitted, defaults to the prior completed week.
   */
  generate: adminProcedure
    .input(
      z
        .object({
          weekOf: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, "weekOf must be YYYY-MM-DD (Monday)")
            .optional(),
          includeMonthlyReceipts: z.boolean().optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      const weekOf = input?.weekOf ?? getPayPeriodMondayFor();
      const result = await generatePayrollRun(weekOf, {
        includeMonthlyReceipts: input?.includeMonthlyReceipts,
      });
      return result;
    }),

  approve: adminProcedure
    .input(z.object({ runId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user?.id) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Login required" });
      }
      try {
        await approveRun(input.runId, ctx.user.id);
        return { success: true };
      } catch (err: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
      }
    }),

  markSubmitted: adminProcedure
    .input(z.object({ runId: z.number().int() }))
    .mutation(async ({ input }) => {
      try {
        await markSubmitted(input.runId);
        return { success: true };
      } catch (err: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
      }
    }),

  exportCsv: adminProcedure
    .input(z.object({ runId: z.number().int() }))
    .query(async ({ input }) => {
      const csv = await buildCsv(input.runId);
      return { csv };
    }),
});
