import "dotenv/config";
import { runGuestMessagePipeline } from "./server/taskCreator.ts";
import { drizzle } from "drizzle-orm/mysql2";
import { guestMessages, tasks } from "./drizzle/schema.ts";
import { sql, desc } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const db = drizzle({ connection: { uri: DATABASE_URL } });

  // Check counts before
  const msgsBefore = await db.select({ count: sql`COUNT(*)` }).from(guestMessages);
  const tasksBefore = await db.select({ count: sql`COUNT(*)` }).from(tasks);
  console.log(`[Before] Messages: ${msgsBefore[0].count}, Tasks: ${tasksBefore[0].count}`);

  // Run full pipeline with a small batch
  console.log("[Test] Running full pipeline...");
  const start = Date.now();
  try {
    const result = await runGuestMessagePipeline();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[Test] Pipeline completed in ${elapsed}s:`, result);
  } catch (err) {
    console.error("[Test] Pipeline failed:", err.message);
    console.error(err.stack);
  }

  // Check counts after
  const msgsAfter = await db.select({ count: sql`COUNT(*)` }).from(guestMessages);
  const tasksAfter = await db.select({ count: sql`COUNT(*)` }).from(tasks);
  console.log(`[After] Messages: ${msgsAfter[0].count}, Tasks: ${tasksAfter[0].count}`);

  // Show analyzed messages
  const analyzed = await db.select({
    id: guestMessages.id,
    guestName: guestMessages.guestName,
    aiCategory: guestMessages.aiCategory,
    aiSentiment: guestMessages.aiSentiment,
    aiUrgency: guestMessages.aiUrgency,
    aiSummary: guestMessages.aiSummary,
    aiActionItems: guestMessages.aiActionItems,
    taskId: guestMessages.taskId,
    bodyPreview: sql`LEFT(${guestMessages.body}, 60)`,
  }).from(guestMessages).orderBy(desc(guestMessages.id)).limit(10);

  console.log("\n[Analyzed Messages]:");
  for (const m of analyzed) {
    console.log(`  #${m.id} ${m.guestName}: cat=${m.aiCategory} sent=${m.aiSentiment} urg=${m.aiUrgency} task=${m.taskId}`);
    if (m.aiSummary) console.log(`    Summary: ${m.aiSummary}`);
    if (m.aiActionItems?.length) console.log(`    Actions: ${m.aiActionItems.join("; ")}`);
  }

  // Show any new tasks
  const newTasks = await db.select().from(tasks).orderBy(desc(tasks.id)).limit(5);
  console.log("\n[Recent Tasks]:");
  for (const t of newTasks) {
    console.log(`  #${t.id} [${t.category}/${t.priority}] ${t.title}`);
    if (t.description) console.log(`    Desc: ${t.description.slice(0, 120)}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
