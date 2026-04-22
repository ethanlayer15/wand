/**
 * Analyze Router — powers the 6-tab Analyze section
 * Tabs: Overview, Trends, Cleaners, Flagged Reviews, Comparison, Review Feed
 */
import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  getListings,
  getReviews,
  getReviewsWithAnalysis,
  getReviewAnalyses,
  getGuestMessages,
  getTasks,
  getFlaggedReviews,
  countUnanalyzedReviews,
} from "./db";
import {
  syncHostawayMessages,
} from "./sync";
import {
  analyzeUnanalyzedReviews,
  analyzeGuestMessages,
  startBackgroundAnalysisJob,
  getLatestAnalysisJob,
  stopAnalysisJob,
} from "./aiAnalysis";
import { normalizeRating as normalizeRatingShared } from "./compensation";

// 5-point normalization, but default null → 0 for averaging/math callers.
function normalizeRating(rating: number | null | undefined): number {
  return normalizeRatingShared(rating) ?? 0;
}

// Best-available date for a review's time-window filtering. We anchor to the
// guest's CHECK-OUT date (departureDate) rather than when the review was
// posted, so time-range selectors reflect the stay window — a late-submitted
// review doesn't shift an old stay into the current month.
// Fallback order: departureDate → arrivalDate → submittedAt → createdAt.
function reviewDate(r: {
  departureDate?: Date | null;
  arrivalDate?: Date | null;
  submittedAt?: Date | null;
  createdAt?: Date | null;
}): Date | null {
  return r.departureDate ?? r.arrivalDate ?? r.submittedAt ?? r.createdAt ?? null;
}

