/**
 * Wand AI Agents — Tool Catalog
 *
 * Every Wand action the agent layer can take lives here as a typed tool.
 * Each tool has:
 *   - name          stable identifier passed to Claude
 *   - description   human-readable purpose (shown to Claude)
 *   - inputSchema   Zod → JSON Schema for Claude's tool definition
 *   - handler       the actual implementation
 *   - riskTier      "read" | "suggest" | "write-low" | "write-gated"
 *
 * Phase 1 ships ONLY read + suggest tier tools. Write-gated tools come in
 * phases 2–5 after we have ops-inbox approval data to justify them.
 *
 * Tools compile down to Anthropic's tool-use schema via `toAnthropicTools()`.
 * The runner calls `runTool(name, input)` to dispatch.
 */
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, like, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  listings,
  cleaners,
  tasks,
  reviews,
  guestMessages,
  pods,
  podVendors,
  propertyVendors,
  completedCleans,
  breezewayProperties,
} from "../../drizzle/schema";
import { getPlaybook, listSuggestions } from "./agentDb";

// ── Types ────────────────────────────────────────────────────────────

export type RiskTier = "read" | "suggest" | "write-low" | "write-gated";

export type AgentTool<TInput = any, TOutput = any> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  riskTier: RiskTier;
  handler: (input: TInput) => Promise<TOutput>;
};

// ── Helpers ──────────────────────────────────────────────────────────

function zodToJsonSchema(schema: z.ZodType<any>): Record<string, unknown> {
  // Minimal Zod → JSON Schema conversion sufficient for Anthropic tool input.
  // We don't need full spec coverage — just object/string/number/boolean/array/optional.
  const anySchema = schema as any;

  if (anySchema._def?.typeName === "ZodObject") {
    const shape = anySchema._def.shape();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const vAny = value as any;
      properties[key] = zodToJsonSchema(vAny);
      if (!vAny.isOptional?.()) required.push(key);
    }
    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }
  if (anySchema._def?.typeName === "ZodOptional") {
    return zodToJsonSchema(anySchema._def.innerType);
  }
  if (anySchema._def?.typeName === "ZodString") {
    const out: Record<string, unknown> = { type: "string" };
    if (anySchema.description) out.description = anySchema.description;
    return out;
  }
  if (anySchema._def?.typeName === "ZodNumber") {
    return { type: "number" };
  }
  if (anySchema._def?.typeName === "ZodBoolean") {
    return { type: "boolean" };
  }
  if (anySchema._def?.typeName === "ZodArray") {
    return {
      type: "array",
      items: zodToJsonSchema(anySchema._def.type),
    };
  }
  if (anySchema._def?.typeName === "ZodEnum") {
    return { type: "string", enum: anySchema._def.values };
  }
  if (anySchema._def?.typeName === "ZodNullable") {
    return zodToJsonSchema(anySchema._def.innerType);
  }
  return { type: "string" };
}

// ── Tool Definitions ─────────────────────────────────────────────────

const listingsFindInput = z.object({
  query: z
    .string()
    .optional()
    .describe("Fuzzy name/address/city search term. Omit to list all active."),
  podId: z.number().optional().describe("Filter by pod ID"),
  limit: z.number().optional().describe("Max results (default 25)"),
});

const listingsFind: AgentTool = {
  name: "listings_find",
  description:
    "Search active Hostaway listings by name, internal name, address, or city. Returns id, name, pod, address, guest capacity, and rolling avg rating.",
  riskTier: "read",
  inputSchema: listingsFindInput,
  handler: async (input: z.infer<typeof listingsFindInput>) => {
    const db = await getDb();
    if (!db) return { results: [] };
    const q = input.query?.trim();
    const limit = Math.min(input.limit ?? 25, 100);

    const conditions: any[] = [eq(listings.status, "active")];
    if (q) {
      const like_ = `%${q}%`;
      conditions.push(
        or(
          like(listings.name, like_),
          like(listings.internalName, like_),
          like(listings.address, like_),
          like(listings.city, like_)
        )
      );
    }
    if (input.podId !== undefined) {
      conditions.push(eq(listings.podId, input.podId));
    }

    const rows = await db
      .select({
        id: listings.id,
        name: listings.name,
        internalName: listings.internalName,
        address: listings.address,
        city: listings.city,
        state: listings.state,
        podId: listings.podId,
        guestCapacity: listings.guestCapacity,
        avgRating: listings.avgRating,
        reviewCount: listings.reviewCount,
      })
      .from(listings)
      .where(and(...conditions))
      .limit(limit);

    return { results: rows, count: rows.length };
  },
};

