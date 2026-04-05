/**
 * Viv Airbnb — Parse Airbnb emails, extract structured data, auto-archive booking confirmations.
 * Uses regex/template parsing instead of LLM for reliable, instant extraction.
 */
import { getDb } from "./db";
import { vivAirbnbBookings, vivAirbnbReviews, vivArchived } from "../drizzle/schema";
import { eq, inArray, desc, like, or, sql, isNull } from "drizzle-orm";
import { fetchEmailList, fetchEmail, archiveMessage, type EmailListItem } from "./gmail";
import {
  parseBookingFromBody,
  parseBookingFromSnippet,
  parseBookingFromSubject,
  parseBookingFromHtml,
  parseReviewFromBody,
  parseReviewFromSnippet,
  parseReviewFromSubject,
} from "./airbnbParser";

// ── Types ──────────────────────────────────────────────────────────────

export interface AirbnbBooking {
  id: number;
  messageId: string;
  uid: number;
  confirmationCode: string | null;
  propertyName: string | null;
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  numGuests: number | null;
  nightlyRate: string | null;
  numNights: number | null;
  status: string | null;
  autoArchived: boolean | null;
  emailDate: Date | null;
  createdAt: Date;
}

export interface AirbnbReview {
  id: number;
  messageId: string;
  uid: number;
  propertyName: string | null;
  guestName: string | null;
  rating: number | null;
  reviewSnippet: string | null;
  highlights: string[] | null;
  improvements: string[] | null;
  aiProcessed: boolean | null;
  emailDate: Date | null;
  createdAt: Date;
}

// ── Detection ──────────────────────────────────────────────────────────

/**
 * Only match automated Airbnb system emails (from @airbnb.com domain).
 * Real conversations about Airbnb topics from non-Airbnb addresses stay in normal inbox.
 */
export function isAirbnbEmail(email: EmailListItem): boolean {
  const fromAddr = email.from[0]?.address?.toLowerCase() || "";
  return fromAddr.endsWith("@airbnb.com");
}

export function classifyAirbnbEmail(email: EmailListItem): "booking" | "review" | "cancellation" | "request" | "other" {
  const subject = email.subject.toLowerCase();

  if (
    (subject.includes("left a") && (subject.includes("review") || subject.includes("star"))) ||
    subject.includes("new review") ||
    subject.includes("-star review")
  ) return "review";

  if (subject.includes("canceled") || subject.includes("cancelled") || subject.includes("cancellation")) return "cancellation";
  if (subject.includes("pending") && subject.includes("reservation request")) return "request";

  if (
    subject.includes("reservation confirmed") ||
    subject.includes("booking confirmed") ||
    subject.includes("reservation for") ||
    (subject.includes("arrives") && !subject.includes("review")) ||
    subject.includes("new booking") ||
    subject.includes("confirmed -")
  ) return "booking";

  return "other";
}

// ── Encoding Fix ──────────────────────────────────────────────────────

/**
 * Fix Latin-1 misread UTF-8 bytes back to proper UTF-8 string.
 */
function fixEncoding(text: string): string {
  if (!text) return text;
  if (!/â/.test(text)) return text;
  try {
    const bytes = Buffer.from(text, "latin1");
    const fixed = bytes.toString("utf8");
    if (!fixed.includes("\uFFFD")) return fixed;
  } catch {
    // ignore
  }
  return text;
}

// ── Extraction (Regex-based) ──────────────────────────────────────────

/**
 * Extract structured booking data using regex parsing (no LLM).
 * Tries: full body text → HTML body → snippet → subject line, in order of data richness.
 */
