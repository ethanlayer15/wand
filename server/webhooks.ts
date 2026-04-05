import { Router } from "express";
import { logBreezewayAudit, upsertBreezewayProperty, upsertGuestMessage, getListingByHostawayId } from "./db";

const webhookRouter = Router();

/**
 * Breezeway webhook endpoint for real-time task and property status events
 * POST /api/webhooks/breezeway
 *
 * Breezeway sends a test event {"event": "test_webhook_event"} during subscription
 * registration — we must respond with 2XX within 10 seconds.
 */
webhookRouter.post("/breezeway", async (req, res) => {
  const startTime = Date.now();

  try {
    const body = req.body;

    // Handle Breezeway's subscription test event — must respond 2XX immediately
    if (body?.event === "test_webhook_event") {
      console.log("[Webhook] Received Breezeway subscription test event — acknowledging");
      return res.status(200).json({ success: true, acknowledged: true });
    }

    const { event, data } = body;

    if (!event) {
      return res.status(400).json({
        success: false,
        error: "Missing event in webhook payload",
      });
    }

    const responseTime = Date.now() - startTime;
    await logBreezewayAudit(
      undefined,
      "POST",
      "/webhooks/breezeway",
      { event, data },
      200,
      responseTime
    );

    // Handle task events
    switch (event) {
      case "task-created":
        console.log("[Webhook] Task created:", data?.id);
        break;

      case "task-committed":
        console.log("[Webhook] Task committed:", data?.id);
        break;

      case "task-updated":
        console.log("[Webhook] Task updated:", data?.id);
        break;

      case "task-deleted":
        console.log("[Webhook] Task deleted:", data?.id);
        break;

      case "task-assignment-updated":
        console.log("[Webhook] Task assignment updated:", data?.id);
        break;

      case "task-started":
        console.log("[Webhook] Task started:", data?.id);
        break;

      case "task-paused":
        console.log("[Webhook] Task paused:", data?.id);
        break;

      case "task-resumed":
        console.log("[Webhook] Task resumed:", data?.id);
        break;

      case "task-completed":
        console.log("[Webhook] Task completed:", data?.id);
        break;

      case "task-cost-updated":
        console.log("[Webhook] Task cost updated:", data?.id);
        break;

      case "task-supplies-updated":
        console.log("[Webhook] Task supplies updated:", data?.id);
        break;

      case "task-comment-created":
        console.log("[Webhook] Task comment created:", data?.id);
        break;

      // Property status events
      case "property-status":
      case "property.status_changed":
        console.log("[Webhook] Property status changed:", data?.id);
        if (data?.id) {
          try {
            await upsertBreezewayProperty({
              breezewayId: String(data.id),
              name: data.name || data.display || "Unknown",
              address: data.address1 ?? null,
              city: data.city ?? null,
              state: data.state ?? null,
              status: data.status === "active" ? "active" : "inactive",
              photoUrl: null,
              syncedAt: new Date(),
            });
          } catch (err) {
            console.error("[Webhook] Failed to update property status:", err);
          }
        }
        break;

      default:
        console.warn("[Webhook] Unknown event type:", event);
    }

    res.json({
      success: true,
      event,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Webhook] Error processing Breezeway webhook:", error);
    const responseTime = Date.now() - startTime;
    await logBreezewayAudit(
      undefined,
      "POST",
      "/webhooks/breezeway",
      req.body,
      500,
      responseTime,
      String(error)
    );

    res.status(500).json({
      success: false,
      error: "Failed to process webhook",
    });
  }
});

/**
 * Hostaway webhook endpoint for real-time guest message ingestion
 * POST /api/webhooks/hostaway
 *
 * Receives incoming guest messages from Hostaway and saves them
 * to the guestMessages table immediately. No AI classification
 * is performed on the webhook — that's handled by the 10-minute cron.
 *
 * Expected payload shape (Hostaway conversation webhook):
 * {
 *   event: "conversation_message_created" | "conversation_created" | ...,
 *   data: {
 *     id: number,              // message ID
 *     conversationId: number,
 *     body: string,
 *     isIncoming: boolean,
 *     insertedOn: string,       // ISO timestamp
 *     listingMapId?: number,
 *     reservationId?: number,
 *     guestName?: string,
 *     channelName?: string,
 *     ...
 *   }
 * }
 */
webhookRouter.post("/hostaway", async (req, res) => {
  try {
    const body = req.body;

    // Handle Hostaway test/verification events
    if (body?.event === "test" || body?.event === "ping" || body?.test === true) {
      console.log("[Webhook:Hostaway] Test event received — acknowledging");
      return res.status(200).json({ success: true, acknowledged: true });
    }

    const event = body?.event;
    const data = body?.data;

    if (!data) {
      console.warn("[Webhook:Hostaway] No data in payload:", JSON.stringify(body).slice(0, 500));
      return res.status(200).json({ success: true, message: "No data to process" });
    }

    console.log(`[Webhook:Hostaway] Event: ${event}, messageId: ${data.id}, conversationId: ${data.conversationId}`);

    // Only process incoming guest messages (not outgoing host replies)
    const isIncoming = data.isIncoming !== undefined ? Boolean(data.isIncoming) : true;

    // Resolve listing ID from Hostaway listing map ID
    let listingId: number | null = null;
    const hostawayListingId = data.listingMapId || data.listing_map_id;
    if (hostawayListingId) {
      try {
        const localListing = await getListingByHostawayId(String(hostawayListingId));
        listingId = localListing?.id ?? null;
      } catch (err) {
        console.warn(`[Webhook:Hostaway] Could not resolve listing ${hostawayListingId}:`, err);
      }
    }

    // Build the guest message record
    const conversationId = data.conversationId || data.conversation_id;
    const reservationId = data.reservationId || data.reservation_id;
    const messageId = data.id;
    const guestName = data.guestName || data.guest_name || data.recipientName || null;
    const messageBody = data.body || data.message || null;
    const sentAt = data.insertedOn || data.inserted_on || data.createdAt || null;
    const channelName = data.channelName || data.channel_name || null;

    if (messageId && conversationId) {
      await upsertGuestMessage({
        hostawayMessageId: String(messageId),
        hostawayConversationId: String(conversationId),
        hostawayReservationId: reservationId ? String(reservationId) : null,
        listingId,
        guestName,
        body: messageBody,
        isIncoming: isIncoming,
        sentAt: sentAt ? new Date(sentAt) : null,
        channelName,
      });

      console.log(`[Webhook:Hostaway] Saved message ${messageId} from conversation ${conversationId} (incoming: ${isIncoming})`);
    } else {
      console.warn(`[Webhook:Hostaway] Missing messageId or conversationId in payload`);
    }

    res.json({
      success: true,
      event,
      messageId: messageId || null,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Webhook:Hostaway] Error processing webhook:", error);
    // Always return 200 to prevent Hostaway from retrying endlessly
    res.status(200).json({
      success: false,
      error: "Internal processing error",
    });
  }
});

export default webhookRouter;
