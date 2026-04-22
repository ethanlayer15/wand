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
  isScorableClean,
  isPartnerDupeClean,
  findResponsibleClean,
  cleanAssigneeIds,
  cleaningScoreForReview,
  normalizeRating,
  type CleanForMatching,
} from "./compensation";
import {
  runCleanerAttribution,
  getCleanerScorecards,
  getAttributionStats,
} from "./cleanerAttribution";
import {
  getListings,
  getDb,
  getCleanerPodIds,
  setCleanerPods,
  getAllCleanerPodAssignments,
  getBreezewaySyncConfig,
  getBreezewayProperties,
} from "./db";
import { cleaners, listings, completedCleans, pods, reviews, reviewAnalysis, breezewayTeam } from "../drizzle/schema";
import { eq, desc, gte, and, or, inArray, isNull, isNotNull } from "drizzle-orm";
import { getWeekOfMonday } from "./payCalculation";
import {
  syncCompletedCleans,
  getLastCleanSyncResult,
  isCleanSyncInProgress,
  startCleanSyncInBackground,
} from "./breezewayCleanSync";

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

    /**
     * Detail endpoint — returns the reviews, cleans, and scoring breakdown
     * that feed into a cleaner's rolling score. Supports date range filtering.
     */
    scoreDetail: publicProcedure
      .input(z.object({
        cleanerId: z.number(),
        daysBack: z.number().min(7).max(365).default(30),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;

        const cleaner = await getCleanerById(input.cleanerId);
        if (!cleaner) return null;

        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - input.daysBack);
        const cleansFromDate = new Date();
        cleansFromDate.setDate(cleansFromDate.getDate() - (input.daysBack + 15)); // wider window for cleans

        // Listings this cleaner has worked on in the window (as primary or paired)
        const cleanerCleans = await db.select().from(completedCleans).where(
          and(
            or(
              eq(completedCleans.cleanerId, input.cleanerId),
              eq(completedCleans.pairedCleanerId, input.cleanerId),
            ),
            gte(completedCleans.scheduledDate, cleansFromDate),
          ),
        );

        const listingIds = Array.from(
          new Set(cleanerCleans.map((c) => c.listingId).filter((id): id is number => id != null)),
        );

        // ALL scorable cleans on those listings in the window — pick the
        // clean responsible for each guest stay across all cleaners, then
        // check whether the current cleaner is on it.
        const allListingCleans = listingIds.length
          ? await db.select().from(completedCleans).where(
              and(inArray(completedCleans.listingId, listingIds), gte(completedCleans.scheduledDate, cleansFromDate)),
            )
          : [];

        const cleansByListing = new Map<number, CleanForMatching[]>();
        for (const c of allListingCleans) {
          if (!c.listingId || !c.scheduledDate) continue;
          if (isPartnerDupeClean(c)) continue;
          if (!isScorableClean(c.taskTitle)) continue;
          const entry: CleanForMatching = {
            id: c.id,
            scheduledDate: new Date(c.scheduledDate),
            taskTitle: c.taskTitle,
            cleanerId: c.cleanerId,
            pairedCleanerId: c.pairedCleanerId,
            breezewayTaskId: c.breezewayTaskId,
            reportUrl: c.reportUrl ?? null,
          };
          const arr = cleansByListing.get(c.listingId) ?? [];
          arr.push(entry);
          cleansByListing.set(c.listingId, arr);
        }

        // Get reviews in the date range — anchor on guest check-out
        // (departureDate) to match calculateCleanerRollingScore so the
        // cached score and this detail view stay in sync. Fall back to
        // submittedAt for older rows where Hostaway never populated
        // departureDate.
        const recentReviews = await db.select().from(reviews).where(
          or(
            gte(reviews.departureDate, fromDate),
            and(
              isNull(reviews.departureDate),
              gte(reviews.submittedAt, fromDate),
            ),
          ),
        );

        // Get AI analyses
        const { reviewAnalysis } = await import("../drizzle/schema");
        const allAnalyses = await db.select().from(reviewAnalysis);
        const analysisMap = new Map(allAnalyses.map((a: any) => [a.reviewId, a]));

        // Get listing names
        const allListings = await db.select().from(listings);
        const listingMap = new Map(allListings.map((l) => [l.id, l]));

        // Match reviews to cleans and build detail records
        const matchedReviews: Array<{
          reviewId: number;
          listingId: number;
          listingName: string;
          source: string;
          rating: number | null;
          cleanlinessRating: number | null;
          scoreUsed: number;
          scoreReason: string;
          guestName: string | null;
          publicReview: string | null;
          privateFeedback: string | null;
          arrivalDate: string | null;
          submittedAt: string | null;
          matchedCleanDate: string | null;
          matchedCleanTitle: string | null;
          matchedCleanReportUrl: string | null;
        }> = [];

        for (const review of recentReviews) {
          if (!review.listingId) continue;
          const cleansOnListing = cleansByListing.get(review.listingId);
          if (!cleansOnListing) continue;

          const arrival = review.arrivalDate || review.submittedAt;
          if (!arrival) continue;

          const responsible = findResponsibleClean(arrival, cleansOnListing);
          if (!responsible) continue;
          if (!cleanAssigneeIds(responsible).includes(input.cleanerId)) continue;

          const analysis = analysisMap.get(review.id);
          const { score: scoreUsed, reason: scoreReason } = cleaningScoreForReview(review, (analysis as any) ?? null);

          const listing = listingMap.get(review.listingId);
          matchedReviews.push({
            reviewId: review.id,
            listingId: review.listingId,
            listingName: listing?.internalName || listing?.name || `Listing #${review.listingId}`,
            source: review.source || "unknown",
            rating: normalizeRating(review.rating),
            cleanlinessRating: review.cleanlinessRating,
            scoreUsed,
            scoreReason,
            guestName: review.guestName,
            publicReview: review.text || null,
            privateFeedback: review.privateFeedback || null,
            arrivalDate: review.arrivalDate?.toISOString().slice(0, 10) ?? null,
            submittedAt: review.submittedAt?.toISOString().slice(0, 10) ?? null,
            matchedCleanDate: responsible.scheduledDate.toISOString().slice(0, 10),
            matchedCleanTitle: responsible.taskTitle,
            matchedCleanReportUrl: responsible.reportUrl ?? null,
          });
        }

        // Sort by submitted date descending
        matchedReviews.sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));

        // Compute summary
        const scores = matchedReviews.map((r) => r.scoreUsed);
        const avgScore = scores.length > 0
          ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2))
          : null;

        // Per-property breakdown
        const byProperty: Record<number, { name: string; count: number; avg: number }> = {};
        for (const r of matchedReviews) {
          if (!byProperty[r.listingId]) {
            byProperty[r.listingId] = { name: r.listingName, count: 0, avg: 0 };
          }
          byProperty[r.listingId].count++;
        }
        for (const lid of Object.keys(byProperty)) {
          const propReviews = matchedReviews.filter((r) => r.listingId === Number(lid));
          byProperty[Number(lid)].avg = Number(
            (propReviews.reduce((a, r) => a + r.scoreUsed, 0) / propReviews.length).toFixed(2)
          );
        }

        const cleanerScorableCount = cleanerCleans.filter((c) =>
          isScorableClean(c.taskTitle) && !isPartnerDupeClean(c),
        ).length;

        return {
          cleaner: { id: cleaner.id, name: cleaner.name, email: cleaner.email },
          daysBack: input.daysBack,
          totalCleans: cleanerCleans.length,
          scorableCleans: cleanerScorableCount,
          reviewCount: matchedReviews.length,
          avgScore,
          reviews: matchedReviews,
          byProperty: Object.values(byProperty).sort((a, b) => b.count - a.count),
        };
      }),

    /**
     * Diagnostic endpoint — explains why rolling score recalc is returning null for cleaners.
     * Returns counts at every step of the scoring pipeline so we can see exactly where it breaks.
     */
    scoreDiagnostic: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const fortyFiveDaysAgo = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);

      // 0. Breezeway sync config + linkage health
      const bwConfig = await getBreezewaySyncConfig();
      const bwProperties = await getBreezewayProperties();
      const bwTeamRows = await db.select().from(breezewayTeam);
      const propsWithRefId = bwProperties.filter((p) => p.referencePropertyId).length;
      const propsHomeIdOnly = bwProperties.length - propsWithRefId;

      // 1. Active cleaners
      const activeCleaners = await db.select().from(cleaners).where(eq(cleaners.active, true));
      const cleanersWithBwTeam = activeCleaners.filter((c) => c.breezewayTeamId != null).length;

      // 2. Completed cleans in last 45 days
      const recentCleans = await db
        .select()
        .from(completedCleans)
        .where(gte(completedCleans.scheduledDate, fortyFiveDaysAgo));

      // How many have a cleanerId set (i.e. matched to a cleaner record)
      const cleansWithCleanerId = recentCleans.filter((c) => c.cleanerId != null);
      const cleansWithListingId = recentCleans.filter((c) => c.listingId != null);
      const cleansFullyMatched = recentCleans.filter(
        (c) => c.cleanerId != null && c.listingId != null && c.scheduledDate != null
      );

      // Most recent clean to see staleness
      const latestCleanRow = await db
        .select({ date: completedCleans.scheduledDate })
        .from(completedCleans)
        .orderBy(desc(completedCleans.scheduledDate))
        .limit(1);
      const latestCleanDate = latestCleanRow[0]?.date ?? null;

      // 3. Reviews in last 30 days
      const recentReviews = await db
        .select()
        .from(reviews)
        .where(gte(reviews.submittedAt, thirtyDaysAgo));

      const reviewsBySource = {
        airbnb: recentReviews.filter((r) => r.source === "airbnb").length,
        vrbo: recentReviews.filter((r) => r.source === "vrbo").length,
        booking: recentReviews.filter((r) => r.source === "booking").length,
        direct: recentReviews.filter((r) => r.source === "direct").length,
        other: recentReviews.filter(
          (r) => !["airbnb", "vrbo", "booking", "direct"].includes(r.source ?? "")
        ).length,
      };
      const airbnbReviewsWithCleanliness = recentReviews.filter(
        (r) => r.source === "airbnb" && r.cleanlinessRating != null
      ).length;

      // 4. AI analyses in reviewAnalysis table for recent reviews (non-Airbnb path)
      const recentReviewIds = new Set(recentReviews.map((r) => r.id));
      const allAnalyses = await db.select({ reviewId: reviewAnalysis.reviewId }).from(reviewAnalysis);
      const analyzedRecentCount = allAnalyses.filter((a) => recentReviewIds.has(a.reviewId)).length;

      // 5. Per-cleaner breakdown — how many cleans+reviews would match for each active cleaner
      const perCleaner: Array<{
        cleanerId: number;
        name: string;
        cleansLast45Days: number;
        listingsCleanedLast45Days: number;
        matchableReviewsLast30Days: number;
        currentScore: string | null;
        lastCalculated: Date | null;
      }> = [];

      for (const cleaner of activeCleaners) {
        const myCleans = recentCleans.filter(
          (c) => c.cleanerId === cleaner.id && c.listingId != null && c.scheduledDate != null && isScorableClean(c.taskTitle)
        );
        const myListingIds = new Set(myCleans.map((c) => c.listingId!));
        const cleansByListing = new Map<number, Date[]>();
        for (const c of myCleans) {
          const arr = cleansByListing.get(c.listingId!) || [];
          arr.push(new Date(c.scheduledDate!));
          cleansByListing.set(c.listingId!, arr);
        }

        // Count reviews whose listing matches AND where a clean fell within -1..+3 days
        let matchable = 0;
        for (const r of recentReviews) {
          if (!r.listingId || !myListingIds.has(r.listingId)) continue;
          const reviewDate = r.arrivalDate
            ? new Date(r.arrivalDate)
            : r.submittedAt
              ? new Date(r.submittedAt)
              : null;
          if (!reviewDate) continue;
          const cleanDates = cleansByListing.get(r.listingId) || [];
          const found = cleanDates.some((cd) => {
            const diffDays = (reviewDate.getTime() - cd.getTime()) / (1000 * 60 * 60 * 24);
            return diffDays >= -1 && diffDays <= 3;
          });
          if (found) matchable++;
        }

        perCleaner.push({
          cleanerId: cleaner.id,
          name: cleaner.name,
          cleansLast45Days: myCleans.length,
          listingsCleanedLast45Days: myListingIds.size,
          matchableReviewsLast30Days: matchable,
          currentScore: cleaner.currentRollingScore,
          lastCalculated: cleaner.scoreLastCalculatedAt,
        });
      }

      // Sort by most cleans first so the most-active cleaners are up top
      perCleaner.sort((a, b) => b.cleansLast45Days - a.cleansLast45Days);

      // Top-level verdict: the most likely root cause
      let diagnosis = "";
      if (!bwConfig.enabled) {
        diagnosis =
          "Breezeway sync is DISABLED in integrations.breezeway.config.taskSyncEnabled — sync will short-circuit and never insert cleans. Enable it on the Breezeway integration page.";
      } else if (cleanersWithBwTeam === 0) {
        diagnosis =
          "Sync is enabled but NONE of the active cleaners have a breezewayTeamId — every fetched task will fail the assignee mapping. Run Sync Breezeway Team or link cleaners manually.";
      } else if (activeCleaners.length === 0) {
        diagnosis = "No active cleaners in the cleaners table.";
      } else if (recentCleans.length === 0) {
        diagnosis =
          bwConfig.lastPollAt
            ? `No completedCleans in the last 45 days — sync IS enabled and last polled ${bwConfig.lastPollAt.toISOString()}, but no rows were inserted. Click 'Sync Cleans' and check the toast for total/created/skipped counts.`
            : "No completedCleans in the last 45 days — sync is enabled but lastPollAt is null (cron has never run since enable). Click 'Sync Cleans' to trigger manually.";
      } else if (cleansWithCleanerId.length === 0) {
        diagnosis =
          "completedCleans exist but NONE have cleanerId set — the Breezeway assignee → cleaner mapping is broken.";
      } else if (cleansWithListingId.length === 0) {
        diagnosis =
          "completedCleans exist but NONE have listingId set — the Breezeway home_id → listing mapping is broken.";
      } else if (recentReviews.length === 0) {
        diagnosis = "No reviews in the last 30 days — nothing to score against.";
      } else if (airbnbReviewsWithCleanliness === 0 && analyzedRecentCount === 0) {
        diagnosis =
          "Recent reviews exist but no Airbnb cleanlinessRating and no AI analyses — neither scoring path has data.";
      } else if (perCleaner.every((p) => p.matchableReviewsLast30Days === 0)) {
        diagnosis =
          "Cleans and reviews both exist but NO per-cleaner overlap — clean dates don't line up with review arrival dates (check -1..+3 day window).";
      } else {
        diagnosis = "Scoring data looks healthy — check individual cleaner breakdown below.";
      }

      return {
        diagnosis,
        now: now.toISOString(),
        windows: {
          reviewWindowStart: thirtyDaysAgo.toISOString(),
          cleanWindowStart: fortyFiveDaysAgo.toISOString(),
        },
        breezewaySync: {
          enabled: bwConfig.enabled,
          // NOTE: lastPollAt is updated by breezewayTaskSync, NOT cleanSync,
          // so it tells you whether the task poller is alive but not whether
          // cleans have been synced. See lastCleanSync below for that.
          lastPollAt: bwConfig.lastPollAt ? bwConfig.lastPollAt.toISOString() : null,
          syncActivatedAt: bwConfig.syncActivatedAt ? bwConfig.syncActivatedAt.toISOString() : null,
          totalProperties: bwProperties.length,
          propsWithReferenceId: propsWithRefId,
          propsHomeIdOnly,
          breezewayTeamRows: bwTeamRows.length,
          cleansSyncCutoff: "2026-03-30T00:00:00.000Z",
        },
        // Most recent syncCompletedCleans() result, cached in memory on the
        // server process. Null until the first run since the latest boot.
        lastCleanSync: getLastCleanSyncResult(),
        // True if a background CleanSync is currently running — we kick
        // the sync off fire-and-forget because a full run takes longer
        // than Railway's edge-proxy HTTP timeout.
        cleanSyncInProgress: isCleanSyncInProgress(),
        cleaners: {
          total: activeCleaners.length,
          withScoreCalculated: activeCleaners.filter((c) => c.scoreLastCalculatedAt != null).length,
          withNonNullScore: activeCleaners.filter((c) => c.currentRollingScore != null).length,
          withBreezewayTeamId: cleanersWithBwTeam,
        },
        completedCleans: {
          last45Days: recentCleans.length,
          withCleanerId: cleansWithCleanerId.length,
          withListingId: cleansWithListingId.length,
          fullyMatched: cleansFullyMatched.length,
          latestCleanDate: latestCleanDate ? new Date(latestCleanDate).toISOString() : null,
          daysSinceLatest: latestCleanDate
            ? Math.round((now.getTime() - new Date(latestCleanDate).getTime()) / (1000 * 60 * 60 * 24))
            : null,
        },
        reviews: {
          last30Days: recentReviews.length,
          bySource: reviewsBySource,
          airbnbWithCleanlinessSubScore: airbnbReviewsWithCleanliness,
          analyzedByAI: analyzedRecentCount,
        },
        perCleaner: perCleaner.slice(0, 30),
      };
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
   *
   * Fires the sync in the background and returns immediately. A full run
   * takes longer (~70-120s for 250+ properties) than Railway's ~30s
   * edge-proxy HTTP timeout, so we can't await it inline. The client
   * polls `scoreDiagnostic.lastCleanSync` to see the final result.
   */
  syncCleans: adminProcedure.mutation(async () => {
    const { started, alreadyRunning } = startCleanSyncInBackground();
    return {
      started,
      alreadyRunning,
      message: alreadyRunning
        ? "A CleanSync is already in progress — check Diagnose Scores in 30-60 seconds."
        : "CleanSync started in the background. Click Diagnose Scores in 30-60 seconds to see results.",
    };
  }),

  /**
   * Synchronous foreground sync — only for local dev / CLI use. In
   * production this will hit Railway's edge-proxy timeout, so prefer
   * `syncCleans` above.
   */
  syncCleansForeground: adminProcedure.mutation(async () => {
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
