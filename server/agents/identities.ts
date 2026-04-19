/**
 * Agent identity registry — Wanda + Starry.
 *
 * Phase 1 keeps this in code; Phase 2+ may move it to the slackBots table
 * for runtime install/uninstall via OAuth.
 */
import { ENV } from "../_core/env";
import type { AgentIdentity, AgentName } from "./types";

export const AGENTS: Record<AgentName, AgentIdentity> = {
  wanda: {
    name: "wanda",
    displayName: "Wanda",
    primaryDepartment: "leisr_ops",
    slackBotToken: ENV.slackWandaBotToken,
    slackSigningSecret: ENV.slackWandaSigningSecret,
  },
  starry: {
    name: "starry",
    displayName: "Starry",
    primaryDepartment: "fivestr_ops",
    slackBotToken: ENV.slackStarryBotToken,
    slackSigningSecret: ENV.slackStarrySigningSecret,
  },
};

export function getAgent(name: AgentName): AgentIdentity {
  return AGENTS[name];
}

export function isAgentConfigured(name: AgentName): boolean {
  const a = AGENTS[name];
  return Boolean(a.slackBotToken && a.slackSigningSecret);
}
