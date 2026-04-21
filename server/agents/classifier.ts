/**
 * Phase 4 — cleaner-message intent classifier.
 *
 * Called as a pre-step on Starry's DM handler before the main agent loop
 * runs. The result (intent + hints) is injected into the agent's user
 * message so the main loop doesn't have to re-discover what kind of issue
 * it's looking at. Also exposed as a tool so the agent can re-classify
 * mid-conversation if a follow-up shifts the picture.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "../_core/env";

export type Intent =
  | "late_checkout"
  | "guest_issue"
  | "damage_report"
  | "access_issue"
  | "maintenance"
  | "supply_request"
  | "clean_blocked"
  | "other";

export const INTENTS: readonly Intent[] = [
  "late_checkout",
  "guest_issue",
  "damage_report",
  "access_issue",
  "maintenance",
  "supply_request",
  "clean_blocked",
  "other",
] as const;

export interface ClassifierResult {
  intent: Intent;
  confidence: number;
  listingHint?: string;
  taskHint?: string;
  reasoning: string;
}

const CLASSIFIER_SYSTEM = `You classify short-term-rental cleaner messages into one of 8 intents.

Intents:
- late_checkout     — guest is still in the property past checkout; cleaner is blocked or waiting
- guest_issue       — guest is complaining, unreachable, or asking for something the owner needs to handle
- damage_report     — cleaner found damage, missing items, or something the guest may owe for
- access_issue      — cleaner cannot enter (lockbox, keypad, broken door, wrong code)
- maintenance       — broken appliance, plumbing, HVAC, lightbulb, pest, etc. — anything that needs a fix
- supply_request    — cleaner is out of linens, toiletries, cleaning products, paper goods
- clean_blocked     — cleaning literally can't happen right now (power out, water off, prior cleaner left items)
- other             — small talk, general questions, status checks, anything that doesn't fit the above

Rules:
- Pick exactly one intent.
- "confidence" is 0–1. Use <0.6 for genuinely ambiguous messages; the caller will coerce those to "other".
- "listingHint" captures a property name if mentioned ("Kimble", "Skyland", "the bunk room at Quo").
- "taskHint" captures the task referent if mentioned ("today's clean", "the HVAC ticket", "the oven repair").
- Keep "reasoning" to one short sentence.
- The referent is ALWAYS a Breezeway task, not a Wand task. Don't invent ids.`;

/**
 * Classify a cleaner DM. Uses a forced tool call so Anthropic returns a
 * JSON object matching `ClassifierResult` without needing to parse free text.
 */
export async function classifyCleanerMessage(
  text: string
): Promise<ClassifierResult> {
  if (!ENV.anthropicApiKey) {
    return {
      intent: "other",
      confidence: 0,
      reasoning: "anthropic api key not configured",
    };
  }
  if (!text.trim()) {
    return {
      intent: "other",
      confidence: 0,
      reasoning: "empty message",
    };
  }

  const client = new Anthropic({ apiKey: ENV.anthropicApiKey });

  const resp = await client.messages.create({
    model: ENV.anthropicModel,
    max_tokens: 400,
    system: CLASSIFIER_SYSTEM,
    tools: [
      {
        name: "emit_classification",
        description:
          "Emit the classification result. This is the ONLY way to respond — do not write free-form text.",
        input_schema: {
          type: "object",
          properties: {
            intent: { type: "string", enum: [...INTENTS] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            listingHint: { type: "string" },
            taskHint: { type: "string" },
            reasoning: { type: "string" },
          },
          required: ["intent", "confidence", "reasoning"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "emit_classification" },
    messages: [{ role: "user", content: text.slice(0, 4000) }],
  });

  const toolUse = resp.content.find(
    (c): c is Anthropic.Messages.ToolUseBlock => c.type === "tool_use"
  );
  if (!toolUse) {
    return {
      intent: "other",
      confidence: 0,
      reasoning: "classifier returned no tool_use block",
    };
  }

  const input = toolUse.input as Partial<ClassifierResult>;
  const intent: Intent = INTENTS.includes(input.intent as Intent)
    ? (input.intent as Intent)
    : "other";
  const confidence = typeof input.confidence === "number"
    ? Math.max(0, Math.min(1, input.confidence))
    : 0;

  // Coerce low-confidence classifications to "other" so callers can trust
  // the intent field without also checking confidence.
  const effective: Intent = confidence < 0.6 ? "other" : intent;

  return {
    intent: effective,
    confidence,
    listingHint: input.listingHint?.trim() || undefined,
    taskHint: input.taskHint?.trim() || undefined,
    reasoning: input.reasoning ?? "",
  };
}

/** Which agent / department each intent routes to. */
export interface IntentRouting {
  department: "leisr_ops" | "fivestr_ops";
  includeWanda: boolean;
}

export function getIntentRouting(intent: Intent): IntentRouting {
  switch (intent) {
    case "late_checkout":
    case "guest_issue":
      return { department: "leisr_ops", includeWanda: true };
    case "damage_report":
      return { department: "fivestr_ops", includeWanda: true };
    case "access_issue":
    case "maintenance":
    case "supply_request":
    case "clean_blocked":
    case "other":
      return { department: "fivestr_ops", includeWanda: false };
  }
}
