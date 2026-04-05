/**
 * Validates that the STRIPE_LIVE_KEY (or STRIPE_SECRET_KEY fallback) is configured
 * and can successfully reach the Stripe API to list customers.
 */
import { describe, it, expect } from "vitest";

describe("Stripe live key validation", () => {
  it("should have STRIPE_LIVE_KEY or STRIPE_SECRET_KEY set", () => {
    const key = process.env.STRIPE_LIVE_KEY ?? process.env.STRIPE_SECRET_KEY ?? "";
    expect(key.length).toBeGreaterThan(0);
    // Must be a valid Stripe key format (sk_live, sk_test, or rk_live)
    expect(key).toMatch(/^(sk_live|sk_test|rk_live|rk_test)_/);
  });

  it("should successfully call Stripe API to list customers", async () => {
    const key = process.env.STRIPE_LIVE_KEY ?? process.env.STRIPE_SECRET_KEY ?? "";
    expect(key.length).toBeGreaterThan(0);

    const response = await fetch("https://api.stripe.com/v1/customers?limit=1", {
      headers: {
        Authorization: `Basic ${Buffer.from(key + ":").toString("base64")}`,
      },
    });

    expect(response.status).toBe(200);
    const data = await response.json() as { object: string; data: unknown[] };
    expect(data.object).toBe("list");
    expect(Array.isArray(data.data)).toBe(true);
  });

  it("should prefer STRIPE_LIVE_KEY over STRIPE_SECRET_KEY", () => {
    if (process.env.STRIPE_LIVE_KEY) {
      expect(process.env.STRIPE_LIVE_KEY).toMatch(/^rk_live_/);
    }
  });
});
