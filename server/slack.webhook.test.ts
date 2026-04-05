import { describe, it, expect } from "vitest";

describe("Slack webhook URL validation", () => {
  it("should have SLACK_WEBHOOK_URL set and be a valid Slack webhook URL", () => {
    const url = process.env.SLACK_WEBHOOK_URL;
    expect(url).toBeDefined();
    expect(url).toBeTruthy();
    expect(url!.startsWith("https://hooks.slack.com/")).toBe(true);
  });

  it("should have a complete webhook path (not just the base domain)", () => {
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) return;
    // Slack webhook URLs follow the pattern: https://hooks.slack.com/services/T.../B.../...
    const pathParts = new URL(url).pathname.split("/").filter(Boolean);
    expect(pathParts.length).toBeGreaterThanOrEqual(2);
  });

  // NOTE: The live POST test was removed because vitest runs during build/deploy,
  // which caused a "connection verified" message to spam the Slack channel on every
  // restart. The manual test button in Settings → SDT handles live verification.
});
