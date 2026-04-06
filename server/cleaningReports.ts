/**
 * Cleaning Report Emails
 *
 * Sends automated email notifications to property owners when a turnover clean is completed.
 * Triggered by breezewayCleanSync after new completed cleans are inserted.
 */
import { sendEmail } from "./gmail";
import { getDb } from "./db";
import {
  cleaningReportRecipients,
  cleaningReportsSent,
  completedCleans,
  cleaners,
} from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

// ── Email Template ──────────────────────────────────────────────────

function formatDateTime(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }) + " at " + d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

function formatDateOnly(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function buildCleaningReportHtml(opts: {
  propertyName: string;
  scheduledDate: Date | null;
  completedDate: Date | null;
  cleanerName: string;
  pairedCleanerName?: string | null;
  breezewayTaskId: string;
}): string {
  const reportUrl = `https://app.breezeway.io/task/${opts.breezewayTaskId}`;
  const cleanerDisplay = opts.pairedCleanerName
    ? `${opts.cleanerName} & ${opts.pairedCleanerName}`
    : opts.cleanerName;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1a3a2a 0%, #2d5a3d 100%); border-radius: 12px 12px 0 0; padding: 24px; text-align: center;">
      <h1 style="color: #fff; margin: 0; font-size: 22px;">Turnover Clean Completed</h1>
      <p style="color: #a8d5ba; margin: 8px 0 0; font-size: 14px;">${opts.propertyName}</p>
    </div>

    <!-- Main Content -->
    <div style="background: #fff; padding: 24px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
      <p style="color: #333; font-size: 15px; margin: 0 0 20px;">
        The turnover clean for <strong>${opts.propertyName}</strong> has been completed.
      </p>

      <!-- Details -->
      <div style="background: #f8faf9; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px; width: 140px;">Scheduled</td>
            <td style="padding: 8px 0; color: #333; font-size: 14px; font-weight: 500;">${formatDateOnly(opts.scheduledDate)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px;">Completed</td>
            <td style="padding: 8px 0; color: #333; font-size: 14px; font-weight: 500;">${formatDateTime(opts.completedDate)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px;">Cleaner</td>
            <td style="padding: 8px 0; color: #333; font-size: 14px; font-weight: 500;">${cleanerDisplay}</td>
          </tr>
        </table>
      </div>

      <!-- CTA Button -->
      <div style="text-align: center; margin-bottom: 16px;">
        <a href="${reportUrl}" target="_blank" rel="noopener noreferrer"
           style="display: inline-block; background: linear-gradient(135deg, #2d5a3d 0%, #3d7a52 100%); color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">
          View Cleaning Report
        </a>
      </div>

      <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">
        This report was sent automatically by 5STR Wand
      </p>
    </div>
  </div>
</body>
</html>`;
}

function buildCleaningReportText(opts: {
  propertyName: string;
  scheduledDate: Date | null;
  completedDate: Date | null;
  cleanerName: string;
  pairedCleanerName?: string | null;
  breezewayTaskId: string;
}): string {
  const reportUrl = `https://app.breezeway.io/task/${opts.breezewayTaskId}`;
  const cleanerDisplay = opts.pairedCleanerName
    ? `${opts.cleanerName} & ${opts.pairedCleanerName}`
    : opts.cleanerName;

  return [
    `Turnover Clean Completed — ${opts.propertyName}`,
    "",
    `The turnover clean for ${opts.propertyName} has been completed.`,
    "",
    `Scheduled: ${formatDateOnly(opts.scheduledDate)}`,
    `Completed: ${formatDateTime(opts.completedDate)}`,
    `Cleaner: ${cleanerDisplay}`,
    "",
    `View Cleaning Report: ${reportUrl}`,
    "",
    "— 5STR Wand",
  ].join("\n");
}

// ── Core Functions ──────────────────────────────────────────────────

/**
 * Get all configured recipients for a listing.
 */
async function getRecipientsForListing(listingId: number): Promise<{ email: string; name: string | null }[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ email: cleaningReportRecipients.email, name: cleaningReportRecipients.name })
    .from(cleaningReportRecipients)
    .where(eq(cleaningReportRecipients.listingId, listingId));
}

/**
 * Send a cleaning report email for a single completed clean.
 * Records the result in cleaningReportsSent for audit/dedup.
 */
async function sendCleaningReport(clean: {
  id: number;
  breezewayTaskId: string;
  listingId: number | null;
  propertyName: string | null;
  scheduledDate: Date | string | null;
  completedDate: Date | string | null;
  cleanerName: string;
  pairedCleanerName?: string | null;
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
    // Record that no recipients were configured
    await db.insert(cleaningReportsSent).values({
      completedCleanId: clean.id,
      breezewayTaskId: clean.breezewayTaskId,
      recipientEmails: "[]",
      status: "no_recipients",
    });
    console.log(`[CleaningReports] No recipients for listing ${clean.listingId} (${clean.propertyName})`);
    return;
  }

  const toEmails = recipients.map((r) => r.email).join(", ");
  const propertyName = clean.propertyName || "Property";

  try {
    const html = buildCleaningReportHtml({
      propertyName,
      scheduledDate: clean.scheduledDate ? new Date(clean.scheduledDate as any) : null,
      completedDate: clean.completedDate ? new Date(clean.completedDate as any) : null,
      cleanerName: clean.cleanerName,
      pairedCleanerName: clean.pairedCleanerName,
      breezewayTaskId: clean.breezewayTaskId,
    });

    const text = buildCleaningReportText({
      propertyName,
      scheduledDate: clean.scheduledDate ? new Date(clean.scheduledDate as any) : null,
      completedDate: clean.completedDate ? new Date(clean.completedDate as any) : null,
      cleanerName: clean.cleanerName,
      pairedCleanerName: clean.pairedCleanerName,
      breezewayTaskId: clean.breezewayTaskId,
    });

    await sendEmail({
      to: toEmails,
      subject: `Turnover Clean Completed — ${propertyName}`,
      html,
      text,
    });

    await db.insert(cleaningReportsSent).values({
      completedCleanId: clean.id,
      breezewayTaskId: clean.breezewayTaskId,
      recipientEmails: JSON.stringify(recipients.map((r) => r.email)),
      status: "sent",
    });

    console.log(`[CleaningReports] Sent report for ${propertyName} to ${toEmails}`);
  } catch (err: any) {
    console.error(`[CleaningReports] Failed to send for ${clean.breezewayTaskId}:`, err.message);

    await db.insert(cleaningReportsSent).values({
      completedCleanId: clean.id,
      breezewayTaskId: clean.breezewayTaskId,
      recipientEmails: JSON.stringify(recipients.map((r) => r.email)),
      status: "failed",
      errorMessage: err.message?.slice(0, 500),
    }).catch(() => {}); // don't fail on audit insert
  }
}

/**
 * Send cleaning report emails for a batch of newly synced cleans.
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

  // Fetch the new cleans with cleaner names
  const newCleans = await db
    .select({
      id: completedCleans.id,
      breezewayTaskId: completedCleans.breezewayTaskId,
      listingId: completedCleans.listingId,
      propertyName: completedCleans.propertyName,
      scheduledDate: completedCleans.scheduledDate,
      completedDate: completedCleans.completedDate,
      cleanerId: completedCleans.cleanerId,
      pairedCleanerId: completedCleans.pairedCleanerId,
    })
    .from(completedCleans)
    .where(inArray(completedCleans.id, newCleanIds));

  // Get all cleaner names
  const allCleanerRows = await db.select({ id: cleaners.id, name: cleaners.name }).from(cleaners);
  const cleanerNameMap = new Map(allCleanerRows.map((c) => [c.id, c.name]));

  for (const clean of newCleans) {
    // Skip partner records (they represent the same physical clean)
    if (clean.breezewayTaskId.endsWith("-partner")) {
      result.skipped++;
      continue;
    }

    const cleanerName = clean.cleanerId ? cleanerNameMap.get(clean.cleanerId) || "Team Member" : "Team Member";
    const pairedCleanerName = clean.pairedCleanerId ? cleanerNameMap.get(clean.pairedCleanerId) || null : null;

    try {
      await sendCleaningReport({
        id: clean.id,
        breezewayTaskId: clean.breezewayTaskId,
        listingId: clean.listingId,
        propertyName: clean.propertyName,
        scheduledDate: clean.scheduledDate,
        completedDate: clean.completedDate,
        cleanerName,
        pairedCleanerName,
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
