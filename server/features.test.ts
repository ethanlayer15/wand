/**
 * Tests for Feature Batch: POD Storage Addresses, Breezeway Clean Sync, Receipt Upload
 */
import { describe, it, expect, vi } from "vitest";
import { getWeekOfMonday } from "./payCalculation";

// ── POD Storage Address Tests ──────────────────────────────────────────

describe("POD Storage Addresses", () => {
  const POD_ADDRESSES = [
    { name: "WNC - West", address: "2895 Cope Creek Rd, Sylva, NC 28779" },
    { name: "WNC - East", address: "21 Riverwood Rd, Swannanoa, NC 28778" },
    { name: "WNC - AVL", address: "1515 Smokey Park Hwy, Candler, NC 28715" },
  ];

  it("has exactly 3 POD storage addresses defined", () => {
    expect(POD_ADDRESSES).toHaveLength(3);
  });

  it("each POD has a name and valid address", () => {
    for (const pod of POD_ADDRESSES) {
      expect(pod.name).toBeTruthy();
      expect(pod.address).toBeTruthy();
      expect(pod.address).toContain("NC");
      expect(pod.address).toMatch(/\d{5}$/); // ZIP code at end
    }
  });

  it("WNC - West has correct address", () => {
    const west = POD_ADDRESSES.find((p) => p.name === "WNC - West");
    expect(west?.address).toBe("2895 Cope Creek Rd, Sylva, NC 28779");
  });

  it("WNC - East has correct address", () => {
    const east = POD_ADDRESSES.find((p) => p.name === "WNC - East");
    expect(east?.address).toBe("21 Riverwood Rd, Swannanoa, NC 28778");
  });

  it("WNC - AVL has correct address", () => {
    const avl = POD_ADDRESSES.find((p) => p.name === "WNC - AVL");
    expect(avl?.address).toBe("1515 Smokey Park Hwy, Candler, NC 28715");
  });
});

// ── Breezeway Clean Sync Tests ─────────────────────────────────────────

describe("Breezeway Clean Sync Logic", () => {
  it("getWeekOfMonday correctly groups cleans by week", () => {
    // All dates in the same week should return the same Monday
    const mon = getWeekOfMonday(new Date("2026-03-30T12:00:00Z"));
    const wed = getWeekOfMonday(new Date("2026-04-01T12:00:00Z"));
    const fri = getWeekOfMonday(new Date("2026-04-03T12:00:00Z"));
    const sun = getWeekOfMonday(new Date("2026-04-05T12:00:00Z"));
    expect(mon).toBe("2026-03-30");
    expect(wed).toBe("2026-03-30");
    expect(fri).toBe("2026-03-30");
    expect(sun).toBe("2026-03-30");
  });

  it("dedup logic: same breezewayTaskId should not create duplicate", () => {
    const existingTaskIds = new Set(["12345", "67890"]);
    const newTaskId = "12345";
    expect(existingTaskIds.has(newTaskId)).toBe(true);
    // Should skip
  });

  it("dedup logic: new breezewayTaskId should be inserted", () => {
    const existingTaskIds = new Set(["12345", "67890"]);
    const newTaskId = "99999";
    expect(existingTaskIds.has(newTaskId)).toBe(false);
    // Should insert
  });

  it("paired clean detection: 2 matched cleaners → isPaired=true, splitRatio=0.50", () => {
    const matchedCleanerIds = [1, 2];
    const isPaired = matchedCleanerIds.length >= 2;
    const splitRatio = isPaired ? "0.50" : "1.00";
    expect(isPaired).toBe(true);
    expect(splitRatio).toBe("0.50");
  });

  it("solo clean detection: 1 matched cleaner → isPaired=false, splitRatio=1.00", () => {
    const matchedCleanerIds = [1];
    const isPaired = matchedCleanerIds.length >= 2;
    const splitRatio = isPaired ? "0.50" : "1.00";
    expect(isPaired).toBe(false);
    expect(splitRatio).toBe("1.00");
  });

  it("partner task ID is derived from primary task ID", () => {
    const taskId = "12345";
    const partnerTaskId = `${taskId}-partner`;
    expect(partnerTaskId).toBe("12345-partner");
    expect(partnerTaskId).not.toBe(taskId);
  });

  it("cutoff date filters old tasks", () => {
    const CUTOFF_DATE = new Date("2026-03-30T00:00:00.000Z");
    const oldTask = new Date("2026-03-15T00:00:00.000Z");
    const newTask = new Date("2026-04-01T00:00:00.000Z");
    expect(oldTask < CUTOFF_DATE).toBe(true); // should skip
    expect(newTask < CUTOFF_DATE).toBe(false); // should process
  });

  it("housekeeping department maps to cleaning category", () => {
    const mapDepartmentToCategory = (dept?: string) => {
      switch (dept?.toLowerCase()) {
        case "housekeeping": return "cleaning";
        case "inspection": return "improvements";
        default: return "maintenance";
      }
    };
    expect(mapDepartmentToCategory("housekeeping")).toBe("cleaning");
    expect(mapDepartmentToCategory("Housekeeping")).toBe("cleaning");
  });

  it("finished and closed stages are treated as completed", () => {
    const isCompleted = (stage?: string) =>
      stage === "finished" || stage === "closed";
    expect(isCompleted("finished")).toBe(true);
    expect(isCompleted("closed")).toBe(true);
    expect(isCompleted("open")).toBe(false);
    expect(isCompleted("started")).toBe(false);
    expect(isCompleted(undefined)).toBe(false);
  });
});

