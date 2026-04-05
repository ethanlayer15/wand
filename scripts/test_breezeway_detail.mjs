// Deep-dive into Breezeway task structure for attribution engine
const BREEZEWAY_AUTH_URL = "https://api.breezeway.io/public/auth/v1/";
const BREEZEWAY_API_BASE = "https://api.breezeway.io/public/inventory/v1";

const clientId = "jg0wituhel8oqgg0bt3qnqv2n7hkw3nd";
const clientSecret = "82agxz7avjux2ruucdf9imodxyj24nun";

async function login() {
  const resp = await fetch(BREEZEWAY_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  });
  if (!resp.ok) throw new Error(`Login failed: ${resp.status}`);
  return resp.json();
}

async function apiGet(token, endpoint, params = {}) {
  const url = new URL(`${BREEZEWAY_API_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined) url.searchParams.append(k, String(v));
  });
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `JWT ${token}`, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`GET ${endpoint} failed: ${resp.status}`);
  return resp.json();
}

(async () => {
  const tokens = await login();
  const token = tokens.access_token;

  // 1. Get a full task object to see all fields
  console.log("=== Full Task Object Structure ===");
  const tasks = await apiGet(token, "/task/", { home_id: 997661, limit: 3, page: 1 });
  if (tasks.results?.length > 0) {
    console.log(JSON.stringify(tasks.results[0], null, 2));
  }

  // 2. Check task statuses to understand completed vs in-progress
  console.log("\n=== Task Status Codes ===");
  const statusCodes = new Set();
  const allTasks = await apiGet(token, "/task/", { home_id: 997661, limit: 100, page: 1 });
  for (const t of allTasks.results || []) {
    const status = t.type_task_status?.code || t.type_task_status?.name || "unknown";
    statusCodes.add(`${status} (${t.type_task_status?.stage || "?"})`);
  }
  console.log("Unique statuses:", [...statusCodes]);

  // 3. Check task departments to identify cleaning tasks
  console.log("\n=== Task Departments ===");
  const departments = new Set();
  for (const t of allTasks.results || []) {
    departments.add(t.type_department || "none");
  }
  console.log("Unique departments:", [...departments]);

  // 4. Check task names to identify cleaning patterns
  console.log("\n=== Task Name Patterns ===");
  const namePatterns = {};
  for (const t of allTasks.results || []) {
    const name = t.name || "unnamed";
    namePatterns[name] = (namePatterns[name] || 0) + 1;
  }
  for (const [name, count] of Object.entries(namePatterns).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  "${name}": ${count} tasks`);
  }

  // 5. Check assignment structure
  console.log("\n=== Assignment Structure ===");
  for (const t of (allTasks.results || []).slice(0, 3)) {
    if (t.assignments?.length > 0) {
      console.log(`Task "${t.name}" (${t.scheduled_date}):`);
      for (const a of t.assignments) {
        console.log(`  ${JSON.stringify(a)}`);
      }
    }
  }

  // 6. Get a Breezeway property to check if it has a Hostaway/channel reference
  console.log("\n=== Property Detail (check for channel mapping) ===");
  try {
    const prop = await apiGet(token, "/property/997661");
    console.log(JSON.stringify(prop, null, 2).substring(0, 2000));
  } catch (e) {
    console.log("Error:", e.message);
  }
})();