export const analyzeRouter = router({
  // ── Overview ─────────────────────────────────────────────────────────
  overview: publicProcedure
    .input(z.object({
      timeRange: z.enum(["30d", "quarter", "year", "all"]).optional(),
      startDate: z.string().optional(), // ISO date string for custom range
      endDate: z.string().optional(),
      listingId: z.number().optional(),
      state: z.string().optional(), // state filter (region/pod)
      podId: z.number().optional(), // deprecated, use podIds
      podIds: z.array(z.number()).optional(),
    }).optional())
    .query(async ({ input }) => {
    const [allListings, allReviews, allAnalyses, messages, tasks] = await Promise.all([
      getListings(),
      getReviews(),
      getReviewAnalyses(),
      getGuestMessages(),
      getTasks(),
    ]);

    // Normalise legacy single podId into podIds
    const effectivePodIds =
      input?.podIds && input.podIds.length > 0
        ? input.podIds
        : input?.podId
          ? [input.podId]
          : null;

    // Build listing ID set based on filters
    const listingMap = new Map(allListings.map((l) => [l.id, l]));
    let filteredListingIds: Set<number> | null = null;
    if (input?.listingId) {
      filteredListingIds = new Set([input.listingId]);
    } else if (effectivePodIds) {
      const podSet = new Set(effectivePodIds);
      filteredListingIds = new Set(
        allListings.filter((l) => podSet.has((l as any).podId)).map((l) => l.id)
      );
    } else if (input?.state) {
      filteredListingIds = new Set(
        allListings.filter((l) => l.state === input.state).map((l) => l.id)
      );
    }

    // Compute time cutoff
    let timeCutoff: Date | null = null;
    if (input?.startDate) {
      timeCutoff = new Date(input.startDate);
    } else if (input?.timeRange && input.timeRange !== "all") {
      const now = new Date();
      if (input.timeRange === "30d") {
        timeCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else if (input.timeRange === "quarter") {
        const q = Math.floor(now.getMonth() / 3);
        timeCutoff = new Date(now.getFullYear(), q * 3, 1);
      } else if (input.timeRange === "year") {
        timeCutoff = new Date(now.getFullYear(), 0, 1);
      }
    }
    let timeEnd: Date | null = null;
    if (input?.endDate) {
      timeEnd = new Date(input.endDate);
      timeEnd.setHours(23, 59, 59, 999);
    }

    // Filter reviews — anchor on guest check-out (departureDate) via reviewDate(),
    // falling back through arrival/submitted/created. A late-posted review for
    // a 60-day-old stay does NOT count in the 30-day window.
    // Only count PUBLISHED GUEST-TO-HOST reviews (matches Hostaway dashboard and
    // the filter already applied in Trends/Comparison tabs). Without this, the
    // "30-day review count" was inflated by host-to-guest reviews and drafts.
    let reviews = allReviews.filter(
      (r) =>
        (r.reviewStatus === "published" || r.reviewStatus == null) &&
        (r.reviewType === "guest-to-host" || r.reviewType == null)
    );
    if (filteredListingIds) {
      reviews = reviews.filter((r) => filteredListingIds!.has(r.listingId));
    }
    if (timeCutoff) {
      reviews = reviews.filter((r) => {
        const d = reviewDate(r);
        return d != null && d >= timeCutoff!;
      });
    }
    if (timeEnd) {
      reviews = reviews.filter((r) => {
        const d = reviewDate(r);
        return d != null && d <= timeEnd!;
      });
    }

    // Filter analyses to match
    const reviewIdSet = new Set(reviews.map((r) => r.id));
    let analyses = allAnalyses;
    if (filteredListingIds || timeCutoff || timeEnd) {
      analyses = analyses.filter((a) => reviewIdSet.has(a.reviewId));
    }

    // Sentiment distribution
    const sentimentDist = { positive: 0, neutral: 0, negative: 0 };
    for (const a of analyses) {
      const score = a.sentimentScore ?? 0;
      if (score > 20) sentimentDist.positive++;
      else if (score < -20) sentimentDist.negative++;
      else sentimentDist.neutral++;
    }

    // Issue categories from analyses
    const issueCounts: Record<string, number> = {};
    for (const a of analyses) {
      if (a.issues && Array.isArray(a.issues)) {
        for (const issue of a.issues as Array<{ type: string }>) {
          issueCounts[issue.type] = (issueCounts[issue.type] || 0) + 1;
        }
      }
    }

    // Top issues sorted by count
    const topIssues = Object.entries(issueCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([type, count]) => ({ type, count }));

    // Average rating — normalize to 5-star scale.
    // reviewStatus may be null for older synced reviews (Hostaway doesn't always
    // populate it). The sync pipeline already filters out non-published reviews
    // at insert time, so null here is safe to treat as published.
    const ratedReviews = reviews.filter(
      (r) => r.rating != null &&
             (r.reviewStatus === "published" || r.reviewStatus == null) &&
             (r.reviewType === "guest-to-host" || r.reviewType == null)
    );
    const avgRating = ratedReviews.length > 0
      ? ratedReviews.reduce((sum, r) => sum + normalizeRating(r.rating), 0) / ratedReviews.length
      : 0;

    // Rating distribution
    const ratingDist: Record<number, number> = {};
    for (const r of ratedReviews) {
      const rating = Math.round(normalizeRating(r.rating));
      if (rating > 0) ratingDist[rating] = (ratingDist[rating] || 0) + 1;
    }

    // Guest message categories
    const messageCats: Record<string, number> = {};
    for (const m of messages) {
      if (m.aiCategory) {
        messageCats[m.aiCategory] = (messageCats[m.aiCategory] || 0) + 1;
      }
    }

    // Properties needing attention (most issues)
    const propertyIssues: Record<number, number> = {};
    for (const a of analyses) {
      if (a.issues && Array.isArray(a.issues)) {
        propertyIssues[a.listingId] = (propertyIssues[a.listingId] || 0) + (a.issues as any[]).length;
      }
    }
    const propertiesNeedingAttention = Object.entries(propertyIssues)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([listingId, issueCount]) => {
        const listing = listingMap.get(Number(listingId));
        return {
          listingId: Number(listingId),
          name: listing?.internalName || listing?.name || `Property #${listingId}`,
          issueCount,
        };
      });

    const unanalyzedCount = await countUnanalyzedReviews();

    // Collect distinct states for the filter dropdown
    const states = [...new Set(allListings.map((l) => l.state).filter(Boolean))].sort() as string[];

    return {
      totalListings: filteredListingIds ? filteredListingIds.size : allListings.length,
      totalReviews: reviews.length,
      totalAnalyzed: analyses.length,
      unanalyzedCount,
      totalMessages: messages.length,
      totalTasks: tasks.length,
      avgRating: Number(avgRating.toFixed(2)),
      sentimentDist,
      topIssues,
      ratingDist,
      messageCats,
      propertiesNeedingAttention,
      states,
    };
  }),

  // ── Count unanalyzed (for progress tracking) ─────────────────────────
  countUnanalyzed: publicProcedure.query(async () => {
    const count = await countUnanalyzedReviews();
    return { count };
  }),

  // ── Trends ───────────────────────────────────────────────────────────
  trends: publicProcedure
    .input(z.object({
      months: z.number().default(12),
      listingId: z.number().optional(),
      podId: z.number().optional(),
      podIds: z.array(z.number()).optional(),
      timeRange: z.enum(["30d", "quarter", "year", "all"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const allListingsForTrends = await getListings();
      let reviews = await getReviews();
      const analyses = await getReviewAnalyses(input.listingId ? { listingId: input.listingId } : undefined);
      const analysisMap = new Map(analyses.map((a) => [a.reviewId, a]));

      // Apply pod filter (multi-select)
      const effectivePodIds =
        input.podIds && input.podIds.length > 0
          ? input.podIds
          : input.podId
            ? [input.podId]
            : null;
      if (effectivePodIds) {
        const podSet = new Set(effectivePodIds);
        const podListingIds = new Set(allListingsForTrends.filter((l) => podSet.has((l as any).podId)).map((l) => l.id));
        reviews = reviews.filter((r) => podListingIds.has(r.listingId));
      }

      // Group reviews by month
      const monthlyData: Record<string, {
        month: string;
        count: number;
        avgRating: number;
        avgSentiment: number;
        issueCount: number;
        ratings: number[];
        sentiments: number[];
      }> = {};

      // Compute time cutoff — prefer explicit timeRange/startDate over months
      let cutoff = new Date();
      if (input.startDate) {
        cutoff = new Date(input.startDate);
      } else if (input.timeRange && input.timeRange !== "all") {
        const now = new Date();
        if (input.timeRange === "30d") {
          cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        } else if (input.timeRange === "quarter") {
          const q = Math.floor(now.getMonth() / 3);
          cutoff = new Date(now.getFullYear(), q * 3, 1);
        } else if (input.timeRange === "year") {
          cutoff = new Date(now.getFullYear(), 0, 1);
        }
      } else {
        cutoff.setMonth(cutoff.getMonth() - input.months);
      }
      const endCutoff = input.endDate ? new Date(new Date(input.endDate).setHours(23, 59, 59, 999)) : null;

      for (const r of reviews) {
        if (input.listingId && r.listingId !== input.listingId) continue;
        if (input.podId) { /* already filtered above */ }
        // Only count published guest reviews (matches Hostaway dashboard filter)
        if (r.reviewStatus !== "published" && r.reviewStatus != null) continue;
        if (r.reviewType != null && r.reviewType !== "guest-to-host") continue;
        const date = reviewDate(r);
        if (!date) continue; // Skip reviews without any known date
        if (date < cutoff) continue;
        if (endCutoff && date > endCutoff) continue;

        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = {
            month: monthKey,
            count: 0,
            avgRating: 0,
            avgSentiment: 0,
            issueCount: 0,
            ratings: [],
            sentiments: [],
          };
        }

        const md = monthlyData[monthKey];
        md.count++;
        // Normalize to 5-star scale
        if (r.rating) md.ratings.push(normalizeRating(r.rating));

        const analysis = analysisMap.get(r.id);
        if (analysis) {
          if (analysis.sentimentScore != null) md.sentiments.push(analysis.sentimentScore);
          if (analysis.issues && Array.isArray(analysis.issues)) {
            md.issueCount += (analysis.issues as any[]).length;
          }
        }
      }

      // Calculate averages
      const trendData = Object.values(monthlyData)
        .map((md) => ({
          month: md.month,
          count: md.count,
          avgRating: md.ratings.length > 0
            ? Number((md.ratings.reduce((a, b) => a + b, 0) / md.ratings.length).toFixed(2))
            : 0,
          avgSentiment: md.sentiments.length > 0
            ? Number((md.sentiments.reduce((a, b) => a + b, 0) / md.sentiments.length).toFixed(1))
            : 0,
          issueCount: md.issueCount,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));

      return trendData;
    }),

  // ── Cleaners ─────────────────────────────────────────────────────────
  cleaners: publicProcedure.query(async () => {
    const analyses = await getReviewAnalyses();
    const reviews = await getReviews();
    const reviewMap = new Map(reviews.map((r) => [r.id, r]));

    // Build cleaner scorecards from review analysis
    const cleanerData: Record<string, {
      name: string;
      reviewCount: number;
      avgSentiment: number;
      sentiments: number[];
      issues: Array<{ type: string; description: string; severity: string }>;
      highlights: string[];
      properties: Set<number>;
    }> = {};

    for (const a of analyses) {
      if (!a.cleanerMentioned) continue;
      const name = a.cleanerMentioned;
      if (!cleanerData[name]) {
        cleanerData[name] = {
          name,
          reviewCount: 0,
          avgSentiment: 0,
          sentiments: [],
          issues: [],
          highlights: [],
          properties: new Set(),
        };
      }

      const cd = cleanerData[name];
      cd.reviewCount++;
      if (a.sentimentScore != null) cd.sentiments.push(a.sentimentScore);
      if (a.issues && Array.isArray(a.issues)) {
        cd.issues.push(...(a.issues as any[]));
      }
      if (a.highlights && Array.isArray(a.highlights)) {
        cd.highlights.push(...a.highlights);
      }
      cd.properties.add(a.listingId);
    }

    return Object.values(cleanerData).map((cd) => ({
      name: cd.name,
      reviewCount: cd.reviewCount,
      avgSentiment: cd.sentiments.length > 0
        ? Number((cd.sentiments.reduce((a, b) => a + b, 0) / cd.sentiments.length).toFixed(1))
        : 0,
      issueCount: cd.issues.length,
      highlightCount: cd.highlights.length,
      propertyCount: cd.properties.size,
      recentIssues: cd.issues.slice(-5),
      recentHighlights: cd.highlights.slice(-5),
    }));
  }),

  // ── Flagged Reviews ──────────────────────────────────────────────────
  flagged: publicProcedure
    .input(z.object({
      listingId: z.number().optional(),
      podId: z.number().optional(),
      podIds: z.array(z.number()).optional(),
      severity: z.string().optional(),
      limit: z.number().default(100),
      timeRange: z.enum(["30d", "quarter", "year", "all"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const allListingsForFlagged = await getListings();
      let reviewsWithAnalysis = await getReviewsWithAnalysis({
        listingId: input.listingId,
        flaggedOnly: true,
        limit: input.limit,
      });
      // Apply pod filter (multi-select)
      const effectivePodIdsFlagged =
        input.podIds && input.podIds.length > 0
          ? input.podIds
          : input.podId
            ? [input.podId]
            : null;
      if (effectivePodIdsFlagged) {
        const podSet = new Set(effectivePodIdsFlagged);
        const podListingIds = new Set(allListingsForFlagged.filter((l) => podSet.has((l as any).podId)).map((l) => l.id));
        reviewsWithAnalysis = reviewsWithAnalysis.filter((r) => podListingIds.has(r.listingId));
      }

      // Compute time range
      let timeCutoff: Date | null = null;
      if (input.startDate) {
        timeCutoff = new Date(input.startDate);
      } else if (input.timeRange && input.timeRange !== "all") {
        const now = new Date();
        if (input.timeRange === "30d") timeCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        else if (input.timeRange === "quarter") { const q = Math.floor(now.getMonth() / 3); timeCutoff = new Date(now.getFullYear(), q * 3, 1); }
        else if (input.timeRange === "year") timeCutoff = new Date(now.getFullYear(), 0, 1);
      }
      const timeEnd = input.endDate ? new Date(new Date(input.endDate).setHours(23, 59, 59, 999)) : null;

      let result = reviewsWithAnalysis as typeof reviewsWithAnalysis;

      // Apply date filters — anchored on departureDate via reviewDate()
      if (timeCutoff) {
        result = result.filter((r) => {
          const d = reviewDate(r as any);
          return d != null && d >= timeCutoff!;
        });
      }
      if (timeEnd) {
        result = result.filter((r) => {
          const d = reviewDate(r as any);
          return d != null && d <= timeEnd!;
        });
      }

      // Filter by severity if specified
      if (input.severity) {
        result = result.filter((r) => {
          if (!r.analysis?.issues) return false;
          return (r.analysis.issues as any[]).some((i: any) => i.severity === input.severity);
        });
      }

      return result;
    }),


  // ── Comparison ───────────────────────────────────────────────────────
  comparison: publicProcedure
    .input(z.object({
      listingId: z.number().optional(),
      podId: z.number().optional(),
      podIds: z.array(z.number()).optional(),
      timeRange: z.enum(["30d", "quarter", "year", "all"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      state: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
    const listings = await getListings();
    let reviews = await getReviews();
    let analyses = await getReviewAnalyses();

    // Compute time range
    let timeCutoff: Date | null = null;
    if (input?.startDate) {
      timeCutoff = new Date(input.startDate);
    } else if (input?.timeRange && input.timeRange !== "all") {
      const now = new Date();
      if (input.timeRange === "30d") timeCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      else if (input.timeRange === "quarter") { const q = Math.floor(now.getMonth() / 3); timeCutoff = new Date(now.getFullYear(), q * 3, 1); }
      else if (input.timeRange === "year") timeCutoff = new Date(now.getFullYear(), 0, 1);
    }
    const timeEnd = input?.endDate ? new Date(new Date(input.endDate).setHours(23, 59, 59, 999)) : null;

    // Normalise legacy single podId into podIds (comparison)
    const effectivePodIdsCmp =
      input?.podIds && input.podIds.length > 0
        ? input.podIds
        : input?.podId
          ? [input.podId]
          : null;

    // Filter by listing/pod/state
    let filteredListingIds: Set<number> | null = null;
    if (input?.listingId) {
      filteredListingIds = new Set([input.listingId]);
    } else if (effectivePodIdsCmp) {
      const podSet = new Set(effectivePodIdsCmp);
      filteredListingIds = new Set(listings.filter((l) => podSet.has((l as any).podId)).map((l) => l.id));
    } else if (input?.state) {
      filteredListingIds = new Set(listings.filter((l) => l.state === input.state).map((l) => l.id));
    }
    if (filteredListingIds) {
      reviews = reviews.filter((r) => filteredListingIds!.has(r.listingId));
      analyses = analyses.filter((a) => filteredListingIds!.has(a.listingId));
    }
    // Time filter — anchored on departureDate via reviewDate()
    if (timeCutoff) {
      reviews = reviews.filter((r) => {
        const d = reviewDate(r);
        return d != null && d >= timeCutoff!;
      });
      const reviewIdSet = new Set(reviews.map((r) => r.id));
      analyses = analyses.filter((a) => reviewIdSet.has(a.reviewId));
    }
    if (timeEnd) {
      reviews = reviews.filter((r) => {
        const d = reviewDate(r);
        return d != null && d <= timeEnd!;
      });
      const reviewIdSet = new Set(reviews.map((r) => r.id));
      analyses = analyses.filter((a) => reviewIdSet.has(a.reviewId));
    }

    // Build per-property stats
    const propertyStats: Record<number, {
      listingId: number;
      name: string;
      reviewCount: number;
      ratings: number[];
      sentiments: number[];
      issueCount: number;
      issueTypes: Record<string, number>;
    }> = {};

    for (const l of listings) {
      propertyStats[l.id] = {
        listingId: l.id,
        name: l.name,
        reviewCount: 0,
        ratings: [],
        sentiments: [],
        issueCount: 0,
        issueTypes: {},
      };
    }

    for (const r of reviews) {
      const ps = propertyStats[r.listingId];
      if (!ps) continue;
      // Only count published guest reviews (matches Hostaway dashboard filter)
      if (r.reviewStatus !== "published" && r.reviewStatus != null) continue;
      if (r.reviewType != null && r.reviewType !== "guest-to-host") continue;
      ps.reviewCount++;
      if (r.rating) ps.ratings.push(normalizeRating(r.rating));
    }

    const analysisMap = new Map<number, typeof analyses>();
    for (const a of analyses) {
      if (!analysisMap.has(a.listingId)) analysisMap.set(a.listingId, []);
      analysisMap.get(a.listingId)!.push(a);
    }

    for (const [listingId, listingAnalyses] of analysisMap) {
      const ps = propertyStats[listingId];
      if (!ps) continue;
      for (const a of listingAnalyses) {
        if (a.sentimentScore != null) ps.sentiments.push(a.sentimentScore);
        if (a.issues && Array.isArray(a.issues)) {
          ps.issueCount += (a.issues as any[]).length;
          for (const issue of a.issues as Array<{ type: string }>) {
            ps.issueTypes[issue.type] = (ps.issueTypes[issue.type] || 0) + 1;
          }
        }
      }
    }

    return Object.values(propertyStats)
      .filter((ps) => ps.reviewCount > 0)
      .map((ps) => ({
        listingId: ps.listingId,
        name: ps.name,
        reviewCount: ps.reviewCount,
        avgRating: ps.ratings.length > 0
          ? Number((ps.ratings.reduce((a, b) => a + b, 0) / ps.ratings.length).toFixed(2))
          : 0,
        avgSentiment: ps.sentiments.length > 0
          ? Number((ps.sentiments.reduce((a, b) => a + b, 0) / ps.sentiments.length).toFixed(1))
          : 0,
        issueCount: ps.issueCount,
        topIssueType: Object.entries(ps.issueTypes).sort(([, a], [, b]) => b - a)[0]?.[0] || null,
      }))
      .sort((a, b) => b.reviewCount - a.reviewCount);
  }),

  // ── Review Feed ──────────────────────────────────────────────────────
  feed: publicProcedure
    .input(z.object({
      listingId: z.number().optional(),
      podId: z.number().optional(),
      podIds: z.array(z.number()).optional(),
      source: z.string().optional(),
      sentiment: z.string().optional(),
      minRating: z.number().optional(),
      maxRating: z.number().optional(),
      search: z.string().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
      timeRange: z.enum(["30d", "quarter", "year", "all"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const allListingsForFeed = await getListings();
      let reviewsWithAnalysis = await getReviewsWithAnalysis({
        listingId: input.listingId,
      });
      // Apply pod filter (multi-select)
      const effectivePodIdsFeed =
        input.podIds && input.podIds.length > 0
          ? input.podIds
          : input.podId
            ? [input.podId]
            : null;
      if (effectivePodIdsFeed) {
        const podSet = new Set(effectivePodIdsFeed);
        const podListingIds = new Set(allListingsForFeed.filter((l) => podSet.has((l as any).podId)).map((l) => l.id));
        reviewsWithAnalysis = reviewsWithAnalysis.filter((r) => podListingIds.has(r.listingId));
      }

      // Apply date filters — anchored on departureDate via reviewDate()
      if (input.timeRange && input.timeRange !== "all") {
        let timeCutoff: Date | null = null;
        const now = new Date();
        if (input.timeRange === "30d") timeCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        else if (input.timeRange === "quarter") { const q = Math.floor(now.getMonth() / 3); timeCutoff = new Date(now.getFullYear(), q * 3, 1); }
        else if (input.timeRange === "year") timeCutoff = new Date(now.getFullYear(), 0, 1);
        if (timeCutoff) reviewsWithAnalysis = reviewsWithAnalysis.filter((r) => {
          const d = reviewDate(r as any);
          return d != null && d >= timeCutoff!;
        });
      }
      if (input.startDate) {
        const cutoff = new Date(input.startDate);
        reviewsWithAnalysis = reviewsWithAnalysis.filter((r) => {
          const d = reviewDate(r as any);
          return d != null && d >= cutoff;
        });
      }
      if (input.endDate) {
        const endCutoff = new Date(new Date(input.endDate).setHours(23, 59, 59, 999));
        reviewsWithAnalysis = reviewsWithAnalysis.filter((r) => {
          const d = reviewDate(r as any);
          return d != null && d <= endCutoff;
        });
      }

      // Apply filters
      if (input.source) {
        reviewsWithAnalysis = reviewsWithAnalysis.filter((r) => r.source === input.source);
      }
      if (input.sentiment) {
        reviewsWithAnalysis = reviewsWithAnalysis.filter((r) => r.sentiment === input.sentiment);
      }
      if (input.minRating != null) {
        reviewsWithAnalysis = reviewsWithAnalysis.filter((r) => (r.rating || 0) >= input.minRating!);
      }
      if (input.maxRating != null) {
        reviewsWithAnalysis = reviewsWithAnalysis.filter((r) => (r.rating || 0) <= input.maxRating!);
      }
      if (input.search) {
        const q = input.search.toLowerCase();
        reviewsWithAnalysis = reviewsWithAnalysis.filter(
          (r) =>
            r.text?.toLowerCase().includes(q) ||
            r.guestName?.toLowerCase().includes(q) ||
            r.analysis?.summary?.toLowerCase().includes(q)
        );
      }

      const total = reviewsWithAnalysis.length;
      const paged = reviewsWithAnalysis.slice(input.offset, input.offset + input.limit);

      return { reviews: paged, total };
    }),

  // ── Guest Messages ───────────────────────────────────────────────────
  messages: publicProcedure
    .input(z.object({
      listingId: z.number().optional(),
      category: z.string().optional(),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      let messages = await getGuestMessages({ listingId: input.listingId, limit: 500 });
      if (input.category) {
        messages = messages.filter((m) => m.aiCategory === input.category);
      }
      return messages.slice(0, input.limit);
    }),

  // ── Sync & Analyze Actions ───────────────────────────────────────────
  syncMessages: protectedProcedure.mutation(async () => {
    return syncHostawayMessages();
  }),

  analyzeReviews: protectedProcedure
    .input(z.object({ batchSize: z.number().default(20) }))
    .mutation(async ({ input }) => {
      return analyzeUnanalyzedReviews(input.batchSize);
    }),

  // ── Background Job: Start analysis of ALL reviews ───────────────────────
  startAnalysisJob: protectedProcedure.mutation(async () => {
    const jobId = await startBackgroundAnalysisJob();
    return { jobId };
  }),

  // ── Poll job progress ───────────────────────────────────────────────────
  getAnalysisJobStatus: publicProcedure
    .input(z.object({ jobId: z.string().optional() }))
    .query(async ({ input }) => {
      const job = getLatestAnalysisJob();
      if (!job) return null;
      if (input.jobId && job.jobId !== input.jobId) {
        // Return the specific job if requested
        return getLatestAnalysisJob();
      }
      return job;
    }),

  // ── Stop a running job ─────────────────────────────────────────────────────
  stopAnalysisJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      const stopped = stopAnalysisJob(input.jobId);
      return { stopped };
    }),

  analyzeMessages: protectedProcedure
    .input(z.object({ batchSize: z.number().default(20) }))
    .mutation(async ({ input }) => {
      return analyzeGuestMessages(input.batchSize);
    }),
});
