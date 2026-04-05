/**
 * Backfill breezewayCreatedAt for all existing Breezeway tasks.
 * Reads breezewayTaskId from the tasks table, fetches each task from
 * the Breezeway API, and writes the created_at value back.
 *
 * Usage: node scripts/backfill_breezeway_created_at.mjs
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

if (!DB_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// ── Breezeway auth ──────────────────────────────────────────────────────────

async function getBWToken() {
  const res = await fetch("https://api.breezeway.io/public/auth/v1/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: BW_CLIENT_ID, client_secret: BW_CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`BW auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function fetchBWTask(token, taskId) {
  const res = await fetch(`https://api.breezeway.io/public/inventory/v1/task/${taskId}/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BW task fetch failed for ${taskId}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Main ────────────────────────────────────────────────────────────────────

const conn = await mysql.createConnection(DB_URL);

// Get all Breezeway tasks that don't yet have breezewayCreatedAt
const [rows] = await conn.execute(
  "SELECT id, breezewayTaskId FROM tasks WHERE source = 'breezeway' AND breezewayTaskId IS NOT NULL AND breezewayCreatedAt IS NULL"
);

console.log(`Found ${rows.length} tasks needing breezewayCreatedAt backfill`);

if (rows.length === 0) {
  console.log("Nothing to backfill.");
  await conn.end();
  process.exit(0);
}

let token = await getBWToken();
let updated = 0;
let skipped = 0;
let errors = 0;
let tokenRefreshAt = Date.now() + 20 * 60 * 1000; // refresh every 20 min

for (const row of rows) {
  try {
    // Refresh token periodically
    if (Date.now() > tokenRefreshAt) {
      token = await getBWToken();
      tokenRefreshAt = Date.now() + 20 * 60 * 1000;
      console.log("Token refreshed");
    }

    const bwTask = await fetchBWTask(token, row.breezewayTaskId);
    if (!bwTask) {
      console.log(`  Task ${row.breezewayTaskId} not found in BW (skipping)`);
      skipped++;
      continue;
    }

    const createdAt = bwTask.created_at;
    if (!createdAt) {
      console.log(`  Task ${row.breezewayTaskId} has no created_at in BW (skipping)`);
      skipped++;
      continue;
    }

    const createdAtDate = new Date(createdAt);
    await conn.execute(
      "UPDATE tasks SET breezewayCreatedAt = ? WHERE id = ?",
      [createdAtDate, row.id]
    );
    updated++;

    if (updated % 10 === 0) {
      console.log(`  Progress: ${updated} updated, ${skipped} skipped, ${errors} errors`);
    }

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 150));
  } catch (err) {
    console.error(`  Error processing task ${row.breezewayTaskId}:`, err.message);
    errors++;
    // If rate limited, wait longer
    if (err.message.includes("429")) {
      console.log("  Rate limited — waiting 30s...");
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
}

await conn.end();
console.log(`\nBackfill complete: ${updated} updated, ${skipped} skipped, ${errors} errors`);
