/**
 * Cleaning Report SMS
 *
 * Sends automated SMS notifications via Quo (OpenPhone) to property owners
 * when a turnover clean is completed.
 * Triggered by breezewayCleanSync after new completed cleans are inserted.
 */
import { sendSms } from "./quo";
import { getDb } from "./db";
import {
  cleaningReportRecipients,
  cleaningReportsSent,
  completedCleans,
} from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

// ── SMS Content ────────────────────────────────────────────────────

function buildSmsContent(opts: {
  propertyName: string;
  scheduledDate: Date | null;
  breezewayTaskId: string;
}): string {
  const dateStr = opts.scheduledDate
    ? opts.scheduledDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "N/A";
  const reportUrl = `https://app.breezeway.io/task/${opts.breezewayTaskId}`;
  return `Turnover clean completed for ${opts.propertyName} (${dateStr}). View report: ${reportUrl}`;
}

// ── Core Functions ──────────────────────────────────────────────────

/**
 * Get all configured recipients for a listing.
 */
async function getRecipientsForListing(listingId: number): Promise<{ phoneNumber: string; name: string | null }[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ phoneNumber: cleaningReportRecipients.phoneNumber, name: cleaningReportRecipients.name })
    .from(cleaningReportRecipients)
    .where(eq(cleaningReportRecipients.listingId, listingId));
}

/**
 * Send a cleaning report SMS for a single completed clean.
 * Records the result in cleaningReportsSent for audit/dedup.
 */
async function sendCleaningReport(clean: {
  id: number;
  breezewayTaskId: string;
  listingId: number | null;
  propertyName: string | null;
  scheduledDate: Date | string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Skip if no listing linked
  if (!clean.listingId) {
    console.log(`[CleaningReports] No listing for clean ${clean.breezewayTaskId}, skipping`);
    return;
  }

  // Check if already sent
  const existing = await db
    .select({ id: cleaningReportsSent.id })
    .from(cleaningReportsSent)
    .where(eq(cleaningReportsSent.breezewayTaskId, clean.breezewayTaskId))
    .limit(1);

  if (existing.length > 0) {
    console.log(`[CleaningReports] Already sent for ${clean.breezewayTaskId}, skipping`);
    return;
  }

  // Get recipients
  const recipients = await getRecipientsForListing(clean.listingId);

  if (recipients.length === 0) {
    await db.insert(cleaningReportsSent).values({
      completedCleanId: clean.id,
      breezewayTaskId: clean.breezewayTaskId,
      recipientPhoneNumbers: "[]",
      status: "no_recipients",
    });
    console.log(`[CleaningReports] No recipients for listing ${clean.listingId} (${clean.propertyName})`);
    return;
  }

  const propertyName = clean.propertyName || "Property";
  const content = buildSmsContent({
    propertyName,
    scheduledDate: clean.scheduledDate ? new Date(clean.scheduledDate as any) : null,
    breezewayTaskId: clean.breezewayTaskId,
  });

  try {
    for (const recipient of recipients) {
      await sendSms({ to: recipient.phoneNumber, content });
    }

    await db.insert(cleaningReportsSent).values({
      completedCleanId: clean.id,
      breezewayTaskId: clean.breezewayTaskId,
      recipientPhoneNumbers: JSON.stringify(recipients.map((r) => r.phoneNumber)),
      status: "sent",
    });

    const toNumbers = recipients.map((r) => r.phoneNumber).join(", ");
    console.log(`[CleaningReports] Sent SMS for ${propertyName} to ${toNumbers}`);
  } catch (err: any) {
    console.error(`[CleaningReports] Failed to send SMS for ${clean.breezewayTaskId}:`, err.message);

    await db.insert(cleaningReportsSent).values({
      completedCleanId: clean.id,
      breezewayTaskId: clean.breezewayTaskId,
      recipientPhoneNumbers: JSON.stringify(recipients.map((r) => r.phoneNumber)),
      status: "failed",
      errorMessage: err.message?.slice(0, 500),
    }).catch(() => {}); // don't fail on audit insert
  }
}

/**
 * Send cleaning report SMS for a batch of newly synced cleans.
 * Called from breezewayCleanSync after new completed cleans are inserted.
 */
export async function sendCleaningReportsForNewCleans(newCleanIds: number[]): Promise<{
  sent: number;
  failed: number;
  skipped: number;
}> {
  const result = { sent: 0, failed: 0, skipped: 0 };
  if (newCleanIds.length === 0) return result;

  const db = await getDb();
  if (!db) return result;

  const newCleans = await db
    .select({
      id: completedCleans.id,
      breezewayTaskId: completedCleans.breezewayTaskId,
      listingId: completedCleans.listingId,
      propertyName: completedCleans.propertyName,
      scheduledDate: completedCleans.scheduledDate,
    })
    .from(completedCleans)
    .where(inArray(completedCleans.id, newCleanIds));

  for (const clean of newCleans) {
    // Skip partner records (they represent the same physical clean)
    if (clean.breezewayTaskId.endsWith("-partner")) {
      result.skipped++;
      continue;
    }

    try {
      await sendCleaningReport({
        id: clean.id,
        breezewayTaskId: clean.breezewayTaskId,
        listingId: clean.listingId,
        propertyName: clean.propertyName,
        scheduledDate: clean.scheduledDate,
      });
      result.sent++;
    } catch (err: any) {
      console.error(`[CleaningReports] Error for clean ${clean.id}:`, err.message);
      result.failed++;
    }

    // Small delay between sends
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`[CleaningReports] Batch complete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`);
  return result;
}