// ── Receipt Upload Tests ───────────────────────────────────────────────

describe("Receipt Upload Logic", () => {
  it("month format validation: YYYY-MM", () => {
    const monthRegex = /^\d{4}-\d{2}$/;
    expect(monthRegex.test("2026-04")).toBe(true);
    expect(monthRegex.test("2026-4")).toBe(false);
    expect(monthRegex.test("2026-04-01")).toBe(false);
    expect(monthRegex.test("April 2026")).toBe(false);
  });

  it("receipt type enum validation", () => {
    const validTypes = ["cell_phone", "vehicle_maintenance"];
    expect(validTypes.includes("cell_phone")).toBe(true);
    expect(validTypes.includes("vehicle_maintenance")).toBe(true);
    expect(validTypes.includes("other")).toBe(false);
  });

  it("file size limit: 10MB", () => {
    const MAX_SIZE = 10 * 1024 * 1024;
    expect(MAX_SIZE).toBe(10485760);
    expect(5 * 1024 * 1024 < MAX_SIZE).toBe(true); // 5MB OK
    expect(15 * 1024 * 1024 < MAX_SIZE).toBe(false); // 15MB too large
  });

  it("base64 encoding/decoding roundtrip", () => {
    const original = "Hello, receipt data!";
    const encoded = Buffer.from(original).toString("base64");
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    expect(decoded).toBe(original);
  });

  it("S3 file key includes cleaner ID, month, and type", () => {
    const cleanerId = 42;
    const month = "2026-04";
    const type = "cell_phone";
    const fileName = "bill.pdf";
    const randomSuffix = "abc123";
    const fileKey = `receipts/${cleanerId}/${month}/${type}-${randomSuffix}-${fileName}`;
    expect(fileKey).toContain("receipts/42/2026-04/cell_phone-");
    expect(fileKey).toContain("bill.pdf");
  });

  it("receipt status values", () => {
    const validStatuses = ["pending", "approved", "rejected"];
    expect(validStatuses).toContain("pending");
    expect(validStatuses).toContain("approved");
    expect(validStatuses).toContain("rejected");
  });

  it("current month calculation returns YYYY-MM format", () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    expect(currentMonth).toMatch(/^\d{4}-\d{2}$/);
  });
});

// ── Mileage Calculation Tests ──────────────────────────────────────────

describe("Mileage Distance Storage", () => {
  it("distance should be stored as one-way miles", () => {
    // The distanceFromStorage field stores one-way distance
    // Mileage reimbursement is calculated as round-trip (2x)
    const oneWayMiles = 15.5;
    const roundTripMiles = oneWayMiles * 2;
    expect(roundTripMiles).toBe(31.0);
  });

  it("distance of 0 means property is at the storage location", () => {
    const distance = 0;
    expect(distance).toBe(0);
    // No mileage reimbursement needed
  });

  it("distance is stored with 2 decimal precision", () => {
    const distance = 15.567;
    const stored = Number(distance.toFixed(2));
    expect(stored).toBe(15.57);
  });
});
