// Raw Hostaway API test with timeouts
import dotenv from "dotenv";
dotenv.config();

const HOSTAWAY_API_BASE = "https://api.hostaway.com/v1";
const HOSTAWAY_AUTH_URL = "https://api.hostaway.com/v1/accessTokens";

const accountId = process.env.HOSTAWAY_ACCOUNT_ID;
const apiKey = process.env.HOSTAWAY_API_KEY;

console.log("Account ID:", accountId ? `${accountId.slice(0, 4)}...` : "MISSING");
console.log("API Key:", apiKey ? `${apiKey.slice(0, 8)}...` : "MISSING");

async function getToken() {
  console.log("\n1. Getting access token...");
  const resp = await fetch(HOSTAWAY_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: accountId,
      client_secret: apiKey,
      scope: "general",
    }),
    signal: AbortSignal.timeout(15000),
  });
  
  if (!resp.ok) {
    console.error("Auth failed:", resp.status, await resp.text());
    process.exit(1);
  }
  
  const data = await resp.json();
  console.log("Token obtained:", data.access_token?.slice(0, 20) + "...");
  return data.access_token;
}

async function testEndpoint(token, endpoint, params = {}) {
  const url = new URL(`${HOSTAWAY_API_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, String(v)));
  
  console.log(`\nFetching: ${url.toString()}`);
  const start = Date.now();
  
  try {
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    
    const elapsed = Date.now() - start;
    console.log(`Response: ${resp.status} in ${elapsed}ms`);
    
    if (!resp.ok) {
      console.error("Error body:", await resp.text());
      return null;
    }
    
    const data = await resp.json();
    console.log(`Result count: ${data.result?.length ?? "N/A"}, Total: ${data.count ?? "N/A"}`);
    if (data.result?.length > 0) {
      console.log("First item keys:", Object.keys(data.result[0]).join(", "));
    }
    return data;
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`Failed after ${elapsed}ms:`, err.message);
    return null;
  }
}

async function main() {
  try {
    const token = await getToken();
    
    // Test listings first (known to work)
    console.log("\n=== Test: Listings ===");
    await testEndpoint(token, "/listings", { limit: 5, offset: 0 });
    
    // Test conversations (the one that hangs)
    console.log("\n=== Test: Conversations ===");
    await testEndpoint(token, "/conversations", { limit: 5, offset: 0 });
    
    // Test conversations with different params
    console.log("\n=== Test: Conversations (with sortOrder) ===");
    await testEndpoint(token, "/conversations", { limit: 5, offset: 0, sortOrder: "latestActivity" });
    
  } catch (err) {
    console.error("Fatal:", err.message);
  }
  
  process.exit(0);
}

main();