const listingsGetInput = z.object({
  listingId: z.number().describe("Listing ID"),
});

const listingsGet: AgentTool = {
  name: "listings_get",
  description:
    "Get a single listing with its pod name, vendor directory, and the current property playbook (quirks, frequent issues, guest feedback themes).",
  riskTier: "read",
  inputSchema: listingsGetInput,
  handler: async (input: z.infer<typeof listingsGetInput>) => {
    const db = await getDb();
    if (!db) return { listing: null };

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, input.listingId))
      .limit(1);
    if (!listing) return { listing: null };

    let podName: string | null = null;
    if (listing.podId) {
      const [pod] = await db
        .select({ name: pods.name, region: pods.region })
        .from(pods)
        .where(eq(pods.id, listing.podId))
        .limit(1);
      podName = pod?.name ?? null;
    }

    const [propOverrides, podDefaults] = await Promise.all([
      db
        .select()
        .from(propertyVendors)
        .where(eq(propertyVendors.listingId, input.listingId)),
      listing.podId
        ? db
            .select()
            .from(podVendors)
            .where(eq(podVendors.podId, listing.podId))
        : Promise.resolve([] as any[]),
    ]);

    const playbook = await getPlaybook(input.listingId);

    return {
      listing: { ...listing, podName },
      vendors: {
        propertyOverrides: propOverrides,
        podDefaults,
      },
      playbook,
    };
  },
};

const podsListInput = z.object({});

const podsList: AgentTool = {
  name: "pods_list",
  description:
    "List all pods with name, region, storage address, and property count.",
  riskTier: "read",
  inputSchema: podsListInput,
  handler: async () => {
    const db = await getDb();
    if (!db) return { pods: [] };
    const allPods = await db.select().from(pods).orderBy(pods.name);
    const counts = await db
      .select({
        podId: listings.podId,
        count: sql<number>`COUNT(*)`,
      })
      .from(listings)
      .where(isNotNull(listings.podId))
      .groupBy(listings.podId);
    const countMap = new Map(counts.map((r) => [r.podId, Number(r.count)]));
    return {
      pods: allPods.map((p) => ({
        ...p,
        propertyCount: countMap.get(p.id) ?? 0,
      })),
    };
  },
};

const cleanersListInput = z.object({
  podId: z.number().optional().describe("Filter by pod ID"),
  activeOnly: z.boolean().optional().describe("Default true"),
  limit: z.number().optional(),
});

const cleanersList: AgentTool = {
  name: "cleaners_list",
  description:
    "List cleaners with rolling score, current multiplier, and pod assignment. Useful for finding who can cover a clean, who's top-performing, or who needs coaching.",
  riskTier: "read",
  inputSchema: cleanersListInput,
  handler: async (input: z.infer<typeof cleanersListInput>) => {
    const db = await getDb();
    if (!db) return { cleaners: [] };

    const conditions: any[] = [];
    if (input.activeOnly !== false) conditions.push(eq(cleaners.active, true));
    if (input.podId !== undefined) conditions.push(eq(cleaners.podId, input.podId));

    const rows = await db
      .select({
        id: cleaners.id,
        name: cleaners.name,
        email: cleaners.email,
        podId: cleaners.podId,
        currentRollingScore: cleaners.currentRollingScore,
        currentMultiplier: cleaners.currentMultiplier,
        active: cleaners.active,
      })
      .from(cleaners)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(cleaners.currentRollingScore))
      .limit(Math.min(input.limit ?? 100, 500));

    return { cleaners: rows, count: rows.length };
  },
};

const tasksOpenInput = z.object({
  listingId: z.number().optional(),
  podId: z.number().optional(),
  olderThanHours: z
    .number()
    .optional()
    .describe("Only return tasks older than N hours (e.g. 24 for stale tasks)"),
  limit: z.number().optional(),
});

