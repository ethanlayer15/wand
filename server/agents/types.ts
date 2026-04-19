/**
 * Shared types for the Wanda + Starry agent runtime (Phase 1 scaffold).
 */

export type AgentName = "wanda" | "starry";

export interface AgentIdentity {
  name: AgentName;
  /** Human-facing name used in copy and Slack messages. */
  displayName: string;
  /** Department this agent operates on. */
  primaryDepartment: "leisr_ops" | "leisr_mgmt" | "fivestr_ops";
  /** Slack bot token env var ref. */
  slackBotToken: string;
  /** Slack signing secret env var ref. */
  slackSigningSecret: string;
}

export interface AgentRunInput {
  agent: AgentName;
  /** Free-form user message (Slack DM, mention text, voice transcript). */
  userMessage: string;
  /**
   * Where the run originated. Used for audit logging + reply routing.
   * "slack" = real-time Slack message; "cron" = proactive sweep; "webhook" = inbound webhook.
   */
  triggeredBy: "slack" | "cron" | "webhook" | "manual";
  /** Optional Slack context for replies. */
  slack?: {
    channelId: string;
    threadTs?: string;
    userId: string;
    teamId: string;
  };
  /** Optional Wand user (for permission scoping + private-task ownership). */
  wandUserId?: number;
}

export interface AgentRunResult {
  runId: string;
  reply: string | null;
  toolCallsMade: number;
  durationMs: number;
  error?: string;
}
