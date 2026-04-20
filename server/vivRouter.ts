/**
 * Viv tRPC router — AI email concierge endpoints.
 */
import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  vivTriageCache,
  vivSnooze,
  vivLabels,
  vivArchived,
} from "../drizzle/schema";
import { eq, and, lte, inArray } from "drizzle-orm";
import {
  fetchEmailList,
  fetchEmail,
  setFlags,
  archiveMessage,
  sendEmail,
  searchEmails,
  searchEmailsByFrom,
  testGmailConnection,
} from "./gmail";
import { triageEmail, triageBatch, draftReply, extractTaskFromEmail, extractBookingDetails, extractReviewDetails } from "./vivAi";
import {
  processAirbnbEmails,
  getAirbnbBookings,
  getAirbnbReviews,
  isAirbnbEmail,
  reprocessUnprocessedReviews,
  reprocessUnprocessedBookings,
  extractBookingDataRegex,
  extractReviewDataRegex,
} from "./vivAirbnb";
import { vivAirbnbBookings, vivAirbnbReviews } from "../drizzle/schema";
import {
  runVoiceProfileBuild,
  getVoiceProfile,
  saveDraftCorrection,
} from "./vivVoiceProfile";

export const vivRouter = router({
  // ── Connection Test ────────────────────────────────────────────────────
  testConnection: publicProcedure.query(async () => {
    return testGmailConnection();
  }),

  // ── Inbox ──────────────────────────────────────────────────────────────
  inbox: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }).optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      // Pre-fetch snoozed/archived IDs so we know how much to over-fetch
      const db = await getDb();
      let allSnoozedIds = new Set<string>();
      let allArchivedIds = new Set<string>();

      if (db) {
        const now = new Date();
        const snoozed = await db.select({ messageId: vivSnooze.messageId, snoozeUntil: vivSnooze.snoozeUntil }).from(vivSnooze);
        for (const s of snoozed) {
          if (s.snoozeUntil > now) allSnoozedIds.add(s.messageId);
        }
        const archived = await db.select({ messageId: vivArchived.messageId }).from(vivArchived);
        for (const a of archived) allArchivedIds.add(a.messageId);
      }

      // Over-fetch to compensate for snoozed/archived/Airbnb filtering
      // Fetch 3x the requested limit to ensure we have enough after filtering
      const fetchLimit = Math.min(limit * 3, 100);
      const { emails, total } = await fetchEmailList("INBOX", fetchLimit, offset);

      // Get triage data from cache
      let triageMap: Record<string, any> = {};

      if (db && emails.length > 0) {
        const messageIds = emails.map((e) => e.messageId).filter(Boolean);

        if (messageIds.length > 0) {
          const triageResults = await db
            .select()
            .from(vivTriageCache)
            .where(inArray(vivTriageCache.messageId, messageIds));

          for (const t of triageResults) {
            triageMap[t.messageId] = {
              priority: t.priority,
              category: t.category,
              summary: t.summary,
              suggestedAction: t.suggestedAction,
              needsReply: t.needsReply,
            };
          }
        }
      }

      // Only filter out automated Airbnb system emails (FROM @airbnb.com domain)
      const isAirbnbEmail = (from: { address: string; name: string }[]) =>
        from.some((f) => f.address.toLowerCase().endsWith("@airbnb.com"));

      // Enrich emails with triage data and filter out snoozed/archived/airbnb
      const enriched = emails
        .filter((e) => !allSnoozedIds.has(e.messageId) && !allArchivedIds.has(e.messageId) && !isAirbnbEmail(e.from))
        .slice(0, limit) // Apply the original limit after filtering
        .map((e) => ({
          ...e,
          triage: triageMap[e.messageId] || null,
        }));

      return { emails: enriched, total };
    }),

  // ── Single Email ───────────────────────────────────────────────────────
  email: publicProcedure
    .input(z.object({ uid: z.number() }))
    .query(async ({ input }) => {
      const email = await fetchEmail(input.uid);
      if (!email) return null;

      // Get triage from cache
      const db = await getDb();
      let triage = null;
      if (db && email.messageId) {
        const cached = await db
          .select()
          .from(vivTriageCache)
          .where(eq(vivTriageCache.messageId, email.messageId))
          .limit(1);
        if (cached.length > 0) {
          triage = {
            priority: cached[0].priority,
            category: cached[0].category,
            summary: cached[0].summary,
            suggestedAction: cached[0].suggestedAction,
            needsReply: cached[0].needsReply === 1,
            isAmexReceipt: false,
          };
        }
      }

      return { ...email, triage };
    }),

  // ── Search ─────────────────────────────────────────────────────────────
  search: publicProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ input }) => {
      return searchEmails(input.query);
    }),

  // ── Triage (AI classify) ───────────────────────────────────────────────
  triage: publicProcedure
    .input(
      z.object({
        emails: z.array(
          z.object({
            uid: z.number(),
            messageId: z.string(),
            subject: z.string(),
            from: z.string(),
            snippet: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      const results: Record<number, any> = {};

      // Check which are already cached
      const uncached: typeof input.emails = [];
      if (db) {
        const messageIds = input.emails.map((e) => e.messageId).filter(Boolean);
        if (messageIds.length > 0) {
          const cached = await db
            .select()
            .from(vivTriageCache)
            .where(inArray(vivTriageCache.messageId, messageIds));

          const cachedMap = new Map(cached.map((c) => [c.messageId, c]));

          for (const email of input.emails) {
            const c = cachedMap.get(email.messageId);
            if (c) {
              results[email.uid] = {
                priority: c.priority,
                category: c.category,
                summary: c.summary,
                suggestedAction: c.suggestedAction,
                needsReply: c.needsReply,
                isAmexReceipt: false,
              };
            } else {
              uncached.push(email);
            }
          }
        } else {
          uncached.push(...input.emails);
        }
      } else {
        uncached.push(...input.emails);
      }

      // Triage uncached emails
      if (uncached.length > 0) {
        const triageResults = await triageBatch(uncached);

        // Save to cache
        const entries = Array.from(triageResults.entries());
        for (const [uid, triage] of entries) {
          results[uid] = triage;
          const email = uncached.find((e) => e.uid === uid);
          if (db && email?.messageId) {
            try {
              await db
                .insert(vivTriageCache)
                .values({
                  messageId: email.messageId,
                  uid,
                  priority: triage.priority as any,
                  category: triage.category,
                  summary: triage.summary,
                  suggestedAction: triage.suggestedAction,
                  needsReply: triage.needsReply ? 1 : 0,
                })
                .onDuplicateKeyUpdate({
                  set: {
                    priority: triage.priority as any,
                    category: triage.category,
                    summary: triage.summary,
                    suggestedAction: triage.suggestedAction,
                    needsReply: triage.needsReply ? 1 : 0,
                  },
                });
            } catch (e) {
              console.error("Failed to cache triage:", e);
            }
          }
        }
      }

      return results;
    }),

  // ── Draft Reply (AI) ──────────────────────────────────────────────────
  draftReply: publicProcedure
    .input(
      z.object({
        uid: z.number(),
        subject: z.string(),
        from: z.string(),
        fromName: z.string(),
        bodyText: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      return draftReply({
        subject: input.subject,
        from: input.from,
        fromName: input.fromName,
        bodyText: input.bodyText,
      });
    }),

  // ── Send Email ─────────────────────────────────────────────────────────
  send: publicProcedure
    .input(
      z.object({
        to: z.string(),
        cc: z.string().optional(),
        subject: z.string(),
        body: z.string(),
        html: z.string().optional(),
        inReplyTo: z.string().optional(),
        references: z.array(z.string()).optional(),
        originalFrom: z.string().optional(),   // for quoted body
        originalDate: z.string().optional(),   // for quoted body
        originalBody: z.string().optional(),   // plain text of original email
      })
    )
    .mutation(async ({ input }) => {
      return sendEmail({
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        text: input.body,
        html: input.html,
        inReplyTo: input.inReplyTo,
        references: input.references,
        originalFrom: input.originalFrom,
        originalDate: input.originalDate,
        originalBody: input.originalBody,
      });
    }),

  // ── Actions ────────────────────────────────────────────────────────────
  markRead: publicProcedure
    .input(z.object({ uid: z.number() }))
    .mutation(async ({ input }) => {
      await setFlags(input.uid, ["\\Seen"], "add");
      return { success: true };
    }),

  markUnread: publicProcedure
    .input(z.object({ uid: z.number() }))
    .mutation(async ({ input }) => {
      await setFlags(input.uid, ["\\Seen"], "remove");
      return { success: true };
    }),

  star: publicProcedure
    .input(z.object({ uid: z.number() }))
    .mutation(async ({ input }) => {
      await setFlags(input.uid, ["\\Flagged"], "add");
      return { success: true };
    }),

  unstar: publicProcedure
    .input(z.object({ uid: z.number() }))
    .mutation(async ({ input }) => {
      await setFlags(input.uid, ["\\Flagged"], "remove");
      return { success: true };
    }),

  archive: publicProcedure
    .input(z.object({ uid: z.number(), messageId: z.string() }))
    .mutation(async ({ input }) => {
      // Track in DB
      const db = await getDb();
      if (db) {
        await db
          .insert(vivArchived)
          .values({ messageId: input.messageId, uid: input.uid })
          .onDuplicateKeyUpdate({ set: { uid: input.uid } });
      }
      // Move in Gmail
      try {
        await archiveMessage(input.uid);
      } catch (e) {
        console.error("Gmail archive failed:", e);
      }
      return { success: true };
    }),

  snooze: publicProcedure
    .input(
      z.object({
        uid: z.number(),
        messageId: z.string(),
        until: z.string(), // ISO date string
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .insert(vivSnooze)
        .values({
          messageId: input.messageId,
          uid: input.uid,
          snoozeUntil: new Date(input.until),
        })
        .onDuplicateKeyUpdate({
          set: { snoozeUntil: new Date(input.until) },
        });

      return { success: true };
    }),

  unsnooze: publicProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .delete(vivSnooze)
        .where(eq(vivSnooze.messageId, input.messageId));

      return { success: true };
    }),

  // ── Labels ─────────────────────────────────────────────────────────────
  addLabel: publicProcedure
    .input(z.object({ messageId: z.string(), label: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.insert(vivLabels).values({
        messageId: input.messageId,
        label: input.label,
      });

      return { success: true };
    }),

  removeLabel: publicProcedure
    .input(z.object({ messageId: z.string(), label: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .delete(vivLabels)
        .where(
          and(
            eq(vivLabels.messageId, input.messageId),
            eq(vivLabels.label, input.label)
          )
        );

      return { success: true };
    }),

  getLabels: publicProcedure
    .input(z.object({ messageId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const labels = await db
        .select()
        .from(vivLabels)
        .where(eq(vivLabels.messageId, input.messageId));

      return labels.map((l) => l.label);
    }),

  // ── Airbnb Inbox (raw emails from Gmail for the Airbnb tab) ───────────────
  airbnbInbox: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
      }).optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;
      // Search Gmail for Airbnb emails specifically
      // Search by FROM @airbnb.com only — excludes real conversations about Airbnb topics
      const emails = await searchEmailsByFrom("@airbnb.com", "INBOX", limit);
      return { emails };
    }),

  // ── Parse Airbnb Card (booking or review details) ─────────────────────────
  // First checks the DB for already-extracted data, falls back to LLM extraction.
  parseAirbnbCard: publicProcedure
    .input(
      z.object({
        type: z.enum(["booking", "review"]),
        subject: z.string(),
        snippet: z.string(),
        messageId: z.string().optional(),
        bodyText: z.string().optional(),
        uid: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();

      if (input.type === "booking") {
        // Try DB lookup first (by messageId or rawSubject)
        if (db) {
          let dbBooking: any = null;
          if (input.messageId) {
            const rows = await db.select().from(vivAirbnbBookings)
              .where(eq(vivAirbnbBookings.messageId, input.messageId)).limit(1);
            if (rows.length > 0) dbBooking = rows[0];
          }
          if (!dbBooking && input.subject) {
            const rows = await db.select().from(vivAirbnbBookings)
              .where(eq(vivAirbnbBookings.rawSubject, input.subject)).limit(1);
            if (rows.length > 0) dbBooking = rows[0];
          }
          if (dbBooking && (dbBooking.propertyName || dbBooking.nightlyRate || dbBooking.checkIn)) {
            return {
              type: "booking" as const,
              details: {
                propertyName: dbBooking.propertyName,
                checkIn: dbBooking.checkIn,
                checkOut: dbBooking.checkOut,
                nights: dbBooking.numNights,
                nightlyRate: dbBooking.nightlyRate,
                guestName: dbBooking.guestName,
              },
            };
          }
        }

        // Fetch full email body by UID if not already provided (needed for property name + rate)
        let bookingBodyText = input.bodyText;
        let bookingBodyHtml: string | undefined;
        if (input.uid) {
          try {
            const emailData = await fetchEmail(input.uid);
            if (!bookingBodyText) bookingBodyText = emailData?.bodyText || undefined;
            bookingBodyHtml = emailData?.bodyHtml || undefined;
          } catch {
            // ignore fetch errors
          }
        }

        // Fall back to regex extraction (fast, no LLM) — pass both text and HTML bodies
        const regexData = extractBookingDataRegex(input.subject, bookingBodyText, input.snippet, bookingBodyHtml);
        if (regexData.propertyName || regexData.nightlyRate || regexData.checkIn) {
          // Also save to DB so future lookups are instant
          if (db && input.messageId && (regexData.propertyName || regexData.nightlyRate)) {
            try {
              await db.insert(vivAirbnbBookings).values({
                messageId: input.messageId,
                uid: input.uid || 0,
                rawSubject: input.subject,
                confirmationCode: regexData.confirmationCode,
                propertyName: regexData.propertyName,
                guestName: regexData.guestName,
                checkIn: regexData.checkIn,
                checkOut: regexData.checkOut,
                nightlyRate: regexData.nightlyRate,
                numNights: regexData.numNights,
                status: regexData.status,
                autoArchived: false,
              }).onDuplicateKeyUpdate({
                set: {
                  propertyName: regexData.propertyName,
                  checkIn: regexData.checkIn,
                  checkOut: regexData.checkOut,
                  nightlyRate: regexData.nightlyRate,
                  numNights: regexData.numNights,
                }
              });
            } catch { /* ignore duplicate errors */ }
          }
          return {
            type: "booking" as const,
            details: {
              propertyName: regexData.propertyName,
              checkIn: regexData.checkIn,
              checkOut: regexData.checkOut,
              nights: regexData.numNights,
              nightlyRate: regexData.nightlyRate,
              guestName: regexData.guestName,
            },
          };
        }

        // Last resort: LLM extraction
        const details = await extractBookingDetails({
          subject: input.subject,
          snippet: input.snippet,
          bodyText: bookingBodyText,
        });
        return { type: "booking" as const, details };
      } else {
        // Review: try DB lookup first
        if (db) {
          let dbReview: any = null;
          if (input.messageId) {
            const rows = await db.select().from(vivAirbnbReviews)
              .where(eq(vivAirbnbReviews.messageId, input.messageId)).limit(1);
            if (rows.length > 0) dbReview = rows[0];
          }
          if (!dbReview && input.subject) {
            const rows = await db.select().from(vivAirbnbReviews)
              .where(eq(vivAirbnbReviews.rawSubject, input.subject)).limit(1);
            if (rows.length > 0) dbReview = rows[0];
          }
          if (dbReview && (dbReview.propertyName || dbReview.rating || dbReview.highlights)) {
            // Convert highlights array to comma-separated string for the card format
            const highlightsStr = Array.isArray(dbReview.highlights) ? dbReview.highlights.join(", ") : dbReview.highlights;
            const improvementsStr = Array.isArray(dbReview.improvements) ? dbReview.improvements.join(", ") : dbReview.improvements;
            return {
              type: "review" as const,
              details: {
                propertyName: dbReview.propertyName,
                highlights: highlightsStr || null,
                improvements: improvementsStr || null,
                rating: dbReview.rating,
              },
            };
          }
        }

        // Fetch full email body by UID if not already provided (needed for property name + highlights)
        let reviewBodyText = input.bodyText;
        if (!reviewBodyText && input.uid) {
          try {
            const emailData = await fetchEmail(input.uid);
            reviewBodyText = emailData?.bodyText || emailData?.bodyHtml || undefined;
          } catch {
            // ignore fetch errors
          }
        }

        // Fall back to regex extraction
        const regexData = extractReviewDataRegex(input.subject, reviewBodyText, input.snippet);
        if (regexData.propertyName || regexData.rating) {
          const highlightsArr = Array.isArray(regexData.highlights) ? regexData.highlights : [];
          const improvementsArr = Array.isArray(regexData.improvements) ? regexData.improvements : [];
          const highlightsStr = highlightsArr.join(", ") || null;
          const improvementsStr = improvementsArr.join(", ") || null;
          // Save to DB for future instant lookups
          if (db && input.messageId && (regexData.propertyName || regexData.rating)) {
            try {
              await db.insert(vivAirbnbReviews).values({
                messageId: input.messageId,
                uid: input.uid || 0,
                rawSubject: input.subject,
                propertyName: regexData.propertyName,
                guestName: regexData.guestName,
                rating: regexData.rating,
                reviewSnippet: regexData.reviewSnippet,
                highlights: highlightsArr.length > 0 ? highlightsArr : null,
                improvements: improvementsArr.length > 0 ? improvementsArr : null,
                aiProcessed: false,
              }).onDuplicateKeyUpdate({
                set: {
                  propertyName: regexData.propertyName,
                  rating: regexData.rating,
                  highlights: highlightsArr.length > 0 ? highlightsArr : null,
                  improvements: improvementsArr.length > 0 ? improvementsArr : null,
                }
              });
            } catch { /* ignore duplicate errors */ }
          }
          return {
            type: "review" as const,
            details: {
              propertyName: regexData.propertyName,
              highlights: highlightsStr,
              improvements: improvementsStr,
              rating: regexData.rating,
            },
          };
        }

        // Last resort: LLM extraction
        const details = await extractReviewDetails({
          subject: input.subject,
          snippet: input.snippet,
          bodyText: reviewBodyText,
        });
        return { type: "review" as const, details };
      }
    }),

  // ── Archive All Airbnb Inbox Emails ─────────────────────────────────────
  archiveAllAirbnbInbox: publicProcedure
    .input(
      z.object({
        uids: z.array(z.number()),
        messageIds: z.array(z.string()),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      let archived = 0;
      for (let i = 0; i < input.uids.length; i++) {
        const uid = input.uids[i];
        const messageId = input.messageIds[i];
        try {
          // Archive in Gmail via IMAP
          await archiveMessage(uid);
          // Record in Viv DB
          if (db && messageId) {
            await db
              .insert(vivArchived)
              .values({ messageId, uid })
              .onDuplicateKeyUpdate({ set: { uid } });
          }
          archived++;
        } catch (e) {
          console.error(`[archiveAllAirbnb] Failed uid=${uid}:`, e);
        }
      }
      return { archived };
    }),

  // ── Airbnb Feed ─────────────────────────────────────────────────────────

  /**
   * Scan inbox for Airbnb emails, extract data, auto-archive booking confirmations.
   * Returns processing stats.
   */
  airbnbSync: publicProcedure.mutation(async () => {
    // Use IMAP SEARCH to find Airbnb emails specifically (much faster than fetching all)
    const airbnbEmails = await searchEmails("airbnb", "INBOX", 50);
    console.log(`[Airbnb Sync] Found ${airbnbEmails.length} Airbnb emails via IMAP SEARCH`);
    
    if (airbnbEmails.length === 0) {
      return { bookingsProcessed: 0, reviewsProcessed: 0, autoArchived: 0 };
    }
    
    // Process them (with LLM timeout fallback and non-blocking archive)
    const result = await processAirbnbEmails(airbnbEmails);
    return result;
  }),

  /**
   * Get Airbnb bookings log — structured, searchable.
   */
  airbnbBookings: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return getAirbnbBookings({
        limit: input?.limit ?? 50,
        offset: input?.offset ?? 0,
        search: input?.search,
      });
    }),

  /**
   * Get Airbnb reviews — kept visible for response.
   */
  airbnbReviews: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return getAirbnbReviews({
        limit: input?.limit ?? 50,
        offset: input?.offset ?? 0,
        search: input?.search,
      });
    }),

  /**
   * Get combined Airbnb feed stats.
   */
  airbnbStats: publicProcedure.query(async () => {
    const [bookings, reviews] = await Promise.all([
      getAirbnbBookings({ limit: 1 }),
      getAirbnbReviews({ limit: 1 }),
    ]);
    return {
      totalBookings: bookings.total,
      totalReviews: reviews.total,
    };
  }),

  /**
   * Archive all booking confirmation emails in Gmail (background, non-blocking).
   */
  archiveAllBookings: publicProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) return { archived: 0 };

    // Get all unarchived bookings
    const unarchived = await db
      .select({ uid: vivAirbnbBookings.uid, messageId: vivAirbnbBookings.messageId })
      .from(vivAirbnbBookings)
      .where(eq(vivAirbnbBookings.autoArchived, false));

    let archived = 0;
    for (const booking of unarchived) {
      try {
        await archiveMessage(booking.uid);
        await db.insert(vivArchived)
          .values({ messageId: booking.messageId, uid: booking.uid })
          .onDuplicateKeyUpdate({ set: { uid: booking.uid } });
        await db.update(vivAirbnbBookings)
          .set({ autoArchived: true })
          .where(eq(vivAirbnbBookings.messageId, booking.messageId));
        archived++;
      } catch (e: any) {
        console.log(`[Airbnb] Archive failed for booking ${booking.uid}:`, e.message);
      }
    }

    return { archived };
  }),

  /**
   * Archive all review emails in Gmail.
   */
  archiveAllReviews: publicProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) return { archived: 0 };

    const reviews = await db
      .select({ uid: vivAirbnbReviews.uid, messageId: vivAirbnbReviews.messageId })
      .from(vivAirbnbReviews);

    let archived = 0;
    for (const review of reviews) {
      try {
        await archiveMessage(review.uid);
        await db.insert(vivArchived)
          .values({ messageId: review.messageId, uid: review.uid })
          .onDuplicateKeyUpdate({ set: { uid: review.uid } });
        archived++;
      } catch (e: any) {
        console.log(`[Airbnb] Archive failed for review ${review.uid}:`, e.message);
      }
    }

    return { archived };
  }),

  /**
   * Re-run AI extraction on existing reviews that haven't been processed yet.
   */
  reprocessReviews: publicProcedure.mutation(async () => {
    return reprocessUnprocessedReviews();
  }),

  /**
   * Re-run AI extraction on existing bookings that have missing data.
   */
  reprocessBookings: publicProcedure.mutation(async () => {
    return reprocessUnprocessedBookings();
  }),

  // ── Voice Profile ──────────────────────────────────────────────────────

  /**
   * Get the current voice profile.
   */
  getVoiceProfile: publicProcedure.query(async () => {
    return getVoiceProfile();
  }),

  /**
   * Scan sent emails and build/update the voice profile using AI.
   */
  buildVoiceProfile: publicProcedure.mutation(async () => {
    return runVoiceProfileBuild();
  }),

  /**
   * Save a draft correction (original AI draft vs user-edited version).
   * Used to refine the voice profile over time.
   */
  saveDraftCorrection: publicProcedure
    .input(
      z.object({
        originalDraft: z.string(),
        editedDraft: z.string(),
        emailSubject: z.string().optional(),
        emailFrom: z.string().optional(),
        emailSnippet: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await saveDraftCorrection(input);
      return { success: true };
    }),

  // ── Forward Email ──────────────────────────────────────────────────────
  forward: publicProcedure
    .input(
      z.object({
        to: z.string(),
        note: z.string().optional(),
        originalSubject: z.string(),
        originalFrom: z.string(),
        originalDate: z.string(),
        originalBody: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const forwardedBody = `${input.note ? input.note + "\n\n" : ""}---------- Forwarded message ---------\nFrom: ${input.originalFrom}\nDate: ${input.originalDate}\nSubject: ${input.originalSubject}\n\n${input.originalBody}`;
      return sendEmail({
        to: input.to,
        subject: `Fwd: ${input.originalSubject}`,
        text: forwardedBody,
      });
    }),

  // ── Create Task from Email ────────────────────────────────────────────
  createTask: publicProcedure
    .input(
      z.object({
        uid: z.number(),
        subject: z.string(),
        from: z.string(),
        fromName: z.string(),
        snippet: z.string(),
        bodyText: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const extraction = await extractTaskFromEmail({
        subject: input.subject,
        from: input.from,
        fromName: input.fromName,
        snippet: input.snippet,
        bodyText: input.bodyText,
      });

      const { tasks } = await import("../drizzle/schema");
      const { getDefaultBoardId } = await import("./db");
      const boardId = await getDefaultBoardId();
      await db.insert(tasks).values({
        title: extraction.title,
        description: extraction.description,
        priority: extraction.priority,
        status: "created",
        category: "maintenance",
        source: "manual",
        dueDate: extraction.dueDate ? new Date(extraction.dueDate) : undefined,
        assignedTo: extraction.contactEmail,
        boardId: boardId ?? undefined,
      });

      return { success: true };
    }),

  // ── Auto-forward Amex 1003 Receipts ────────────────────────────────────
  autoForwardAmexReceipt: publicProcedure
    .input(
      z.object({
        uid: z.number(),
        messageId: z.string(),
        subject: z.string(),
        from: z.string(),
        date: z.string(),
        bodyText: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      // Forward to TopKey
      const forwardedBody = `---------- Forwarded Amex Receipt ---------\nFrom: ${input.from}\nDate: ${input.date}\nSubject: ${input.subject}\n\n${input.bodyText}`;
      await sendEmail({
        to: "leisr@receipts.topkey.io",
        subject: `[Amex 1003] ${input.subject}`,
        text: forwardedBody,
      });

      // Archive in Viv DB and Gmail
      const db = await getDb();
      if (db) {
        await db
          .insert(vivArchived)
          .values({ messageId: input.messageId, uid: input.uid })
          .onDuplicateKeyUpdate({ set: { uid: input.uid } });
      }
      try {
        await archiveMessage(input.uid);
      } catch (e) {
        console.error("Gmail archive failed for Amex receipt:", e);
      }

      return { success: true, forwardedTo: "leisr@receipts.topkey.io" };
    }),
});