/**
 * Apply confirmed cleaning fee matches to the Wand database.
 * Run with: node scripts/apply_cleaning_fees.mjs
 */
import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env
const envPath = join(__dirname, "../.env");
let DATABASE_URL;
try {
  const env = readFileSync(envPath, "utf8");
  const match = env.match(/^DATABASE_URL=(.+)$/m);
  if (match) DATABASE_URL = match[1].trim().replace(/^["']|["']$/g, "");
} catch {}
if (!DATABASE_URL) DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not found");

const conn = await mysql.createConnection(DATABASE_URL);

async function findByExactName(name) {
  const [rows] = await conn.execute(
    "SELECT id, internalName, name, city, state FROM listings WHERE status = 'active' AND (internalName = ? OR name = ?)",
    [name, name]
  );
  return rows[0] ?? null;
}

async function findByPartialName(partial) {
  const [rows] = await conn.execute(
    "SELECT id, internalName, name, city, state FROM listings WHERE status = 'active' AND (internalName LIKE ? OR name LIKE ?)",
    [`%${partial}%`, `%${partial}%`]
  );
  return rows;
}

async function setFee(id, fee, label) {
  await conn.execute("UPDATE listings SET cleaningFeeCharge = ? WHERE id = ?", [String(fee), id]);
  console.log(`  ✓ $${fee} → ${label} (id=${id})`);
}

let applied = 0;
let skipped = 0;

console.log("=== Applying confirmed cleaning fee matches ===\n");

// All confirmed matches: [name, fee]
const matches = [
  // WNC properties
  ["Countryside", 270],
  ["Treetop Towers Near Grove Park Inn", 440],
  ["Hickory Hills", 330],
  ["Japandi", 85],
  ["Longview", 185],
  ["Luck's Lookout", 295],
  ["Nine Peaks", 325],
  ["North Shore Lakehouse", 295],
  ["Rushing Creek Retreat", 165],
  ["Saddle Hills Unit 1 (2BR)", 125],
  ["Saddle Hills Unit 2 (2BR)", 125],
  ["Saddle Hills Unit 3 (3BR)", 180],
  ["Saddle Hills (combo listing)", 430],
  ["The Great Escape", 85],
  ["Cast Away", 85],
  ["Streams & Dreams", 85],
  ["All Tuckered Out", 85],
  ["Tucked Away", 85],
  ["The Kimble", 75],
  ["Breezy", 75],
  ["Florio", 75],
  ["River Run", 75],
  ["River Rest", 75],
  ["Tiny Bearadise", 95],
  ["Whistler Retreat", 155],
  ["Borrowed Time", 320],
  ["Ceilidh Cottage", 330],
  ["Crashing Creek Cabin", 185],
  ["The Evergreen", 80],
  ["The Locust", 80],
  ["The Twig", 80],
  ["Portkey", 95],
  ["The Fern", 95],
  ["The Friendswood", 230],
  ["Little Friendswood", 210],
  ["Pennsylvania", 250],
  ["Kamp Wildkat", 255],
  ["The Peach Perch", 70],
  ["Kimberly", 140],
  ["Glamping Dome", 140],
  ["Majestic", 360],
  ["Glenna", 210],
  ["Brownstone Escape", 260],
  ["Laurel House", 395],
  ["Blue Haven Retreat", 270],
  ["Mountain View 534 A", 150],
  ["Mountain View 534 B", 150],
  ["Mountain View 534 C", 150],
  ["Mountain View 534 D", 150],
  // LYH properties
  ["Riverwood Retreat", 290],
  ["Golden Jewel", 225],
  ["Harbor Ridge Retreat", 225],
  ["Quaint Cottage", 140],
  ["Commerce Loft", 150],
  ["Hideaway Haven", 280],
  ["Redwing Farm Cottage", 165],
  ["Perrymont", 115],
  // User-confirmed matches
  ["Adventure Awaits LKJ", 395],
  ["The Wyndsong", 195],
  ["The Madison", 175],
  // Writer's Retreat (curly apostrophe handled below)
  ["Writer\u2019s Retreat", 110],
];

// Also try Daltun's Ranch with both apostrophe variants
const daltunVariants = ["Daltun's Ranch", "Daltun\u2019s Ranch", "Daltuns Ranch"];

for (const [name, fee] of matches) {
  const prop = await findByExactName(name);
  if (prop) {
    await setFee(prop.id, fee, `${prop.internalName || prop.name} (${prop.city}, ${prop.state})`);
    applied++;
  } else {
    console.log(`  ✗ NOT FOUND: "${name}"`);
    skipped++;
  }
}

// Mack's Retreat — curly apostrophe
const mackRows = await findByPartialName("Mack");
const mack = mackRows.find(r => (r.internalName || r.name).toLowerCase().includes("retreat"));
if (mack) {
  await setFee(mack.id, 230, `${mack.internalName || mack.name} (${mack.city})`);
  applied++;
} else {
  console.log("  ✗ NOT FOUND: Mack's Retreat");
  skipped++;
}

// Daltun's Ranch — try variants
let daltunFound = false;
for (const variant of daltunVariants) {
  const prop = await findByExactName(variant);
  if (prop) {
    await setFee(prop.id, 250, `${prop.internalName || prop.name} (${prop.city})`);
    applied++;
    daltunFound = true;
    break;
  }
}
if (!daltunFound) {
  const rows = await findByPartialName("Daltun");
  if (rows.length > 0) {
    await setFee(rows[0].id, 250, `${rows[0].internalName || rows[0].name} (${rows[0].city})`);
    applied++;
  } else {
    console.log("  ✗ NOT FOUND: Daltun's Ranch");
    skipped++;
  }
}

// Madison Ave ($260) — search for it
console.log("\n--- Searching for Madison Ave ($260) ---");
const madisonAveRows = await findByPartialName("Madison Ave");
if (madisonAveRows.length > 0) {
  for (const r of madisonAveRows) {
    console.log(`  Found: "${r.internalName || r.name}" (${r.city}, ${r.state}) id=${r.id}`);
    await setFee(r.id, 260, `${r.internalName || r.name}`);
    applied++;
  }
} else {
  console.log("  → SKIPPED: 'Madison Ave' ($260) — not found in DB");
  skipped++;
}

// 513 Laurel / The Nest at Valley Overlook ($270)
console.log("\n--- Searching for The Nest at Valley Overlook / 513 Laurel ($270) ---");
const nestRows = await findByPartialName("Valley Overlook");
const nestRows2 = await findByPartialName("Nest at");
const allNest = [...nestRows, ...nestRows2];
if (allNest.length > 0) {
  const r = allNest[0];
  console.log(`  Found: "${r.internalName || r.name}" (${r.city}, ${r.state}) id=${r.id}`);
  await setFee(r.id, 270, `${r.internalName || r.name}`);
  applied++;
} else {
  console.log("  → SKIPPED: Not yet in Wand DB");
  skipped++;
}

await conn.end();

console.log(`\n=== DONE ===`);
console.log(`Applied: ${applied} | Skipped/not found: ${skipped}`);
