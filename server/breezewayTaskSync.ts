/**
 * Breezeway Task Sync Engine
 * Polls the Breezeway API for tasks assigned to Leisr Stays and upserts them into the local DB.
 * Uses incremental fetching via updated_at to minimize API calls.
 *
 * NOTE: This file was truncated during Manus zip export. The main pollBreezewayTasks function
 * is partially reconstructed. Some helper functions may be missing.
 */

import { createBreezewayClient } from "./breezeway";
import {
  getBreezewayProperties,
  getListings,
  getBreezewaySyncConfig,
  updateBreezewaySyncConfig,
  upsertBreezewayTask,
  getTaskByBreezewayId,
} from "./db";

// Types
interface SyncResult {
  created: number;
  updated: number;
  hidden: number;
  errors: number;
  total: number;
}

interface BreezewayTaskResponse {
  id: number;
  name: string;
  type_department?: string;
  type_task_status?: { stage?: string };
  created_at?: string;
  updated_at?: string;
  assignments?: { assignee_id: number }[];
  reference_property_id?: number;
  [key: string]: any;
}

const ALLOWED_DEPARTMENTS = new Set([
  "cleaning",
  "maintenance",
  "inspection",
  "general",
]);

let syncActive = false;

async function lookupLeisrStaysAssigneeId(): Promise<number | null> {
  try {
    const client = createBreezewayClient();
    const team = await client.get<{ results?: { id: number; name: string }[] }>("/team/");
    const member = team.results?.find(
      (m) => m.name?.toLowerCase().includes("leisr")
    );
    return member?.id ?? null;
  } catch {
    return null;
  }
}

export async function activateBreezewayTaskSync(): Promise<void> {
  syncActive = true;
  await updateBreezewaySyncConfig({ enabled: true, syncActivatedAt: new Date().toISOString() });
}

export async function deactivateBreezewayTaskSync(): Promise<void> {
  syncActive = false;
  await updateBreezewaySyncConfig({ enabled: false });
}

export async function closeBreezewayTask(taskId: number): Promise<void> {
  const client = createBreezewayClient();
  await client.patch(`/task/${taskId}/`, { type_task_status: { stage: "completed" } });
}

export async function reopenBreezewayTask(taskId: number): Promise<void> {
  const client = createBreezewayClient();
  await client.patch(`/task/${taskId}/`, { type_task_status: { stage: "open" } });
}

export async function pollBreezewayTasks(): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    hidden: 0,
    errors: 0,
    total: 0,
  };

  const config = await getBreezewaySyncConfig();
  if (!config.enabled) {
    console.log("[BreezewaySyncEngine] Sync is disabled, skipping");
    return result;
  }

  let assigneeId = config.leisrStaysAssigneeId;
  if (!assigneeId) {
    assigneeId = await lookupLeisrStaysAssigneeId();
    if (!assigneeId) {
      console.error("[BreezewaySyncEngine] Cannot sync: Leisr Stays assignee ID not found");
      return result;
    }
    await updateBreezewaySyncConfig({ leisrStaysAssigneeId: assigneeId });
  }

  try {
    const client = createBreezewayClient();
    const properties = await getBreezewayProperties();
    console.log(`[BreezewaySyncEngine] Fetching tasks across ${properties.length} properties`);

    const allListings = await getListings();
    const hostawayIdToListingId = new Map<string, number>();
    for (const l of allListings) {
      if (l.hostawayId) hostawayIdToListingId.set(String(l.hostawayId), l.id);
    }

    const queryableProperties = properties.filter((p) => p.referencePropertyId);

    for (const property of queryableProperties) {
      try {
        const params: Record<string, any> = {
          reference_property_id: property.referencePropertyId,
          assignee_ids: assigneeId,
          limit: 100,
          page: 1,
        };

        const response = await client.get<{
          results?: BreezewayTaskResponse[];
        }>("/task/", params);

        const tasks = response.results || [];
        result.total += tasks.length;

        for (const bwTask of tasks) {
          try {
            const dept = bwTask.type_department?.toLowerCase();
            if (dept && !ALLOWED_DEPARTMENTS.has(dept)) continue;

            const WAND_CUTOFF_DATE = new Date("2026-03-30T00:00:00.000Z");
            if (bwTask.created_at && new Date(bwTask.created_at) < WAND_CUTOFF_DATE) continue;

            const existing = await getTaskByBreezewayId(bwTask.id);
            const listingId = property.referencePropertyId
              ? hostawayIdToListingId.get(String(property.referencePropertyId))
              : undefined;

            await upsertBreezewayTask({
              breezewayId: bwTask.id,
              name: bwTask.name,
              department: bwTask.type_department || null,
              stage: bwTask.type_task_status?.stage || null,
              listingId: listingId || null,
              rawData: bwTask,
            });

            if (existing) {
              result.updated++;
            } else {
              result.created++;
            }
          } catch (taskErr: any) {
            result.errors++;
          }
        }
      } catch (propErr: any) {
        console.error(`[BreezewaySyncEngine] Error fetching property ${property.breezewayId}: ${propErr?.message}`);
        result.errors++;
      }
    }

    await updateBreezewaySyncConfig({ lastPollAt: new Date().toISOString() });
  } catch (err: any) {
    console.error("[BreezewaySyncEngine] Poll failed:", err?.message);
    result.errors++;
  }

  console.log(`[BreezewaySyncEngine] Sync complete: ${JSON.stringify(result)}`);
  return result;
}
