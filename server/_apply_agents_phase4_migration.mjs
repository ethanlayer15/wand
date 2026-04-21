import mysql from "mysql2/promise";
import fs from "node:fs";

/**
 * Apply Phase 4 migration to the Wand DB.
 *
 * Same statement-at-a-time pattern as Phase 1 — TiDB's multi-statement
 * schema-change lag can make CREATE TABLE + follow-up reads race. Skips
 * "already exists" errors so the script is safely re-runnable.
 */

const url = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port),
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: false },
  multipleStatements: false,
});

const raw = fs.readFileSync(
  new URL("../drizzle/migrations/0005_phase4_routing.sql", import.meta.url),
  "utf8"
);

const stripped = raw
  .split("\n")
  .map((line) => (line.trimStart().startsWith("--") ? "" : line))
  .join("\n");

const statements = stripped
  .split(/;[ \t]*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log(`Parsed ${statements.length} statements.\n`);

const SKIP_CODES = new Set([
  "ER_DUP_FIELDNAME",
  "ER_TABLE_EXISTS_ERROR",
  "ER_DUP_KEYNAME",
  "ER_DUP_ENTRY",
]);

let applied = 0;
let skipped = 0;
for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  const preview = stmt.slice(0, 80).replace(/\s+/g, " ");
  try {
    await conn.query(stmt);
    applied++;
    console.log(`  ✓ [${i + 1}/${statements.length}] ${preview}…`);
  } catch (err) {
    if (SKIP_CODES.has(err.code)) {
      skipped++;
      console.log(`  ⏭  [${i + 1}/${statements.length}] ${err.code}: ${err.sqlMessage}`);
    } else {
      console.error(`\n❌ [${i + 1}/${statements.length}] Statement failed:`);
      console.error(stmt);
      console.error("\nError:", err.code, err.sqlMessage);
      throw err;
    }
  }
}

console.log(`\n✅ Applied ${applied}, skipped ${skipped}.\n`);

const [cols] = await conn.query(
  `SHOW COLUMNS FROM escalationGroupDms`
);
console.log("escalationGroupDms columns:");
for (const c of cols) console.log(`  ${c.Field.padEnd(22)} ${c.Type}`);

await conn.end();
