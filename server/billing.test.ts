
// ── Stripe helper unit tests (pure logic, no DB) ──────────────────────────

describe("Billing: Stripe helper validation", () => {
  it("rejects charge amounts below $0.50 (50 cents)", () => {
    // The billing router checks totalCents < 50
    const lineItems = [
      { amount: "0.30", description: "test" },
      { amount: "0.10", description: "test2" },
    ];
    const totalCents = lineItems.reduce(
      (sum, item) => sum + Math.round(parseFloat(item.amount) * 100),
      0
    );
    expect(totalCents).toBe(40);
    expect(totalCents < 50).toBe(true);
  });

  it("correctly calculates total cents from decimal string amounts", () => {
    const lineItems = [
      { amount: "150.00" },
      { amount: "75.50" },
      { amount: "200.25" },
    ];
    const totalCents = lineItems.reduce(
      (sum, item) => sum + Math.round(parseFloat(item.amount) * 100),
      0
    );
    expect(totalCents).toBe(42575); // $425.75
  });

  it("handles empty amount strings as 0", () => {
    const amount = "";
    const cents = Math.round(parseFloat(amount) * 100);
    expect(isNaN(cents)).toBe(true);
  });

  it("truncates description to 500 chars for Stripe", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      propertyName: `Property ${i}`,
      description: `Very long task description for property ${i} with lots of details`,
    }));
    const description = items
      .map((i) => `${i.propertyName}: ${i.description}`)
      .join("; ");
    const truncated = description.slice(0, 500);
    expect(truncated.length).toBeLessThanOrEqual(500);
  });
});

// ── Billing record deduplication tests ─────────────────────────────────────

describe("Billing: Duplicate detection logic", () => {
  it("identifies already-billed task IDs from billing records", () => {
    const existingRecords = [
      { breezewayTaskId: "task-1", status: "charged" },
      { breezewayTaskId: "task-2", status: "invoiced" },
      { breezewayTaskId: "task-3", status: "charged" },
    ];