import { describe, it, expect, vi } from "vitest";

describe("Analyze Router", () => {
  describe("Overview endpoint", () => {
    it("should return overview stats structure", async () => {
      // Test the overview data shape
      const response = await fetch(
        "http://localhost:3000/api/trpc/analyze.overview"
      );
      const data = await response.json();
      const result = data.result?.data?.json;

      expect(result).toBeDefined();
      expect(result).toHaveProperty("totalListings");
      expect(result).toHaveProperty("totalReviews");
      expect(result).toHaveProperty("totalAnalyzed");
      expect(result).toHaveProperty("totalMessages");
      expect(result).toHaveProperty("avgRating");
      expect(result).toHaveProperty("sentimentDist");
      expect(result).toHaveProperty("ratingDist");
      expect(result).toHaveProperty("topIssues");
      expect(result).toHaveProperty("messageCats");
      expect(result).toHaveProperty("propertiesNeedingAttention");

      expect(result.sentimentDist).toHaveProperty("positive");
      expect(result.sentimentDist).toHaveProperty("neutral");
      expect(result.sentimentDist).toHaveProperty("negative");

      expect(typeof result.totalListings).toBe("number");
      expect(typeof result.totalReviews).toBe("number");
      expect(typeof result.avgRating).toBe("number");
    });

    it("should have correct listing count from Hostaway", async () => {
      const response = await fetch(
        "http://localhost:3000/api/trpc/analyze.overview"
      );
      const data = await response.json();
      const result = data.result?.data?.json;

      expect(result.totalListings).toBeGreaterThanOrEqual(109);
    });

    it("should have reviews synced from Hostaway", async () => {
      const response = await fetch(
        "http://localhost:3000/api/trpc/analyze.overview"
      );
      const data = await response.json();
      const result = data.result?.data?.json;

      expect(result.totalReviews).toBeGreaterThan(0);
    });
  });

  describe("Trends endpoint", () => {
    it("should return trends data for default 12 months", async () => {
      const input = encodeURIComponent(JSON.stringify({ json: { months: 12 } }));
      const response = await fetch(
        `http://localhost:3000/api/trpc/analyze.trends?input=${input}`
      );
      const data = await response.json();
      const result = data.result?.data?.json;

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("Cleaners endpoint", () => {
    it("should return cleaners data structure", async () => {
      const response = await fetch(
        "http://localhost:3000/api/trpc/analyze.cleaners"
      );
      const data = await response.json();
      const result = data.result?.data?.json;

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("Comparison endpoint", () => {
    it("should return property comparison data", async () => {
      const response = await fetch(
        "http://localhost:3000/api/trpc/analyze.comparison"
      );
      const data = await response.json();
      const result = data.result?.data?.json;

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      if (result.length > 0) {
        expect(result[0]).toHaveProperty("listingId");
        expect(result[0]).toHaveProperty("name");
        expect(result[0]).toHaveProperty("reviewCount");
        expect(result[0]).toHaveProperty("avgRating");
      }
    });
  });

  describe("Feed endpoint", () => {
    it("should return review feed with pagination", async () => {
      const input = encodeURIComponent(JSON.stringify({ json: { limit: 5 } }));
      const response = await fetch(
        `http://localhost:3000/api/trpc/analyze.feed?input=${input}`
      );
      const data = await response.json();
      const result = data.result?.data?.json;

      expect(result).toBeDefined();
      expect(result).toHaveProperty("reviews");
      expect(Array.isArray(result.reviews)).toBe(true);
      expect(result.reviews.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Flagged endpoint", () => {
    it("should return flagged reviews", async () => {
      const input = encodeURIComponent(JSON.stringify({ json: {} }));
      const response = await fetch(
        `http://localhost:3000/api/trpc/analyze.flagged?input=${input}`
      );
      const data = await response.json();
      const result = data.result?.data?.json;

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("Dashboard enhanced stats", () => {
    it("should return enhanced dashboard stats with AI fields", async () => {
      const response = await fetch(
        "http://localhost:3000/api/trpc/dashboard.stats"
      );
      const data = await response.json();
      const result = data.result?.data?.json;

      expect(result).toBeDefined();
      // avgRating is now a separate endpoint (dashboard.avgRating)
      expect(result).toHaveProperty("totalReviews");
      expect(result).toHaveProperty("urgentCount");
      expect(result).toHaveProperty("propertiesCount");
      expect(result).toHaveProperty("analyzedCount");
      expect(result).toHaveProperty("sentimentDist");
      expect(result).toHaveProperty("topIssues");
      expect(result).toHaveProperty("totalMessages");
      expect(result).toHaveProperty("urgentMessageCount");

      expect(typeof result.analyzedCount).toBe("number");
      expect(typeof result.totalMessages).toBe("number");
      expect(typeof result.urgentMessageCount).toBe("number");
    });

    it("should return time-filtered average rating", async () => {
      const response = await fetch(
        'http://localhost:3000/api/trpc/dashboard.avgRating?input=%7B%22json%22%3A%7B%22timeRange%22%3A%2230d%22%7D%7D'
      );
      const data = await response.json();
      const result = data.result?.data?.json;

      expect(result).toBeDefined();
      expect(result).toHaveProperty("avgRating");
      expect(result).toHaveProperty("reviewCount");
      expect(typeof result.reviewCount).toBe("number");
    });

    it("should return urgent alerts", async () => {
      const response = await fetch(
        "http://localhost:3000/api/trpc/dashboard.urgentAlerts"
      );
      const data = await response.json();
      const result = data.result?.data?.json;

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

describe("AI Analysis Engine", () => {
  it("should export analyzeReview function", async () => {
    const mod = await import("./aiAnalysis");
    expect(typeof mod.analyzeReview).toBe("function");
  });

  it("should export analyzeUnanalyzedReviews function", async () => {
    const mod = await import("./aiAnalysis");
    expect(typeof mod.analyzeUnanalyzedReviews).toBe("function");
  });

  it("should export analyzeGuestMessages function", async () => {
    const mod = await import("./aiAnalysis");
    expect(typeof mod.analyzeGuestMessages).toBe("function");
  });
});

describe("Hostaway API Client", () => {
  it("should export getHostawayClient function", async () => {
    const mod = await import("./hostaway");
    expect(typeof mod.getHostawayClient).toBe("function");
  });

  it("should create client with getHostawayClient", async () => {
    const mod = await import("./hostaway");
    const client = mod.getHostawayClient();
    expect(client).toBeDefined();
    expect(typeof client.getListings).toBe("function");
    expect(typeof client.getReviews).toBe("function");
  });
});