export function extractBookingDataRegex(
  subject: string,
  bodyText?: string,
  snippet?: string,
  bodyHtml?: string
): {
  confirmationCode: string | null;
  propertyName: string | null;
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  numGuests: number | null;
  nightlyRate: string | null;
  numNights: number | null;
  status: string;
} {
  const cleanSubject = fixEncoding(subject);

  let status = "confirmed";
  const subjectLower = cleanSubject.toLowerCase();
  if (subjectLower.includes("cancel")) status = "canceled";
  if (subjectLower.includes("pending") || subjectLower.includes("request")) status = "pending";

  // Try full body text first
  if (bodyText) {
    const cleanBody = fixEncoding(bodyText);
    const parsed = parseBookingFromBody(cleanBody, cleanSubject);
    if (parsed.propertyName || parsed.nightlyRate) {
      // If we got rate/dates but no property name, try HTML for the property name
      if (!parsed.propertyName && bodyHtml) {
        const htmlParsed = parseBookingFromHtml(bodyHtml, cleanSubject);
        if (htmlParsed.propertyName) parsed.propertyName = htmlParsed.propertyName;
      }
      return { ...parsed, status, numGuests: null };
    }
  }

  // Try HTML body (newer Airbnb email format — property name only in HTML)
  if (bodyHtml) {
    const htmlParsed = parseBookingFromHtml(bodyHtml, cleanSubject);
    if (htmlParsed.propertyName || htmlParsed.nightlyRate || htmlParsed.checkIn) {
      return { ...htmlParsed, status, numGuests: null };
    }
  }

  // Try snippet
  if (snippet && snippet.length > 10) {
    const cleanSnippet = fixEncoding(snippet);
    const parsed = parseBookingFromSnippet(cleanSnippet, cleanSubject);
    if (parsed.propertyName || parsed.checkIn) {
      return { ...parsed, status, numGuests: null };
    }
  }

  // Last resort: subject only
  const parsed = parseBookingFromSubject(cleanSubject);
  return { ...parsed, status, numGuests: null };
}

/**
 * Extract structured review data using regex parsing (no LLM).
 * Tries: full body text → snippet → subject line, in order of data richness.
 */
export function extractReviewDataRegex(
  subject: string,
  bodyText?: string,
  snippet?: string
): {
  propertyName: string | null;
  guestName: string | null;
  rating: number | null;
  reviewSnippet: string | null;
  highlights: string[] | null;
  improvements: string[] | null;
} {
  const cleanSubject = fixEncoding(subject);

  // Try full body first
  if (bodyText) {
    const cleanBody = fixEncoding(bodyText);
    const parsed = parseReviewFromBody(cleanBody, cleanSubject);
    if (parsed.propertyName || parsed.reviewText || parsed.specialThanks.length > 0) {
      return {
        propertyName: parsed.propertyName,
        guestName: parsed.guestName,
        rating: parsed.rating,
        reviewSnippet: parsed.reviewText,
        highlights: parsed.specialThanks.length > 0 ? parsed.specialThanks : null,
        improvements: parsed.improvements.length > 0 ? parsed.improvements : null,
      };
    }
  }

  // Try snippet
  if (snippet && snippet.length > 10) {
    const cleanSnippet = fixEncoding(snippet);
    const parsed = parseReviewFromSnippet(cleanSnippet, cleanSubject);
    return {
      propertyName: parsed.propertyName,
      guestName: parsed.guestName,
      rating: parsed.rating,
      reviewSnippet: parsed.reviewText,
      highlights: parsed.specialThanks.length > 0 ? parsed.specialThanks : null,
      improvements: parsed.improvements.length > 0 ? parsed.improvements : null,
    };
  }

  // Last resort: subject only
  const parsed = parseReviewFromSubject(cleanSubject);
  return {
    propertyName: parsed.propertyName,
    guestName: parsed.guestName,
    rating: parsed.rating,
    reviewSnippet: parsed.reviewText,
    highlights: null,
    improvements: null,
  };
}

// ── Processing Pipeline ────────────────────────────────────────────────

