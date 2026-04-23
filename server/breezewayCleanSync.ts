/**
 * Breezeway Completed Cleans Sync
 *
 * Pulls completed cleaning tasks from Breezeway and populates the completedCleans table.
 * Matches Breezeway assignees to Wand cleaners via breezewayTeam → cleaners.breezewayTeamId.
 * Also looks up the listing's cleaningFeeCharge and distanceFromStorage.
 */
import { createBreezewayClient } from "./breezeway";
import {
  getBreezewaySyncConfig,
  getBreezewayProperties,
  getListings,
  getDb,
} from "./db";
import { getCleaners } from "./compensation";
import { completedCleans } from "../drizzle/schema";
import { breezewayTeam } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getPayWeekStart } from "./payCalculation";
import { sendCleaningReportsForNewCleans } from "./cleaningReports";

interface BreezewayTaskResponse {
  id: number;
  name: string;
  description?: string;
  home_id: number;
  type_department?: string;
  type_task_status?: {
    code: string;
    name: string;
    stage: string;
  };
  scheduled_date?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  assignments?: Array<{
    id: number;
    assignee_id: number;
    name: string;
    type_task_user_status: string;
  }>;
  report_url?: string;
  finished_at?: string;
}

interface CleanSyncResult {
  created: number;
  skipped: number;
  errors: number;
  total: number;
  /** How many tasks were skipped because their created_at was before the hard CUTOFF_DATE */
  skippedOldDate?: number;
  /** How many tasks already existed in the DB */
  skippedDupe?: number;
  /** How many tasks had no assignee matching any Wand cleaner */
  skippedNoCleaner?: number;
  /** How many tasks were for a Breezeway property that doesn't map to any
   *  current Hostaway listing — e.g. archived/dead properties or ex-customers.
   *  We skip these so we don't pollute completedCleans with listingId=NULL rows. */
  skippedNoListing?: number;
  /** How many properties we queried tasks for */
  propertiesQueried?: number;
  /** Timestamp the sync started */
  startedAt?: string;
  /** Timestamp the sync finished */
  finishedAt?: string;
}

// Module-level cache of the most recent sync result — surfaced in the
// scoreDiagnostic endpoint so we can see what happened without having
// to rely on the toast in the UI (which disappears too fast).
let lastCleanSyncResult: CleanSyncResult | null = null;
// Track whether a background run is currently in progress so the UI
// can show "running" instead of stale data.
let cleanSyncInProgress = false;
export function getLastCleanSyncResult(): CleanSyncResult | null {
  return lastCleanSyncResult;
}
export function isCleanSyncInProgress(): boolean {
  return cleanSyncInProgress;
}

/**
 * Fire-and-forget wrapper for syncCompletedCleans. Kicks off the sync in
 * the background and returns immediately so the HTTP request doesn't hit
 * Railway's ~30s edge-proxy timeout. The caller polls lastCleanSyncResult
 * via the scoreDiagnostic endpoint to see when it finishes.
 */
export function startCleanSyncInBackground(): {
  started: boolean;
  alreadyRunning: boolean;
} {
  if (cleanSyncInProgress) {
    return { started: false, alreadyRunning: true };
  }
  cleanSyncInProgress = true;
  // Intentionally not awaited — runs off the event loop.
  void syncCompletedCleans()
    .catch((err) => {
      console.error("[CleanSync] Background run crashed:", err?.message);
    })
    .finally(() => {
      cleanSyncInProgress = false;
    });
  return { started: true, alreadyRunning: false };
}

/**
 * Sync completed cleaning tasks from Breezeway into the completedCleans table.
 *
 * Flow:
 * 1. Fetch all tasks from Breezeway with department=housekeeping and stage=finished
 * 2. Match each task's assignee to a Wand cleaner via breezewayTeam.breezewayId → cleaners.breezewayTeamId
 * 3. Match the task's home_id to a listing via breezewayProperties → listings
 * 4. Insert into completedCleans if not already present (dedup by breezewayTaskId)
 */
