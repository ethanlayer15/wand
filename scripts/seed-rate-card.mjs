/**
 * Seed Rate Card with Turnover Clean prices for 51 properties
 * from the 5STR Property Prices spreadsheet.
 * Uses fuzzy name matching against Breezeway properties in the DB.
 *
 * Schema: rateCard(id, propertyId varchar(128), propertyName varchar(256),
 *                  taskType varchar(128), amount decimal(10,2),
 *                  createdAt, updatedAt)
 * Note: propertyId is the integer DB id of breezewayProperties as a string
 */
import mysql from 'mysql2/promise';

// 40 WNC properties + 11 LYH properties = 51 total
// Prices in dollars (stored as decimal)
const SPREADSHEET_PROPERTIES = [
  // WNC (Western North Carolina) properties
  { name: "Modern Asheville Retreat with Firepit & Hot Tub", price: 175 },
  { name: "Laurel Creek Falls | Hot Tub, Theater & Fire Pit", price: 175 },
  { name: "Catawba Falls Retreat | Views, Hot Tub & Game Room", price: 175 },
  { name: "Kindling Cascades", price: 175 },
  { name: "Wyndhurst villas", price: 175 },
  { name: "Pennsylvania", price: 130 },
  { name: "Nothing Fancy BNB", price: 130 },
  { name: "Cozy Cottage on Perrymont", price: 130 },
  { name: "The Kimberly", price: 130 },
  { name: "Countryside", price: 130 },
  { name: "Little Friendswood", price: 130 },
  { name: "Abbey View", price: 130 },
  { name: "Mack's Retreat", price: 130 },
  { name: "Melinda STR", price: 130 },
  { name: "Combo 67/69 Flat Top", price: 175 },
  { name: "67 Flat Top", price: 130 },
  { name: "69 Flat Top", price: 130 },
  { name: "Shiner's Hideaway", price: 130 },
  { name: "Laurel House", price: 130 },
  { name: "Darin Kidd", price: 130 },
  { name: "Enterprise check out 11am", price: 130 },
  { name: "Broadway", price: 130 },
  { name: "Lawterdale (no pets)", price: 130 },
  { name: "Riceville", price: 130 },
  { name: "Friendswood", price: 130 },
  { name: "Portkey", price: 130 },
  { name: "Rushing Creek Retreat (NO PETS)", price: 175 },
  { name: "Riverwood Retreat", price: 175 },
  { name: "Pocket Change Candler", price: 130 },
  { name: "Bent Creek Luxury Cottage", price: 175 },
  { name: "Blue Ridge Luxury Cottage", price: 175 },
  { name: "Rosewood Luxury Cottage", price: 175 },
  { name: "Laurel Luxury Cottage", price: 175 },
  { name: "Rhododendron Luxury Cottage", price: 175 },
  { name: "Gaston Mountain", price: 130 },
  { name: "Needlewood Stay", price: 130 },
  { name: "Skyland", price: 130 },
  { name: "Treetop Towers", price: 175 },
  { name: "Borrowed Time (Boone)", price: 130 },
  { name: "Bear Claw", price: 130 },
  // LYH (Lynchburg) properties
  { name: "Lynchburg Lab", price: 130 },
  { name: "Florio (LB)", price: 130 },
  { name: "River Rest (LB)", price: 130 },
  { name: "The Kimble", price: 130 },
  { name: "Ceilidh Cottage", price: 130 },
  { name: "Rising Sun", price: 130 },
  { name: "Kimberly Ave (no pets)", price: 130 },
  { name: "Forest Lane", price: 130 },
  { name: "Dillingham (no pets)", price: 130 },
  { name: "Patriots (no pets)", price: 130 },
];

// Normalize a string for comparison
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Simple word overlap score
function wordOverlapScore(a, b) {
  const wordsA = new Set(normalize(a).split(' ').filter(w => w.length > 2));
  const wordsB = new Set(normalize(b).split(' ').filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return (2 * overlap) / (wordsA.size + wordsB.size);
}

// Find best matching Breezeway property
function findBestMatch(spreadsheetName, breezewayProperties) {
  let bestScore = 0;
  let bestMatch = null;

  const normSpreadsheet = normalize(spreadsheetName);

  for (const prop of breezewayProperties) {
    const normProp = normalize(prop.name);

    // Exact match
    if (normSpreadsheet === normProp) {
      return { match: prop, score: 1.0, type: 'exact' };
    }

    // Contains match
    if (normProp.includes(normSpreadsheet) || normSpreadsheet.includes(normProp)) {
      const score = 0.9;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { match: prop, score, type: 'contains' };
      }
    }

    // Word overlap
    const score = wordOverlapScore(spreadsheetName, prop.name);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { match: prop, score, type: 'fuzzy' };
    }
  }

  return bestMatch && bestScore >= 0.3 ? bestMatch : null;
}

const url = process.env.DATABASE_URL;
const match = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
const [, user, password, host, port, database] = match;

