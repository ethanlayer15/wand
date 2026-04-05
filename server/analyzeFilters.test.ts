import { describe, it, expect } from "vitest";

// ── Rating normalization logic (mirrors server/analyzeRouter.ts) ──────
function normalizeRating(rating: number | null | undefined): number {
  if (rating == null) return 0;
  return rating > 5 ? rating / 2 : rating;
}

// ── Time range cutoff logic (mirrors analyzeRouter overview) ──────────
function computeTimeCutoff(
  timeRange: "30d" | "quarter" | "year" | "all" | undefined,
  startDate?: string
): Date | null {
  if (startDate) return new Date(startDate);
  if (!timeRange || timeRange === "all") return null;
  const now = new Date();
  if (timeRange === "30d") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  if (timeRange === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    return new Date(now.getFullYear(), q * 3, 1);
  }
  if (timeRange === "year") {
    return new Date(now.getFullYear(), 0, 1);
  }
  return null;
}

// ── Filter reviews helper (mirrors analyzeRouter overview) ────────────
interface MockReview {
  id: number;
  listingId: number;
  rating: number | null;
  reviewStatus: string | null;
  reviewType: string | null;
  createdAt: Date;
}

function filterReviews(
  reviews: MockReview[],
  opts: {
    listingId?: number;
    state?: string;
    timeRange?: "30d" | "quarter" | "year" | "all";
    startDate?: string;
    endDate?: string;
  },
  listingStateMap: Map<number, string>
) {
  let filtered = reviews;

  // Listing filter
  if (opts.listingId) {
    filtered = filtered.filter((r) => r.listingId === opts.listingId);
  } else if (opts.state) {
    const stateListingIds = new Set(
      [...listingStateMap.entries()]
        .filter(([, s]) => s === opts.state)
        .map(([id]) => id)
    );
    filtered = filtered.filter((r) => stateListingIds.has(r.listingId));
  }

  // Time filter
  const cutoff = computeTimeCutoff(opts.timeRange, opts.startDate);
  if (cutoff) {
    filtered = filtered.filter((r) => r.createdAt >= cutoff);
  }
  if (opts.endDate) {
    const end = new Date(opts.endDate);
    end.setHours(23, 59, 59, 999);
    filtered = filtered.filter((r) => r.createdAt <= end);
  }

  return filtered;
}

function computeAvgRating(reviews: MockReview[]): number {
  const rated = reviews.filter(
    (r) =>
      r.rating != null &&
      r.reviewStatus === "published" &&
      (r.reviewType === "guest-to-host" || r.reviewType == null)
  );
  if (rated.length === 0) return 0;
  return rated.reduce((sum, r) => sum + normalizeRating(r.rating), 0) / rated.length;
}

// ── Test Data ─────────────────────────────────────────────────────────
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

const MOCK_REVIEWS: MockReview[] = [
  { id: 1, listingId: 100, rating: 10, reviewStatus: "published", reviewType: "guest-to-host", createdAt: daysAgo(5) },
  { id: 2, listingId: 100, rating: 8, reviewStatus: "published", reviewType: "guest-to-host", createdAt: daysAgo(10) },
  { id: 3, listingId: 200, rating: 6, reviewStatus: "published", reviewType: "guest-to-host", createdAt: daysAgo(20) },
  { id: 4, listingId: 200, rating: 10, reviewStatus: "published", reviewType: "guest-to-host", createdAt: daysAgo(45) },
  { id: 5, listingId: 300, rating: 10, reviewStatus: "published", reviewType: "guest-to-host", createdAt: daysAgo(100) },
  { id: 6, listingId: 300, rating: null, reviewStatus: "published", reviewType: "guest-to-host", createdAt: daysAgo(15) },
  { id: 7, listingId: 100, rating: 10, reviewStatus: "expired", reviewType: "guest-to-host", createdAt: daysAgo(3) },
  { id: 8, listingId: 200, rating: 4, reviewStatus: "published", reviewType: "guest-to-host", createdAt: daysAgo(200) },
];

const LISTING_STATE_MAP = new Map<number, string>([
  [100, "NC"],
  [200, "VA"],
  [300, "SC"],
]);

// ── Tests ─────────────────────────────────────────────────────────────

describe("Rating normalization", () => {
  it("divides by 2 when rating > 5 (10-point scale)", () => {
    expect(normalizeRating(10)).toBe(5);
    expect(normalizeRating(8)).toBe(4);
    expect(normalizeRating(6)).toBe(3);
  });

  it("keeps rating as-is when <= 5", () => {
    expect(normalizeRating(5)).toBe(5);
    expect(normalizeRating(4)).toBe(4);
    expect(normalizeRating(1)).toBe(1);
  });

  it("returns 0 for null/undefined", () => {
    expect(normalizeRating(null)).toBe(0);
    expect(normalizeRating(undefined)).toBe(0);
  });
});

