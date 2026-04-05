/**
 * Update existing rate cards with match confidence data
 * and add unmatched CSV entries for manual assignment.
 */
import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";
import { parse } from "csv-parse/sync";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node update-ratecard-confidence.mjs <csv-path>");
  process.exit(1);
}

function normalise(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

function matchScore(a, b) {
  const na = normalise(a);
  const nb = normalise(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  // Levenshtein-based similarity
  const len = Math.max(na.length, nb.length);
  if (len === 0) return 0;
  const dp = Array.from({ length: na.length + 1 }, (_, i) =>
    Array.from({ length: nb.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= na.length; i++) {
    for (let j = 1; j <= nb.length; j++) {
      dp[i][j] = na[i - 1] === nb[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - dp[na.length][nb.length] / len;
}

async function main() {
  const csvContent = readFileSync(csvPath, "utf-8");
  const rows = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });

  // Parse CSV entries
  const pricingEntries = [];
  for (const row of rows) {
    const name = row["property"] || row["Property"] || "";
    const totalStr = row["total"] || row["Total"] || "0";
    const total = parseFloat(totalStr.replace(/[$,]/g, "")) || 0;
    if (!name || total <= 0) continue;
    // Handle grouped properties (slash-separated)
    const names = name.split("/").map((n) => n.trim()).filter(Boolean);
    for (const n of names) {
      pricingEntries.push({ name: n, total });
    }
  }

  const url = new URL(DATABASE_URL);
  const connection = await createConnection({
    host: url.hostname,
    port: parseInt(url.port || "3306"),
    user: url.username,
    password: url.password,
    database: url.pathname.replace("/", ""),
    ssl: { rejectUnauthorized: false },
  });

  // Get Breezeway properties from DB
  const [properties] = await connection.execute("SELECT * FROM breezewayProperties");
  console.log(`Found ${properties.length} Breezeway properties`);

  // Get existing rate cards
  const [existingCards] = await connection.execute("SELECT * FROM rateCard");
  console.log(`Found ${existingCards.length} existing rate cards`);

  let updated = 0;
  let addedUnmatched = 0;

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

    const scorePercent = Math.round(bestScore * 100);

    if (bestScore >= 0.6 && bestProperty) {
      // High confidence - update existing card
      const confidence = "high";
      await connection.execute(
        `UPDATE rateCard SET csvName = ?, matchConfidence = ?, matchScore = ? WHERE propertyId = ? AND taskType = 'turnover-clean'`,
        [entry.name, confidence, scorePercent, bestProperty.breezewayId]
      );
      updated++;
    } else if (bestScore >= 0.4 && bestProperty) {
      // Possible match - update existing card
      const confidence = "possible";
      await connection.execute(
        `UPDATE rateCard SET csvName = ?, matchConfidence = ?, matchScore = ? WHERE propertyId = ? AND taskType = 'turnover-clean'`,
        [entry.name, confidence, scorePercent, bestProperty.breezewayId]
      );
      updated++;
    } else {
      // Unmatched - add as new entry with empty propertyId placeholder
      // Check if already exists
      const [existing] = await connection.execute(
        `SELECT id FROM rateCard WHERE csvName = ? AND matchConfidence = 'unmatched'`,
        [entry.name]
      );
      if (existing.length === 0) {
        await connection.execute(
          `INSERT INTO rateCard (propertyId, propertyName, csvName, matchConfidence, matchScore, taskType, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ["unmatched", entry.name, entry.name, "unmatched", bestScore > 0 ? scorePercent : 0, "turnover-clean", entry.total]
        );
        addedUnmatched++;
      }
    }
  }

  console.log(`Updated ${updated} existing rate cards with confidence data`);
  console.log(`Added ${addedUnmatched} unmatched entries`);

  // Show summary
  const [summary] = await connection.execute(
    `SELECT matchConfidence, COUNT(*) as cnt FROM rateCard GROUP BY matchConfidence`
  );
  console.log("\nRate card summary:");
  for (const row of summary) {
    console.log(`  ${row.matchConfidence || "no-confidence"}: ${row.cnt}`);
  }

  await connection.end();
}

main().catch(console.error);
