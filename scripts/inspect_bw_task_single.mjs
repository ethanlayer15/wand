/**
 * Inspect a single Breezeway task by ID to see all available fields.
 * Run with: cd /home/ubuntu/wandai && npx tsx inspect_bw_task_single.mjs
 */
import { createBreezewayClient } from "./server/breezeway.ts";

const client = createBreezewayClient();

// Use a known task ID from the database
const taskId = "117131943"; // HVAC Ductwork

try {
  // Try different URL patterns
  const task = await client.get(`/task/${taskId}`);
  console.log("[Test] Full task response:");
  console.log(JSON.stringify(task, null, 2));
} catch (err) {
  console.error("[Test] Error:", err);
}
