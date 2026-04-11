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
import { listings, breezewayProperties } from "../drizzle/schema";
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
    console.log(`[Sync] Hostaway returned ${hostawayListings.length} listings (paginated)`);
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    for (const hl of hostawayListings) {
      try {
        // Hostaway listing field names vary slightly across API versions — be
        // defensive and fall back through the most common spellings.
        const hostawayId = String(hl.id);
        const name = hl.name || hl.propertyName || hl.externalListingName || "Unnamed";
        const internalName = hl.internalListingName || hl.internal_listing_name || null;
        const address = hl.address || hl.address1 || null;
        const city = hl.city || null;
        const state = hl.state || hl.stateCode || null;
        const country = hl.country || hl.countryCode || null;
        const photoUrl = hl.thumbnailUrl || hl.thumbnail_url || hl.listingImages?.[0]?.url || null;
        const guestCapacity =
          typeof hl.personCapacity === "number"
            ? hl.personCapacity
            : typeof hl.guestCapacity === "number"
              ? hl.guestCapacity
              : null;

        // NOTE: the listings table has NO syncedAt column — don't try to
        // set one or the insert silently fails in the swallowed catch.
        await db
          .insert(listings)
          .values({
            hostawayId,
            name,
            internalName,
            address,
            city,
            state,
            country,
            guestCapacity,
            photoUrl,
          })
          .onDuplicateKeyUpdate({
            set: {
              name,
              // Only overwrite internalName if Hostaway actually supplied one —
              // otherwise we'd clobber any manually-set internal name.
              ...(internalName ? { internalName } : {}),
              address,
              city,
              state,
              country,
              guestCapacity,
              photoUrl,
            },
          });
        synced++;
      } catch (e: any) {
        errors++;
        if (errors <= 5) {
          console.error(
            `[Sync] Failed to upsert Hostaway listing ${hl?.id ?? "?"} (${hl?.name ?? "?"}): ${e?.message ?? e}`
          );
        }
      }
    }
    console.log(`[Sync] Hostaway listings sync result: ${synced} synced, ${errors} errors`);
  } catch (err: any) {
    console.error("[Sync] Hostaway listings sync failed:", err?.message ?? err);
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

    // Paginate through ALL properties (not just the first 200)
    const PAGE_LIMIT = 200;
    let page = 1;
    let allProperties: any[] = [];

    while (true) {
      const response = await client.get<{
        results?: any[];
        total_pages?: number;
      }>("/property", { limit: PAGE_LIMIT, page });

      const properties = response.results || [];
      allProperties = allProperties.concat(properties);
      console.log(`[Sync] Breezeway properties page ${page}: ${properties.length} results`);

      if (properties.length === 0 || (response.total_pages !== undefined && page >= response.total_pages)) break;
      page++;
    }

    console.log(`[Sync] Total Breezeway properties fetched: ${allProperties.length}`);

    // Pre-load existing tags so we don't wipe them during sync
    const db = await getDb();
    const existingProps = db ? await db.select({ breezewayId: breezewayProperties.breezewayId, tags: breezewayProperties.tags }).from(breezewayProperties) : [];
    const existingTagsMap = new Map(existingProps.map(p => [p.breezewayId, p.tags]));

    for (const prop of allProperties) {
      try {
        const defaultPhoto = prop.photos?.find((p: any) => p.default);
        const bwId = String(prop.id);
        // Preserve existing tags — never overwrite with empty
        const existingTags = existingTagsMap.get(bwId);
        const tagsToSet = existingTags || "[]";

        await upsertBreezewayProperty({
          breezewayId: bwId,
          referencePropertyId: prop.reference_property_id ? String(prop.reference_property_id) : null,
          name: prop.name || prop.display || "Unnamed",
          address: prop.address1 ?? null,
          city: prop.city ?? null,
          state: prop.state ?? null,
          status: prop.status === "active" ? "active" : "inactive",
          photoUrl: defaultPhoto?.url ?? null,
          tags: tagsToSet,
          syncedAt: new Date(),
        });
        synced++;
      } catch (err: any) {
        errors++;
        if (errors <= 5) console.error(`[Sync] Failed to upsert property ${prop.name || prop.id}: ${err.message}`);
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
