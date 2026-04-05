/**
 * Inspect a live Breezeway task response to see all available fields.
 * Run with: cd /home/ubuntu/wandai && npx tsx /tmp/inspect_bw_task.mjs
 */
import { createBreezewayClient } from "./server/breezeway.ts";
import { getBreezewayProperties } from "./server/db.ts";

const client = createBreezewayClient();
const properties = await getBreezewayProperties();
const queryable = properties.filter(p => p.referencePropertyId);

console.log(`[Test] Checking ${queryable.length} queryable properties for tasks...`);

let found = false;
for (const prop of queryable) {
  if (found) break;
  try {
    const response = await client.get("/task/", {
      reference_property_id: prop.referencePropertyId,
      assignee_ids: 344977,
      limit: 5,
      page: 1,
    });
    const tasks = response?.results || [];
    if (tasks.length > 0) {
      console.log(`[Test] Found ${tasks.length} tasks for property ${prop.name}`);
      console.log("[Test] Full first task response:");
      console.log(JSON.stringify(tasks[0], null, 2));
      found = true;
    }
  } catch (err) {
    // skip
  }
}

if (!found) {
  console.log("[Test] No tasks found across all properties");
}
