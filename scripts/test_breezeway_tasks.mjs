// Test Breezeway task API directly
const BREEZEWAY_AUTH_URL = "https://api.breezeway.io/public/auth/v1/";
const BREEZEWAY_API_BASE = "https://api.breezeway.io/public/inventory/v1";

const clientId = process.env.BREEZEWAY_CLIENT_ID || "jg0wituhel8oqgg0bt3qnqv2n7hkw3nd";
const clientSecret = process.env.BREEZEWAY_CLIENT_SECRET || "82agxz7avjux2ruucdf9imodxyj24nun";

async function login() {
  const resp = await fetch(BREEZEWAY_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  });
  if (!resp.ok) throw new Error(`Login failed: ${resp.status} ${await resp.text()}`);
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
  if (!resp.ok) throw new Error(`GET ${endpoint} failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

(async () => {
  console.log("Logging in to Breezeway...");
  const tokens = await login();
  const token = tokens.access_token;
  console.log("Logged in successfully");

  // 1. Try fetching tasks without home_id
  console.log("\n--- Tasks (no home_id filter) ---");
  try {
    const tasks = await apiGet(token, "/task/", { limit: 5, page: 1 });
    console.log("Total results:", tasks.total_results);
    if (tasks.results) {
      for (const t of tasks.results.slice(0, 3)) {
        console.log(`  Task #${t.id}: ${t.name} | home_id: ${t.home_id} | date: ${t.scheduled_date} | dept: ${t.type_department}`);
        console.log(`    Status: ${JSON.stringify(t.type_task_status)}`);
        if (t.assignments) {
          for (const a of t.assignments) {
            console.log(`    Assigned: ${a.name} (id: ${a.assignee_id}) status: ${a.type_task_user_status}`);
          }
        }
      }
    }
  } catch (e) {
    console.log("Error:", e.message);
  }

  // 2. Try fetching tasks for a specific property
  console.log("\n--- Tasks for home_id=992265 ---");
  try {
    const tasks = await apiGet(token, "/task/", { home_id: 992265, limit: 5, page: 1 });
    console.log("Total results:", tasks.total_results);
    if (tasks.results?.length > 0) {
      for (const t of tasks.results.slice(0, 3)) {
        console.log(`  Task #${t.id}: ${t.name} | date: ${t.scheduled_date}`);
        if (t.assignments) {
          for (const a of t.assignments) {
            console.log(`    Assigned: ${a.name} (id: ${a.assignee_id})`);
          }
        }
      }
    }
  } catch (e) {
    console.log("Error:", e.message);
  }

  // 3. Try the /task endpoint (without trailing slash)
  console.log("\n--- Tasks (no trailing slash) ---");
  try {
    const tasks = await apiGet(token, "/task", { limit: 5, page: 1 });
    console.log("Total results:", tasks.total_results);
  } catch (e) {
    console.log("Error:", e.message);
  }

  // 4. Check what properties have tasks - try a few
  const propIds = [992265, 997661, 998234, 998236, 145658, 145659];
  console.log("\n--- Checking multiple properties for tasks ---");
  for (const pid of propIds) {
    try {
      const tasks = await apiGet(token, "/task/", { home_id: pid, limit: 1 });
      if (tasks.total_results > 0) {
        console.log(`  Property ${pid}: ${tasks.total_results} tasks`);
      }
    } catch (e) {
      // skip
    }
  }
})();
