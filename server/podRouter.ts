/**
 * Pod System Router
 *
 * Manages geographic property clusters (pods), pod-level vendor directories,
 * property-level vendor overrides, and property-to-pod assignments.
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { buildAssignmentSuggestions } from "./podAutoAssign";
import {
  listPods,
  getPod,
  createPod,
  updatePod,
  deletePod,
  assignPropertiesToPod,
  unassignProperties,
  listPropertiesWithPods,
  listPodVendors,
  createPodVendor,
  updatePodVendor,
  deletePodVendor,
  listPropertyVendors,
  createPropertyVendor,
  updatePropertyVendor,
  deletePropertyVendor,
  getEffectiveVendors,
  getDb,
} from "./db";
import { listings } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { makeRequest, DistanceMatrixResult } from "./_core/map";
import { seedPodStorageAddresses } from "./seedPodAddresses";

const vendorSpecialtyEnum = z.enum([
  "plumber",
  "electrician",
  "hvac",
  "handyman",
  "pest_control",
  "landscaper",
  "appliance_repair",
]);

export const podRouter = router({
  // ── Pod CRUD ────────────────────────────────────────────────────────

  /** List all pods with property counts */
  list: protectedProcedure.query(async () => {
    return listPods();
  }),

  /** Get a single pod with its vendors */
  get: protectedProcedure
    .input(z.object({ podId: z.number() }))
    .query(async ({ input }) => {
      const pod = await getPod(input.podId);
      const vendors = pod ? await listPodVendors(input.podId) : [];
      return { pod, vendors };
    }),

  /** Create a new pod */
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        region: z.string().max(512).optional(),
        storageAddress: z.string().max(512).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return createPod(input);
    }),

  /** Update a pod */
  update: adminProcedure
    .input(
      z.object({
        podId: z.number(),
        name: z.string().min(1).max(128).optional(),
        region: z.string().max(512).optional(),
        storageAddress: z.string().max(512).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { podId, ...data } = input;
      await updatePod(podId, data);
      return { success: true };
    }),

  /**
   * Calculate driving distances from a POD's storage address to all properties in that POD.
   * Uses Google Maps Distance Matrix API. Stores results in listings.distanceFromStorage.
   */
  calculateDistances: adminProcedure
    .input(z.object({ podId: z.number() }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;
      const pod = await getPod(input.podId);
      if (!pod) throw new Error("Pod not found");
      if (!pod.storageAddress) throw new Error("Pod has no storage address set");

      // Get all properties in this pod that have an address
      const properties = await listPropertiesWithPods();
      const podProperties = properties.filter(
        (p) => p.podId === input.podId && p.address
      );

      if (podProperties.length === 0) {
        return { updated: 0, total: 0, errors: 0 };
      }

      let updated = 0;
      let errors = 0;

      // Google Distance Matrix API supports max 25 destinations per request
      const BATCH_SIZE = 25;
      for (let i = 0; i < podProperties.length; i += BATCH_SIZE) {
        const batch = podProperties.slice(i, i + BATCH_SIZE);
        const destinations = batch.map((p) => p.address!).join("|");

        try {
          const result = await makeRequest<DistanceMatrixResult>(
            "/maps/api/distancematrix/json",
            {
              origins: pod.storageAddress,
              destinations,
              units: "imperial",
              mode: "driving",
            }
          );

          if (result.status !== "OK") {
            console.error(`[POD Mileage] Distance Matrix API error: ${result.status}`);
            errors += batch.length;
            continue;
          }

          const elements = result.rows[0]?.elements || [];
          for (let j = 0; j < elements.length; j++) {
            const element = elements[j];
            const property = batch[j];
            if (element.status === "OK") {
              // distance.value is in meters, convert to miles (one-way)
              const miles = Number((element.distance.value / 1609.34).toFixed(2));
              await db
                .update(listings)
                .set({ distanceFromStorage: String(miles) })
                .where(eq(listings.id, property.id));
              updated++;
              console.log(
                `[POD Mileage] ${property.name}: ${miles} mi from ${pod.name} storage`
              );
            } else {
              console.warn(
                `[POD Mileage] Could not calculate distance for ${property.name}: ${element.status}`
              );
              errors++;
            }
          }
        } catch (err: any) {
          console.error(`[POD Mileage] Batch error: ${err.message}`);
          errors += batch.length;
        }
      }

      return { updated, total: podProperties.length, errors };
    }),

  /** Seed the 3 WNC POD storage addresses */
  seedAddresses: adminProcedure.mutation(async () => {
    return seedPodStorageAddresses();
  }),

  /** Delete a pod */
  delete: adminProcedure
    .input(z.object({ podId: z.number() }))
    .mutation(async ({ input }) => {
      await deletePod(input.podId);
      return { success: true };
    }),

  // ── Property Assignment ─────────────────────────────────────────────

  /** List all properties with their pod assignment */
  properties: protectedProcedure.query(async () => {
    return listPropertiesWithPods();
  }),

  /** Assign properties to a pod (bulk) */
  assignProperties: adminProcedure
    .input(
      z.object({
        podId: z.number(),
        listingIds: z.array(z.number()).min(1),
      })
    )
    .mutation(async ({ input }) => {
      await assignPropertiesToPod(input.podId, input.listingIds);
      return { success: true, count: input.listingIds.length };
    }),

  /** Unassign properties from any pod */
  unassignProperties: adminProcedure
    .input(z.object({ listingIds: z.array(z.number()).min(1) }))
    .mutation(async ({ input }) => {
      await unassignProperties(input.listingIds);
      return { success: true, count: input.listingIds.length };
    }),

  /**
   * Preview auto-assignment: classify all unassigned properties by location
   * and return suggestions with confidence levels. Does NOT write to DB.
   */
  previewAutoAssign: protectedProcedure.query(async () => {
    const allPods = await listPods();
    const properties = await listPropertiesWithPods();
    const suggestions = buildAssignmentSuggestions(properties);
    return {
      pods: allPods,
      suggestions,
      summary: {
        total: suggestions.length,
        high: suggestions.filter((s) => s.confidence === "high").length,
        low: suggestions.filter((s) => s.confidence === "low").length,
        random: suggestions.filter((s) => s.confidence === "random").length,
        alreadyAssigned: suggestions.filter((s) => s.currentPodId !== null).length,
      },
    };
  }),

  /**
   * Execute auto-assignment: apply confirmed assignments to the DB.
   * Accepts an array of { listingId, podName } — the caller has already
   * reviewed and confirmed all assignments (including overrides).
   */
  executeAutoAssign: adminProcedure
    .input(
      z.object({
        assignments: z.array(
          z.object({
            listingId: z.number(),
            podName: z.string(),
          })
        ).min(1),
      })
    )
    .mutation(async ({ input }) => {
      const allPods = await listPods();
      const podByName = new Map(allPods.map((p) => [p.name, p.id]));

      // Group listing IDs by target pod
      const byPod = new Map<number, number[]>();
      const unresolved: string[] = [];

      for (const { listingId, podName } of input.assignments) {
        const podId = podByName.get(podName);
        if (!podId) {
          unresolved.push(`${listingId}:${podName}`);
          continue;
        }
        const existing = byPod.get(podId) ?? [];
        existing.push(listingId);
        byPod.set(podId, existing);
      }

      // Bulk-assign each group
      let assigned = 0;
      for (const [podId, listingIds] of byPod.entries()) {
        await assignPropertiesToPod(podId, listingIds);
        assigned += listingIds.length;
      }

      return { assigned, unresolved };
    }),

  // ── Pod Vendor Directory ────────────────────────────────────────────

  /** List vendors for a pod */
  listVendors: protectedProcedure
    .input(z.object({ podId: z.number() }))
    .query(async ({ input }) => {
      return listPodVendors(input.podId);
    }),

  /** Add a vendor to a pod */
  createVendor: adminProcedure
    .input(
      z.object({
        podId: z.number(),
        name: z.string().min(1).max(256),
        phone: z.string().max(32).optional(),
        email: z.string().email().max(320).optional(),
        company: z.string().max(256).optional(),
        specialty: vendorSpecialtyEnum,
        notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return createPodVendor(input);
    }),

  /** Update a pod vendor */
  updateVendor: adminProcedure
    .input(
      z.object({
        vendorId: z.number(),
        name: z.string().min(1).max(256).optional(),
        phone: z.string().max(32).optional().nullable(),
        email: z.string().email().max(320).optional().nullable(),
        company: z.string().max(256).optional().nullable(),
        specialty: vendorSpecialtyEnum.optional(),
        notes: z.string().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const { vendorId, ...data } = input;
      await updatePodVendor(vendorId, data);
      return { success: true };
    }),

  /** Delete a pod vendor */
  deleteVendor: adminProcedure
    .input(z.object({ vendorId: z.number() }))
    .mutation(async ({ input }) => {
      await deletePodVendor(input.vendorId);
      return { success: true };
    }),

  // ── Property Vendor Overrides ───────────────────────────────────────

  /** List vendor overrides for a property */
  listPropertyVendors: protectedProcedure
    .input(z.object({ listingId: z.number() }))
    .query(async ({ input }) => {
      return listPropertyVendors(input.listingId);
    }),

  /** Add a property-level vendor override */
  createPropertyVendor: adminProcedure
    .input(
      z.object({
        listingId: z.number(),
        name: z.string().min(1).max(256),
        phone: z.string().max(32).optional(),
        email: z.string().email().max(320).optional(),
        company: z.string().max(256).optional(),
        specialty: vendorSpecialtyEnum,
        notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return createPropertyVendor(input);
    }),

  /** Update a property vendor override */
  updatePropertyVendor: adminProcedure
    .input(
      z.object({
        vendorId: z.number(),
        name: z.string().min(1).max(256).optional(),
        phone: z.string().max(32).optional().nullable(),
        email: z.string().email().max(320).optional().nullable(),
        company: z.string().max(256).optional().nullable(),
        specialty: vendorSpecialtyEnum.optional(),
        notes: z.string().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const { vendorId, ...data } = input;
      await updatePropertyVendor(vendorId, data);
      return { success: true };
    }),

  /** Delete a property vendor override */
  deletePropertyVendor: adminProcedure
    .input(z.object({ vendorId: z.number() }))
    .mutation(async ({ input }) => {
      await deletePropertyVendor(input.vendorId);
      return { success: true };
    }),

  /** Get effective vendors for a property (property overrides > pod defaults) */
  effectiveVendors: protectedProcedure
    .input(z.object({ listingId: z.number() }))
    .query(async ({ input }) => {
      return getEffectiveVendors(input.listingId);
    }),
});
