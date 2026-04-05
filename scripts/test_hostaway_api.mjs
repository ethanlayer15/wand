// Test Hostaway API connectivity and conversation fetching
import { getHostawayClient } from "./server/hostaway.ts";

async function test() {
  console.log("Testing Hostaway API connection...");
  
  try {
    const client = getHostawayClient();
    console.log("Client created successfully");
    
    // Test 1: Get conversations
    console.log("\n--- Test 1: Fetching conversations ---");
    const conversations = await client.getAllConversations();
    console.log(`Total conversations: ${conversations.length}`);
    
    if (conversations.length > 0) {
      console.log("First conversation:", JSON.stringify(conversations[0], null, 2));
      
      // Test 2: Get messages for the first conversation
      console.log("\n--- Test 2: Fetching messages for first conversation ---");
      const messages = await client.getAllConversationMessages(conversations[0].id);
      console.log(`Messages in first conversation: ${messages.length}`);
      if (messages.length > 0) {
        console.log("First message:", JSON.stringify(messages[0], null, 2));
      }
    }
    
    // Test 3: Get listings (to verify API key works)
    console.log("\n--- Test 3: Fetching listings ---");
    const listings = await client.getAllListings();
    console.log(`Total listings: ${listings.length}`);
    
  } catch (err) {
    console.error("Error:", err.message);
    console.error("Stack:", err.stack);
  }
  
  process.exit(0);
}

test();
