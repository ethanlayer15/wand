/**
 * Backfill property tags from Breezeway API into the breezewayProperties table.
 * Uses the cached token from the breezewayTokens table to avoid re-auth rate limits.
 * Run: node backfill-tags.mjs
 */
import mysql from "mysql2/promise";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Missing required env var: DATABASE_URL");
  process.exit(1);
}

const conn = await mysql.createConnection(DB_URL);

async function bwGet(token, path) {
  const resp = await fetch(`https://api.breezeway.io/public/inventory/v1${path}`, {
    headers: { Authorization: `JWT ${token}` },
  });
  if (resp.status === 404) return null; // No tags for this property
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Breezeway GET ${path} failed: ${resp.status} ${body}`);
  }
  return resp.json();
}

try {
  // Get the cached access token from the DB
  const [tokenRows] = await conn.execute(
    "SELECT accessToken, expiresAt FROM breezewayTokens ORDER BY id DESC LIMIT 1"
  );
  
  if (!tokenRows.length) {
    console.error("No cached Breezeway token found in DB. Wait for server to authenticate first.");
    process.exit(1);
  }
  
  const { accessToken, expiresAt } = tokenRows[0];
  const now = new Date();
  const expiry = new Date(expiresAt);
  
  console.log(`Using cached token (expires: ${expiry.toISOString()})`);
  
  if (expiry <= now) {
    console.error("Cached token is expired. Wait for server to refresh it.");
    process.exit(1);
  }
  
  // Get all properties from DB
  const [rows] = await conn.execute("SELECT id, breezewayId, name FROM breezewayProperties");
  console.log(`Found ${rows.length} properties in DB`);

  let updated = 0;
  let errors = 0;
  let noTags = 0;
  let withTags = 0;

  for (const row of rows) {
    try {
      // Fetch tags for this property from Breezeway
      let tags = [];
      const tagsData = await bwGet(accessToken, `/property/${row.breezewayId}/tags`);
      if (tagsData && Array.isArray(tagsData)) {
        tags = tagsData.map((t) => t.name).filter(Boolean);
      }

      if (tags.length === 0) {
        noTags++;
      } else {
        withTags++;
        console.log(`  ${row.name}: [${tags.join(", ")}]`);
      }

      await conn.execute(
        "UPDATE breezewayProperties SET tags = ? WHERE id = ?",
        [JSON.stringify(tags), row.id]
      );
      updated++;

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      if (err.message.includes("429")) {
        console.error(`  Rate limited! Stopping. ${updated} updated so far.`);
        break;
      }
      console.error(`  Error for ${row.name} (${row.breezewayId}):`, err.message);
      errors++;
    }
  }

  console.log(`\nDone: ${updated} updated, ${withTags} with tags, ${noTags} with no tags, ${errors} errors`);

  // Show distinct tags
  const [tagRows] = await conn.execute(
    "SELECT DISTINCT tags FROM breezewayProperties WHERE tags IS NOT NULL AND tags != '[]'"
  );
  const allTags = new Set();
  for (const r of tagRows) {
    try {
      JSON.parse(r.tags).forEach((t) => allTags.add(t));
    } catch {}
  }
  console.log(`\nDistinct tags found (${allTags.size}): ${Array.from(allTags).sort().join(", ") || "(none)"}`);
} finally {
  await conn.end();
}
