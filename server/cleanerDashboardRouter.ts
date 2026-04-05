/**
 * Cleaner Dashboard Router — public endpoints accessed via unique token.
 * No authentication required — the token IS the auth.
 *
 * IMPORTANT: Never expose cleaning fee amounts or revenue data to cleaners.
 * They see "base pay per clean" and tier names only.
 */
import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getCleanerByToken, ensureCleanerToken, generateAllMissingTokens, regenerateToken } from "./cleanerTokens";
import { calculateWeeklyPay, getWeekOfMonday } from "./payCalculation";
import { getDb } from "./db";
import {
  cleaners,
  reviews,
  reviewAnalysis,
  completedCleans,
  weeklyPaySnapshots,
  cleanerReceipts,
} from "../drizzle/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { getMultiplierTier, DEFAULT_MULTIPLIER_TIERS } from "./compensationConfig";
import { storagePut } from "./storage";

export const cleanerDashboardRouter = router({
  /**
   * Get cleaner info by dashboard token (public — no auth).
   * Returns cleaner name, score, tier — but NOT revenue data.
   */
  getByToken: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ input }) => {
      const cleaner = await getCleanerByToken(input.token);
      if (!cleaner) return null;

      const qualityScore = cleaner.currentRollingScore
        ? Number(cleaner.currentRollingScore)
        : null;
      const qualityTier = getMultiplierTier(qualityScore, DEFAULT_MULTIPLIER_TIERS);

      return {
        id: cleaner.id,
        name: cleaner.name,
        qualityScore,
        qualityMultiplier: qualityTier.multiplier,
        qualityTierLabel: qualityTier.label,
        qualityTierColor: qualityTier.color,
        active: cleaner.active,
      };
    }),

  /**
   * Get reviews for a cleaner (public — token-based).
   * Shows cleaning sub-score from review analyses.
   */
  reviews: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        period: z.enum(["week", "month", "year", "all"]).default("month"),
      })
    )
    .query(async ({ input }) => {
      const cleaner = await getCleanerByToken(input.token);
      if (!cleaner) return { reviews: [], averageScore: null, reviewCount: 0 };

      const db = await getDb();
      if (!db) return { reviews: [], averageScore: null, reviewCount: 0 };

      // Calculate date cutoff based on period
      const now = new Date();
      let cutoff: Date | null = null;
      switch (input.period) {
        case "week":
          cutoff = new Date(now);
          cutoff.setDate(cutoff.getDate() - 7);
          break;
        case "month":
          cutoff = new Date(now);
          cutoff.setDate(cutoff.getDate() - 30);
          break;
        case "year":
          cutoff = new Date(now);
          cutoff.setFullYear(cutoff.getFullYear() - 1);
          break;
        case "all":
          cutoff = null;
          break;
      }

      // Get all review analyses mentioning this cleaner
      const allAnalyses = await db.select().from(reviewAnalysis);
      const allReviews = await db.select().from(reviews);
      const { listings } = await import("../drizzle/schema");
      const allListings = await db.select().from(listings);

      const reviewMap = new Map(allReviews.map((r) => [r.id, r]));
      const listingMap = new Map(allListings.map((l) => [l.id, l]));

      const relevantAnalyses = allAnalyses.filter((a) => {
        if (!a.cleanerMentioned) return false;
        if (a.cleanerMentioned.toLowerCase() !== cleaner.name.toLowerCase()) return false;
        if (cutoff) {
          const review = reviewMap.get(a.reviewId);
          if (!review) return false;
          const reviewDate = review.submittedAt ?? review.createdAt;
          return reviewDate >= cutoff;
        }
        return true;
      });

      // Build review list with cleaning scores
      const reviewList = relevantAnalyses
        .map((a) => {
          const review = reviewMap.get(a.reviewId);
          if (!review) return null;
          const rating = review.rating
            ? review.rating > 5
              ? review.rating / 2
              : review.rating
            : null;
          return {
            id: review.id,
            propertyName: listingMap.get(review.listingId)?.internalName ?? listingMap.get(review.listingId)?.name ?? `Property #${review.listingId}`,
            rating,
            reviewDate: review.submittedAt ?? review.createdAt,
            guestName: review.guestName ?? "Guest",
            // Show AI summary as excerpt
            excerpt: a.summary ?? null,
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const da = a!.reviewDate?.getTime() ?? 0;
          const db = b!.reviewDate?.getTime() ?? 0;
          return db - da;
        });

      // Calculate average score
      const scores = reviewList
        .map((r) => r!.rating)
        .filter((s): s is number => s !== null);
      const averageScore =
        scores.length > 0
          ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2))
          : null;

      return {
        reviews: reviewList,
        averageScore,
        reviewCount: scores.length,
      };
    }),

  /**
   * Get weekly pay breakdown for a cleaner (public — token-based).
   * IMPORTANT: Hides cleaning fee amounts and revenue data.
   * Shows: number of cleans, "base pay per clean" (not the fee), multiplier tiers, mileage, total.
   */
  weeklyPay: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        weekOf: z.string().optional(), // YYYY-MM-DD of Monday; defaults to current week
      })
    )
    .query(async ({ input }) => {
      const cleaner = await getCleanerByToken(input.token);
      if (!cleaner) return null;

      const weekOf = input.weekOf ?? getWeekOfMonday(new Date());
      const breakdown = await calculateWeeklyPay(cleaner.id, weekOf);
      if (!breakdown) return null;

      // Return cleaner-safe view (NO cleaning fees, NO revenue)
      return {
        weekOf: breakdown.weekOf,
        totalCleans: breakdown.totalCleans,
        // Show base pay as a total, not per-property fee
        basePay: breakdown.basePay,
        qualityScore: breakdown.qualityScore,
        qualityMultiplier: breakdown.qualityMultiplier,
        qualityTierLabel: breakdown.qualityTierLabel,
        // Volume: show tier name only, NOT revenue
        volumeMultiplier: breakdown.volumeMultiplier,
        volumeTierLabel: breakdown.volumeTierLabel,
        // Mileage
        totalMileage: breakdown.totalMileage,
        mileageRate: breakdown.mileageRate,
        mileagePay: breakdown.mileagePay,
        // Reimbursements
        cellPhoneReimbursement: breakdown.cellPhoneReimbursement,
        vehicleReimbursement: breakdown.vehicleReimbursement,
        // Total
        totalPay: breakdown.totalPay,
        // Per-clean list (property name + distance only — NO fees)
        cleans: breakdown.cleans.map((c) => ({
          propertyName: c.propertyName,
          distanceMiles: c.distanceMiles,
          scheduledDate: c.scheduledDate,
        })),
      };
    }),

  /**
   * Get pay history (last N weeks) for a cleaner (public — token-based).
   */
  payHistory: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        limit: z.number().min(1).max(52).default(12),
      })
    )
    .query(async ({ input }) => {
      const cleaner = await getCleanerByToken(input.token);
      if (!cleaner) return [];

      const db = await getDb();
      if (!db) return [];

      const snapshots = await db
        .select()
        .from(weeklyPaySnapshots)
        .where(eq(weeklyPaySnapshots.cleanerId, cleaner.id))
        .orderBy(desc(weeklyPaySnapshots.weekOf))
        .limit(input.limit);

      // Return cleaner-safe view
      return snapshots.map((s) => ({
        weekOf: s.weekOf,
        totalCleans: s.totalCleans,
        basePay: Number(s.basePay),
        qualityMultiplier: Number(s.qualityMultiplier),
        qualityTierLabel: s.qualityTierLabel,
        volumeMultiplier: Number(s.volumeMultiplier),
        volumeTierLabel: s.volumeTierLabel,
        mileagePay: Number(s.mileagePay),
        cellPhoneReimbursement: Number(s.cellPhoneReimbursement),
        vehicleReimbursement: Number(s.vehicleReimbursement),
        totalPay: Number(s.totalPay),
      }));
    }),

  // ── Admin-only endpoints ──────────────────────────────────────────

  /** Generate tokens for all cleaners that don't have one */
  generateTokens: protectedProcedure.mutation(async () => {
    return generateAllMissingTokens();
  }),

  /** Get all cleaner dashboard URLs (admin view) */
  listTokens: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const allCleaners = await db.select().from(cleaners);
    return allCleaners.map((c) => ({
      id: c.id,
      name: c.name,
      token: c.dashboardToken,
      active: c.active,
    }));
  }),

  /** Regenerate a cleaner's token */
  regenerateToken: protectedProcedure
    .input(z.object({ cleanerId: z.number() }))
    .mutation(async ({ input }) => {
      const newToken = await regenerateToken(input.cleanerId);
      return { token: newToken };
    }),

  /** Upload a receipt for a cleaner (admin can upload on behalf) */
  uploadReceipt: protectedProcedure
    .input(
      z.object({
        cleanerId: z.number(),
        month: z.string().regex(/^\d{4}-\d{2}$/),
        type: z.enum(["cell_phone", "vehicle_maintenance"]),
        fileUrl: z.string().url(),
        fileKey: z.string(),
        fileName: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.insert(cleanerReceipts).values({
        cleanerId: input.cleanerId,
        month: input.month,
        type: input.type,
        fileUrl: input.fileUrl,
        fileKey: input.fileKey,
        fileName: input.fileName ?? null,
        status: "pending",
      });

      return { success: true };
    }),

  /** Approve/reject a receipt */
  reviewReceipt: protectedProcedure
    .input(
      z.object({
        receiptId: z.number(),
        status: z.enum(["approved", "rejected"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(cleanerReceipts)
        .set({
          status: input.status,
          reviewedBy: ctx.user.id,
          reviewedAt: new Date(),
          notes: input.notes ?? null,
        })
        .where(eq(cleanerReceipts.id, input.receiptId));

      return { success: true };
    }),

  /** List receipts for a cleaner or all cleaners (admin) */
  listReceipts: protectedProcedure
    .input(
      z.object({
        cleanerId: z.number().optional(),
        month: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      let query = db.select().from(cleanerReceipts);
      const conditions = [];
      if (input.cleanerId) conditions.push(eq(cleanerReceipts.cleanerId, input.cleanerId));
      if (input.month) conditions.push(eq(cleanerReceipts.month, input.month));

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      return query.orderBy(desc(cleanerReceipts.uploadedAt));
    }),

  // ── Public Token-Based Receipt Endpoints ──────────────────────────

  /**
   * Upload a receipt from the cleaner dashboard (public — token-based).
   * Accepts base64-encoded file data, uploads to S3, and stores the record.
   */
  submitReceipt: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        type: z.enum(["cell_phone", "vehicle_maintenance"]),
        month: z.string().regex(/^\d{4}-\d{2}$/),
        fileName: z.string(),
        fileData: z.string(), // base64-encoded file content
        mimeType: z.string().default("application/octet-stream"),
      })
    )
    .mutation(async ({ input }) => {
      const cleaner = await getCleanerByToken(input.token);
      if (!cleaner) throw new Error("Invalid dashboard token");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Decode base64 to buffer
      const fileBuffer = Buffer.from(input.fileData, "base64");

      // Upload to S3
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const fileKey = `receipts/${cleaner.id}/${input.month}/${input.type}-${randomSuffix}-${input.fileName}`;
      const { url } = await storagePut(fileKey, fileBuffer, input.mimeType);

      // Insert receipt record
      await db.insert(cleanerReceipts).values({
        cleanerId: cleaner.id,
        month: input.month,
        type: input.type,
        fileUrl: url,
        fileKey,
        fileName: input.fileName,
        status: "pending",
      });

      return { success: true, fileUrl: url };
    }),

  /**
   * Get receipts for the current cleaner (public — token-based).
   */
  myReceipts: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      })
    )
    .query(async ({ input }) => {
      const cleaner = await getCleanerByToken(input.token);
      if (!cleaner) throw new Error("Invalid dashboard token");

      const db = await getDb();
      if (!db) return [];

      const conditions = [eq(cleanerReceipts.cleanerId, cleaner.id)];
      if (input.month) conditions.push(eq(cleanerReceipts.month, input.month));

      return db
        .select()
        .from(cleanerReceipts)
        .where(and(...conditions))
        .orderBy(desc(cleanerReceipts.uploadedAt));
    }),
});