export async function processAirbnbEmails(emails: EmailListItem[]): Promise<{
  bookingsProcessed: number;
  reviewsProcessed: number;
  autoArchived: number;
}> {
  const db = await getDb();
  if (!db) return { bookingsProcessed: 0, reviewsProcessed: 0, autoArchived: 0 };

  const airbnbEmails = emails.filter(isAirbnbEmail);
  let bookingsProcessed = 0;
  let reviewsProcessed = 0;
  let autoArchived = 0;

  const messageIds = airbnbEmails.map((e) => e.messageId).filter(Boolean);
  if (messageIds.length === 0) return { bookingsProcessed: 0, reviewsProcessed: 0, autoArchived: 0 };

  const existingBookings = await db
    .select({ messageId: vivAirbnbBookings.messageId })
    .from(vivAirbnbBookings)
    .where(inArray(vivAirbnbBookings.messageId, messageIds));

  const existingReviews = await db
    .select({ messageId: vivAirbnbReviews.messageId })
    .from(vivAirbnbReviews)
    .where(inArray(vivAirbnbReviews.messageId, messageIds));

  const processedIds = new Set([
    ...existingBookings.map((b) => b.messageId),
    ...existingReviews.map((r) => r.messageId),
  ]);

  const toProcess = airbnbEmails.filter((e) => !processedIds.has(e.messageId));
  console.log(`[Airbnb] Found ${airbnbEmails.length} Airbnb emails, ${toProcess.length} new to process`);

  for (const email of toProcess) {
    const type = classifyAirbnbEmail(email);
    console.log(`[Airbnb] Processing: "${email.subject}" → type=${type}`);

    if (type === "booking" || type === "cancellation") {
      try {
        // Try to fetch full email body for better extraction
        let fullBodyText: string | undefined;
        let fullBodyHtml: string | undefined;
        try {
          const fullEmail = await fetchEmail(email.uid);
          if (fullEmail?.bodyText) fullBodyText = fullEmail.bodyText;
          if (fullEmail?.bodyHtml) fullBodyHtml = fullEmail.bodyHtml;
        } catch {
          // fallback to snippet
        }

        const data = extractBookingDataRegex(email.subject, fullBodyText, email.snippet, fullBodyHtml);
        await db.insert(vivAirbnbBookings).values({
          messageId: email.messageId,
          uid: email.uid,
          confirmationCode: data.confirmationCode,
          propertyName: data.propertyName,
          guestName: data.guestName,
          checkIn: data.checkIn,
          checkOut: data.checkOut,
          numGuests: data.numGuests,
          nightlyRate: data.nightlyRate,
          numNights: data.numNights,
          status: data.status,
          autoArchived: type === "booking",
          rawSubject: email.subject,
          rawSnippet: email.snippet.slice(0, 500),
          emailDate: new Date(email.date),
        }).onDuplicateKeyUpdate({
          set: {
            uid: email.uid,
            confirmationCode: data.confirmationCode,
            propertyName: data.propertyName,
            guestName: data.guestName,
            checkIn: data.checkIn,
            checkOut: data.checkOut,
            numGuests: data.numGuests,
            nightlyRate: data.nightlyRate,
            numNights: data.numNights,
            status: data.status,
          },
        });

        bookingsProcessed++;
        console.log(`[Airbnb] Saved booking: ${data.guestName || "unknown"} at ${data.propertyName || "unknown"} — ${data.nightlyRate || "?"} x ${data.numNights || "?"} nights`);

        if (type === "booking") {
          archiveMessage(email.uid)
            .then(async () => {
              try {
                await db.insert(vivArchived).values({ messageId: email.messageId, uid: email.uid })
                  .onDuplicateKeyUpdate({ set: { uid: email.uid } });
                autoArchived++;
                console.log(`[Airbnb] Auto-archived booking ${email.uid}`);
              } catch { /* acceptable */ }
            })
            .catch(() => {
              console.log(`[Airbnb] Auto-archive skipped for ${email.uid} (IMAP timeout — will retry next sync)`);
            });
        }
      } catch (e: any) {
        console.error("[Airbnb] Failed to process booking email:", email.uid, e.message);
      }
    } else if (type === "review") {
      try {
        // Fetch full email body for better extraction
        let fullBodyText: string | undefined;
        try {
          const fullEmail = await fetchEmail(email.uid);
          if (fullEmail?.bodyText) fullBodyText = fullEmail.bodyText;
          else if (fullEmail?.bodyHtml) {
            fullBodyText = fullEmail.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          }
        } catch {
          // fallback to snippet
        }

        const data = extractReviewDataRegex(email.subject, fullBodyText, email.snippet);
        await db.insert(vivAirbnbReviews).values({
          messageId: email.messageId,
          uid: email.uid,
          propertyName: data.propertyName,
          guestName: data.guestName,
          rating: data.rating,
          reviewSnippet: data.reviewSnippet,
          highlights: data.highlights,
          improvements: data.improvements,
          aiProcessed: true,
          rawSubject: email.subject,
          rawSnippet: email.snippet.slice(0, 500),
          emailDate: new Date(email.date),
        }).onDuplicateKeyUpdate({
          set: {
            uid: email.uid,
            propertyName: data.propertyName,
            guestName: data.guestName,
            rating: data.rating,
            reviewSnippet: data.reviewSnippet,
            highlights: data.highlights,
            improvements: data.improvements,
            aiProcessed: true,
          },
        });

        reviewsProcessed++;
        console.log(`[Airbnb] Saved review: ${data.guestName || "unknown"} — ${data.rating || "?"}★ | highlights: ${data.highlights?.length || 0}`);
      } catch (e: any) {
        console.error("[Airbnb] Failed to process review email:", email.uid, e.message);
      }
    }
  }

  return { bookingsProcessed, reviewsProcessed, autoArchived };
}

