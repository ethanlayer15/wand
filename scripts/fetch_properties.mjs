/**
 * Fetch all active properties from the Wand database and write to JSON.
 * Run with: node scripts/fetch_properties.mjs
 */
import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { writeFileSync } from "fs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const conn = await mysql.createConnection(DATABASE_URL);

const [rows] = await conn.execute(
  `SELECT id, name, internalName, city, state, cleaningFeeCharge, podId
   FROM listings
   WHERE status = 'active'
   ORDER BY COALESCE(internalName, name)`
);

await conn.end();

writeFileSync("/home/ubuntu/Downloads/wand_properties.json", JSON.stringify(rows, null, 2));
console.log(`Fetched ${rows.length} properties`);
console.log(JSON.stringify(rows.slice(0, 5), null, 2));