const tasksOpen: AgentTool = {
  name: "tasks_open",
  description:
    "List open (non-completed, non-ignored) tasks. Optionally filter by listing, pod, or age. Includes title, status, priority, category, and listing name.",
  riskTier: "read",
  inputSchema: tasksOpenInput,
  handler: async (input: z.infer<typeof tasksOpenInput>) => {
    const db = await getDb();
    if (!db) return { tasks: [] };

    const conditions: any[] = [
      inArray(tasks.status, [
        "created",
        "needs_review",
        "up_next",
        "in_progress",
      ] as any),
    ];
    if (input.listingId !== undefined) conditions.push(eq(tasks.listingId, input.listingId));
    if (input.olderThanHours !== undefined) {
      const cutoff = new Date(Date.now() - input.olderThanHours * 3600_000);
      conditions.push(sql`${tasks.createdAt} < ${cutoff}`);
    }

    const rows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        category: tasks.category,
        isUrgent: tasks.isUrgent,
        listingId: tasks.listingId,
        listingName: listings.name,
        assignedTo: tasks.assignedTo,
        createdAt: tasks.createdAt,
        breezewayTaskId: tasks.breezewayTaskId,
      })
      .from(tasks)
      .leftJoin(listings, eq(tasks.listingId, listings.id))
      .where(and(...conditions))
      .orderBy(desc(tasks.isUrgent), desc(tasks.createdAt))
      .limit(Math.min(input.limit ?? 50, 200));

    // Pod filter requires a second pass (tasks don't have podId directly)
    let result = rows;
    if (input.podId !== undefined) {
      const podListingIds = await db
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.podId, input.podId));
      const podSet = new Set(podListingIds.map((r) => r.id));
      result = rows.filter((r) => r.listingId && podSet.has(r.listingId));
    }

    return { tasks: result, count: result.length };
  },
};

const reviewsRecentInput = z.object({
  listingId: z.number().optional(),
  limit: z.number().optional(),
  flaggedOnly: z.boolean().optional(),
});