/**
 * Re-process ALL reviews using regex parsing.
 * Fetches full email body and runs regex extraction to get highlights/improvements/propertyName.
 */
export async function reprocessUnprocessedReviews(): Promise<{ processed: number; failed: number }> {
  const db = await getDb();
  if (!db) return { processed: 0, failed: 0 };

  // Process ALL reviews (not just aiProcessed=false) since we switched from LLM to regex
  const allReviews = await db
    .select()
    .from(vivAirbnbReviews)
    .limit(100);

  let processed = 0;
  let failed = 0;

  for (const review of allReviews) {
    try {
      // Fetch full email body
      let fullBodyText: string | undefined;
      try {
        const fullEmail = await fetchEmail(review.uid);
        if (fullEmail?.bodyText) fullBodyText = fullEmail.bodyText;
        else if (fullEmail?.bodyHtml) {
          fullBodyText = fullEmail.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }
      } catch {
        // Use rawSnippet as fallback
        fullBodyText = undefined;
      }

      const data = extractReviewDataRegex(
        review.rawSubject || "",
        fullBodyText,
        review.rawSnippet || undefined
      );

      await db.update(vivAirbnbReviews)
        .set({
          propertyName: data.propertyName || review.propertyName,
          guestName: data.guestName || review.guestName,
          rating: data.rating || review.rating,
          reviewSnippet: data.reviewSnippet || review.reviewSnippet,
          highlights: data.highlights || review.highlights,
          improvements: data.improvements || review.improvements,
          aiProcessed: true,
        })
        .where(eq(vivAirbnbReviews.id, review.id));

      processed++;
      console.log(`[Airbnb] Reprocessed review ${review.id}: ${data.guestName || "unknown"} — ${data.highlights?.length || 0} highlights`);
    } catch (e: any) {
      console.error(`[Airbnb] Failed to reprocess review ${review.id}:`, e.message);
      failed++;
    }
  }

  return { processed, failed };
}

/**
 * Re-process ALL bookings using regex parsing.
 * Fetches full email body and runs regex extraction to get complete booking details.
 */
export async function reprocessUnprocessedBookings(): Promise<{ processed: number; failed: number }> {
  const db = await getDb();
  if (!db) return { processed: 0, failed: 0 };

  // Process ALL bookings since we switched from LLM to regex
  const allBookings = await db
    .select()
    .from(vivAirbnbBookings)
    .limit(100);

  let processed = 0;
  let failed = 0;

  for (const booking of allBookings) {
    try {
      let fullBodyText: string | undefined;
      let fullBodyHtml: string | undefined;
      try {
        const fullEmail = await fetchEmail(booking.uid);
        if (fullEmail?.bodyText) fullBodyText = fullEmail.bodyText;
        if (fullEmail?.bodyHtml) fullBodyHtml = fullEmail.bodyHtml;
      } catch {
        fullBodyText = undefined;
      }

      const data = extractBookingDataRegex(
        booking.rawSubject || "",
        fullBodyText,
        booking.rawSnippet || undefined,
        fullBodyHtml
      );

      await db.update(vivAirbnbBookings)
        .set({
          confirmationCode: data.confirmationCode || booking.confirmationCode,
          propertyName: data.propertyName || booking.propertyName,
          guestName: data.guestName || booking.guestName,
          checkIn: data.checkIn || booking.checkIn,
          checkOut: data.checkOut || booking.checkOut,
          numGuests: data.numGuests || booking.numGuests,
          nightlyRate: data.nightlyRate || booking.nightlyRate,
          numNights: data.numNights || booking.numNights,
          status: data.status || booking.status || "confirmed",
        })
        .where(eq(vivAirbnbBookings.id, booking.id));

      processed++;
      console.log(`[Airbnb] Reprocessed booking ${booking.id}: ${data.guestName || "unknown"} at ${data.propertyName || "unknown"} — ${data.nightlyRate || "?"} x ${data.numNights || "?"} nights`);
    } catch (e: any) {
      console.error(`[Airbnb] Failed to reprocess booking ${booking.id}:`, e.message);
      failed++;
    }
  }

  return { processed, failed };
}

