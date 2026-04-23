/**
 * Email Reports — Weekly pay reports and monthly receipt reminders.
 *
 * 1. Friday 8 AM ET: Send weekly pay report to each active cleaner with email
 * 2. 1st of each month: Send receipt submission reminder to cleaners
 * 3. Manual trigger: Admin can send reports on-demand
 */
import { sendEmail } from "./gmail";
import { getDb } from "./db";
import { cleaners } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { calculateWeeklyPay, getPayWeekStart, type WeeklyPayBreakdown } from "./payCalculation";
import { getCleanerByToken } from "./cleanerTokens";

// ── Email Templates ─────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Build the weekly pay report HTML email for a cleaner.
 * IMPORTANT: Never include cleaning fee amounts or revenue data.
 */
function buildWeeklyPayEmailHtml(
  cleanerName: string,
  breakdown: WeeklyPayBreakdown,
  dashboardUrl: string
): string {
  const adjustedPay = Number(
    (breakdown.basePay * breakdown.qualityMultiplier * breakdown.volumeMultiplier).toFixed(2)
  );

  const cleansRows = breakdown.cleans
    .map(
      (c) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${c.propertyName}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; text-align: center;">${c.distanceMiles ? (c.distanceMiles * 2).toFixed(1) + " mi" : "—"}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; text-align: center;">${c.scheduledDate ? formatDate(c.scheduledDate) : "—"}</td>
      </tr>`
    )
    .join("");

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
      <h1 style="color: #fff; margin: 0; font-size: 24px;">✨ Wand Weekly Pay Report</h1>
      <p style="color: #a8d5ba; margin: 8px 0 0; font-size: 14px;">Week of ${formatDate(breakdown.weekOf)}</p>
    </div>

    <!-- Main Content -->
    <div style="background: #fff; padding: 24px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
      <p style="color: #333; font-size: 16px; margin: 0 0 20px;">Hi ${cleanerName},</p>
      <p style="color: #555; font-size: 14px; margin: 0 0 24px;">Here's your pay breakdown for this week:</p>

      <!-- Pay Summary -->
      <div style="background: #f8faf9; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; color: #555; font-size: 14px;">Base Pay (${breakdown.totalCleans} clean${breakdown.totalCleans !== 1 ? "s" : ""})</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #333;">${formatCurrency(breakdown.basePay)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #555; font-size: 14px;">
              Quality Multiplier
              <span style="display: inline-block; background: ${breakdown.qualityMultiplier >= 1.5 ? "#e8f5e9" : breakdown.qualityMultiplier >= 1.2 ? "#fff8e1" : "#fce4ec"}; color: ${breakdown.qualityMultiplier >= 1.5 ? "#2e7d32" : breakdown.qualityMultiplier >= 1.2 ? "#f57f17" : "#c62828"}; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-left: 4px;">
                ${breakdown.qualityTierLabel}
              </span>
            </td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #333;">×${breakdown.qualityMultiplier.toFixed(1)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #555; font-size: 14px;">
              Volume Multiplier
              <span style="display: inline-block; background: ${breakdown.volumeMultiplier >= 1.2 ? "#fff8e1" : breakdown.volumeMultiplier >= 1.1 ? "#e3f2fd" : "#f5f5f5"}; color: ${breakdown.volumeMultiplier >= 1.2 ? "#f57f17" : breakdown.volumeMultiplier >= 1.1 ? "#1565c0" : "#757575"}; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-left: 4px;">
                ${breakdown.volumeTierLabel}
              </span>
            </td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #333;">×${breakdown.volumeMultiplier.toFixed(1)}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding: 4px 0;"><hr style="border: none; border-top: 1px dashed #ddd;"></td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #555; font-size: 14px;">Adjusted Pay</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #333;">${formatCurrency(adjustedPay)}</td>
          </tr>
          ${breakdown.mileagePay > 0 ? `
          <tr>
            <td style="padding: 6px 0; color: #555; font-size: 14px;">Mileage (${breakdown.totalMileage.toFixed(1)} mi × ${formatCurrency(breakdown.mileageRate)}/mi)</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #333;">+${formatCurrency(breakdown.mileagePay)}</td>
          </tr>` : ""}
          ${breakdown.cellPhoneReimbursement > 0 ? `
          <tr>
            <td style="padding: 6px 0; color: #555; font-size: 14px;">Cell Phone Reimbursement</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #333;">+${formatCurrency(breakdown.cellPhoneReimbursement)}</td>
          </tr>` : ""}
          ${breakdown.vehicleReimbursement > 0 ? `
          <tr>
            <td style="padding: 6px 0; color: #555; font-size: 14px;">Vehicle Maintenance</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #333;">+${formatCurrency(breakdown.vehicleReimbursement)}</td>
          </tr>` : ""}
          <tr>
            <td colspan="2" style="padding: 4px 0;"><hr style="border: none; border-top: 2px solid #1a3a2a;"></td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #1a3a2a; font-size: 18px; font-weight: 700;">Total Pay</td>
            <td style="padding: 8px 0; text-align: right; color: #1a3a2a; font-size: 18px; font-weight: 700;">${formatCurrency(breakdown.totalPay)}</td>
          </tr>
        </table>
      </div>

      ${breakdown.totalCleans > 0 ? `
      <!-- Cleans List -->
      <h3 style="color: #333; font-size: 14px; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.5px;">Cleans This Week</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px;">
        <thead>
          <tr style="background: #f5f5f5;">
            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #555;">Property</th>
            <th style="padding: 8px 12px; text-align: center; font-weight: 600; color: #555;">Round Trip</th>
            <th style="padding: 8px 12px; text-align: center; font-weight: 600; color: #555;">Date</th>
          </tr>
        </thead>
        <tbody>
          ${cleansRows}
        </tbody>
      </table>` : ""}

      ${breakdown.qualityScore !== null ? `
      <!-- Quality Score -->
      <div style="background: #f0f7f3; border-radius: 8px; padding: 16px; margin-bottom: 24px; text-align: center;">
        <p style="color: #555; font-size: 12px; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.5px;">30-Day Cleaning Score</p>
        <p style="color: #1a3a2a; font-size: 28px; font-weight: 700; margin: 0;">${breakdown.qualityScore.toFixed(2)}</p>
      </div>` : ""}

      <!-- Dashboard Link -->
      <div style="text-align: center; margin-top: 20px;">
        <a href="${dashboardUrl}" style="display: inline-block; background: #1a3a2a; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          View Full Dashboard →
        </a>
      </div>

      <p style="color: #999; font-size: 12px; text-align: center; margin: 24px 0 0;">
        This is an automated report from Wand. Questions? Reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Build the monthly receipt reminder HTML email.
 */
function buildReceiptReminderHtml(cleanerName: string, dashboardUrl: string): string {
  const currentMonth = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #1a3a2a 0%, #2d5a3d 100%); border-radius: 12px 12px 0 0; padding: 24px; text-align: center;">
      <h1 style="color: #fff; margin: 0; font-size: 24px;">📋 Monthly Receipt Reminder</h1>
      <p style="color: #a8d5ba; margin: 8px 0 0; font-size: 14px;">${currentMonth}</p>
    </div>
    <div style="background: #fff; padding: 24px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
      <p style="color: #333; font-size: 16px; margin: 0 0 16px;">Hi ${cleanerName},</p>
      <p style="color: #555; font-size: 14px; margin: 0 0 16px;">
        This is a friendly reminder to submit your monthly receipts for reimbursement:
      </p>
      <ul style="color: #555; font-size: 14px; padding-left: 20px; margin: 0 0 16px;">
        <li style="margin-bottom: 8px;"><strong>Cell Phone Bill</strong> — submit your monthly phone bill receipt</li>
        <li style="margin-bottom: 8px;"><strong>Vehicle Maintenance</strong> — submit any vehicle maintenance receipts (oil changes, tire rotation, etc.)</li>
      </ul>
      <div style="background: #fff3e0; border-left: 4px solid #ff9800; padding: 12px 16px; border-radius: 4px; margin-bottom: 24px;">
        <p style="color: #e65100; font-size: 13px; margin: 0; font-weight: 600;">
          ⏰ Deadline: 5th of this month
        </p>
        <p style="color: #bf360c; font-size: 12px; margin: 4px 0 0;">
          Receipts not submitted by the 5th will not be eligible for this month's reimbursement.
        </p>
      </div>
      <div style="text-align: center;">
        <a href="${dashboardUrl}" style="display: inline-block; background: #1a3a2a; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Submit Receipts →
        </a>
      </div>
      <p style="color: #999; font-size: 12px; text-align: center; margin: 24px 0 0;">
        This is an automated reminder from Wand. Questions? Reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ── Send Functions ──────────────────────────────────────────────────

/**
 * Get the base URL for cleaner dashboard links.
 * Uses the deployed domain or falls back to localhost.
 */
function getDashboardBaseUrl(): string {
  // In production, use the deployed domain
  return "https://wandaimanage-d9uetjht.manus.space";
}

/**
 * Send weekly pay report to a single cleaner.
 * Returns true if sent successfully, false if skipped (no email, inactive, etc.)
 */
export async function sendWeeklyPayReport(
  cleanerId: number,
  weekOf?: string
): Promise<{ sent: boolean; reason?: string }> {
  const db = await getDb();
  if (!db) return { sent: false, reason: "Database not available" };

  const [cleaner] = await db
    .select()
    .from(cleaners)
    .where(eq(cleaners.id, cleanerId));

  if (!cleaner) return { sent: false, reason: "Cleaner not found" };
  if (!cleaner.active) return { sent: false, reason: "Cleaner inactive" };
  if (!cleaner.email) return { sent: false, reason: "No email address" };
  if (!cleaner.dashboardToken) return { sent: false, reason: "No dashboard token" };

  const targetWeek = weekOf ?? getPayWeekStart(new Date());
  const breakdown = await calculateWeeklyPay(cleaner.id, targetWeek);
  if (!breakdown) return { sent: false, reason: "Could not calculate pay" };

  const dashboardUrl = `${getDashboardBaseUrl()}/cleaner/${cleaner.dashboardToken}`;
  const html = buildWeeklyPayEmailHtml(cleaner.name, breakdown, dashboardUrl);

  try {
    await sendEmail({
      to: cleaner.email,
      subject: `Wand Pay Report — Week of ${formatDate(targetWeek)}`,
      html,
      text: `Hi ${cleaner.name}, your weekly pay report is ready. Total: ${formatCurrency(breakdown.totalPay)}. View details: ${dashboardUrl}`,
    });
    console.log(`[EmailReports] Sent weekly pay report to ${cleaner.name} (${cleaner.email})`);
    return { sent: true };
  } catch (err: any) {
    console.error(`[EmailReports] Failed to send to ${cleaner.name}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

/**
 * Send weekly pay reports to ALL active cleaners with email addresses.
 */
export async function sendAllWeeklyPayReports(
  weekOf?: string
): Promise<{ sent: number; skipped: number; failed: number; details: Array<{ name: string; status: string; reason?: string }> }> {
  const db = await getDb();
  if (!db) return { sent: 0, skipped: 0, failed: 0, details: [] };

  const allCleaners = await db
    .select()
    .from(cleaners)
    .where(eq(cleaners.active, true));

  const results = { sent: 0, skipped: 0, failed: 0, details: [] as Array<{ name: string; status: string; reason?: string }> };

  for (const cleaner of allCleaners) {
    const result = await sendWeeklyPayReport(cleaner.id, weekOf);
    if (result.sent) {
      results.sent++;
      results.details.push({ name: cleaner.name, status: "sent" });
    } else if (result.reason === "No email address" || result.reason === "Cleaner inactive") {
      results.skipped++;
      results.details.push({ name: cleaner.name, status: "skipped", reason: result.reason });
    } else {
      results.failed++;
      results.details.push({ name: cleaner.name, status: "failed", reason: result.reason });
    }

    // Small delay between emails to avoid rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(
    `[EmailReports] Weekly reports: ${results.sent} sent, ${results.skipped} skipped, ${results.failed} failed`
  );
  return results;
}

/**
 * Send monthly receipt reminder to ALL active cleaners with email addresses.
 */
export async function sendReceiptReminders(): Promise<{ sent: number; skipped: number; failed: number }> {
  const db = await getDb();
  if (!db) return { sent: 0, skipped: 0, failed: 0 };

  const allCleaners = await db
    .select()
    .from(cleaners)
    .where(eq(cleaners.active, true));

  const results = { sent: 0, skipped: 0, failed: 0 };

  for (const cleaner of allCleaners) {
    if (!cleaner.email || !cleaner.dashboardToken) {
      results.skipped++;
      continue;
    }

    const dashboardUrl = `${getDashboardBaseUrl()}/cleaner/${cleaner.dashboardToken}`;
    const html = buildReceiptReminderHtml(cleaner.name, dashboardUrl);

    try {
      await sendEmail({
        to: cleaner.email,
        subject: "Wand — Monthly Receipt Reminder",
        html,
        text: `Hi ${cleaner.name}, please submit your monthly receipts (cell phone + vehicle maintenance) by the 5th. Upload here: ${dashboardUrl}`,
      });
      results.sent++;
    } catch (err: any) {
      console.error(`[EmailReports] Receipt reminder failed for ${cleaner.name}:`, err.message);
      results.failed++;
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(
    `[EmailReports] Receipt reminders: ${results.sent} sent, ${results.skipped} skipped, ${results.failed} failed`
  );
  return results;
}
