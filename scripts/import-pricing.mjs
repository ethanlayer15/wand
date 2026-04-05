#!/usr/bin/env node

/**
 * Import turnover clean pricing from CSV with fuzzy matching to Breezeway properties.
 * Usage: pnpm import-pricing /path/to/pricing_data.csv
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import { URL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fuzzy matching utilities
const STOP_WORDS = new Set([
  "the", "and", "llc", "inc", "co", "corp", "ltd", "at", "of", "in", "on",
  "for", "a", "an", "no", "pets", "new", "unit", "all", "check", "out",
  "am", "pm", "str", "bnb",
]);

function normalise(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(s) {
  return normalise(s)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function tokenDice(a, b) {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let overlap = 0;
  for (const w of a) {
    if (setB.has(w)) overlap++;
  }
  return (2 * overlap) / (a.length + b.length);
}

function bigrams(s) {
  const norm = normalise(s);
  const bg = new Set();
  for (let i = 0; i < norm.length - 1; i++) {
    bg.add(norm.slice(i, i + 2));
  }
  return bg;
}

function bigramDice(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  Array.from(a).forEach((bg) => {
    if (b.has(bg)) overlap++;
  });
  return (2 * overlap) / (a.size + b.size);
}

function matchScore(bwName, scName) {
  const normBw = normalise(bwName);
  const normSc = normalise(scName);

  if (normBw === normSc) return 1.0;

  if (normBw.length >= 3 && normSc.length >= 3) {
    if (normSc.includes(normBw) || normBw.includes(normSc)) return 0.85;
  }

  const tokBw = significantTokens(bwName);
  const tokSc = significantTokens(scName);
  const tScore = tokenDice(tokBw, tokSc);
  const bScore = bigramDice(bigrams(bwName), bigrams(scName));

  return 0.6 * tScore + 0.4 * bScore;
}

// Parse CSV
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  
  if (lines.length < 2) {
    throw new Error("CSV file must have at least a header and one data row");
  }

  const header = lines[0].split(",").map((h) => h.trim());
  const propertyIdx = header.indexOf("Property");
  const totalIdx = header.indexOf("total");

  if (propertyIdx === -1 || totalIdx === -1) {
    throw new Error("CSV must have 'Property' and 'total' columns");
  }

  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",").map((p) => p.trim());
    const propertyName = parts[propertyIdx];
    const totalStr = parts[totalIdx];

    if (!propertyName || !totalStr) continue;

    // Parse total (strip $ and commas)
    const total = parseFloat(totalStr.replace(/[$,]/g, ""));
    if (isNaN(total)) continue;

    // Handle grouped properties (slash-separated)
    const names = propertyName.split("/").map((n) => n.trim()).filter(Boolean);
    for (const name of names) {
      entries.push({ name, total });
    }
  }

  return entries;
}

// Parse DATABASE_URL
function parseDatabaseUrl(dbUrl) {
  const url = new URL(dbUrl);
  const sslParam = url.searchParams.get("ssl");
  
  return {
    host: url.hostname,
    port: parseInt(url.port || "3306"),
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl: sslParam ? JSON.parse(sslParam) : true,
  };
}

// Main
async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: pnpm import-pricing /path/to/pricing_data.csv");
    process.exit(1);
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  // Parse CSV
  console.log(`📖 Parsing CSV: ${csvPath}`);
  const pricingEntries = parseCSV(csvPath);
  console.log(`✓ Found ${pricingEntries.length} pricing entries`);

  // Parse DATABASE_URL
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ DATABASE_URL environment variable not set");
    process.exit(1);
  }

  const dbConfig = parseDatabaseUrl(dbUrl);

  // Connect to database
  console.log(`\n🔌 Connecting to ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}...`);
  const connection = await mysql.createConnection(dbConfig);
  console.log("✓ Connected");

  try {
    // Fetch Breezeway properties
    console.log("\n🔍 Fetching Breezeway properties from database...");
    const [properties] = await connection.execute(
      "SELECT breezewayId, name FROM breezewayProperties WHERE status = 'active' ORDER BY name"
    );
    console.log(`✓ Found ${properties.length} Breezeway properties`);

    // Fuzzy match and seed rate_card
    console.log("\n🎯 Fuzzy matching pricing to properties...");
    const matched = [];
    const unmatched = [];

    for (const entry of pricingEntries) {
      let bestScore = 0;
      let bestProperty = null;

      for (const prop of properties) {
        const score = matchScore(entry.name, prop.name);
        if (score > bestScore) {
          bestScore = score;
          bestProperty = prop;
        }
      }

      if (bestScore >= 0.7 && bestProperty) {
        // High confidence match
        matched.push({
          csvName: entry.name,
          propertyId: bestProperty.breezewayId,
          propertyName: bestProperty.name,
          price: entry.total,
          score: Math.round(bestScore * 100),
          confidence: "high",
        });
      } else if (bestScore >= 0.4 && bestProperty) {
        // Possible match
        matched.push({
          csvName: entry.name,
          propertyId: bestProperty.breezewayId,
          propertyName: bestProperty.name,
          price: entry.total,
          score: Math.round(bestScore * 100),
          confidence: "possible",
        });
      } else {
        // No match
        unmatched.push({
          csvName: entry.name,
          price: entry.total,
          bestScore: bestScore > 0 ? Math.round(bestScore * 100) : 0,
        });
      }
    }

    console.log(`✓ High confidence: ${matched.filter((m) => m.confidence === "high").length}`);
    console.log(`✓ Possible: ${matched.filter((m) => m.confidence === "possible").length}`);
    console.log(`✗ Unmatched: ${unmatched.length}`);

    // Insert into rate_card
    console.log("\n💾 Seeding rate_card table...");
    let inserted = 0;
    for (const match of matched) {
      await connection.execute(
        `INSERT INTO rateCard (propertyId, propertyName, taskType, amount)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE amount = VALUES(amount)`,
        [match.propertyId, match.propertyName, "turnover-clean", match.price]
      );
      inserted++;
    }
    console.log(`✓ Inserted/updated ${inserted} rate cards`);

    // Report results
    console.log("\n📊 IMPORT SUMMARY");
    console.log("═".repeat(60));
    console.log(`Total CSV entries: ${pricingEntries.length}`);
    console.log(`Matched (high): ${matched.filter((m) => m.confidence === "high").length}`);
    console.log(`Matched (possible): ${matched.filter((m) => m.confidence === "possible").length}`);
    console.log(`Unmatched: ${unmatched.length}`);

    if (unmatched.length > 0) {
      console.log("\n⚠️  UNMATCHED PROPERTIES (manual review needed):");
      console.log("─".repeat(60));
      for (const um of unmatched) {
        console.log(`  • "${um.csvName}" ($${um.price}) — best score: ${um.bestScore}%`);
      }
    }

    if (matched.filter((m) => m.confidence === "possible").length > 0) {
      console.log("\n⚠️  POSSIBLE MATCHES (verify these):");
      console.log("─".repeat(60));
      for (const m of matched.filter((m) => m.confidence === "possible")) {
        console.log(`  • CSV: "${m.csvName}" → Breezeway: "${m.propertyName}" (${m.score}% match)`);
      }
    }

    console.log("\n✅ Import complete!");
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
