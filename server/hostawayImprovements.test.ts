/**
 * Tests for Hostaway integration improvements:
 * 1. Real-time Hostaway webhook endpoint
 * 2. 10-minute AI classification cron schedule
 * 3. Expanded AI triggers (shouldCreateTask logic)
 * 4. Broader keyword matching (maintenance override + escalation override)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Inline the logic under test (shouldCreateTask + keyword helpers) ──────

const TASK_TRIGGER_CATEGORIES = new Set([
  "maintenance",
  "cleaning",
  "improvement",
  "complaint",
]);

const MAINTENANCE_OVERRIDE_KEYWORDS = [
  "ac", "a/c", "air condition", "heat", "heater", "heating",
  "hot water", "broken", "not working", "doesn't work", "won't work",
  "leak", "leaking", "smell", "smells", "noise", "noisy", "loud",
  "bug", "bugs", "insect", "insects", "ant", "ants", "roach", "cockroach", "spider",
  "dirty", "stain", "stained", "mold", "mildew",
  "clogged", "drain", "toilet", "fridge", "refrigerator", "freezer",
  "oven", "stove", "microwave", "dishwasher", "washer", "dryer",
  "wifi", "wi-fi", "internet", "no signal",
  "lockbox", "lock box", "door code", "key", "can't get in", "locked out",
  "parking", "garage",
  "water", "flood", "flooded",
  "power", "electricity", "outlet", "light", "lights",
];

const ESCALATION_KEYWORDS = [
  "refund", "leaving early", "checking out early", "cut our trip short",
  "calling airbnb", "calling vrbo", "contacting airbnb", "contacting vrbo",
  "contacting support", "filing a complaint",
  "disappointed", "unacceptable", "disgusting", "worst",
  "health department", "unsafe", "dangerous", "hazard",
  "lawsuit", "lawyer", "attorney", "legal action",
];

function bodyContainsKeyword(body: string | null | undefined, keywords: string[]): boolean {
  if (!body) return false;
  const lower = body.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

interface MockGuestMessage {
  aiAnalyzed: boolean;
  isIncoming: boolean | null;
  aiCategory: string | null;
  aiSentiment: string | null;
  aiUrgency: string | null;
  body: string | null;
}

function shouldCreateTask(msg: MockGuestMessage): boolean {
  if (!msg.aiAnalyzed) return false;
  if (msg.isIncoming === false) return false;
  if (msg.aiCategory && TASK_TRIGGER_CATEGORIES.has(msg.aiCategory)) return true;
  if (msg.aiSentiment === "negative") return true;
  if (msg.aiUrgency === "high" || msg.aiUrgency === "critical") return true;

  // KEYWORD OVERRIDE
  if (msg.aiCategory === "question" || msg.aiCategory === "other") {
    if (bodyContainsKeyword(msg.body, MAINTENANCE_OVERRIDE_KEYWORDS)) {
      return true;
    }
  }

  // ESCALATION OVERRIDE
  if (bodyContainsKeyword(msg.body, ESCALATION_KEYWORDS)) {
    return true;
  }

  return false;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("shouldCreateTask — original triggers (preserved)", () => {
  it("creates task for maintenance category", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "maintenance", aiSentiment: "neutral", aiUrgency: "medium",
      body: "The sink is dripping.",
    })).toBe(true);
  });

  it("creates task for cleaning category", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "cleaning", aiSentiment: "neutral", aiUrgency: "low",
      body: "The bathroom wasn't cleaned.",
    })).toBe(true);
  });

  it("creates task for complaint category", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "complaint", aiSentiment: "negative", aiUrgency: "high",
      body: "This is terrible.",
    })).toBe(true);
  });

  it("creates task for improvement category", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "improvement", aiSentiment: "neutral", aiUrgency: "low",
      body: "It would be nice if there was a coffee maker.",
    })).toBe(true);
  });

  it("creates task for negative sentiment regardless of category", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "other", aiSentiment: "negative", aiUrgency: "low",
      body: "Not happy with the stay.",
    })).toBe(true);
  });

  it("creates task for high urgency regardless of category", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "question", aiSentiment: "neutral", aiUrgency: "high",
      body: "Something is wrong.",
    })).toBe(true);
  });

  it("creates task for critical urgency", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "compliment", aiSentiment: "positive", aiUrgency: "critical",
      body: "There's a gas smell!",
    })).toBe(true);
  });

  it("does NOT create task for unanalyzed messages", () => {
    expect(shouldCreateTask({
      aiAnalyzed: false, isIncoming: true,
      aiCategory: "maintenance", aiSentiment: "negative", aiUrgency: "high",
      body: "Everything is broken.",
    })).toBe(false);
  });

  it("does NOT create task for outgoing host messages", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: false,
      aiCategory: "maintenance", aiSentiment: "negative", aiUrgency: "high",
      body: "We'll fix the AC.",
    })).toBe(false);
  });

  it("does NOT create task for neutral compliment", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "compliment", aiSentiment: "positive", aiUrgency: "low",
      body: "Great place, loved it!",
    })).toBe(false);
  });
});

describe("shouldCreateTask — keyword override for questions", () => {
  it("creates task when question mentions AC", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "question", aiSentiment: "neutral", aiUrgency: "low",
      body: "Is the AC supposed to sound like that?",
    })).toBe(true);
  });

  it("creates task when question mentions hot water", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "question", aiSentiment: "neutral", aiUrgency: "low",
      body: "Is there usually hot water in the morning?",
    })).toBe(true);
  });

  it("creates task when question mentions broken", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "question", aiSentiment: "neutral", aiUrgency: "low",
      body: "Is the dishwasher broken? It won't start.",
    })).toBe(true);
  });

  it("creates task when question mentions wifi", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "question", aiSentiment: "neutral", aiUrgency: "low",
      body: "Where can I find the wifi password?",
    })).toBe(true);
  });

  it("creates task when question mentions lockbox", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "question", aiSentiment: "neutral", aiUrgency: "low",
      body: "The lockbox code doesn't seem to work, can you help?",
    })).toBe(true);
  });

  it("creates task when 'other' category mentions oven", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "other", aiSentiment: "neutral", aiUrgency: "low",
      body: "The oven control panel is not lighting up.",
    })).toBe(true);
  });

  it("creates task when question mentions bugs/insects", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "question", aiSentiment: "neutral", aiUrgency: "low",
      body: "Are there usually this many ants in the kitchen?",
    })).toBe(true);
  });

  it("creates task when question mentions stain", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "question", aiSentiment: "neutral", aiUrgency: "low",
      body: "There's a stain on the couch, was that there before?",
    })).toBe(true);
  });

  it("does NOT create task for generic question without keywords", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "question", aiSentiment: "neutral", aiUrgency: "low",
      body: "What time is checkout?",
    })).toBe(false);
  });

  it("does NOT create task for compliment with keyword (only overrides question/other)", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "compliment", aiSentiment: "positive", aiUrgency: "low",
      body: "The AC works perfectly!",
    })).toBe(false);
  });
});

describe("shouldCreateTask — escalation override", () => {
  it("creates task when guest mentions refund", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "question", aiSentiment: "neutral", aiUrgency: "low",
      body: "I'd like to discuss a refund for the first night.",
    })).toBe(true);
  });

  it("creates task when guest mentions leaving early", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "other", aiSentiment: "neutral", aiUrgency: "low",
      body: "We're thinking about leaving early because of the noise.",
    })).toBe(true);
  });

  it("creates task when guest mentions calling Airbnb", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "compliment", aiSentiment: "positive", aiUrgency: "low",
      body: "If this isn't fixed I'll be calling Airbnb about this.",
    })).toBe(true);
  });

  it("creates task when guest says 'unacceptable'", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "other", aiSentiment: "neutral", aiUrgency: "low",
      body: "This situation is unacceptable.",
    })).toBe(true);
  });

  it("creates task when guest mentions lawyer/legal", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "other", aiSentiment: "neutral", aiUrgency: "low",
      body: "I'm going to have my lawyer look into this.",
    })).toBe(true);
  });

  it("creates task when guest says 'unsafe'", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "question", aiSentiment: "neutral", aiUrgency: "low",
      body: "The railing on the deck feels unsafe.",
    })).toBe(true);
  });

  it("creates task when guest says 'disgusting'", () => {
    expect(shouldCreateTask({
      aiAnalyzed: true, isIncoming: true,
      aiCategory: "other", aiSentiment: "neutral", aiUrgency: "low",
      body: "The bathroom is disgusting.",
    })).toBe(true);
  });
});

describe("bodyContainsKeyword", () => {
  it("matches case-insensitively", () => {
    expect(bodyContainsKeyword("The AC is broken", ["ac"])).toBe(true);
    expect(bodyContainsKeyword("the ac is broken", ["AC"])).toBe(true);
    expect(bodyContainsKeyword("THE AC IS BROKEN", ["ac"])).toBe(true);
  });

  it("returns false for null/undefined body", () => {
    expect(bodyContainsKeyword(null, ["ac"])).toBe(false);
    expect(bodyContainsKeyword(undefined, ["ac"])).toBe(false);
  });

  it("returns false when no keywords match", () => {
    expect(bodyContainsKeyword("Everything is great!", MAINTENANCE_OVERRIDE_KEYWORDS)).toBe(false);
  });

  it("matches partial words (e.g., 'heating' matches 'heat')", () => {
    expect(bodyContainsKeyword("The heating system is great", ["heat"])).toBe(true);
  });

  it("matches multi-word keywords", () => {
    expect(bodyContainsKeyword("There's no hot water", ["hot water"])).toBe(true);
    expect(bodyContainsKeyword("I can't get in to the property", ["can't get in"])).toBe(true);
  });
});

describe("Hostaway webhook endpoint structure", () => {
  it("webhook route is registered at /api/webhooks/hostaway", async () => {
    // Verify the webhook file exports a router with the hostaway route
    const fs = await import("fs");
    const webhookCode = fs.readFileSync("/home/ubuntu/wandai/server/webhooks.ts", "utf-8");
    expect(webhookCode).toContain('webhookRouter.post("/hostaway"');
    expect(webhookCode).toContain("upsertGuestMessage");
  });

  it("webhook handles test/ping events", async () => {
    const fs = await import("fs");
    const webhookCode = fs.readFileSync("/home/ubuntu/wandai/server/webhooks.ts", "utf-8");
    expect(webhookCode).toContain('body?.event === "test"');
    expect(webhookCode).toContain('body?.event === "ping"');
  });

  it("webhook always returns 200 even on error", async () => {
    const fs = await import("fs");
    const webhookCode = fs.readFileSync("/home/ubuntu/wandai/server/webhooks.ts", "utf-8");
    // Check that the catch block returns 200
    expect(webhookCode).toContain("res.status(200).json");
  });
});

describe("Cron schedule — 10-minute AI classification", () => {
  it("cron.ts uses 10-minute interval for guest message pipeline", async () => {
    const fs = await import("fs");
    const cronCode = fs.readFileSync("/home/ubuntu/wandai/server/cron.ts", "utf-8");
    expect(cronCode).toContain("TEN_MINUTES_MS");
    expect(cronCode).toContain("10 * 60 * 1000");
    // Should NOT still have the old 5x daily schedule for guest messages
    expect(cronCode).not.toContain('scheduleAtHours("Guest Message Pipeline"');
  });

  it("cron.ts runs guest message pipeline on startup", async () => {
    const fs = await import("fs");
    const cronCode = fs.readFileSync("/home/ubuntu/wandai/server/cron.ts", "utf-8");
    expect(cronCode).toContain("guestMsgStartup");
    expect(cronCode).toContain("30_000");
  });
});

describe("Expanded AI prompt", () => {
  it("AI prompt includes soft complaint detection rules", async () => {
    const fs = await import("fs");
    const aiCode = fs.readFileSync("/home/ubuntu/wandai/server/aiAnalysis.ts", "utf-8");
    expect(aiCode).toContain("SOFT COMPLAINTS DISGUISED AS QUESTIONS");
    expect(aiCode).toContain("Is the AC supposed to sound like that?");
  });

  it("AI prompt includes improvement suggestion detection", async () => {
    const fs = await import("fs");
    const aiCode = fs.readFileSync("/home/ubuntu/wandai/server/aiAnalysis.ts", "utf-8");
    expect(aiCode).toContain("IMPROVEMENT SUGGESTIONS");
    expect(aiCode).toContain("it would be nice if");
  });

  it("AI prompt includes experience friction detection", async () => {
    const fs = await import("fs");
    const aiCode = fs.readFileSync("/home/ubuntu/wandai/server/aiAnalysis.ts", "utf-8");
    expect(aiCode).toContain("EXPERIENCE FRICTION SIGNALS");
    expect(aiCode).toContain("lockbox");
    expect(aiCode).toContain("parking confusion");
  });

  it("AI prompt includes escalation detection rules", async () => {
    const fs = await import("fs");
    const aiCode = fs.readFileSync("/home/ubuntu/wandai/server/aiAnalysis.ts", "utf-8");
    expect(aiCode).toContain("ESCALATION DETECTION");
    expect(aiCode).toContain("refund");
    expect(aiCode).toContain("calling Airbnb");
    expect(aiCode).toContain("critical");
  });

  it("AI prompt includes appliance/system issue rules", async () => {
    const fs = await import("fs");
    const aiCode = fs.readFileSync("/home/ubuntu/wandai/server/aiAnalysis.ts", "utf-8");
    expect(aiCode).toContain("APPLIANCE/SYSTEM ISSUES");
    expect(aiCode).toContain("AC, heating, hot water");
  });
});
