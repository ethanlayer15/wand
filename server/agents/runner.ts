/**
 * Agent runner — single shared wrapper around the Anthropic Messages API
 * that loops on tool use, logs every tool call to `agentActions`, and
 * returns the final assistant reply.
 *
 * Phase 1: scaffold only. The tool registry is intentionally tiny (just
 * `getOnCall` + `listMyTasks`) to prove the loop end-to-end. Phase 2+
 * grows it (Hostaway send, Breezeway comment, Slack DM, etc.).
 */
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { agentActions } from "../../drizzle/schema";
import type { AgentRunInput, AgentRunResult } from "./types";
import { AGENTS } from "./identities";
import { runAgentTool, AGENT_TOOLS } from "./tools";

const PROPERTY_RULE = `Property naming is literal. Property names like "Skylar" and "Skyland" look
similar but are different listings. When you call findListing, the response
includes a matchType per row ('exact', 'word', 'contains', 'none'). Only pass
listingId to createTaskDraft when the matchType is 'exact'. NEVER substitute a
lookalike name, never abbreviate, never re-run findListing with a shorter query
to force a hit. If no exact match exists, omit listingId and note "(property X
not found — please attach manually)" in the description so a human can fix it.`;

const SYSTEM_PROMPTS: Record<string, string> = {
  wanda: `You are Wanda, the AI chief of staff for Leisr Stays — a short-term-rental
operator. You live in Slack and help the Leisr Ops + Mgmt teams stay on top of
guest experience, property issues, and review-driven improvements.

Style: warm, concise, decisive. Lead with the answer, not the reasoning.
Always cite the specific Wand task / reservation / review you're referring to
when relevant. Never invent property names, guest names, or amounts — call a
tool to look them up.

${PROPERTY_RULE}

When a request crosses into 5STR Cleaning & Maintenance territory (cleans,
cleaner messages, maintenance tickets), tag Starry to handle it.`,
  starry: `You are Starry, the AI chief of staff for 5STR Cleaning & Maintenance — the
ops arm that cleans + maintains Leisr Stays properties. You live in Slack and
help cleaners and the 5STR ops team coordinate cleans, maintenance, and on-call
escalations.

Style: warm, concise, decisive. Cleaners often voice-message — surface the
intent quickly and bullet the action items. Never invent property names; call
a tool.

Routing: when a cleaner DMs you about an issue, you receive a pre-classified
intent at the top of the message. If intent is anything except "other", call
routeEscalation to open a group DM with the on-call manager. The tasks cleaners
refer to are Breezeway tasks — use getCleanerActiveBreezewayTasks to resolve
"the task" / "my clean" / "the ticket" to a specific breezewayTaskId before
calling routeEscalation. For guest-related intents (late_checkout, guest_issue,
damage_report), routeEscalation automatically pulls Wanda and Leisr Ops on-call
into the DM — you don't need to tag Wanda separately.

${PROPERTY_RULE}`,
};

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const runId = randomUUID();
  const t0 = Date.now();
  const agent = AGENTS[input.agent];

  if (!ENV.anthropicApiKey) {
    return {
      runId,
      reply: null,
      toolCallsMade: 0,
      durationMs: Date.now() - t0,
      error: "ANTHROPIC_API_KEY not configured",
    };
  }

  const client = new Anthropic({ apiKey: ENV.anthropicApiKey });
  const db = await getDb();

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: input.userMessage },
  ];

  let toolCallsMade = 0;
  let finalText: string | null = null;

  // Cap loop iterations to prevent runaways.
  for (let step = 0; step < 8; step++) {
    let resp: Anthropic.Messages.Message;
    try {
      resp = await client.messages.create({
        model: ENV.anthropicModel,
        max_tokens: 1024,
        system: SYSTEM_PROMPTS[input.agent],
        tools: AGENT_TOOLS,
        messages,
      });
    } catch (err: any) {
      console.error(`[agent:${input.agent}] Anthropic call failed:`, err.message);
      return {
        runId,
        reply: null,
        toolCallsMade,
        durationMs: Date.now() - t0,
        error: err.message,
      };
    }

    // Append the assistant turn to the running conversation.
    messages.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason !== "tool_use") {
      // Final text turn.
      finalText = resp.content
        .filter((c): c is Anthropic.Messages.TextBlock => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
      break;
    }

    // Run any tool_use blocks, gather tool_result blocks for the next turn.
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type !== "tool_use") continue;
      toolCallsMade++;
      const toolStart = Date.now();
      let toolOk = true;
      let toolOutput: any = null;
      let toolErr: string | undefined;
      try {
        toolOutput = await runAgentTool({
          name: block.name,
          input: block.input,
          agent: input.agent,
          wandUserId: input.wandUserId,
          slackContext: input.slack,
        });
      } catch (err: any) {
        toolOk = false;
        toolErr = err.message;
        toolOutput = { error: err.message };
      }
      const durationMs = Date.now() - toolStart;

      // Audit log
      if (db) {
        try {
          await db.insert(agentActions).values({
            agentName: input.agent,
            runId,
            toolName: block.name,
            input: block.input as any,
            output: toolOutput as any,
            success: toolOk,
            errorMessage: toolErr,
            durationMs,
            userId: input.wandUserId ?? null,
            triggeredBy: input.triggeredBy,
          });
        } catch (err: any) {
          console.error(`[agent:${input.agent}] audit log insert failed:`, err.message);
        }
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(toolOutput).slice(0, 8000),
        is_error: !toolOk,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    runId,
    reply: finalText,
    toolCallsMade,
    durationMs: Date.now() - t0,
  };
}
