import mysql from "mysql2/promise";
import fs from "node:fs";

const url = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port),
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: false },
  multipleStatements: true,
});

const sql = fs
  .readFileSync(
    new URL("../drizzle/migrations/0004_agents_phase1.sql", import.meta.url),
    "utf8"
  )
  .replace(/-->\s*statement-breakpoint/g, "");

// Split on `;` followed by newline so we can skip-on-already-exists per statement.
const statements = sql
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("--"));

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

const [boards] = await conn.query(`SELECT id, slug, name, agent FROM boards`);
console.log("\nboards:");
for (const b of boards) {
  console.log(`  ${String(b.id).padEnd(3)} ${b.slug.padEnd(14)} ${b.name.padEnd(14)} (agent: ${b.agent})`);
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
