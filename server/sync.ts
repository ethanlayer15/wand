/**
 * Sync module — syncs data between external APIs and local DB.
 *
 * NOTE: Partially truncated during Manus zip export. syncHostawayMessages and
 * syncBreezewayProperties are reconstructed. Other functions are stubs.
 */

import { getHostawayClient } from "./hostaway";
import { createBreezewayClient } from "./breezeway";
import {
  getListingByHostawayId,
  upsertGuestMessage,
  upsertBreezewayProperty,
  getDb,
} from "./db";
import { listings } from "../drizzle/schema";

// ── Hostaway Messages ───────────────────────────────────────────────

export async function syncHostawayMessages(opts?: {
  maxConversations?: number;
  fetchFullMessages?: boolean;
}): Promise<{ synced: number; errors: number; conversations: number }> {
  const maxConversations = opts?.maxConversations ?? 500;
  const fetchFullMessages = opts?.fetchFullMessages ?? false;
  let synced = 0;
  let errors = 0;
  let conversations = 0;

  try {
    const client = getHostawayClient();
    const recentConversations = await client.getRecentConversations(maxConversations);
    conversations = recentConversations.length;

    for (const conv of recentConversations) {
      try {
        let listingId: number | null = null;
        if (conv.listingMapId) {
          const localListing = await getListingByHostawayId(String(conv.listingMapId));
          listingId = localListing?.id ?? null;
        }
        const guestName = (conv as any).recipientName || conv.guestName || null;
        const reservationStatus = (conv as any).Reservation?.status ?? null;

        const messages = fetchFullMessages
          ? await client.getAllConversationMessages(conv.id)
          : conv.conversationMessages || [];

        for (const msg of messages) {
          try {
            await upsertGuestMessage({
              hostawayMessageId: String(msg.id),
              hostawayConversationId: String(conv.id),
              hostawayReservationId: conv.reservationId ? String(conv.reservationId) : null,
              listingId,
              guestName,
              body: msg.body ?? null,
              isIncoming: msg.isIncoming ?? true,
              sentAt: msg.insertedOn ? new Date(msg.insertedOn) : null,
              channelName: (conv as any).channelName ?? null,
              reservationStatus,
            });
            synced++;
          } catch {
            errors++;
          }
        }
      } catch {
        errors++;
      }
    }
  } catch (err) {
    console.error("[Sync] Hostaway messages sync failed:", err);
    throw err;
  }

  return { synced, errors, conversations };
}

// ── Hostaway Listings ───────────────────────────────────────────────

export async function syncHostawayListings(): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;
  try {
    const client = getHostawayClient();
    const hostawayListings = await client.getListings();
    const db = getDb();

    for (const hl of hostawayListings) {
      try {
        await db
          .insert(listings)
          .values({
            hostawayId: String(hl.id),
            name: hl.name || "Unnamed",
            address: hl.address || null,
            city: hl.city || null,
            state: hl.state || null,
            photoUrl: hl.thumbnailUrl || null,
            syncedAt: new Date(),
          })
          .onDuplicateKeyUpdate({
            set: {
              name: hl.name || "Unnamed",
              address: hl.address || null,
              city: hl.city || null,
              state: hl.state || null,
              photoUrl: hl.thumbnailUrl || null,
              syncedAt: new Date(),
            },
          });
        synced++;
      } catch {
        errors++;
      }
    }
  } catch (err) {
    console.error("[Sync] Hostaway listings sync failed:", err);
    throw err;
  }
  return { synced, errors };
}

// ── Hostaway Reviews ────────────────────────────────────────────────

export async function syncHostawayReviews(): Promise<{ synced: number; errors: number }> {
  console.warn("[Sync] syncHostawayReviews is a stub — re-export from Manus");
  return { synced: 0, errors: 0 };
}

// ── Breezeway Properties ────────────────────────────────────────────

export async function syncBreezewayProperties(): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;
  try {
    const client = createBreezewayClient();
    const response = await client.get<{
      results?: any[];
    }>("/property", { limit: 200, page: 1 });

    const properties = response.results || [];

    for (const prop of properties) {
      try {
        const defaultPhoto = prop.photos?.find((p: any) => p.default);
        await upsertBreezewayProperty({
          breezewayId: String(prop.id),
          referencePropertyId: prop.reference_property_id ? String(prop.reference_property_id) : null,
          name: prop.name || prop.display || "Unnamed",
          address: prop.address1 ?? null,
          city: prop.city ?? null,
          state: prop.state ?? null,
          status: prop.status === "active" ? "active" : "inactive",
          photoUrl: defaultPhoto?.url ?? null,
          tags: "[]",
          syncedAt: new Date(),
        });
        synced++;
      } catch {
        errors++;
      }
    }
  } catch (err) {
    console.error("[Sync] Breezeway properties sync failed:", err);
    throw err;
  }
  return { synced, errors };
}

// ── Breezeway Team ──────────────────────────────────────────────────

export async function syncBreezewayTeam(): Promise<{ synced: number; errors: number }> {
  console.warn("[Sync] syncBreezewayTeam is a stub — re-export from Manus");
  return { synced: 0, errors: 0 };
}

// ── Breezeway Webhooks ──────────────────────────────────────────────

export async function registerBreezewayWebhooks(): Promise<any> {
  const client = createBreezewayClient();
  // Stub — re-export from Manus for full implementation
  console.warn("[Sync] registerBreezewayWebhooks is a stub");
  return {};
}

export async function listBreezewayWebhooks(): Promise<any[]> {
  const client = createBreezewayClient();
  console.warn("[Sync] listBreezewayWebhooks is a stub");
  return [];
}

// ── Full Sync ───────────────────────────────────────────────────────

export async function runFullSync(): Promise<{
  listings: { synced: number; errors: number };
  reviews: { synced: number; errors: number };
  properties: { synced: number; errors: number };
  team: { synced: number; errors: number };
}> {
  const [listingsResult, reviewsResult, propertiesResult, teamResult] = await Promise.all([
    syncHostawayListings(),
    syncHostawayReviews(),
    syncBreezewayProperties(),
    syncBreezewayTeam(),
  ]);
  return {
    listings: listingsResult,
    reviews: reviewsResult,
    properties: propertiesResult,
    team: teamResult,
  };
}
