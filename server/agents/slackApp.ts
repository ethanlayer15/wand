/**
 * Slack event endpoints for Wanda + Starry (Phase 1).
 *
 * Each agent runs as a separate Slack app with its own bot user + signing
 * secret. Events land at:
 *   POST /api/slack/wanda/events
 *   POST /api/slack/starry/events
 *
 * We verify the signature against the raw request body, ack within 3s, and
 * dispatch to the agent runner asynchronously. Replies are posted back via
 * Slack chat.postMessage using the per-agent bot token.
 */
import express from "express";
import crypto from "node:crypto";
import { runAgent } from "./runner";
import { AGENTS, isAgentConfigured } from "./identities";
import type { AgentName } from "./types";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { slackUserLinks, users } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

const SLACK_API = "https://slack.com/api";

/** Verify a Slack request signature against the raw body. */
function verifySlackSignature(
  signingSecret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  rawBody: Buffer
): boolean {
  if (!timestamp || !signature || !signingSecret) return false;
  // Reject anything older than 5 minutes (replay protection)
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;
  const base = `v0:${timestamp}:${rawBody.toString("utf8")}`;
  const expected =
    "v0=" +
    crypto.createHmac("sha256", signingSecret).update(base).digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signature, "utf8")
    );
  } catch {
    return false;
  }
}

/** Map Slack user_id → Wand users.id, if linked. */
async function resolveWandUserFromSlack(
  workspaceId: string,
  slackUserId: string
): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [link] = await db
    .select()
    .from(slackUserLinks)
    .where(
      and(
        eq(slackUserLinks.workspaceId, workspaceId),
        eq(slackUserLinks.slackUserId, slackUserId)
      )
    )
    .limit(1);
  return link?.userId;
}

async function postSlackMessage(
  botToken: string,
  channel: string,
  text: string,
  threadTs?: string
) {
  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs,
    }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) {
    console.error(`[slack] postMessage failed: ${json.error}`);
  }
  return json;
}

function makeAgentHandler(agentName: AgentName) {
  return async (req: express.Request, res: express.Response) => {
    const agent = AGENTS[agentName];
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) {
      res.status(400).send("missing raw body");
      return;
    }

    if (!isAgentConfigured(agentName)) {
      res.status(503).send("agent not configured");
      return;
    }

    const ok = verifySlackSignature(
      agent.slackSigningSecret,
      req.header("x-slack-request-timestamp") ?? undefined,
      req.header("x-slack-signature") ?? undefined,
      rawBody
    );
    if (!ok) {
      res.status(401).send("invalid signature");
      return;
    }

    const body = JSON.parse(rawBody.toString("utf8"));

    // URL verification handshake (one-time when configuring the app)
    if (body.type === "url_verification") {
      res.status(200).json({ challenge: body.challenge });
      return;
    }

    // Ack immediately — Slack requires <3s response.
    res.status(200).send();

    // Dispatch event handling without blocking
    if (body.type === "event_callback" && body.event) {
      const event = body.event;
      const teamId: string = body.team_id ?? "";

      // Ignore the bot's own messages and bot-to-bot loops
      if (event.bot_id || event.subtype === "bot_message") return;
      // Only handle DMs (im) and explicit @-mentions for Phase 1
      const isDm = event.channel_type === "im" && event.type === "message";
      const isMention = event.type === "app_mention";
      if (!isDm && !isMention) return;

      const text: string = event.text ?? "";
      const channel: string = event.channel;
      const slackUser: string = event.user;
      const threadTs: string | undefined = event.thread_ts ?? event.ts;

      const wandUserId = await resolveWandUserFromSlack(teamId, slackUser);

      try {
        const result = await runAgent({
          agent: agentName,
          userMessage: text,
          triggeredBy: "slack",
          slack: { channelId: channel, threadTs, userId: slackUser, teamId },
          wandUserId,
        });
        if (result.reply) {
          await postSlackMessage(agent.slackBotToken, channel, result.reply, threadTs);
        } else if (result.error) {
          await postSlackMessage(
            agent.slackBotToken,
            channel,
            `:warning: ${agent.displayName} hit an error: ${result.error}`,
            threadTs
          );
        }
      } catch (err: any) {
        console.error(`[slack:${agentName}] handler error:`, err.message);
      }
    }
  };
}

/**
 * Mounts the Slack endpoints on an Express app.
 * Must be called BEFORE express.json() middleware so we get the raw body.
 */
export function registerSlackAgentRoutes(app: express.Express) {
  // Capture raw body for signature verification.
  const rawJson = express.raw({ type: "application/json", limit: "1mb" });

  app.post(
    "/api/slack/wanda/events",
    rawJson,
    (req, _res, next) => {
      (req as any).rawBody = req.body as Buffer;
      next();
    },
    makeAgentHandler("wanda")
  );

  app.post(
    "/api/slack/starry/events",
    rawJson,
    (req, _res, next) => {
      (req as any).rawBody = req.body as Buffer;
      next();
    },
    makeAgentHandler("starry")
  );

  // Health-check (lets you confirm the route is mounted without sending a real event)
  app.get("/api/slack/_health", (_req, res) => {
    res.json({
      wanda: isAgentConfigured("wanda"),
      starry: isAgentConfigured("starry"),
      anthropic: Boolean(ENV.anthropicApiKey),
    });
  });
}