describe("Time range cutoff computation", () => {
  it("returns null for 'all' time range", () => {
    expect(computeTimeCutoff("all")).toBeNull();
    expect(computeTimeCutoff(undefined)).toBeNull();
  });

  it("returns 30 days ago for '30d'", () => {
    const cutoff = computeTimeCutoff("30d")!;
    expect(cutoff).toBeInstanceOf(Date);
    const diffMs = Date.now() - cutoff.getTime();
    const diffDays = diffMs / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(30, 0);
  });

  it("returns start of current quarter for 'quarter'", () => {
    const cutoff = computeTimeCutoff("quarter")!;
    const month = cutoff.getMonth();
    expect(month % 3).toBe(0); // quarter starts on 0, 3, 6, or 9
    expect(cutoff.getDate()).toBe(1);
  });

  it("returns Jan 1 of current year for 'year'", () => {
    const cutoff = computeTimeCutoff("year")!;
    expect(cutoff.getMonth()).toBe(0);
    expect(cutoff.getDate()).toBe(1);
    expect(cutoff.getFullYear()).toBe(now.getFullYear());
  });

  it("uses startDate when provided (overrides timeRange)", () => {
    const cutoff = computeTimeCutoff("30d", "2025-06-01")!;
    expect(cutoff.toISOString().startsWith("2025-06-01")).toBe(true);
  });
});

describe("Review filtering", () => {
  it("returns all reviews when no filters", () => {
    const result = filterReviews(MOCK_REVIEWS, {}, LISTING_STATE_MAP);
    expect(result.length).toBe(MOCK_REVIEWS.length);
  });

  it("filters by listingId", () => {
    const result = filterReviews(MOCK_REVIEWS, { listingId: 100 }, LISTING_STATE_MAP);
    expect(result.every((r) => r.listingId === 100)).toBe(true);
    expect(result.length).toBe(3); // ids 1, 2, 7
  });

  it("filters by state (region)", () => {
    const result = filterReviews(MOCK_REVIEWS, { state: "VA" }, LISTING_STATE_MAP);
    expect(result.every((r) => r.listingId === 200)).toBe(true);
    expect(result.length).toBe(3); // ids 3, 4, 8
  });

  it("filters by 30d time range", () => {
    const result = filterReviews(MOCK_REVIEWS, { timeRange: "30d" }, LISTING_STATE_MAP);
    // Should include reviews from last 30 days: ids 1 (5d), 2 (10d), 3 (20d), 6 (15d), 7 (3d)
    expect(result.every((r) => r.createdAt >= daysAgo(30))).toBe(true);
  });

  it("filters by custom date range", () => {
    const start = daysAgo(50).toISOString().split("T")[0];
    const end = daysAgo(10).toISOString().split("T")[0];
    const result = filterReviews(
      MOCK_REVIEWS,
      { startDate: start, endDate: end },
      LISTING_STATE_MAP
    );
    for (const r of result) {
      expect(r.createdAt >= new Date(start)).toBe(true);
    }
  });

  it("combines listing + time filters", () => {
    const result = filterReviews(
      MOCK_REVIEWS,
      { listingId: 100, timeRange: "30d" },
      LISTING_STATE_MAP
    );
    expect(result.every((r) => r.listingId === 100)).toBe(true);
    expect(result.every((r) => r.createdAt >= daysAgo(30))).toBe(true);
  });
});

describe("Average rating calculation", () => {
  it("excludes null ratings from average", () => {
    const avg = computeAvgRating(MOCK_REVIEWS);
    // Only published guest-to-host with non-null rating: ids 1(10), 2(8), 3(6), 4(10), 5(10), 8(4)
    // Normalized: 5, 4, 3, 5, 5, 4 → sum=26, count=6 → avg=4.333
    // id 6 has null rating → excluded
    // id 7 has expired status → excluded
    // Note: rating 4 is <= 5 so stays as 4 (not divided)
    expect(avg).toBeCloseTo(4.333, 1);
  });

  it("excludes expired reviews from average", () => {
    const onlyExpired: MockReview[] = [
      { id: 1, listingId: 100, rating: 10, reviewStatus: "expired", reviewType: "guest-to-host", createdAt: now },
    ];
    expect(computeAvgRating(onlyExpired)).toBe(0);
  });

  it("returns 0 when no rated reviews", () => {
    const noRatings: MockReview[] = [
      { id: 1, listingId: 100, rating: null, reviewStatus: "published", reviewType: "guest-to-host", createdAt: now },
    ];
    expect(computeAvgRating(noRatings)).toBe(0);
  });

  it("correctly computes avg for filtered subset", () => {
    // Filter to listing 100 only: ids 1(10→5), 2(8→4) (id 7 is expired)
    const filtered = MOCK_REVIEWS.filter((r) => r.listingId === 100);
    const avg = computeAvgRating(filtered);
    expect(avg).toBeCloseTo(4.5, 1);
  });

  it("correctly computes avg for state filter", () => {
    // VA = listing 200: ids 3(6→3), 4(10→5), 8(4→4) → sum=12, count=3 → avg=4.0
    // Note: rating 4 is <= 5 so stays as 4
    const vaReviews = MOCK_REVIEWS.filter((r) => r.listingId === 200);
    const avg = computeAvgRating(vaReviews);
    expect(avg).toBeCloseTo(4.0, 1);
  });
});
