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
  listings,
  customerMapping,
} from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

/**
 * Resolve the Slack webhook for a listing.
 * Lookup order: listing.cleaningReportSlackWebhook → owner (customerMapping,
 * matched on breezewayPropertyId) → null.
 * This implements "option A": per-customer fallback with a per-listing override.
 */
async function resolveSlackWebhookForListing(listingId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      breezewayPropertyId: listings.breezewayPropertyId,
      listingWebhook: listings.cleaningReportSlackWebhook,
    })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!row) return null;
  if (row.listingWebhook) return row.listingWebhook;
  if (!row.breezewayPropertyId) return null;
  const [owner] = await db
    .select({ webhook: customerMapping.cleaningReportSlackWebhook })
    .from(customerMapping)
    .where(eq(customerMapping.breezewayOwnerId, row.breezewayPropertyId))
    .limit(1);
  return owner?.webhook ?? null;
}

// ── SMS Content ────────────────────────────────────────────────────

function buildSmsContent(opts: {
  propertyName: string;
  scheduledDate: Date | null;
  breezewayTaskId: string;
  reportUrl?: string | null;
}): string {
  const dateStr = opts.scheduledDate
    ? opts.scheduledDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "N/A";
  const link = opts.reportUrl || `https://app.breezeway.io/task/${opts.breezewayTaskId}`;
  return `Turnover clean completed for ${opts.propertyName} (${dateStr}). View report: ${link}`;
}

// ── Slack Notification ─────────────────────────────────────────────

async function postCleaningReportToSlack(webhookUrl: string, content: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: content }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook failed (${res.status}): ${body.slice(0, 200)}`);
  }
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
  reportUrl?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Skip if no listing linked
  if (!clean.listingId) {
    console.log(`[CleaningReports] No listing for clean ${clean.breezewayTaskId}, skipping`);
    return;
  }

  // Check if cleaning reports are enabled for this listing
  const [listingConfig] = await db
    .select({ enabled: listings.cleaningReportsEnabled })
    .from(listings)
    .where(eq(listings.id, clean.listingId))
    .limit(1);

  if (!listingConfig?.enabled) {
    return; // silently skip — reports not enabled for this property
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

  // Get recipients (SMS) and resolve Slack webhook (listing or owner-level).
  const recipients = await getRecipientsForListing(clean.listingId);
  const slackWebhook = await resolveSlackWebhookForListing(clean.listingId);

  // Nothing to do if there's no delivery channel at all — record and exit so
  // we don't retry forever.
  if (recipients.length === 0 && !slackWebhook) {
    await db.insert(cleaningReportsSent).values({
      completedCleanId: clean.id,
      breezewayTaskId: clean.breezewayTaskId,
      recipientPhoneNumbers: "[]",
      status: "no_recipients",
    });
    console.log(`[CleaningReports] No SMS recipients and no Slack webhook for listing ${clean.listingId} (${clean.propertyName})`);
    return;
  }

  const propertyName = clean.propertyName || "Property";
  const content = buildSmsContent({
    propertyName,
    scheduledDate: clean.scheduledDate ? new Date(clean.scheduledDate as any) : null,
    breezewayTaskId: clean.breezewayTaskId,
    reportUrl: clean.reportUrl,
  });

  // Track delivery outcome across channels independently so a Slack failure
  // doesn't mask a successful SMS and vice versa.
  let smsSentTo: string[] = [];
  let smsError: string | null = null;
  let slackOk = false;
  let slackError: string | null = null;

  if (recipients.length > 0) {
    try {
      for (const recipient of recipients) {
        await sendSms({ to: recipient.phoneNumber, content });
        smsSentTo.push(recipient.phoneNumber);
      }
    } catch (err: any) {
      smsError = err.message?.slice(0, 500) ?? "sms failed";
      console.error(`[CleaningReports] SMS failed for ${clean.breezewayTaskId}:`, err.message);
    }
  }

  if (slackWebhook) {
    try {
      await postCleaningReportToSlack(slackWebhook, content);
      slackOk = true;
      console.log(`[CleaningReports] Slack notification sent for ${propertyName}`);
    } catch (slackErr: any) {
      slackError = slackErr.message?.slice(0, 500) ?? "slack failed";
      console.error(`[CleaningReports] Slack failed for ${propertyName}:`, slackErr.message);
    }
  }

  // Consider the report "sent" if at least one channel succeeded.
  const anySuccess = smsSentTo.length > 0 || slackOk;
  const status: "sent" | "failed" = anySuccess ? "sent" : "failed";
  const errorMessage = [smsError && `sms: ${smsError}`, slackError && `slack: ${slackError}`]
    .filter(Boolean)
    .join(" | ") || null;

  await db
    .insert(cleaningReportsSent)
    .values({
      completedCleanId: clean.id,
      breezewayTaskId: clean.breezewayTaskId,
      recipientPhoneNumbers: JSON.stringify(smsSentTo),
      status,
      errorMessage,
    })
    .catch(() => {});

  if (anySuccess) {
    const parts: string[] = [];
    if (smsSentTo.length) parts.push(`SMS → ${smsSentTo.join(", ")}`);
    if (slackOk) parts.push("Slack → ok");
    console.log(`[CleaningReports] ${propertyName}: ${parts.join(" · ")}`);
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
      reportUrl: completedCleans.reportUrl,
      taskTitle: completedCleans.taskTitle,
    })
    .from(completedCleans)
    .where(inArray(completedCleans.id, newCleanIds));

  for (const clean of newCleans) {
    // Skip partner records (they represent the same physical clean)
    if (clean.breezewayTaskId.endsWith("-partner")) {
      result.skipped++;
      continue;
    }

    // Only send reports for turnover cleans and deep cleans
    const title = (clean.taskTitle || "").toLowerCase().trim();
    if (!title.includes("turnover clean") && title !== "deep clean") {
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
        reportUrl: clean.reportUrl,
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
