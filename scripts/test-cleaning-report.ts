/**
 * Test script: sends a cleaning report SMS + Slack for a specific clean.
 * Deletes the existing sent record first so it re-fires.
 *
 * Usage: railway run npx tsx scripts/test-cleaning-report.ts
 */
import mysql from "mysql2/promise";
import { sendSms } from "../server/quo";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  const breezewayTaskId = "140305465"; // Kimble turnover clean Apr 5

  // Remove existing sent record so the report can re-fire
  await conn.execute(
    "DELETE FROM cleaningReportsSent WHERE breezewayTaskId = ?",
    [breezewayTaskId]
  );
  console.log("Cleared existing sent record for", breezewayTaskId);

  // Get the clean
  const [cleans] = (await conn.execute(
    "SELECT id, breezewayTaskId, listingId, propertyName, scheduledDate FROM completedCleans WHERE breezewayTaskId = ?",
    [breezewayTaskId]
  )) as any;

  if (!cleans.length) {
    console.error("Clean not found");
    process.exit(1);
  }
  const clean = cleans[0];
  console.log("Clean:", clean.propertyName, clean.scheduledDate);

  // Get recipients
  const [recipients] = (await conn.execute(
    "SELECT phoneNumber, name FROM cleaningReportRecipients WHERE listingId = ?",
    [clean.listingId]
  )) as any;
  console.log("Recipients:", recipients.map((r: any) => `${r.name} (${r.phoneNumber})`));

  // Get slack webhook
  const [listing] = (await conn.execute(
    "SELECT cleaningReportSlackWebhook, cleaningReportsEnabled FROM listings WHERE id = ?",
    [clean.listingId]
  )) as any;

  if (!listing[0]?.cleaningReportsEnabled) {
    console.error("Cleaning reports not enabled for this listing");
    process.exit(1);
  }

  // Build message
  const dateStr = clean.scheduledDate
    ? new Date(clean.scheduledDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "N/A";
  const reportUrl = `https://app.breezeway.io/task/${clean.breezewayTaskId}`;
  const content = `Turnover clean completed for ${clean.propertyName} (${dateStr}). View report: ${reportUrl}`;
  console.log("\nMessage:", content);

  // Send SMS
  for (const r of recipients) {
    try {
      await sendSms({ to: r.phoneNumber, content });
      console.log(`✓ SMS sent to ${r.name} (${r.phoneNumber})`);
    } catch (e: any) {
      console.error(`✗ SMS failed for ${r.phoneNumber}:`, e.message);
    }
  }

  // Send Slack
  const webhookUrl = listing[0]?.cleaningReportSlackWebhook;
  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      });
      if (res.ok) {
        console.log("✓ Slack notification sent");
      } else {
        console.error("✗ Slack failed:", res.status, await res.text());
      }
    } catch (e: any) {
      console.error("✗ Slack error:", e.message);
    }
  }

  // Record the send
  await conn.execute(
    "INSERT INTO cleaningReportsSent (completedCleanId, breezewayTaskId, recipientPhoneNumbers, reportStatus) VALUES (?, ?, ?, 'sent')",
    [clean.id, breezewayTaskId, JSON.stringify(recipients.map((r: any) => r.phoneNumber))]
  );
  console.log("\n✓ Recorded in cleaningReportsSent");

  await conn.end();
  console.log("Done!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
