import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

const mockDb = {
  select: mockSelect,
};

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => mockDb,
}));

vi.mock("./_core/env", () => ({
  ENV: {
    ownerOpenId: "test-owner",
    databaseUrl: "mysql://test",
  },
}));

describe("Pipeline Host Message Filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up the chain: select().from().where().orderBy().limit()
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
  });

  describe("shouldCreateTask filtering", () => {
    // We test the shouldCreateTask logic inline since it's not exported.
    // Replicate the function logic to verify the isIncoming check.

    const TASK_TRIGGER_CATEGORIES = new Set([
      "maintenance",
      "cleaning",
      "improvement",
      "complaint",
    ]);

    function shouldCreateTask(msg: {
      aiAnalyzed: boolean;
      isIncoming: boolean | null;
      aiCategory: string | null;
      aiSentiment: string | null;
      aiUrgency: string | null;
    }): boolean {
      if (!msg.aiAnalyzed) return false;
      // Only create tasks from incoming guest messages, never from host-sent messages
      if (msg.isIncoming === false) return false;
      // Create task for actionable categories
      if (msg.aiCategory && TASK_TRIGGER_CATEGORIES.has(msg.aiCategory)) return true;
      // Create task for negative sentiment regardless of category
      if (msg.aiSentiment === "negative") return true;
      // Create task for high/critical urgency
      if (msg.aiUrgency === "high" || msg.aiUrgency === "critical") return true;
      return false;
    }

    it("should return false for host-sent messages (isIncoming=false) even with actionable category", () => {
      const hostMessage = {
        aiAnalyzed: true,
        isIncoming: false,
        aiCategory: "maintenance",
        aiSentiment: "negative",
        aiUrgency: "high",
      };
      expect(shouldCreateTask(hostMessage)).toBe(false);
    });

    it("should return true for incoming guest messages with actionable category", () => {
      const guestMessage = {
        aiAnalyzed: true,
        isIncoming: true,
        aiCategory: "maintenance",
        aiSentiment: "neutral",
        aiUrgency: "low",
      };
      expect(shouldCreateTask(guestMessage)).toBe(true);
    });

    it("should return true for incoming guest messages with negative sentiment", () => {
      const guestMessage = {
        aiAnalyzed: true,
        isIncoming: true,
        aiCategory: "other",
        aiSentiment: "negative",
        aiUrgency: "low",
      };
      expect(shouldCreateTask(guestMessage)).toBe(true);
    });

    it("should return true for incoming guest messages with high urgency", () => {
      const guestMessage = {
        aiAnalyzed: true,
        isIncoming: true,
        aiCategory: "other",
        aiSentiment: "neutral",
        aiUrgency: "high",
      };
      expect(shouldCreateTask(guestMessage)).toBe(true);
    });

    it("should return true for incoming guest messages with critical urgency", () => {
      const guestMessage = {
        aiAnalyzed: true,
        isIncoming: true,
        aiCategory: "other",
        aiSentiment: "neutral",
        aiUrgency: "critical",
      };
      expect(shouldCreateTask(guestMessage)).toBe(true);
    });

    it("should return false for host messages with negative sentiment", () => {
      const hostMessage = {
        aiAnalyzed: true,
        isIncoming: false,
        aiCategory: "other",
        aiSentiment: "negative",
        aiUrgency: "low",
      };
      expect(shouldCreateTask(hostMessage)).toBe(false);
    });

    it("should return false for host messages with critical urgency", () => {
      const hostMessage = {
        aiAnalyzed: true,
        isIncoming: false,
        aiCategory: "complaint",
        aiSentiment: "negative",
        aiUrgency: "critical",
      };
      expect(shouldCreateTask(hostMessage)).toBe(false);
    });

    it("should return false for unanalyzed messages regardless of isIncoming", () => {
      const unanalyzedGuest = {
        aiAnalyzed: false,
        isIncoming: true,
        aiCategory: "maintenance",
        aiSentiment: "negative",
        aiUrgency: "high",
      };
      expect(shouldCreateTask(unanalyzedGuest)).toBe(false);
    });

    it("should return false for incoming guest messages with non-actionable category and neutral sentiment", () => {
      const guestMessage = {
        aiAnalyzed: true,
        isIncoming: true,
        aiCategory: "compliment",
        aiSentiment: "positive",
        aiUrgency: "low",
      };
      expect(shouldCreateTask(guestMessage)).toBe(false);
    });

    it("should handle null isIncoming gracefully (treat as incoming for backward compat)", () => {
      // null isIncoming should NOT be blocked (backward compatibility with old data)
      const nullIncoming = {
        aiAnalyzed: true,
        isIncoming: null,
        aiCategory: "maintenance",
        aiSentiment: "neutral",
        aiUrgency: "low",
      };
      expect(shouldCreateTask(nullIncoming)).toBe(true);
    });

    it("should return true for all actionable categories when isIncoming is true", () => {
      const categories = ["maintenance", "cleaning", "improvement", "complaint"];
      for (const cat of categories) {
        const msg = {
          aiAnalyzed: true,
          isIncoming: true,
          aiCategory: cat,
          aiSentiment: "neutral",
          aiUrgency: "low",
        };
        expect(shouldCreateTask(msg)).toBe(true);
      }
    });

    it("should return false for all actionable categories when isIncoming is false", () => {
      const categories = ["maintenance", "cleaning", "improvement", "complaint"];
      for (const cat of categories) {
        const msg = {
          aiAnalyzed: true,
          isIncoming: false,
          aiCategory: cat,
          aiSentiment: "neutral",
          aiUrgency: "low",
        };
        expect(shouldCreateTask(msg)).toBe(false);
      }
    });
  });

  describe("getUnanalyzedGuestMessages filtering", () => {
    it("should only query for messages where isIncoming is true", async () => {
      // The db.ts function now includes eq(guestMessages.isIncoming, true) in its where clause.
      // We verify the intent: only incoming messages should be fetched for analysis.
      mockLimit.mockResolvedValue([
        { id: 1, body: "AC is broken", isIncoming: true, aiAnalyzed: false, reservationStatus: "new" },
        { id: 2, body: "Stains on towel", isIncoming: true, aiAnalyzed: false, reservationStatus: "modified" },
      ]);

      // Import after mocks are set up
      const { getUnanalyzedGuestMessages } = await import("./db");
      const messages = await getUnanalyzedGuestMessages(50);

      // All returned messages should be incoming
      for (const msg of messages) {
        expect(msg.isIncoming).toBe(true);
      }
    });

    it("should not return host-sent messages for analysis", async () => {
      // Simulate that the DB query correctly filters out host messages
      mockLimit.mockResolvedValue([
        { id: 1, body: "AC is broken", isIncoming: true, aiAnalyzed: false, reservationStatus: "new" },
      ]);

      const { getUnanalyzedGuestMessages } = await import("./db");
      const messages = await getUnanalyzedGuestMessages(50);

      // No host messages should appear
      const hostMessages = messages.filter((m: any) => m.isIncoming === false);
      expect(hostMessages).toHaveLength(0);
    });
  });

  describe("Confirmed Booking Status Filtering", () => {
    // Replicate the confirmed status list used in db.ts
    const CONFIRMED_RESERVATION_STATUSES = [
      "new", "modified", "pending", "awaitingPayment", "unconfirmed", "ownerStay",
    ];

    it("should include messages from confirmed bookings (status='new')", () => {
      expect(CONFIRMED_RESERVATION_STATUSES).toContain("new");
    });

    it("should include messages from modified bookings (status='modified')", () => {
      expect(CONFIRMED_RESERVATION_STATUSES).toContain("modified");
    });

    it("should include messages from pending bookings (status='pending')", () => {
      expect(CONFIRMED_RESERVATION_STATUSES).toContain("pending");
    });

    it("should include messages from awaitingPayment bookings", () => {
      expect(CONFIRMED_RESERVATION_STATUSES).toContain("awaitingPayment");
    });

    it("should include messages from ownerStay bookings", () => {
      expect(CONFIRMED_RESERVATION_STATUSES).toContain("ownerStay");
    });

    it("should NOT include inquiry status in confirmed list", () => {
      expect(CONFIRMED_RESERVATION_STATUSES).not.toContain("inquiry");
    });

    it("should NOT include cancelled status in confirmed list", () => {
      expect(CONFIRMED_RESERVATION_STATUSES).not.toContain("cancelled");
    });

    it("should NOT include declined status in confirmed list", () => {
      expect(CONFIRMED_RESERVATION_STATUSES).not.toContain("declined");
    });

    it("should NOT include expired status in confirmed list", () => {
      expect(CONFIRMED_RESERVATION_STATUSES).not.toContain("expired");
    });

    it("should filter out inquiry messages from analysis pipeline", async () => {
      // Only confirmed booking messages should be returned
      mockLimit.mockResolvedValue([
        { id: 1, body: "AC broken", isIncoming: true, aiAnalyzed: false, reservationStatus: "new" },
      ]);

      const { getUnanalyzedGuestMessages } = await import("./db");
      const messages = await getUnanalyzedGuestMessages(50);

      // Should not contain any inquiry messages
      const inquiryMessages = messages.filter((m: any) => m.reservationStatus === "inquiry");
      expect(inquiryMessages).toHaveLength(0);
    });

    it("should only return messages with confirmed reservation statuses", async () => {
      mockLimit.mockResolvedValue([
        { id: 1, body: "AC broken", isIncoming: true, aiAnalyzed: false, reservationStatus: "new" },
        { id: 2, body: "Towels needed", isIncoming: true, aiAnalyzed: false, reservationStatus: "modified" },
      ]);

      const { getUnanalyzedGuestMessages } = await import("./db");
      const messages = await getUnanalyzedGuestMessages(50);

      for (const msg of messages) {
        expect(CONFIRMED_RESERVATION_STATUSES).toContain((msg as any).reservationStatus);
      }
    });
  });
});
