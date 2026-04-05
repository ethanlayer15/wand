import { describe, it, expect, vi } from "vitest";
import { detectSdts, formatSlackMessage, type SdtAlert } from "./sdtNotifier";

describe("SDT Notifier", () => {
  describe("detectSdts", () => {
    const dates = ["2026-03-21", "2026-03-22", "2026-03-23", "2026-03-24", "2026-03-25"];

    it("detects an SDT when check-out and check-in overlap on the same property and date", () => {
      const reservations = [
        { id: 1, home_id: 100, check_out: "2026-03-22", check_in: "2026-03-20" },
        { id: 2, home_id: 100, check_in: "2026-03-22", check_out: "2026-03-25" },
      ];

      const sdts = detectSdts(reservations, dates);
      expect(sdts.size).toBe(1);
      const sdt = sdts.get("100:2026-03-22");
      expect(sdt).toBeDefined();
      expect(sdt!.propertyId).toBe(100);
      expect(sdt!.date).toBe("2026-03-22");
    });

    it("does not flag a property with only a check-out (no same-day check-in)", () => {
      const reservations = [
        { id: 1, home_id: 100, check_in: "2026-03-18", check_out: "2026-03-22" },
      ];

      const sdts = detectSdts(reservations, dates);
      expect(sdts.size).toBe(0);
    });

    it("does not flag a property with only a check-in (no same-day check-out)", () => {
      const reservations = [
        { id: 1, home_id: 100, check_in: "2026-03-22", check_out: "2026-03-25" },
      ];

      const sdts = detectSdts(reservations, dates);
      expect(sdts.size).toBe(0);
    });

    it("handles multiple SDTs across different properties", () => {
      const reservations = [
        // Property 100: SDT on Mar 22
        { id: 1, home_id: 100, check_in: "2026-03-20", check_out: "2026-03-22" },
        { id: 2, home_id: 100, check_in: "2026-03-22", check_out: "2026-03-25" },
        // Property 200: SDT on Mar 23
        { id: 3, home_id: 200, check_in: "2026-03-21", check_out: "2026-03-23" },
        { id: 4, home_id: 200, check_in: "2026-03-23", check_out: "2026-03-26" },
        // Property 300: no SDT (gap day between reservations)
        { id: 5, home_id: 300, check_in: "2026-03-20", check_out: "2026-03-22" },
        { id: 6, home_id: 300, check_in: "2026-03-23", check_out: "2026-03-25" },
      ];

      const sdts = detectSdts(reservations, dates);
      expect(sdts.size).toBe(2);
      expect(sdts.has("100:2026-03-22")).toBe(true);
      expect(sdts.has("200:2026-03-23")).toBe(true);
      expect(sdts.has("300:2026-03-22")).toBe(false);
    });

    it("handles ISO datetime strings (with T and timezone)", () => {
      const reservations = [
        { id: 1, home_id: 100, check_in: "2026-03-20T00:00:00Z", check_out: "2026-03-22T00:00:00Z" },
        { id: 2, home_id: 100, check_in: "2026-03-22T15:00:00Z", check_out: "2026-03-25T11:00:00Z" },
      ];

      const sdts = detectSdts(reservations, dates);
      expect(sdts.size).toBe(1);
      expect(sdts.has("100:2026-03-22")).toBe(true);
    });

    it("handles alternative field names (start_date/end_date)", () => {
      const reservations = [
        { id: 1, home_id: 100, start_date: "2026-03-20", end_date: "2026-03-22" },
        { id: 2, home_id: 100, start_date: "2026-03-22", end_date: "2026-03-25" },
      ];

      const sdts = detectSdts(reservations as any, dates);
      expect(sdts.size).toBe(1);
    });

    it("returns empty map for empty reservations", () => {
      const sdts = detectSdts([], dates);
      expect(sdts.size).toBe(0);
    });

    it("ignores reservations outside the date window", () => {
      const reservations = [
        { id: 1, home_id: 100, check_in: "2026-03-10", check_out: "2026-03-15" },
        { id: 2, home_id: 100, check_in: "2026-03-15", check_out: "2026-03-18" },
      ];

      const sdts = detectSdts(reservations, dates);
      expect(sdts.size).toBe(0);
    });
  });

  describe("formatSlackMessage", () => {
    it("formats a single alert correctly", () => {
      const alerts: SdtAlert[] = [
        {
          propertyName: "Mountain Retreat",
          propertyId: 100,
          date: "2026-03-22",
          hasCheckOut: true,
          hasCheckIn: true,
          hasAssignedCleaner: false,
        },
      ];

      const msg = formatSlackMessage(alerts);
      expect(msg).toContain("Unassigned Same-Day Turnovers");
      expect(msg).toContain("Mountain Retreat");
      expect(msg).toContain("2026-03-22");
      expect(msg).toContain("Please review in Breezeway");
    });

    it("formats multiple alerts as a consolidated message", () => {
      const alerts: SdtAlert[] = [
        {
          propertyName: "Mountain Retreat",
          propertyId: 100,
          date: "2026-03-22",
          hasCheckOut: true,
          hasCheckIn: true,
          hasAssignedCleaner: false,
        },
        {
          propertyName: "Beach House",
          propertyId: 200,
          date: "2026-03-23",
          hasCheckOut: true,
          hasCheckIn: true,
          hasAssignedCleaner: false,
        },
      ];

      const msg = formatSlackMessage(alerts);
      expect(msg).toContain("Mountain Retreat");
      expect(msg).toContain("Beach House");
      // Should be one message, not two separate ones
      expect(msg.split("Unassigned Same-Day Turnovers").length).toBe(2); // appears once
    });

    it("returns empty string for empty alerts", () => {
      const msg = formatSlackMessage([]);
      expect(msg).toBe("");
    });
  });
});
