/**
 * Cleaning Reports Router — manage per-property email recipients
 * and view sent report history.
 */
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { protectedProcedure, managerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { cleaningReportRecipients, cleaningReportsSent } from "../drizzle/schema";

export const cleaningReportsRouter = router({
  /** List recipients for a listing */
  getRecipients: protectedProcedure
    .input(z.object({ listingId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(cleaningReportRecipients)
        .where(eq(cleaningReportRecipients.listingId, input.listingId))
        .orderBy(cleaningReportRecipients.name);
    }),

  /** Add a recipient email for a listing */
  addRecipient: managerProcedure
    .input(
      z.object({
        listingId: z.number(),
        email: z.string().email(),
        name: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.insert(cleaningReportRecipients).values({
        listingId: input.listingId,
        email: input.email.trim().toLowerCase(),
        name: input.name?.trim() || null,
      });
      return { success: true };
    }),

  /** Remove a recipient */
  removeRecipient: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(cleaningReportRecipients).where(eq(cleaningReportRecipients.id, input.id));
      return { success: true };
    }),

  /** Get sent report history for a listing (recent 20) */
  getSentReports: protectedProcedure
    .input(z.object({ listingId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      // Join through completedCleans to filter by listing
      const { completedCleans } = await import("../drizzle/schema");
      return db
        .select({
          id: cleaningReportsSent.id,
          breezewayTaskId: cleaningReportsSent.breezewayTaskId,
          recipientEmails: cleaningReportsSent.recipientEmails,
          status: cleaningReportsSent.status,
          errorMessage: cleaningReportsSent.errorMessage,
          sentAt: cleaningReportsSent.sentAt,
          propertyName: completedCleans.propertyName,
        })
        .from(cleaningReportsSent)
        .innerJoin(completedCleans, eq(cleaningReportsSent.completedCleanId, completedCleans.id))
        .where(eq(completedCleans.listingId, input.listingId))
        .orderBy(desc(cleaningReportsSent.sentAt))
        .limit(20);
    }),
});
