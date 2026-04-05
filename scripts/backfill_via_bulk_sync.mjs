/**
 * Backfill breezewayCreatedAt using the same bulk property-based fetch
 * that the sync engine uses. This fetches all tasks per property and
 * writes created_at back to the DB for any task that doesn't have it yet.
 *
 * Usage: node scripts/backfill_via_bulk_sync.mjs
 */

import { createRequire } from "module";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "../.env") });

const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

const DB_URL = process.env.DATABASE_URL;
const BW_CLIENT_ID = process.env.BREEZEWAY_CLIENT_ID;
const BW_CLIENT_SECRET = process.env.BREEZEWAY_CLIENT_SECRET;

if (!DB_URL || !BW_CLIENT_ID || !BW_CLIENT_SECRET) {
  console.error("Missing required env vars: DATABASE_URL, BREEZEWAY_CLIENT_ID, BREEZEWAY_CLIENT_SECRET");
  process.exit(1);
}

const BW_BASE = "https://api.breezeway.io/public/inventory/v1";

// ── Auth ────────────────────────────────────────────────────────────────────

let accessToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  const res = await fetch("https://api.breezeway.io/public/auth/v1/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: BW_CLIENT_ID, client_secret: BW_CLIENT_SECRET }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) {
      const retry = JSON.parse(text)?.details?.retry_after;
      const waitMs = retry ? new Date(retry).getTime() - Date.now() + 2000 : 30000;
      console.log(`Rate limited on auth. Waiting ${Math.ceil(waitMs / 1000)}s...`);
      await new Promise(r => setTimeout(r, waitMs));
      return getToken();
    }
    throw new Error(`BW auth failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 86400) * 1000 - 60000;
  return accessToken;
}

async function bwGet(path, params = {}) {
  const token = await getToken();
  const url = new URL(`${BW_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  let attempts = 0;
  while (true) {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      const text = await res.text();
      let waitMs = 30000;
      try { waitMs = new Date(JSON.parse(text)?.details?.retry_after).getTime() - Date.now() + 2000; } catch {}
      console.log(`  Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s...`);
      await new Promise(r => setTimeout(r, Math.max(waitMs, 5000)));
      attempts++;
      if (attempts > 5) throw new Error("Too many rate limit retries");
      continue;
    }
    if (!res.ok) throw new Error(`BW GET ${path} failed: ${res.status}`);
    return res.json();
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const conn = await mysql.createConnection(DB_URL);

// Load all Breezeway properties with a referencePropertyId
const [properties] = await conn.execute(
  "SELECT breezewayId, referencePropertyId, name FROM breezewayProperties WHERE referencePropertyId IS NOT NULL"
);
console.log(`Found ${properties.length} queryable Breezeway properties`);

// Load the assignee ID from sync config (stored in JSON config column)
const [configRows] = await conn.execute(
  "SELECT JSON_UNQUOTE(JSON_EXTRACT(config, '$.leisrStaysAssigneeId')) AS assigneeId FROM integrations WHERE name = 'breezeway' LIMIT 1"
);
const assigneeId = configRows[0]?.assigneeId;
if (!assigneeId) {
  console.error("No Leisr Stays assignee ID found in integrations table");
  process.exit(1);
}
console.log(`Using assignee ID: ${assigneeId}`);

// Build a map of breezewayTaskId → DB task id for tasks missing breezewayCreatedAt
const [missingRows] = await conn.execute(
  "SELECT id, breezewayTaskId FROM tasks WHERE source = 'breezeway' AND breezewayTaskId IS NOT NULL AND breezewayCreatedAt IS NULL"
);
const missingMap = new Map(missingRows.map(r => [String(r.breezewayTaskId), r.id]));
console.log(`${missingMap.size} tasks need breezewayCreatedAt backfill`);

if (missingMap.size === 0) {
  console.log("Nothing to backfill.");
  await conn.end();
  process.exit(0);
}

let updated = 0;
let propertyErrors = 0;

for (const prop of properties) {
  try {
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const data = await bwGet("/task/", {
        reference_property_id: prop.referencePropertyId,
        assignee_ids: assigneeId,
        limit: 100,
        page,
      });
      const tasks = data.results || [];
      for (const t of tasks) {
        const taskId = String(t.id);
        if (missingMap.has(taskId) && t.created_at) {
          const dbId = missingMap.get(taskId);
          await conn.execute(
            "UPDATE tasks SET breezewayCreatedAt = ? WHERE id = ?",
            [new Date(t.created_at), dbId]
          );
          missingMap.delete(taskId);
          updated++;
        }
      }
      hasMore = tasks.length > 0 && page < (data.total_pages || 1);
      page++;
      // Small delay between pages
      if (hasMore) await new Promise(r => setTimeout(r, 200));
    }
    // Small delay between properties
    await new Promise(r => setTimeout(r, 300));
  } catch (err) {
    console.error(`  Error for property ${prop.name}: ${err.message}`);
    propertyErrors++;
  }
}

await conn.end();
console.log(`\nBackfill complete: ${updated} updated, ${missingMap.size} still missing (not in BW anymore), ${propertyErrors} property errors`);
if (missingMap.size > 0) {
  console.log("Tasks not found in BW (likely deleted/archived there) — will use Wand createdAt as fallback for those.");
}