const reviewsRecent: AgentTool = {
  name: "reviews_recent",
  description:
    "Get recent Hostaway reviews with rating, text, sentiment, and the listing they're for. Useful for review-drafting context and performance coaching.",
  riskTier: "read",
  inputSchema: reviewsRecentInput,
  handler: async (input: z.infer<typeof reviewsRecentInput>) => {
    const db = await getDb();
    if (!db) return { reviews: [] };

    const conditions: any[] = [];
    if (input.listingId !== undefined) conditions.push(eq(reviews.listingId, input.listingId));
    if (input.flaggedOnly) conditions.push(eq(reviews.flagged, true));

    const rows = await db
      .select({
        id: reviews.id,
        listingId: reviews.listingId,
        listingName: listings.name,
        rating: reviews.rating,
        cleanlinessRating: reviews.cleanlinessRating,
        text: reviews.text,
        privateFeedback: reviews.privateFeedback,
        guestName: reviews.guestName,
        sentiment: reviews.sentiment,
        aiSummary: reviews.aiSummary,
        submittedAt: reviews.submittedAt,
      })
      .from(reviews)
      .leftJoin(listings, eq(reviews.listingId, listings.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(reviews.submittedAt))
      .limit(Math.min(input.limit ?? 25, 100));

    return { reviews: rows, count: rows.length };
  },
};

const guestMessagesRecentInput = z.object({
  listingId: z.number().optional(),
  hours: z.number().optional().describe("Lookback window in hours, default 72"),
  limit: z.number().optional(),
});

const guestMessagesRecent: AgentTool = {
  name: "guest_messages_recent",
  description:
    "Get recent guest messages from Hostaway (read-only — sending is handled by Hostbuddy.ai, not Wand).",
  riskTier: "read",
  inputSchema: guestMessagesRecentInput,
  handler: async (input: z.infer<typeof guestMessagesRecentInput>) => {
    const db = await getDb();
    if (!db) return { messages: [] };

    const hours = input.hours ?? 72;
    const cutoff = new Date(Date.now() - hours * 3600_000);
    const conditions: any[] = [sql`${guestMessages.sentAt} >= ${cutoff}`];
    if (input.listingId !== undefined)
      conditions.push(eq(guestMessages.listingId, input.listingId));

    const rows = await db
      .select({
        id: guestMessages.id,
        listingId: guestMessages.listingId,
        listingName: listings.name,
        guestName: guestMessages.guestName,
        body: guestMessages.body,
        isIncoming: guestMessages.isIncoming,
        sentAt: guestMessages.sentAt,
        channelName: guestMessages.channelName,
      })
      .from(guestMessages)
      .leftJoin(listings, eq(guestMessages.listingId, listings.id))
      .where(and(...conditions))
      .orderBy(desc(guestMessages.sentAt))
      .limit(Math.min(input.limit ?? 50, 200));

    return { messages: rows, count: rows.length };
  },
};

const vendorsFindInput = z.object({
  podId: z.number().optional(),
  listingId: z.number().optional(),
  specialty: z
    .enum([
      "plumber",
      "electrician",
      "hvac",
      "handyman",
      "pest_control",
      "landscaper",
      "appliance_repair",
    ])
    .optional(),
});

const vendorsFind: AgentTool = {
  name: "vendors_find",
  description:
    "Find vendors by pod or listing. If listingId is given, returns effective vendors (property overrides take priority over pod defaults). Optionally filter by specialty.",
  riskTier: "read",
  inputSchema: vendorsFindInput,
  handler: async (input: z.infer<typeof vendorsFindInput>) => {
    const db = await getDb();
    if (!db) return { vendors: [] };

    if (input.listingId !== undefined) {
      const [listing] = await db
        .select({ podId: listings.podId })
        .from(listings)
        .where(eq(listings.id, input.listingId))
        .limit(1);
      const [propV, podV] = await Promise.all([
        db
          .select()
          .from(propertyVendors)
          .where(eq(propertyVendors.listingId, input.listingId)),
        listing?.podId
          ? db.select().from(podVendors).where(eq(podVendors.podId, listing.podId))
          : Promise.resolve([] as any[]),
      ]);
      const filterSpec = (arr: any[]) =>
        input.specialty ? arr.filter((v) => v.specialty === input.specialty) : arr;
      return {
        vendors: {
          propertyOverrides: filterSpec(propV),
          podDefaults: filterSpec(podV),
        },
      };
    }

    if (input.podId !== undefined) {
      const rows = await db
        .select()
        .from(podVendors)
        .where(
          input.specialty
            ? and(
                eq(podVendors.podId, input.podId),
                eq(podVendors.specialty, input.specialty)
              )
            : eq(podVendors.podId, input.podId)
        );
      return { vendors: { podDefaults: rows } };
    }

    return { vendors: { message: "Provide podId or listingId" } };
  },
};

const completedCleansListInput = z.object({
  cleanerId: z.number().optional(),
  listingId: z.number().optional(),
  weekOf: z
    .string()
    .optional()
    .describe("ISO date (YYYY-MM-DD) for Monday of the target week"),
  limit: z.number().optional(),
});

const completedCleansList: AgentTool = {
  name: "completed_cleans_list",
  description:
    "List completed cleans. Filter by cleaner, listing, or week. Each row has cleaning fee, distance, paired ratio, and property name.",
  riskTier: "read",
  inputSchema: completedCleansListInput,
  handler: async (input: z.infer<typeof completedCleansListInput>) => {
    const db = await getDb();
    if (!db) return { cleans: [] };

    const conditions: any[] = [];
    if (input.cleanerId !== undefined)
      conditions.push(eq(completedCleans.cleanerId, input.cleanerId));
    if (input.listingId !== undefined)
      conditions.push(eq(completedCleans.listingId, input.listingId));
    if (input.weekOf) conditions.push(eq(completedCleans.weekOf, input.weekOf));

    const rows = await db
      .select({
        id: completedCleans.id,
        cleanerId: completedCleans.cleanerId,
        listingId: completedCleans.listingId,
        propertyName: completedCleans.propertyName,
        scheduledDate: completedCleans.scheduledDate,
        completedDate: completedCleans.completedDate,
        cleaningFee: completedCleans.cleaningFee,
        distanceMiles: completedCleans.distanceMiles,
        weekOf: completedCleans.weekOf,
        splitRatio: completedCleans.splitRatio,
      })
      .from(completedCleans)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(completedCleans.scheduledDate))
      .limit(Math.min(input.limit ?? 100, 500));

    return { cleans: rows, count: rows.length };
  },
};

const playbookGetInput = z.object({
  listingId: z.number().describe("Listing ID"),
});

const playbookGet: AgentTool = {
  name: "playbook_get",
  description:
    "Get the property playbook for a listing: quirks, frequent issues, preferred vendors, guest feedback themes, manual ops notes, and the agent's rolling summary.",
  riskTier: "read",
  inputSchema: playbookGetInput,
  handler: async (input: z.infer<typeof playbookGetInput>) => {
    const playbook = await getPlaybook(input.listingId);
    return { playbook };
  },
};

