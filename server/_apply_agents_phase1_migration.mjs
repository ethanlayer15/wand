import mysql from "mysql2/promise";
import fs from "node:fs";

/**
 * Apply Phase 1 migration to the Wand DB.
 *
 * Strategy: run each DDL/DML block individually, skipping "already exists"
 * errors so the script is safely re-runnable. We split the file into well-
 * defined blocks separated by ";\n\n" (blank line after a semicolon) — that
 * matches how the migration is written and avoids the prior bug where
 * comments + CREATE TABLE got merged into one statement that TiDB never
 * actually executed.
 */

const url = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port),
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: false },
  multipleStatements: false, // run one statement per call so errors are precise
});

const raw = fs.readFileSync(
  new URL("../drizzle/migrations/0004_agents_phase1.sql", import.meta.url),
  "utf8"
);

// Strip line comments so they can't get glued to the next statement.
const stripped = raw
  .split("\n")
  .map((line) => (line.trimStart().startsWith("--") ? "" : line))
  .join("\n");

// Split on ";" at end of line. Each block is one statement.
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

const [boards] = await conn.query(`SELECT id, slug, name, agent FROM boards`);
console.log("boards:");
for (const b of boards) {
  console.log(
    `  ${String(b.id).padEnd(3)} ${b.slug.padEnd(14)} ${b.name.padEnd(14)} (agent: ${b.agent})`
  );
}

const [taskCols] = await conn.query(
  `SHOW COLUMNS FROM tasks WHERE Field IN ('boardId','visibility','ownerUserId','ownerAgent')`
);
console.log("\ntasks new columns:");
for (const c of taskCols) console.log(`  ${c.Field.padEnd(14)} ${c.Type}`);

const [counts] = await conn.query(
  `SELECT b.slug, COUNT(t.id) AS n FROM boards b LEFT JOIN tasks t ON t.boardId = b.id GROUP BY b.slug`
);
console.log("\ntask counts per board:");
for (const r of counts) console.log(`  ${r.slug.padEnd(14)} ${r.n}`);

await conn.end();
