import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL env var not set");

const conn = await mysql.createConnection(DATABASE_URL);
// id=3 is Writer's Retreat (Fairview) — confirmed $110
await conn.execute("UPDATE listings SET cleaningFeeCharge = '110' WHERE id = 3");
console.log("✓ $110 → Writer's Retreat (id=3, Fairview)");
await conn.end();