const suggestionsListInput = z.object({
  status: z
    .enum([
      "pending",
      "approved",
      "dismissed",
      "edited",
      "snoozed",
      "executed",
      "failed",
    ])
    .optional(),
  agentName: z.string().optional(),
  limit: z.number().optional(),
});

const suggestionsListTool: AgentTool = {
  name: "suggestions_list",
  description:
    "List Wand agent suggestions in the Ops Inbox. Useful for checking whether something has already been suggested so we don't duplicate.",
  riskTier: "read",
  inputSchema: suggestionsListInput,
  handler: async (input: z.infer<typeof suggestionsListInput>) => {
    const rows = await listSuggestions({
      status: input.status,
      agentName: input.agentName,
      limit: input.limit,
    });
    return { suggestions: rows, count: rows.length };
  },
};

// ── Suggest-tier tool: propose a new Ops Inbox card ──────────────────
// This is the ONE write tool Phase 1 ships with. It's intentionally
// low-risk: it just creates a pending suggestion row. A human has to
// approve it in the Ops Inbox before any external side effect happens.

const proposeSuggestionInput = z.object({
  agentName: z
    .string()
    .describe(
      "Stable agent identifier, e.g. 'chat', 'task_triage', 'review_drafter'"
    ),
  kind: z
    .string()
    .describe(
      "Suggestion category, e.g. 'task_reassign', 'review_reply', 'coaching_draft'"
    ),
  title: z.string().describe("Short headline for the Ops Inbox card"),
  summary: z.string().optional().describe("1–3 sentence description"),
  reasoning: z
    .string()
    .optional()
    .describe("Why this is being suggested — chain of thought for the human reviewer"),
  proposedAction: z
    .any()
    .optional()
    .describe(
      "Opaque JSON payload with what the executor should do on approval (e.g. { draftReply: '...', reviewId: 42 })"
    ),
  confidence: z
    .number()
    .optional()
    .describe("0.00–1.00 — how confident the agent is in this suggestion"),
  relatedListingId: z.number().optional(),
  relatedCleanerId: z.number().optional(),
  relatedTaskId: z.number().optional(),
  relatedReviewId: z.number().optional(),
  relatedPodId: z.number().optional(),
});

const proposeSuggestion: AgentTool = {
  name: "propose_suggestion",
  description:
    "Create a pending suggestion in the Ops Inbox for a human to review. Use this whenever you want to propose a concrete action that would change external state (send a message, reassign a task, etc.) — never do that directly.",
  riskTier: "suggest",
  inputSchema: proposeSuggestionInput,
  handler: async (input: z.infer<typeof proposeSuggestionInput>) => {
    const { insertSuggestion } = await import("./agentDb");
    const id = await insertSuggestion({
      agentName: input.agentName,
      kind: input.kind,
      title: input.title,
      summary: input.summary ?? null,
      reasoning: input.reasoning ?? null,
      proposedAction: (input.proposedAction ?? null) as any,
      confidence: input.confidence !== undefined ? String(input.confidence) : null,
      relatedListingId: input.relatedListingId ?? null,
      relatedCleanerId: input.relatedCleanerId ?? null,
      relatedTaskId: input.relatedTaskId ?? null,
      relatedReviewId: input.relatedReviewId ?? null,
      relatedPodId: input.relatedPodId ?? null,
    });
    return {
      suggestionId: id,
      status: "pending",
      message:
        "Suggestion queued in the Ops Inbox. A human reviewer will approve, edit, or dismiss it.",
    };
  },
};

// ── Registry ─────────────────────────────────────────────────────────

export const AGENT_TOOLS: AgentTool[] = [
  listingsFind,
  listingsGet,
  podsList,
  cleanersList,
  tasksOpen,
  reviewsRecent,
  guestMessagesRecent,
  vendorsFind,
  completedCleansList,
  playbookGet,
  suggestionsListTool,
  proposeSuggestion,
];

const TOOLS_BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

export function getToolByName(name: string): AgentTool | undefined {
  return TOOLS_BY_NAME.get(name);
}

export function toAnthropicTools(
  tools: AgentTool[] = AGENT_TOOLS
): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: zodToJsonSchema(t.inputSchema),
  }));
}

export async function runTool(
  name: string,
  rawInput: unknown
): Promise<{ success: boolean; output?: any; error?: string }> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` };
  }
  try {
    const parsed = tool.inputSchema.parse(rawInput ?? {});
    const output = await tool.handler(parsed);
    return { success: true, output };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message ?? String(err),
    };
  }
}
