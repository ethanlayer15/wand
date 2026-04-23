/**
 * One-off applier for 0005_onboarding.sql
 * Pattern matches server/_apply_agents_phase1_migration.mjs.
 *
 *   node --env-file=.env server/_apply_onboarding_migration.mjs
 */
import mysql from "mysql2/promise";
import fs from "node:fs";

const url = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port),
  user: url.username,
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  ssl: url.hostname === "localhost" ? undefined : { rejectUnauthorized: false },
  multipleStatements: true,
});

const rawSql = fs
  .readFileSync(
    new URL("../drizzle/migrations/0005_onboarding.sql", import.meta.url),
    "utf8",
  )
  .replace(/-->\s*statement-breakpoint/g, "");

// Strip line-leading SQL comments before splitting so chunks don't get
// filtered out as "comment-only".
const sql = rawSql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const statements = sql
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

let applied = 0;
let skipped = 0;
for (const stmt of statements) {
  try {
    await conn.query(stmt);
    applied++;
  } catch (err) {
    if (
      err.code === "ER_DUP_FIELDNAME" ||
      err.code === "ER_TABLE_EXISTS_ERROR" ||
      err.code === "ER_DUP_KEYNAME" ||
      err.code === "ER_DUP_ENTRY"
    ) {
      skipped++;
      console.log(`  ⏭  ${err.code}: ${err.sqlMessage}`);
    } else {
      console.error("Statement that failed:\n", stmt);
      throw err;
    }
  }
}

console.log(`\n✅ Applied ${applied} statements, skipped ${skipped}.`);

const [tables] = await conn.query(
  `SHOW TABLES LIKE 'onboarding%'`,
);
console.log("\nonboarding tables:");
for (const row of tables) console.log(`  ${Object.values(row)[0]}`);

await conn.end();
