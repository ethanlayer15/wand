import mysql from "mysql2/promise";

const db = await mysql.createConnection(process.env.DATABASE_URL);

// Get a valid token from the DB (camelCase columns)
const [rows] = await db.execute("SELECT accessToken FROM breezewayTokens ORDER BY createdAt DESC LIMIT 1");
const token = rows[0]?.accessToken;
if (!token) { console.log("No token found"); process.exit(1); }

console.log("Token found, testing API...");

// Test 1: no status filter, just date range
const params1 = new URLSearchParams({
  scheduled_date_start: "2026-02-25",
  scheduled_date_end: "2026-03-10",
  limit: "10",
  page: "1",
});
const r1 = await fetch(`https://api.breezeway.io/public/v3/task/?${params1}`, {
  headers: { Authorization: `Bearer ${token}` }
});
const d1 = await r1.json();
console.log("No status filter:", JSON.stringify({ total: d1.total_results, count: d1.results?.length, sample: d1.results?.[0] ? { id: d1.results[0].id, name: d1.results[0].name, status: d1.results[0].type_task_status } : null }, null, 2));

// Test 2: with status=scheduled (lowercase)
const params2 = new URLSearchParams({
  scheduled_date_start: "2026-02-25",
  scheduled_date_end: "2026-03-10",
  status: "scheduled",
  limit: "10",
  page: "1",
});
const r2 = await fetch(`https://api.breezeway.io/public/v3/task/?${params2}`, {
  headers: { Authorization: `Bearer ${token}` }
});
const d2 = await r2.json();
console.log("status=scheduled:", JSON.stringify({ total: d2.total_results, count: d2.results?.length }, null, 2));

// Test 3: with status=Scheduled (capitalized)
const params3 = new URLSearchParams({
  scheduled_date_start: "2026-02-25",
  scheduled_date_end: "2026-03-10",
  status: "Scheduled",
  limit: "10",
  page: "1",
});
const r3 = await fetch(`https://api.breezeway.io/public/v3/task/?${params3}`, {
  headers: { Authorization: `Bearer ${token}` }
});
const d3 = await r3.json();
console.log("status=Scheduled:", JSON.stringify({ total: d3.total_results, count: d3.results?.length }, null, 2));

// Test 4: check what status codes exist in the results
if (d1.results?.length > 0) {
  const statuses = [...new Set(d1.results.map(t => JSON.stringify(t.type_task_status)))];
  console.log("Status codes in results:", statuses);
}

// Test 5: broader date range to see if any tasks exist at all
const params5 = new URLSearchParams({
  scheduled_date_start: "2026-01-01",
  scheduled_date_end: "2026-03-15",
  limit: "5",
  page: "1",
});
const r5 = await fetch(`https://api.breezeway.io/public/v3/task/?${params5}`, {
  headers: { Authorization: `Bearer ${token}` }
});
const d5 = await r5.json();
console.log("Broader range (Jan-Mar 2026):", JSON.stringify({ total: d5.total_results, count: d5.results?.length, statuses: d5.results?.map(t => t.type_task_status?.code) }, null, 2));

await db.end();
