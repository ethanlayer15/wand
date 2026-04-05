import dotenv from "dotenv";
dotenv.config();

const HOSTAWAY_API_BASE = "https://api.hostaway.com/v1";
const HOSTAWAY_AUTH_URL = "https://api.hostaway.com/v1/accessTokens";

const accountId = process.env.HOSTAWAY_ACCOUNT_ID;
const apiKey = process.env.HOSTAWAY_API_KEY;

async function getToken() {
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
  const data = await resp.json();
  return data.access_token;
}

async function main() {
  const token = await getToken();
  
  // Get first 2 conversations with full detail
  const url = `${HOSTAWAY_API_BASE}/conversations?limit=2&offset=0&sortOrder=latestActivity`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const data = await resp.json();
  
  for (const conv of data.result) {
    console.log(`\n=== Conversation ${conv.id} ===`);
    console.log(`Guest: ${conv.recipientName}`);
    console.log(`Listing: ${conv.listingMapId}`);
    console.log(`Reservation: ${conv.reservationId}`);
    console.log(`Archived: ${conv.isArchived}`);
    console.log(`Messages inline: ${conv.conversationMessages?.length ?? 0}`);
    
    if (conv.conversationMessages?.length > 0) {
      const firstMsg = conv.conversationMessages[0];
      console.log("First message keys:", Object.keys(firstMsg).join(", "));
      console.log("First message body:", (firstMsg.body || "").slice(0, 200));
      console.log("First message isIncoming:", firstMsg.isIncoming);
      console.log("First message insertedOn:", firstMsg.insertedOn);
    }
    
    // Also test the separate messages endpoint for comparison
    console.log("\n--- Separate messages endpoint ---");
    const msgUrl = `${HOSTAWAY_API_BASE}/conversations/${conv.id}/messages?limit=3&offset=0`;
    const msgResp = await fetch(msgUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    const msgData = await msgResp.json();
    console.log(`Separate endpoint messages: ${msgData.result?.length ?? 0}, Total: ${msgData.count ?? "N/A"}`);
    if (msgData.result?.length > 0) {
      console.log("First msg body:", (msgData.result[0].body || "").slice(0, 200));
    }
  }
  
  process.exit(0);
}

main();
