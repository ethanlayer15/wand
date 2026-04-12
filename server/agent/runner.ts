/**
 * Wand AI Agents — Runner
 *
 * A minimal Anthropic Messages API client with a tool-use loop.
 *
 * Deliberately uses plain `fetch` against https://api.anthropic.com/v1/messages
 * so we don't pull in a new dependency during Phase 1. We can swap to
 * `@anthropic-ai/sdk` or the Claude Agent SDK later without changing the
 * public runner API.
 *
 * Flow per run:
 *   1. Bundle context (server/agent/context.ts) → system prompt
 *   2. POST messages to Anthropic with tool definitions
 *   3. If Claude returns `tool_use` blocks: dispatch them via server/agent/tools.ts,
 *      append `tool_result` messages, and POST again
 *   4. Repeat until Claude returns a pure `end_turn` response or we hit
 *      the iteration cap
 *   5. Audit every tool call in `agentActions`
 */
import { ENV } from "../_core/env";
import {
  AGENT_TOOLS,
  runTool,
  toAnthropicTools,
  type AgentTool,
} from "./tools";
import { buildAgentContext, type AgentContextInput } from "./context";
import { logAgentAction } from "./agentDb";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_ITERATIONS = 8;
const MAX_OUTPUT_TOKENS = 2048;

// ── Anthropic wire types (minimal) ───────────────────────────────────

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

type Message = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

type AnthropicResponse = {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<TextBlock | ToolUseBlock>;
  stop_reason: "end_turn" | "max_tokens" | "tool_use" | "stop_sequence" | null;
  usage?: { input_tokens: number; output_tokens: number };
};

// ── Public API ───────────────────────────────────────────────────────

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RunInput = AgentContextInput & {
  /** Full chat history — the latest user message must be last. */
  messages: ChatMessage[];
  /** Restrict the tool subset for this run. Defaults to all registered tools. */
  tools?: AgentTool[];
  /** Override agent iteration cap for long-running workflows. */
  maxIterations?: number;
  /** Trigger type for audit log. */
  triggeredBy?: string;
};

export type RunResult = {
  runId: string;
  finalText: string;
  toolCalls: Array<{
    name: string;
    input: unknown;
    output: unknown;
    success: boolean;
    error?: string;
    durationMs: number;
  }>;
  stopReason: AnthropicResponse["stop_reason"];
  iterations: number;
  usage?: { input_tokens: number; output_tokens: number };
};

export async function runAgent(input: RunInput): Promise<RunResult> {
  if (!ENV.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Set it in the environment before using Wand AI agents."
    );
  }

  const context = await buildAgentContext({
    user: input.user,
    systemPreamble: input.systemPreamble,
    agentName: input.agentName,
  });

  const tools = input.tools ?? AGENT_TOOLS;
  const toolDefs = toAnthropicTools(tools);
  const maxIters = input.maxIterations ?? MAX_ITERATIONS;
  const triggeredBy = input.triggeredBy ?? "chat";

  // Translate Wand ChatMessage[] → Anthropic message[] — first assistant/user turns only,
  // Claude-style content blocks are added as we loop for tool_use/tool_result.
  const conversation: Message[] = input.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const toolCallRecord: RunResult["toolCalls"] = [];
  let lastResponse: AnthropicResponse | null = null;
  let iterations = 0;

  while (iterations < maxIters) {
    iterations++;

    const body = {
      model: ENV.anthropicModel,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: context.systemPrompt,
      tools: toolDefs,
      messages: conversation,
    };

    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ENV.anthropicApiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(
        `Anthropic API error ${resp.status}: ${errText.slice(0, 500)}`
      );
    }

    lastResponse = (await resp.json()) as AnthropicResponse;

    // Append assistant response to conversation so next turn sees it
    conversation.push({
      role: "assistant",
      content: lastResponse.content,
    });

    // Collect any tool_use blocks and execute them
    const toolUseBlocks = lastResponse.content.filter(
      (c): c is ToolUseBlock => c.type === "tool_use"
    );

    if (toolUseBlocks.length === 0 || lastResponse.stop_reason === "end_turn") {
      // Conversation is complete
      break;
    }

    const toolResults: ToolResultBlock[] = [];
    for (const toolUse of toolUseBlocks) {
      const started = Date.now();
      const result = await runTool(toolUse.name, toolUse.input);
      const durationMs = Date.now() - started;

      toolCallRecord.push({
        name: toolUse.name,
        input: toolUse.input,
        output: result.output,
        success: result.success,
        error: result.error,
        durationMs,
      });

      // Audit log (fire-and-forget; errors are logged inside logAgentAction)
      void logAgentAction({
        agentName: context.agentName,
        runId: context.runId,
        toolName: toolUse.name,
        input: toolUse.input as any,
        output: truncateForStorage(result.output),
        success: result.success,
        errorMessage: result.error ?? null,
        durationMs,
        userId: context.userId,
        triggeredBy,
      });

      const serializedOutput = result.success
        ? safeStringify(result.output)
        : `ERROR: ${result.error ?? "unknown"}`;

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: serializedOutput.slice(0, 12_000),
        is_error: !result.success,
      });
    }

    conversation.push({
      role: "user",
      content: toolResults,
    });
  }

  // Extract final text from the last assistant message
  const finalText = lastResponse
    ? lastResponse.content
        .filter((c): c is TextBlock => c.type === "text")
        .map((c) => c.text)
        .join("\n")
    : "";

  return {
    runId: context.runId,
    finalText,
    toolCalls: toolCallRecord,
    stopReason: lastResponse?.stop_reason ?? null,
    iterations,
    usage: lastResponse?.usage,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function truncateForStorage(value: unknown): unknown {
  // Cap audit-logged payloads so very large tool results don't blow up the DB.
  try {
    const json = JSON.stringify(value);
    if (json.length <= 8_000) return value;
    return {
      _truncated: true,
      preview: json.slice(0, 8_000),
      length: json.length,
    };
  } catch {
    return { _unserializable: true };
  }
}