export async function syncCompletedCleans(): Promise<CleanSyncResult> {
  const result: CleanSyncResult = {
    created: 0,
    skipped: 0,
    errors: 0,
    total: 0,
    skippedOldDate: 0,
    skippedDupe: 0,
    skippedNoCleaner: 0,
    skippedNoListing: 0,
    propertiesQueried: 0,
    startedAt: new Date().toISOString(),
  };
  const newCleanIds: number[] = []; // Track IDs for cleaning report emails

  const config = await getBreezewaySyncConfig();
  if (!config.enabled) {
    console.log("[CleanSync] Breezeway sync is disabled, skipping");
    return result;
  }

  const db = await getDb();
  if (!db) {
    console.error("[CleanSync] Database not available");
    return result;
  }

  try {
    const client = createBreezewayClient();

    // Build lookup maps
    // 1. breezewayProperties → listings. Try multiple strategies in order,
    //    because Breezeway's reference_property_id is unreliable (it's only
    //    populated for ~65% of props in prod, and some of those point at
    //    stale/archived Hostaway IDs).
    //
    //    Tier A: referencePropertyId → listings.hostawayId (exact)
    //    Tier B: breezeway.name (normalised) → listings.internalName (normalised)
    //    Tier C: breezeway.name (normalised) → listings.name (normalised)
    //    Tier D: breezeway.address (normalised) + city → listings.address + city
    const properties = await getBreezewayProperties();
    const allListings = await getListings();

    const norm = (s: string | null | undefined): string =>
      (s ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    const hostawayIdToListing = new Map<string, typeof allListings[0]>();
    const internalNameToListing = new Map<string, typeof allListings[0]>();
    const nameToListing = new Map<string, typeof allListings[0]>();
    const addressCityToListing = new Map<string, typeof allListings[0]>();
    for (const l of allListings) {
      if (l.hostawayId) hostawayIdToListing.set(String(l.hostawayId), l);
      const intKey = norm(l.internalName);
      if (intKey && !internalNameToListing.has(intKey)) internalNameToListing.set(intKey, l);
      const nameKey = norm(l.name);
      if (nameKey && !nameToListing.has(nameKey)) nameToListing.set(nameKey, l);
      const addrKey = `${norm(l.address)}|${norm(l.city)}`;
      if (norm(l.address) && !addressCityToListing.has(addrKey)) {
        addressCityToListing.set(addrKey, l);
      }
    }

    // Breezeway's `name` column often uses the format
    //   "<short internal> · <full marketing name>"
    // so we split on " · " and remember just the first segment as the
    // "short" alias that's likely to match listings.internalName.
    const splitShortName = (raw: string | null | undefined): string => {
      if (!raw) return "";
      const parts = raw.split("·").map((s) => s.trim()).filter(Boolean);
      return parts[0] ?? raw;
    };

    // Tier 0 map: listings that have a direct breezewayPropertyId set
    const bwIdToManualListing = new Map<string, typeof allListings[0]>();
    for (const l of allListings) {
      if (l.breezewayPropertyId) {
        bwIdToManualListing.set(String(l.breezewayPropertyId), l);
      }
    }

    const bwHomeIdToListing = new Map<number, typeof allListings[0]>();
    let match0 = 0, matchA = 0, matchB = 0, matchC = 0, matchD = 0, matchE = 0, matchNone = 0;
    let unmatchedWithRefId = 0;
    const unmatchedSamples: string[] = [];
    for (const p of properties) {
      let listing: typeof allListings[0] | undefined;

      // Tier 0: direct breezewayPropertyId on listing (manual/5STR-only properties)
      listing = bwIdToManualListing.get(String(p.breezewayId));
      if (listing) {
        bwHomeIdToListing.set(Number(p.breezewayId), listing);
        match0++;
        continue;
      }

      // Tier A: referencePropertyId → hostawayId
      if (p.referencePropertyId) {
        listing = hostawayIdToListing.get(String(p.referencePropertyId));
        if (listing) {
          bwHomeIdToListing.set(Number(p.breezewayId), listing);
          matchA++;
          continue;
        }
      }

      // Tier B: internalName — compare using both the full Breezeway name
      // AND just the short alias before " · "
      const bwFullKey = norm(p.name);
      const bwShortKey = norm(splitShortName(p.name));
      const bKeys = new Set([bwFullKey, bwShortKey].filter(Boolean));
      for (const k of bKeys) {
        const match = internalNameToListing.get(k);
        if (match) {
          listing = match;
          break;
        }
      }
      if (listing) {
        bwHomeIdToListing.set(Number(p.breezewayId), listing);
        matchB++;
        continue;
      }

      // Tier C: listings.name using same two keys
      for (const k of bKeys) {
        const match = nameToListing.get(k);
        if (match) {
          listing = match;
          break;
        }
      }
      if (listing) {
        bwHomeIdToListing.set(Number(p.breezewayId), listing);
        matchC++;
        continue;
      }

      // Tier D: address + city
      const addrKey = `${norm(p.address)}|${norm(p.city)}`;
      if (norm(p.address)) {
        listing = addressCityToListing.get(addrKey);
        if (listing) {
          bwHomeIdToListing.set(Number(p.breezewayId), listing);
          matchD++;
          continue;
        }
      }

      // Tier E: substring — listing.internalName contained in Breezeway name,
      // or Breezeway short alias contained in listing.internalName. Only
      // accept if the alias is ≥4 chars to avoid "The"/"At" collisions.
      if (bwShortKey.length >= 4) {
        for (const l of allListings) {
          const li = norm(l.internalName);
          if (!li || li.length < 4) continue;
          if (li === bwShortKey || bwFullKey.includes(li) || bwShortKey.includes(li) || li.includes(bwShortKey)) {
            listing = l;
            break;
          }
        }
      }
      if (listing) {
        bwHomeIdToListing.set(Number(p.breezewayId), listing);
        matchE++;
        continue;
      }

      matchNone++;
      if (p.referencePropertyId) unmatchedWithRefId++;
      if (unmatchedSamples.length < 5) {
        unmatchedSamples.push(
          `bwId=${p.breezewayId} refId=${p.referencePropertyId ?? "null"} name="${p.name}" addr="${p.address ?? ""}" city="${p.city ?? ""}"`
        );
      }
    }

    console.log(
      `[CleanSync] Property match: ${properties.length} bw props vs ${allListings.length} listings · 0-direct=${match0} · A-refId=${matchA} · B-internalName=${matchB} · C-name=${matchC} · D-address=${matchD} · E-substring=${matchE} · unmatched=${matchNone} (${unmatchedWithRefId} of those had a refId but no listing in DB)`
    );
    if (unmatchedSamples.length > 0) {
      console.log(`[CleanSync] Unmatched property samples:`);
      for (const s of unmatchedSamples) console.log(`  ${s}`);
    }

    // 2. Breezeway task assignments carry `assignee_id` which is the Breezeway
    //    user id (a number). In our DB that lives on breezewayTeam.breezewayId
    //    (stored as varchar). cleaners.breezewayTeamId is an int FK to
    //    breezewayTeam.id (the local PK).
    //
    //    We build two maps in two passes so that a type-coercion or a wrong-id
    //    link on either side is impossible to silently drop:
    //
    //      A) teamRowIdToBwNumericId : breezewayTeam.id (local PK)  → numeric Breezeway user id
    //      B) bwNumericIdToTeamRowId : numeric Breezeway user id    → breezewayTeam.id (local PK)
    //
    //    Then we walk every cleaner and look up its Breezeway user id via
    //    whichever map matches, covering the case where `cleaners.breezewayTeamId`
    //    was accidentally populated with the Breezeway numeric id instead of
    //    the local PK.
    const allCleaners = await getCleaners();
    const teamMembers = await db.select().from(breezewayTeam);

    const teamRowIdToBwNumericId = new Map<number, number>();
    const bwNumericIdToTeamRowId = new Map<number, number>();
    for (const tm of teamMembers) {
      const numericBwId = Number(tm.breezewayId);
      if (Number.isFinite(numericBwId)) {
        teamRowIdToBwNumericId.set(Number(tm.id), numericBwId);
        bwNumericIdToTeamRowId.set(numericBwId, Number(tm.id));
      }
    }

    // Map: breezeway assignee_id → cleaner.id
    const bwAssigneeToCleanerId = new Map<number, number>();
    let linkedViaPk = 0;
    let linkedViaBwId = 0;
    let unlinked = 0;
    for (const c of allCleaners) {
      if (c.breezewayTeamId == null) continue;
      const raw = Number(c.breezewayTeamId);
      if (!Number.isFinite(raw)) {
        unlinked++;
        continue;
      }
      // First try: treat stored value as a local breezewayTeam.id PK (the
      // intended schema).
      let bwNumericId = teamRowIdToBwNumericId.get(raw);
      if (bwNumericId != null) {
        linkedViaPk++;
      } else if (bwNumericIdToTeamRowId.has(raw)) {
        // Fallback: stored value is ALREADY the Breezeway numeric id (some
        // rows may have been mislinked this way).
        bwNumericId = raw;
        linkedViaBwId++;
      } else {
        unlinked++;
        continue;
      }
      bwAssigneeToCleanerId.set(bwNumericId, c.id);
    }

    console.log(
      `[CleanSync] Lookup maps: ${bwHomeIdToListing.size} properties, ${bwAssigneeToCleanerId.size} cleaners (via-pk=${linkedViaPk} via-bwId=${linkedViaBwId} unlinked=${unlinked} / ${allCleaners.length} total cleaners, ${teamMembers.length} team rows)`
    );

    // 3. Get existing breezewayTaskIds to avoid duplicates
    const existingCleans = await db
      .select({ breezewayTaskId: completedCleans.breezewayTaskId })
      .from(completedCleans);
    const existingTaskIds = new Set(existingCleans.map((c) => c.breezewayTaskId));

    // 4. Fetch completed housekeeping tasks from Breezeway
    // Use reference_property_id when available (faster), fall back to home_id (breezewayId)
    // for properties that don't have a referencePropertyId set. This mirrors the LeisrBilling
    // fix pattern — previously we dropped all properties without referencePropertyId.
    const queryableProperties = properties;
    result.propertiesQueried = queryableProperties.length;
    let allTasks: BreezewayTaskResponse[] = [];
    let rawFetched = 0;

    for (const property of queryableProperties) {
      try {
        let page = 1;
        let hasMore = true;

        while (hasMore) {
          const params: Record<string, any> = {
            type_department: "housekeeping",
            limit: 100,
            page,
          };
          if (property.referencePropertyId) {
            params.reference_property_id = property.referencePropertyId;
          } else {
            params.home_id = Number(property.breezewayId);
          }
          const response = await client.get<{
            results?: BreezewayTaskResponse[];
            total_pages?: number;
          }>("/task/", params);

          const tasks = response.results || [];
          rawFetched += tasks.length;
          // Filter to only completed/finished tasks
          const completedTasks = tasks.filter(
            (t) =>
              t.type_task_status?.stage === "finished" ||
              t.type_task_status?.stage === "closed"
          );
          allTasks = allTasks.concat(completedTasks);
          result.total += completedTasks.length;

          if (tasks.length === 0 || page >= (response.total_pages || 1)) {
            hasMore = false;
          } else {
            page++;
          }
        }
      } catch (err: any) {
        console.error(
          `[CleanSync] Error fetching tasks for property ${property.breezewayId}: ${err?.message}`
        );
        result.errors++;
      }
    }

    console.log(
      `[CleanSync] Queried ${queryableProperties.length} properties · raw tasks: ${rawFetched} · finished/closed: ${allTasks.length}`
    );

    // Hard cutoff: skip tasks created before Feb 1, 2026 (wider window for scoring)
    const CUTOFF_DATE = new Date("2026-02-01T00:00:00.000Z");

    // 5. Process each task
    for (const task of allTasks) {
      try {
        // Skip old tasks
        if (task.created_at && new Date(task.created_at) < CUTOFF_DATE) {
          result.skippedOldDate = (result.skippedOldDate ?? 0) + 1;
          continue;
        }

        const taskIdStr = String(task.id);

        // Skip if already imported
        if (existingTaskIds.has(taskIdStr)) {
          result.skipped++;
          result.skippedDupe = (result.skippedDupe ?? 0) + 1;
          continue;
        }

        // Find the assignee cleaner. Coerce to Number since Breezeway
        // sometimes serialises ids as strings and Map lookups are strict.
        const assignees = task.assignments || [];
        const matchedCleanerIds: number[] = [];
        for (const a of assignees) {
          const aid = Number(a.assignee_id);
          if (!Number.isFinite(aid)) continue;
          const cleanerId = bwAssigneeToCleanerId.get(aid);
          if (cleanerId) matchedCleanerIds.push(cleanerId);
        }

        // Resolve listing first — we need it for both pay records and
        // cleaning reports.  If the Breezeway property doesn't map to any
        // listing we SKIP entirely (archived/dead properties).
        const listing = bwHomeIdToListing.get(task.home_id);
        if (!listing) {
          result.skipped++;
          result.skippedNoListing = (result.skippedNoListing ?? 0) + 1;
          continue;
        }

        if (matchedCleanerIds.length === 0) {
          // No matched cleaner. If the listing has cleaning reports enabled,
          // we still insert with cleanerId=null so the report fires. Otherwise
          // skip — these are properties where we don't track pay either.
          if (!listing.cleaningReportsEnabled) {
            result.skipped++;
            result.skippedNoCleaner = (result.skippedNoCleaner ?? 0) + 1;
            if ((result.skippedNoCleaner ?? 0) <= 3 && assignees.length > 0) {
              console.log(
                `[CleanSync] no-cleaner sample: task=${task.id} assignees=${JSON.stringify(assignees.map((a) => ({ id: a.assignee_id, name: a.name })))}`
              );
            }
            continue;
          }
          // Fall through — insert with cleanerId=null for report-only
          console.log(
            `[CleanSync] No cleaner matched for task ${task.id} on "${listing.internalName || listing.name}" but cleaningReports enabled — inserting for report`
          );
        }
        const propertyName = listing.internalName || listing.name || `Property ${task.home_id}`;
        const cleaningFee = listing.cleaningFeeCharge
          ? String(listing.cleaningFeeCharge)
          : "0";
        const distanceMiles = listing.distanceFromStorage
          ? String(listing.distanceFromStorage)
          : "0";
        const scheduledDate = task.scheduled_date
          ? new Date(task.scheduled_date)
          : task.completed_at
          ? new Date(task.completed_at)
          : new Date();
        const weekOf = getPayWeekStart(scheduledDate);

        // Determine if this is a paired clean (2 matched cleaners)
        const isPaired = matchedCleanerIds.length >= 2;
        const splitRatio = isPaired ? "0.50" : "1.00";

        // Insert for the primary cleaner (may be null for report-only records)
        const primaryCleanerId = matchedCleanerIds[0] ?? null;
        const pairedCleanerId = isPaired ? matchedCleanerIds[1] : null;

        const [insertResult] = await db.insert(completedCleans).values({
          breezewayTaskId: taskIdStr,
          cleanerId: primaryCleanerId,
          listingId: listing.id,
          propertyName,
          taskTitle: task.name || null,
          reportUrl: task.report_url || null,
          scheduledDate,
          completedDate: task.completed_at ? new Date(task.completed_at) : scheduledDate,
          cleaningFee,
          distanceMiles,
          weekOf,
          pairedCleanerId,
          splitRatio,
        });
        existingTaskIds.add(taskIdStr);
        result.created++;
        if (insertResult?.insertId) newCleanIds.push(insertResult.insertId);

        // If paired, insert partner record too
        if (isPaired && pairedCleanerId) {
          const partnerTaskId = `${taskIdStr}-partner`;
          if (!existingTaskIds.has(partnerTaskId)) {
            await db.insert(completedCleans).values({
              breezewayTaskId: partnerTaskId,
              cleanerId: pairedCleanerId,
              listingId: listing.id,
              propertyName,
              taskTitle: task.name || null,
          reportUrl: task.report_url || null,
              scheduledDate,
              completedDate: task.completed_at ? new Date(task.completed_at) : scheduledDate,
              cleaningFee,
              distanceMiles,
              weekOf,
              pairedCleanerId: primaryCleanerId,
              splitRatio,
            });
            existingTaskIds.add(partnerTaskId);
            result.created++;
          }
        }
      } catch (err: any) {
        console.error(`[CleanSync] Error processing task ${task.id}: ${err?.message}`);
        result.errors++;
      }
    }

    console.log(
      `[CleanSync] Complete: ${result.created} created, ${result.skipped} skipped (${result.skippedDupe} dupe, ${result.skippedNoCleaner} no-cleaner, ${result.skippedNoListing} no-listing, ${result.skippedOldDate} old-date), ${result.errors} errors`
    );

    // Send cleaning report emails for newly synced cleans
    if (newCleanIds.length > 0) {
      try {
        const reportResult = await sendCleaningReportsForNewCleans(newCleanIds);
        console.log(
          `[CleanSync] Cleaning reports: ${reportResult.sent} sent, ${reportResult.failed} failed, ${reportResult.skipped} skipped`
        );
      } catch (err: any) {
        console.error("[CleanSync] Cleaning report emails failed:", err.message);
      }
    }
  } catch (err: any) {
    console.error("[CleanSync] Sync failed:", err.message);
    result.errors++;
  }

  result.finishedAt = new Date().toISOString();
  lastCleanSyncResult = result;
  return result;
}
