/**
 * Migration: Cleaning Reports — Email → SMS (Quo/OpenPhone)
 *
 * Renames columns on cleaningReportRecipients and cleaningReportsSent
 * to switch from email-based to phone-number-based recipients.
 *
 * Run via: railway run npx tsx scripts/migrate-cleaning-reports-sms.ts
 */
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const conn = await mysql.createConnection(url);
  console.log("Connected to database");

  // 1. cleaningReportRecipients: rename `email` → `phoneNumber`, change type
  try {
    await conn.execute(`
      ALTER TABLE cleaningReportRecipients
      CHANGE COLUMN email phoneNumber VARCHAR(20) NOT NULL
    `);
    console.log("✓ Renamed cleaningReportRecipients.email → phoneNumber");
  } catch (e: any) {
    if (e.message.includes("Unknown column")) {
      console.log("⏭ cleaningReportRecipients.email already renamed (or doesn't exist)");
    } else {
      throw e;
    }
  }

  // 2. cleaningReportsSent: rename `recipientEmails` → `recipientPhoneNumbers`
  try {
    await conn.execute(`
      ALTER TABLE cleaningReportsSent
      CHANGE COLUMN recipientEmails recipientPhoneNumbers TEXT NOT NULL
    `);
    console.log("✓ Renamed cleaningReportsSent.recipientEmails → recipientPhoneNumbers");
  } catch (e: any) {
    if (e.message.includes("Unknown column")) {
      console.log("⏭ cleaningReportsSent.recipientEmails already renamed (or doesn't exist)");
    } else {
      throw e;
    }
  }

  // 3. listings: add cleaningReportSlackWebhook column
  try {
    await conn.execute(`
      ALTER TABLE listings
      ADD COLUMN cleaningReportSlackWebhook TEXT NULL
    `);
    console.log("✓ Added listings.cleaningReportSlackWebhook");
  } catch (e: any) {
    if (e.message.includes("Duplicate column")) {
      console.log("⏭ listings.cleaningReportSlackWebhook already exists");
    } else {
      throw e;
    }
  }

  // Verify
  const [recipCols] = await conn.execute(`SHOW COLUMNS FROM cleaningReportRecipients`) as any;
  const [sentCols] = await conn.execute(`SHOW COLUMNS FROM cleaningReportsSent`) as any;
  console.log("\ncleaningReportRecipients columns:", recipCols.map((c: any) => c.Field));
  console.log("cleaningReportsSent columns:", sentCols.map((c: any) => c.Field));

  await conn.end();
  console.log("\nDone!");
}

main().catch((e) => { console.error(e); process.exit(1); });
