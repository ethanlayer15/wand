import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL env var not set");

const conn = await mysql.createConnection(DATABASE_URL);
const [rows] = await conn.execute(
  "SELECT id, internalName, name, city FROM listings WHERE status='active' AND (internalName LIKE '%Writer%' OR name LIKE '%Writer%')"
);
for (const r of rows) {
  const n = r.internalName || r.name;
  console.log(`id=${r.id} name=${JSON.stringify(n)} city=${r.city}`);
  // Show hex of apostrophe char
  for (let i = 0; i < n.length; i++) {
    if (n.charCodeAt(i) > 127) {
      console.log(`  char[${i}] = U+${n.charCodeAt(i).toString(16).toUpperCase()} = ${n[i]}`);
    }
  }
}
if (rows.length === 0) console.log("Not found");
await conn.end();
