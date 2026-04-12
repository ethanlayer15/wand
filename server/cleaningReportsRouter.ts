/**
 * Cleaning Reports Router — manage per-property SMS recipients
 * and view sent report history.
 */
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { protectedProcedure, managerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { cleaningReportRecipients, cleaningReportsSent, listings } from "../drizzle/schema";

/** E.164 phone number: +1XXXXXXXXXX */
const phoneNumberSchema = z.string().regex(/^\+1\d{10}$/, "Phone number must be in +1XXXXXXXXXX format");

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

  /** Add a recipient phone number for a listing */
  addRecipient: managerProcedure
    .input(
      z.object({
        listingId: z.number(),
        phoneNumber: phoneNumberSchema,
        name: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.insert(cleaningReportRecipients).values({
        listingId: input.listingId,
        phoneNumber: input.phoneNumber.trim(),
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

  /** Get the Slack webhook URL for a listing */
  getSlackWebhook: protectedProcedure
    .input(z.object({ listingId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { webhookUrl: null };
      const [row] = await db
        .select({ webhookUrl: listings.cleaningReportSlackWebhook })
        .from(listings)
        .where(eq(listings.id, input.listingId))
        .limit(1);
      return { webhookUrl: row?.webhookUrl ?? null };
    }),

  /** Set or clear the Slack webhook URL for a listing */
  setSlackWebhook: managerProcedure
    .input(z.object({
      listingId: z.number(),
      webhookUrl: z.string().url().nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db
        .update(listings)
        .set({ cleaningReportSlackWebhook: input.webhookUrl })
        .where(eq(listings.id, input.listingId));
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
          recipientPhoneNumbers: cleaningReportsSent.recipientPhoneNumbers,
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