// ── Auto-Reprocess on Startup ─────────────────────────────────────────

/**
 * Auto-reprocess bookings/reviews with missing data.
 * Called on server startup to ensure data is populated after every deploy.
 * Only reprocesses entries that have null propertyName (the most critical field).
 */
export async function autoReprocessAirbnbData(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.log('[Startup] No DB connection, skipping auto-reprocess');
    return;
  }

  // Check for bookings with missing propertyName
  const incompleteBookings = await db
    .select({ id: vivAirbnbBookings.id })
    .from(vivAirbnbBookings)
    .where(isNull(vivAirbnbBookings.propertyName));

  // Check for reviews with missing propertyName
  const incompleteReviews = await db
    .select({ id: vivAirbnbReviews.id })
    .from(vivAirbnbReviews)
    .where(isNull(vivAirbnbReviews.propertyName));

  const totalIncomplete = incompleteBookings.length + incompleteReviews.length;
  if (totalIncomplete === 0) {
    console.log('[Startup] All Airbnb bookings/reviews have data — no reprocess needed');
    return;
  }

  console.log(`[Startup] Found ${incompleteBookings.length} bookings and ${incompleteReviews.length} reviews with missing data — auto-reprocessing...`);

  if (incompleteBookings.length > 0) {
    try {
      const result = await reprocessUnprocessedBookings();
      console.log(`[Startup] Reprocessed ${result.processed} bookings (${result.failed} failed)`);
    } catch (e: any) {
      console.error('[Startup] Booking reprocess error:', e.message);
    }
  }

  if (incompleteReviews.length > 0) {
    try {
      const result = await reprocessUnprocessedReviews();
      console.log(`[Startup] Reprocessed ${result.processed} reviews (${result.failed} failed)`);
    } catch (e: any) {
      console.error('[Startup] Review reprocess error:', e.message);
    }
  }
}

// ── Query Helpers ──────────────────────────────────────────────────────

export async function getAirbnbBookings(opts: {
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<{ bookings: AirbnbBooking[]; total: number }> {
  const db = await getDb();
  if (!db) return { bookings: [], total: 0 };

  const limit = opts.limit || 100;
  const offset = opts.offset || 0;

  let query = db.select().from(vivAirbnbBookings);
  let countQuery = db.select({ count: sql<number>`count(*)` }).from(vivAirbnbBookings);

  if (opts.search) {
    const searchTerm = `%${opts.search}%`;
    const searchCondition = or(
      like(vivAirbnbBookings.propertyName, searchTerm),
      like(vivAirbnbBookings.guestName, searchTerm),
      like(vivAirbnbBookings.confirmationCode, searchTerm)
    );
    query = query.where(searchCondition) as any;
    countQuery = countQuery.where(searchCondition) as any;
  }

  const [bookings, countResult] = await Promise.all([
    query.orderBy(desc(vivAirbnbBookings.emailDate)).limit(limit).offset(offset),
    countQuery,
  ]);

  return {
    bookings: bookings as AirbnbBooking[],
    total: (countResult as any)[0]?.count || 0,
  };
}

export async function getAirbnbReviews(opts: {
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<{ reviews: AirbnbReview[]; total: number }> {
  const db = await getDb();
  if (!db) return { reviews: [], total: 0 };

  const limit = opts.limit || 100;
  const offset = opts.offset || 0;

  let query = db.select().from(vivAirbnbReviews);
  let countQuery = db.select({ count: sql<number>`count(*)` }).from(vivAirbnbReviews);

  if (opts.search) {
    const searchTerm = `%${opts.search}%`;
    const searchCondition = or(
      like(vivAirbnbReviews.propertyName, searchTerm),
      like(vivAirbnbReviews.guestName, searchTerm),
      like(vivAirbnbReviews.reviewSnippet, searchTerm)
    );
    query = query.where(searchCondition) as any;
    countQuery = countQuery.where(searchCondition) as any;
  }

  const [reviews, countResult] = await Promise.all([
    query.orderBy(desc(vivAirbnbReviews.emailDate)).limit(limit).offset(offset),
    countQuery,
  ]);

  return {
    reviews: reviews as AirbnbReview[],
    total: (countResult as any)[0]?.count || 0,
  };
}
