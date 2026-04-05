import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./_core/db";
import { rateCard } from "../drizzle/schema";
import { eq } from "drizzle-orm";

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-admin",
      email: "admin@test.com",
      name: "Test Admin",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("billing.rateCards", () => {
  const ctx = createPublicContext();
  let testCardId: number | undefined;

  it("lists rate cards", async () => {
    const caller = appRouter.createCaller(ctx);
    const result = await caller.billing.rateCards.list();
    expect(Array.isArray(result)).toBe(true);
    // Should have entries from the import
    expect(result.length).toBeGreaterThan(0);
  });

  it("upserts a new rate card entry", async () => {
    const caller = appRouter.createCaller(ctx);
    const result = await caller.billing.rateCards.upsert({
      propertyId: "test-999999",
      propertyName: "Test Property",
      csvName: "Test CSV Name",
      matchConfidence: "manual",
      taskType: "turnover-clean",
      amount: "99.99",
    });
    expect(result).toEqual({ success: true });

    // Verify it was created
    const list = await caller.billing.rateCards.list();
    const created = list.find((r) => r.propertyId === "test-999999");
    expect(created).toBeDefined();
    expect(created?.amount).toBe("99.99");
    expect(created?.propertyName).toBe("Test Property");
    expect(created?.csvName).toBe("Test CSV Name");
    expect(created?.matchConfidence).toBe("manual");
    testCardId = created?.id;
  });

  it("updates an existing rate card by ID", async () => {
    if (!testCardId) throw new Error("No test card ID");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.billing.rateCards.upsert({
      id: testCardId,
      propertyId: "test-999999",
      propertyName: "Test Property Updated",
      matchConfidence: "confirmed",
      matchScore: 100,
      taskType: "turnover-clean",
      amount: "149.99",
    });
    expect(result).toEqual({ success: true });

    // Verify the update
    const list = await caller.billing.rateCards.list();
    const updated = list.find((r) => r.id === testCardId);
    expect(updated?.amount).toBe("149.99");
    expect(updated?.propertyName).toBe("Test Property Updated");
    expect(updated?.matchConfidence).toBe("confirmed");
    expect(updated?.matchScore).toBe(100);
  });

  it("queries rate cards by property", async () => {
    const caller = appRouter.createCaller(ctx);
    const result = await caller.billing.rateCards.byProperty({
      propertyId: "test-999999",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].propertyId).toBe("test-999999");
  });

  it("deletes a rate card entry", async () => {
    if (!testCardId) throw new Error("No test card ID");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.billing.rateCards.delete({ id: testCardId });
    expect(result).toEqual({ success: true });

    // Verify deletion
    const list = await caller.billing.rateCards.list();
    const deleted = list.find((r) => r.id === testCardId);
    expect(deleted).toBeUndefined();
  });

  it("upserts by propertyId+taskType when no ID provided", async () => {
    const caller = appRouter.createCaller(ctx);

    // Create first
    await caller.billing.rateCards.upsert({
      propertyId: "test-888888",
      propertyName: "Upsert Test",
      taskType: "turnover-clean",
      amount: "50.00",
      matchConfidence: "manual",
    });

    // Upsert same propertyId+taskType should update
    await caller.billing.rateCards.upsert({
      propertyId: "test-888888",
      propertyName: "Upsert Test Updated",
      taskType: "turnover-clean",
      amount: "75.00",
      matchConfidence: "confirmed",
    });

    const list = await caller.billing.rateCards.list();
    const entries = list.filter((r) => r.propertyId === "test-888888");
    expect(entries.length).toBe(1);
    expect(entries[0].amount).toBe("75.00");
    expect(entries[0].matchConfidence).toBe("confirmed");

    // Cleanup
    await caller.billing.rateCards.delete({ id: entries[0].id });
  });
});
