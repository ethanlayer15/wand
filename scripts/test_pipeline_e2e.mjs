import "dotenv/config";
import { syncHostawayMessages } from "./server/sync.ts";
import { drizzle } from "drizzle-orm/mysql2";
import { guestMessages } from "./drizzle/schema.ts";
import { sql } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const db = drizzle({ connection: { uri: DATABASE_URL } });

  // Check DB count before sync
  const beforeCount = await db.select({ count: sql`COUNT(*)` }).from(guestMessages);
  console.log(`[Before] guestMessages count: ${beforeCount[0].count}`);

  // Sync a small batch (just 10 conversations to test)
  console.log("[Test] Syncing 10 recent conversations...");
  const start = Date.now();
  try {
    const result = await syncHostawayMessages({ maxConversations: 10 });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[Test] Sync completed in ${elapsed}s:`, result);
  } catch (err) {
    console.error("[Test] Sync failed:", err.message);
  }

  // Check DB count after sync
  const afterCount = await db.select({ count: sql`COUNT(*)` }).from(guestMessages);
  console.log(`[After] guestMessages count: ${afterCount[0].count}`);

  // Show a sample of synced messages
  const samples = await db.select({
    id: guestMessages.id,
    hostawayMessageId: guestMessages.hostawayMessageId,
    hostawayConversationId: guestMessages.hostawayConversationId,
    guestName: guestMessages.guestName,
    bodyPreview: sql`LEFT(${guestMessages.body}, 80)`,
    isIncoming: guestMessages.isIncoming,
    sentAt: guestMessages.sentAt,
  }).from(guestMessages).limit(5);

  console.log("[Samples]:", JSON.stringify(samples, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
