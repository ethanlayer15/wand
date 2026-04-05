/**
 * Compensation Router — tRPC endpoints for Phase 1 compensation features.
 * Handles cleaner management, rolling scores, property tier/distance admin.
 */
import { z } from "zod";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import {
  getCleaners,
  getCleanerById,
  upsertCleaner,
  getCleanerScoreHistory,
  recalculateAllRollingScores,
  calculateCleanerRollingScore,
  getMultiplierForScore,
  getMultiplierLabel,
  getNextTierInfo,
  BEDROOM_TIERS,
  updatePropertyCompensationFields,
  bulkUpdatePropertyCompensation,
  calculateMileageReimbursement,
  calculateCleanBonus,
} from "./compensation";
import {
  runCleanerAttribution,
  getCleanerScorecards,
  getAttributionStats,
} from "./cleanerAttribution";
import { getListings, getDb, getCleanerPodIds, setCleanerPods, getAllCleanerPodAssignments } from "./db";
import { cleaners, listings, completedCleans, pods } from "../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import { getWeekOfMonday } from "./payCalculation";
import { syncCompletedCleans } from "./breezewayCleanSync";

export const compensationRouter = router({
  // ── Cleaner-POD Assignments ──────────────────────────────────────

  cleanerPods: router({
    /** Get POD IDs assigned to a specific cleaner */
    getForCleaner: publicProcedure
      .input(z.object({ cleanerId: z.number() }))
      .query(async ({ input }) => {
        return getCleanerPodIds(input.cleanerId);
      }),

    /** Get all cleaner-pod assignments as a plain object (for bulk UI loading) */
    getAll: publicProcedure.query(async () => {
      const map = await getAllCleanerPodAssignments();
      const result: Record<string, number[]> = {};
      map.forEach((podIds, cleanerId) => { result[String(cleanerId)] = podIds; });
      return result;
    }),

    /** Set POD assignments for a cleaner (replaces existing) */
    set: adminProcedure
      .input(z.object({
        cleanerId: z.number(),
        podIds: z.array(z.number()),
      }))
      .mutation(async ({ input }) => {
        await setCleanerPods(input.cleanerId, input.podIds);
        return { success: true };
      }),
  }),

  // ── Cleaners ──────────────────────────────────────────────────────

  cleaners: router({
    list: publicProcedure.query(async () => {
      const allCleaners = await getCleaners();
      return allCleaners.map((c) => ({
        ...c,
        multiplierLabel: getMultiplierLabel(Number(c.currentMultiplier ?? 1.0)),
        nextTier: getNextTierInfo(c.currentRollingScore ? Number(c.currentRollingScore) : null),
      }));
    }),

    get: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const cleaner = await getCleanerById(input.id);
        if (!cleaner) return null;
        return {
          ...cleaner,
          multiplierLabel: getMultiplierLabel(Number(cleaner.currentMultiplier ?? 1.0)),
          nextTier: getNextTierInfo(cleaner.currentRollingScore ? Number(cleaner.currentRollingScore) : null),
        };
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        email: z.string().email().optional(),
        breezewayTeamId: z.number().optional(),
        quickbooksEmployeeId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await upsertCleaner(input);
        return { success: true };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        email: z.string().email().nullable().optional(),
        quickbooksEmployeeId: z.string().nullable().optional(),
        active: z.boolean().optional(),
        podId: z.number().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const updateData: Record<string, any> = {};
        if (input.name !== undefined) updateData.name = input.name;
        if (input.email !== undefined) updateData.email = input.email;
        if (input.quickbooksEmployeeId !== undefined) updateData.quickbooksEmployeeId = input.quickbooksEmployeeId;
        if (input.active !== undefined) updateData.active = input.active;
        if (input.podId !== undefined) updateData.podId = input.podId;
        await db.update(cleaners).set(updateData).where(eq(cleaners.id, input.id));
        return { success: true };
      }),

    scoreHistory: publicProcedure
      .input(z.object({ cleanerId: z.number(), limit: z.number().default(30) }))
      .query(async ({ input }) => {
        return getCleanerScoreHistory(input.cleanerId, input.limit);
      }),

    recalculateScores: protectedProcedure.mutation(async () => {
      const result = await recalculateAllRollingScores();
      return result;
    }),

    recalculateSingle: protectedProcedure
      .input(z.object({ cleanerId: z.number() }))
      .mutation(async ({ input }) => {
        const cleaner = await getCleanerById(input.cleanerId);
        if (!cleaner) throw new Error("Cleaner not found");
        const { score, reviewCount, multiplier } = await calculateCleanerRollingScore(cleaner.name);
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db
          .update(cleaners)
          .set({
            currentRollingScore: score !== null ? String(score) : null,
            currentMultiplier: String(multiplier),
            scoreLastCalculatedAt: new Date(),
          })
          .where(eq(cleaners.id, cleaner.id));
        return { score, reviewCount, multiplier };
      }),
  }),

  // ── Property Compensation Admin ───────────────────────────────────

  properties: router({
    /** List all properties with compensation fields */
    list: publicProcedure.query(async () => {
      const allListings = await getListings();
      return allListings.map((l) => ({
        id: l.id,
        name: l.name,
        internalName: l.internalName,
        city: l.city,
        state: l.state,
        bedroomTier: l.bedroomTier,
        distanceFromStorage: l.distanceFromStorage,
        cleaningFeeCharge: l.cleaningFeeCharge,
        podId: l.podId ?? null,
        bedroomTierLabel: l.bedroomTier
          ? BEDROOM_TIERS.find((t) => t.tier === l.bedroomTier)?.label ?? `Tier ${l.bedroomTier}`
          : null,
      }));
    }),

    /** Update a single property's compensation fields */
    update: protectedProcedure
      .input(z.object({
        listingId: z.number(),
        bedroomTier: z.number().min(1).max(5).nullable().optional(),
        distanceFromStorage: z.string().nullable().optional(),
        cleaningFeeCharge: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        await updatePropertyCompensationFields(input.listingId, {
          bedroomTier: input.bedroomTier,
          distanceFromStorage: input.distanceFromStorage,
          cleaningFeeCharge: input.cleaningFeeCharge,
        });
        return { success: true };
      }),

    /** Bulk update from spreadsheet import */
    bulkUpdate: protectedProcedure
      .input(z.object({
        updates: z.array(z.object({
          listingId: z.number(),
          bedroomTier: z.number().min(1).max(5).nullable().optional(),
          distanceFromStorage: z.string().nullable().optional(),
          cleaningFeeCharge: z.string().nullable().optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        return bulkUpdatePropertyCompensation(input.updates);
      }),
  }),

  // ── Reference data ────────────────────────────────────────────────

  tiers: publicProcedure.query(() => {
    return BEDROOM_TIERS.map((t) => ({
      ...t,
      // Include calculated values for reference
      baseHourlyPay: 14.0 * t.expectedHours,
    }));
  }),

  // ── Attribution ──────────────────────────────────────────────────

  attribution: router({
    /** Run the full cleaner attribution process */
    run: protectedProcedure.mutation(async () => {
      const result = await runCleanerAttribution();
      return result;
    }),

    /** Get cleaner scorecards with attribution data */
    scorecards: publicProcedure.query(async () => {
      return getCleanerScorecards();
    }),

    /** Get attribution summary stats */
    stats: publicProcedure.query(async () => {
      return getAttributionStats();
    }),
  }),

  /**
   * Send weekly pay reports to all active cleaners (admin manual trigger).
   */
  sendWeeklyReports: adminProcedure
    .input(z.object({
      weekOf: z.string().optional(),
    }).optional())
    .mutation(async ({ input }) => {
      const { sendAllWeeklyPayReports } = await import("./emailReports");
      const result = await sendAllWeeklyPayReports(input?.weekOf);
      return result;
    }),

  /**
   * Send receipt reminders to all active cleaners (admin manual trigger).
   */
  sendReceiptReminders: adminProcedure
    .mutation(async () => {
      const { sendReceiptReminders } = await import("./emailReports");
      const result = await sendReceiptReminders();
      return result;
    }),

  /**
   * Log a completed clean (admin). Supports paired/split cleans.
   * When pairedCleanerId is set, splitRatio is automatically set to 0.50 for both cleaners.
   */
  logClean: adminProcedure
    .input(z.object({
      cleanerId: z.number(),
      pairedCleanerId: z.number().nullable().optional(),
      propertyName: z.string().min(1),
      listingId: z.number().nullable().optional(),
      cleaningFee: z.number().min(0),
      distanceMiles: z.number().min(0).default(0),
      scheduledDate: z.string().optional(), // ISO date string
      breezewayTaskId: z.string().optional(), // optional override
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const scheduledDate = input.scheduledDate ? new Date(input.scheduledDate) : new Date();
      const weekOf = getWeekOfMonday(scheduledDate);
      const isPaired = !!input.pairedCleanerId;
      const splitRatio = isPaired ? "0.50" : "1.00";

      // Generate a unique breezewayTaskId if not provided
      const taskId = input.breezewayTaskId ?? `manual-${Date.now()}-${input.cleanerId}`;

      // Insert the primary cleaner's clean record
      await db.insert(completedCleans).values({
        breezewayTaskId: taskId,
        cleanerId: input.cleanerId,
        listingId: input.listingId ?? null,
        propertyName: input.propertyName,
        scheduledDate,
        cleaningFee: String(input.cleaningFee),
        distanceMiles: String(input.distanceMiles),
        weekOf,
        pairedCleanerId: input.pairedCleanerId ?? null,
        splitRatio,
      });

      // If paired, also insert a record for the partner cleaner
      if (isPaired && input.pairedCleanerId) {
        const partnerTaskId = `${taskId}-partner`;
        await db.insert(completedCleans).values({
          breezewayTaskId: partnerTaskId,
          cleanerId: input.pairedCleanerId,
          listingId: input.listingId ?? null,
          propertyName: input.propertyName,
          scheduledDate,
          cleaningFee: String(input.cleaningFee),
          distanceMiles: String(input.distanceMiles),
          weekOf,
          pairedCleanerId: input.cleanerId, // points back to primary
          splitRatio,
        });
      }

      return { success: true, weekOf, isPaired, splitRatio };
    }),

  /**
   * List completed cleans for a given week (admin view).
   */
  listCleans: adminProcedure
    .input(z.object({
      weekOf: z.string().optional(),
      cleanerId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const allCleans = await db
        .select()
        .from(completedCleans)
        .orderBy(desc(completedCleans.scheduledDate))
        .limit(200);

      let filtered = allCleans;
      if (input?.weekOf) {
        filtered = filtered.filter((c) => c.weekOf === input.weekOf);
      }
      if (input?.cleanerId) {
        filtered = filtered.filter((c) => c.cleanerId === input.cleanerId);
      }

      return filtered.map((c) => ({
        ...c,
        cleaningFee: Number(c.cleaningFee ?? 0),
        distanceMiles: Number(c.distanceMiles ?? 0),
        splitRatio: Number(c.splitRatio ?? 1),
        isPaired: c.pairedCleanerId !== null,
      }));
    }),

  /**
   * Delete a completed clean record (admin only).
   */
  deleteClean: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(completedCleans).where(eq(completedCleans.id, input.id));
      return { success: true };
    }),

  /** Estimate compensation for a single clean */
  /**
   * Sync completed cleans from Breezeway (admin). Manual trigger.
   */
  syncCleans: adminProcedure.mutation(async () => {
    const result = await syncCompletedCleans();
    return result;
  }),

  estimateClean: publicProcedure
    .input(z.object({
      bedroomTier: z.number().min(1).max(5),
      multiplier: z.number(),
      distanceFromStorage: z.number(),
      isThirdHouseOrMore: z.boolean().default(false),
    }))
    .query(({ input }) => {
      const tier = BEDROOM_TIERS.find((t) => t.tier === input.bedroomTier) ?? BEDROOM_TIERS[0];
      const baseHourly = 14.0 * tier.expectedHours;
      const { baseBonus, adjustedBonus, dockPenalty } = calculateCleanBonus(input.bedroomTier, input.multiplier);
      const mileage = calculateMileageReimbursement(input.distanceFromStorage, input.isThirdHouseOrMore);

      return {
        baseHourly: Number(baseHourly.toFixed(2)),
        baseBonus,
        adjustedBonus,
        mileage,
        dockPenalty,
        totalEstimate: Number((baseHourly + adjustedBonus + mileage - dockPenalty).toFixed(2)),
        breakdown: {
          tier: tier.label,
          expectedHours: tier.expectedHours,
          hourlyRate: 14.0,
          multiplier: input.multiplier,
          distanceMiles: input.distanceFromStorage,
        },
      };
    }),
});
