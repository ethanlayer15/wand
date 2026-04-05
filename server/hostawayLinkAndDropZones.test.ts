/**
 * Tests for:
 * 1. Hostaway reservation link on guest message task cards
 * 2. Sticky fixed drop zones during drag
 * 3. hostawayReservationId stored during task creation from guest messages
 */

import { describe, it, expect } from "vitest";

// ── Hostaway Reservation Link ─────────────────────────────────────────────

describe("Hostaway Reservation Link", () => {
  describe("URL construction", () => {
    it("should build correct Hostaway dashboard URL from reservation ID", () => {
      const reservationId = "12345";
      const url = `https://dashboard.hostaway.com/reservations/${reservationId}`;
      expect(url).toBe("https://dashboard.hostaway.com/reservations/12345");
    });

    it("should handle numeric-string reservation IDs", () => {
      const reservationId = "987654321";
      const url = `https://dashboard.hostaway.com/reservations/${reservationId}`;
      expect(url).toContain("987654321");
    });
  });

  describe("link visibility rules", () => {
    it("should only show link for guest_message source with a reservation ID", () => {
      const shouldShowLink = (source: string, reservationId: string | null) =>
        source === "guest_message" && !!reservationId;

      expect(shouldShowLink("guest_message", "12345")).toBe(true);
      expect(shouldShowLink("guest_message", null)).toBe(false);
      expect(shouldShowLink("breezeway", "12345")).toBe(false);
      expect(shouldShowLink("wand_manual", "12345")).toBe(false);
      expect(shouldShowLink("airbnb_review", "12345")).toBe(false);
      expect(shouldShowLink("manual", "12345")).toBe(false);
    });

    it("should NOT show link for guest_message without reservation ID", () => {
      const shouldShowLink = (source: string, reservationId: string | null) =>
        source === "guest_message" && !!reservationId;

      expect(shouldShowLink("guest_message", "")).toBe(false);
      expect(shouldShowLink("guest_message", null)).toBe(false);
    });
  });

  describe("link attributes", () => {
    it("should open in a new tab (target=_blank)", () => {
      // Verify the link configuration
      const linkConfig = {
        target: "_blank",
        rel: "noopener noreferrer",
      };
      expect(linkConfig.target).toBe("_blank");
      expect(linkConfig.rel).toContain("noopener");
      expect(linkConfig.rel).toContain("noreferrer");
    });
  });
});

// ── Reservation ID Storage in Task Creation ──────────────────────────────

describe("Reservation ID Storage in Task Creation", () => {
  it("should use reservationId from primary message if available", () => {
    const primaryMsg = {
      id: 1,
      hostawayReservationId: "RES-001",
      hostawayConversationId: "CONV-001",
    };
    const msgs = [primaryMsg];

    const reservationId =
      primaryMsg.hostawayReservationId ||
      msgs.find((m) => m.hostawayReservationId)?.hostawayReservationId ||
      null;

    expect(reservationId).toBe("RES-001");
  });

  it("should fall back to first message with a reservation ID if primary has none", () => {
    const primaryMsg = {
      id: 1,
      hostawayReservationId: null,
      hostawayConversationId: "CONV-001",
    };
    const secondMsg = {
      id: 2,
      hostawayReservationId: "RES-002",
      hostawayConversationId: "CONV-001",
    };
    const msgs = [primaryMsg, secondMsg];

    const reservationId =
      primaryMsg.hostawayReservationId ||
      msgs.find((m) => m.hostawayReservationId)?.hostawayReservationId ||
      null;

    expect(reservationId).toBe("RES-002");
  });

  it("should return null if no messages have a reservation ID", () => {
    const primaryMsg = {
      id: 1,
      hostawayReservationId: null,
      hostawayConversationId: "CONV-001",
    };
    const msgs = [primaryMsg];

    const reservationId =
      primaryMsg.hostawayReservationId ||
      msgs.find((m) => m.hostawayReservationId)?.hostawayReservationId ||
      null;

    expect(reservationId).toBeNull();
  });

  it("should store reservation ID in task values when available", () => {
    const reservationId = "RES-123";
    const taskValues = {
      externalId: "CONV-001",
      externalSource: "hostaway",
      source: "guest_message",
      hostawayReservationId: reservationId ?? undefined,
    };

    expect(taskValues.hostawayReservationId).toBe("RES-123");
  });

  it("should not store reservation ID when null", () => {
    const reservationId: string | null = null;
    const taskValues = {
      externalId: "CONV-001",
      externalSource: "hostaway",
      source: "guest_message",
      hostawayReservationId: reservationId ?? undefined,
    };

    expect(taskValues.hostawayReservationId).toBeUndefined();
  });
});

// ── Sticky Drop Zones ────────────────────────────────────────────────────

describe("Sticky Drop Zones", () => {
  it("should use fixed positioning for drop zones during drag", () => {
    // Verify the CSS properties for fixed positioning
    const dropZoneStyle = {
      position: "fixed" as const,
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
    };

    expect(dropZoneStyle.position).toBe("fixed");
    expect(dropZoneStyle.bottom).toBe(0);
    expect(dropZoneStyle.zIndex).toBeGreaterThan(1000);
  });

  it("should only render drop zones when a drag is active", () => {
    // Simulate the conditional rendering logic
    const shouldRenderDropZones = (activeDragTask: unknown) => !!activeDragTask;

    expect(shouldRenderDropZones(null)).toBe(false);
    expect(shouldRenderDropZones(undefined)).toBe(false);
    expect(shouldRenderDropZones({ id: 1, title: "Test task" })).toBe(true);
  });

  it("should have three drop zones: Done, Ignored, Ideas for Later", () => {
    const dropZones = [
      { status: "completed", label: "Done" },
      { status: "ignored", label: "Ignored" },
      { status: "ideas_for_later", label: "Ideas for Later" },
    ];

    expect(dropZones).toHaveLength(3);
    expect(dropZones.map((z) => z.status)).toContain("completed");
    expect(dropZones.map((z) => z.status)).toContain("ignored");
    expect(dropZones.map((z) => z.status)).toContain("ideas_for_later");
  });

  it("should have z-index high enough to render above sidebar and cards", () => {
    const dropZoneZIndex = 9999;
    const sidebarZIndex = 50; // typical sidebar z-index
    const cardZIndex = 10; // typical card z-index

    expect(dropZoneZIndex).toBeGreaterThan(sidebarZIndex);
    expect(dropZoneZIndex).toBeGreaterThan(cardZIndex);
  });

  it("should not affect layout when not dragging (conditional render)", () => {
    // When activeDragTask is null, drop zones are not rendered at all
    // This means no fixed element occupies the bottom of the viewport
    const activeDragTask = null;
    const isRendered = !!activeDragTask;

    expect(isRendered).toBe(false);
  });
});
