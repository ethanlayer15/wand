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
import { getWeekOfMonday } from "./payCalculation";

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
}

interface CleanSyncResult {
  created: number;
  skipped: number;
  errors: number;
  total: number;
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
  const result: CleanSyncResult = { created: 0, skipped: 0, errors: 0, total: 0 };

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
    // 1. breezewayProperties → listings (via referencePropertyId → hostawayId)
    const properties = await getBreezewayProperties();
    const allListings = await getListings();
    const hostawayIdToListing = new Map<string, typeof allListings[0]>();
    for (const l of allListings) {
      if (l.hostawayId) hostawayIdToListing.set(String(l.hostawayId), l);
    }
    const bwHomeIdToListing = new Map<number, typeof allListings[0]>();
    for (const p of properties) {
      if (p.referencePropertyId) {
        const listing = hostawayIdToListing.get(String(p.referencePropertyId));
        if (listing) {
          bwHomeIdToListing.set(Number(p.breezewayId), listing);
        }
      }
    }

    // 2. breezewayTeam.breezewayId → cleaners (via cleaners.breezewayTeamId)
    const allCleaners = await getCleaners();
    const teamMembers = await db.select().from(breezewayTeam);
    // Map: breezeway assignee_id (which is breezewayTeam.breezewayId) → cleaner
    const bwAssigneeToCleanerId = new Map<number, number>();
    for (const tm of teamMembers) {
      const cleaner = allCleaners.find((c) => c.breezewayTeamId === tm.id);
      if (cleaner) {
        bwAssigneeToCleanerId.set(Number(tm.breezewayId), cleaner.id);
      }
    }

    console.log(
      `[CleanSync] Lookup maps: ${bwHomeIdToListing.size} properties, ${bwAssigneeToCleanerId.size} cleaners`
    );

    // 3. Get existing breezewayTaskIds to avoid duplicates
    const existingCleans = await db
      .select({ breezewayTaskId: completedCleans.breezewayTaskId })
      .from(completedCleans);
    const existingTaskIds = new Set(existingCleans.map((c) => c.breezewayTaskId));

    // 4. Fetch completed housekeeping tasks from Breezeway
    const queryableProperties = properties.filter((p) => p.referencePropertyId);
    let allTasks: BreezewayTaskResponse[] = [];

    for (const property of queryableProperties) {
      try {
        let page = 1;
        let hasMore = true;

        while (hasMore) {
          const response = await client.get<{
            results?: BreezewayTaskResponse[];
            total_pages?: number;
          }>("/task/", {
            reference_property_id: property.referencePropertyId,
            type_department: "housekeeping",
            limit: 100,
            page,
          });

          const tasks = response.results || [];
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

    console.log(`[CleanSync] Fetched ${allTasks.length} completed housekeeping tasks`);

    // Hard cutoff: skip tasks created before March 30, 2026
    const CUTOFF_DATE = new Date("2026-03-30T00:00:00.000Z");

    // 5. Process each task
    for (const task of allTasks) {
      try {
        // Skip old tasks
        if (task.created_at && new Date(task.created_at) < CUTOFF_DATE) {
          continue;
        }

        const taskIdStr = String(task.id);

        // Skip if already imported
        if (existingTaskIds.has(taskIdStr)) {
          result.skipped++;
          continue;
        }

        // Find the assignee cleaner
        const assignees = task.assignments || [];
        const matchedCleanerIds: number[] = [];
        for (const a of assignees) {
          const cleanerId = bwAssigneeToCleanerId.get(a.assignee_id);
          if (cleanerId) matchedCleanerIds.push(cleanerId);
        }

        if (matchedCleanerIds.length === 0) {
          // No matched cleaner — skip (not one of our cleaners)
          result.skipped++;
          continue;
        }

        // Resolve listing
        const listing = bwHomeIdToListing.get(task.home_id);
        const propertyName = listing
          ? (listing.internalName || listing.name || `Property ${task.home_id}`)
          : task.name || `Breezeway Task ${task.id}`;
        const cleaningFee = listing?.cleaningFeeCharge
          ? String(listing.cleaningFeeCharge)
          : "0";
        const distanceMiles = listing?.distanceFromStorage
          ? String(listing.distanceFromStorage)
          : "0";
        const scheduledDate = task.scheduled_date
          ? new Date(task.scheduled_date)
          : task.completed_at
          ? new Date(task.completed_at)
          : new Date();
        const weekOf = getWeekOfMonday(scheduledDate);

        // Determine if this is a paired clean (2 matched cleaners)
        const isPaired = matchedCleanerIds.length >= 2;
        const splitRatio = isPaired ? "0.50" : "1.00";

        // Insert for the primary cleaner
        const primaryCleanerId = matchedCleanerIds[0];
        const pairedCleanerId = isPaired ? matchedCleanerIds[1] : null;

        await db.insert(completedCleans).values({
          breezewayTaskId: taskIdStr,
          cleanerId: primaryCleanerId,
          listingId: listing?.id ?? null,
          propertyName,
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

        // If paired, insert partner record too
        if (isPaired && pairedCleanerId) {
          const partnerTaskId = `${taskIdStr}-partner`;
          if (!existingTaskIds.has(partnerTaskId)) {
            await db.insert(completedCleans).values({
              breezewayTaskId: partnerTaskId,
              cleanerId: pairedCleanerId,
              listingId: listing?.id ?? null,
              propertyName,
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
      `[CleanSync] Complete: ${result.created} created, ${result.skipped} skipped, ${result.errors} errors`
    );
  } catch (err: any) {
    console.error("[CleanSync] Sync failed:", err.message);
    result.errors++;
  }

  return result;
}