const conn = await mysql.createConnection({
  host, port: parseInt(port), user, password, database,
  ssl: { rejectUnauthorized: true }
});

// Fetch all Breezeway properties
const [breezewayProps] = await conn.execute("SELECT id, breezewayId, name FROM breezewayProperties ORDER BY name");
console.log(`Found ${breezewayProps.length} Breezeway properties in DB`);

// Check existing rate card entries
const [existingRates] = await conn.execute("SELECT * FROM rateCard WHERE taskType = 'turnover-clean'");
console.log(`Found ${existingRates.length} existing turnover-clean rate card entries`);

// Perform fuzzy matching
const results = [];
const unmatched = [];

// Deduplicate spreadsheet properties by name
const seen = new Set();
const uniqueProps = SPREADSHEET_PROPERTIES.filter(p => {
  if (seen.has(p.name)) return false;
  seen.add(p.name);
  return true;
});

console.log(`\nProcessing ${uniqueProps.length} unique properties from spreadsheet...`);

for (const prop of uniqueProps) {
  const matchResult = findBestMatch(prop.name, breezewayProps);
  if (matchResult) {
    results.push({
      spreadsheetName: prop.name,
      breezewayDbId: String(matchResult.match.id), // propertyId is varchar in schema
      breezewayName: matchResult.match.name,
      price: prop.price,
      score: matchResult.score,
      type: matchResult.type,
    });
    console.log(`✓ [${matchResult.type.toUpperCase()} ${(matchResult.score * 100).toFixed(0)}%] "${prop.name}" → "${matchResult.match.name}" @ $${prop.price}`);
  } else {
    unmatched.push(prop);
    console.log(`✗ NO MATCH: "${prop.name}" @ $${prop.price}`);
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`Matched: ${results.length}`);
console.log(`Unmatched: ${unmatched.length}`);

if (unmatched.length > 0) {
  console.log('\nUnmatched properties:');
  unmatched.forEach(p => console.log(`  - "${p.name}" @ $${p.price}`));
}

// Insert rate card entries
console.log('\n=== INSERTING RATE CARD ENTRIES ===');
let inserted = 0;
let updated = 0;

for (const result of results) {
  // Check if entry already exists
  const [existing] = await conn.execute(
    "SELECT id FROM rateCard WHERE propertyId = ? AND taskType = 'turnover-clean'",
    [result.breezewayDbId]
  );

  if (existing.length > 0) {
    // Update existing entry
    await conn.execute(
      "UPDATE rateCard SET amount = ?, propertyName = ?, updatedAt = NOW() WHERE propertyId = ? AND taskType = 'turnover-clean'",
      [result.price, result.breezewayName, result.breezewayDbId]
    );
    console.log(`↺ Updated: "${result.breezewayName}" → $${result.price}`);
    updated++;
  } else {
    // Insert new entry
    await conn.execute(
      "INSERT INTO rateCard (propertyId, propertyName, taskType, amount, createdAt, updatedAt) VALUES (?, ?, 'turnover-clean', ?, NOW(), NOW())",
      [result.breezewayDbId, result.breezewayName, result.price]
    );
    console.log(`+ Inserted: "${result.breezewayName}" → $${result.price}`);
    inserted++;
  }
}

// Insert unmatched properties with empty propertyId but with propertyName for manual linking
for (const prop of unmatched) {
  const [existing] = await conn.execute(
    "SELECT id FROM rateCard WHERE propertyName = ? AND taskType = 'turnover-clean'",
    [prop.name]
  );

  if (existing.length === 0) {
    await conn.execute(
      "INSERT INTO rateCard (propertyId, propertyName, taskType, amount, createdAt, updatedAt) VALUES ('', ?, 'turnover-clean', ?, NOW(), NOW())",
      [prop.name, prop.price]
    );
    console.log(`+ Inserted (unmatched): "${prop.name}" → $${prop.price}`);
    inserted++;
  }
}

console.log(`\n=== DONE ===`);
console.log(`Inserted: ${inserted}, Updated: ${updated}`);

// Verify
const [finalRates] = await conn.execute(
  "SELECT rc.id, rc.propertyId, rc.propertyName, rc.amount, bp.name as breezewayName FROM rateCard rc LEFT JOIN breezewayProperties bp ON rc.propertyId = CAST(bp.id AS CHAR) WHERE rc.taskType = 'turnover-clean' ORDER BY COALESCE(bp.name, rc.propertyName)"
);
console.log(`\nFinal rate card entries (turnover-clean): ${finalRates.length}`);
finalRates.forEach(r => {
  const name = r.breezewayName || r.propertyName;
  const linked = r.propertyId && r.propertyId !== '' ? '✓' : '?';
  console.log(`  ${linked} [${r.propertyId || 'unlinked'}] "${name}" → $${parseFloat(r.amount).toFixed(0)}`);
});

await conn.end();
