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
import { eq } from "drizzle-orm";

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
  let synced = 0;
  let errors = 0;
  try {
    const db = await getDb();
    if (!db) return { synced: 0, errors: 0 };

    const client = createBreezewayClient();
    const response = await client.get<{
      results?: any[];
    }>("/user/", { limit: 200, page: 1 });

    const users = response.results || [];
    console.log(`[Sync] Fetched ${users.length} Breezeway team members`);

    const { breezewayTeam } = await import("../drizzle/schema");

    for (const user of users) {
      try {
        const breezewayId = String(user.id);
        // Upsert by breezewayId
        const existing = await db
          .select()
          .from(breezewayTeam)
          .where(eq(breezewayTeam.breezewayId, breezewayId))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(breezewayTeam)
            .set({
              firstName: user.first_name || user.firstName || null,
              lastName: user.last_name || user.lastName || null,
              email: user.email || null,
              role: user.role || user.type || null,
              active: user.status === "active" || user.active !== false,
              syncedAt: new Date(),
            })
            .where(eq(breezewayTeam.breezewayId, breezewayId));
        } else {
          await db.insert(breezewayTeam).values({
            breezewayId,
            firstName: user.first_name || user.firstName || null,
            lastName: user.last_name || user.lastName || null,
            email: user.email || null,
            role: user.role || user.type || null,
            active: user.status === "active" || user.active !== false,
            syncedAt: new Date(),
          });
        }
        synced++;
      } catch (e: any) {
        console.error(`[Sync] Failed to upsert Breezeway team member ${user.id}: ${e.message}`);
        errors++;
      }
    }
    // Auto-create cleaners for team members that don't have one yet
    const { cleaners } = await import("../drizzle/schema");
    const allTeamMembers = await db.select().from(breezewayTeam);
    const existingCleaners = await db.select().from(cleaners);
    const linkedTeamIds = new Set(existingCleaners.map((c) => c.breezewayTeamId).filter(Boolean));
    let autoCreated = 0;

    for (const tm of allTeamMembers) {
      if (linkedTeamIds.has(tm.id)) continue;
      const name = [tm.firstName, tm.lastName].filter(Boolean).join(" ") || `Team Member ${tm.breezewayId}`;
      try {
        await db.insert(cleaners).values({
          breezewayTeamId: tm.id,
          name,
          email: tm.email ?? null,
          currentMultiplier: "1.0",
        });
        autoCreated++;
      } catch (e: any) {
        // Ignore duplicates
        if (!e.message?.includes("Duplicate")) {
          console.warn(`[Sync] Failed to auto-create cleaner for ${name}: ${e.message}`);
        }
      }
    }
    if (autoCreated > 0) {
      console.log(`[Sync] Auto-created ${autoCreated} cleaners from Breezeway team members`);
    }

    console.log(`[Sync] Breezeway team sync complete: ${synced} synced, ${errors} errors`);
  } catch (e: any) {
    console.error(`[Sync] Breezeway team sync failed: ${e.message}`);
    errors++;
  }
  return { synced, errors };
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
