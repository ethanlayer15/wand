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
import { classifyCleanerMessage, getIntentRouting } from "./classifier";

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

/**
 * Fetch a single message by channel + ts. Used by the reaction-to-task flow
 * to read the message that the user reacted to.
 */
async function fetchSlackMessage(
  botToken: string,
  channel: string,
  ts: string
): Promise<{ user?: string; text?: string; ts: string } | null> {
  // conversations.history with latest=ts, inclusive=true, limit=1
  const params = new URLSearchParams({
    channel,
    latest: ts,
    inclusive: "true",
    limit: "1",
  });
  const res = await fetch(`${SLACK_API}/conversations.history?${params}`, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    messages?: Array<{ user?: string; text?: string; ts: string }>;
  };
  if (!json.ok) {
    // Fallback for thread replies which conversations.history won't return
    const repParams = new URLSearchParams({ channel, ts });
    const rep = await fetch(
      `${SLACK_API}/conversations.replies?${repParams}`,
      { headers: { Authorization: `Bearer ${botToken}` } }
    );
    const repJson = (await rep.json()) as {
      ok: boolean;
      messages?: Array<{ user?: string; text?: string; ts: string }>;
    };
    if (!repJson.ok || !repJson.messages?.length) {
      console.error(`[slack] fetchMessage failed: ${json.error}`);
      return null;
    }
    return repJson.messages[0];
  }
  return json.messages?.[0] ?? null;
}

/**
 * Reactions that trigger the propose-a-task flow. We accept several so users
 * can configure their workspace's :wand: emoji or use a stock alternative.
 */
const TASK_REACTIONS = new Set(["wand", "memo", "white_check_mark", "ballot_box_with_check"]);

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

      const isDm = event.channel_type === "im" && event.type === "message";
      const isMention = event.type === "app_mention";
      const isReaction =
        event.type === "reaction_added" && TASK_REACTIONS.has(event.reaction);

      if (!isDm && !isMention && !isReaction) return;

      const slackUser: string = event.user;
      const wandUserId = await resolveWandUserFromSlack(teamId, slackUser);

      // ── Reaction-to-task flow ────────────────────────────────────────
      if (isReaction) {
        try {
          const channel: string = event.item?.channel;
          const itemTs: string = event.item?.ts;
          if (!channel || !itemTs) return;
          const original = await fetchSlackMessage(
            agent.slackBotToken,
            channel,
            itemTs
          );
          if (!original?.text) {
            await postSlackMessage(
              agent.slackBotToken,
              channel,
              `:warning: ${agent.displayName} couldn't read the reacted message (probably needs to be added to this channel).`,
              itemTs
            );
            return;
          }
          const prompt = `A team member reacted with :${event.reaction}: to a Slack message — propose a task for it.

Process:
1. Read the message text below.
2. If it mentions a property (even loosely — "Skylar", "the bunk room at Quo", "Kimble"), call findListing FIRST with that name fragment. Use the matched listing id when you create the task. If no clear match, omit listingId.
3. Then call createTaskDraft with: a short imperative title (≤80 chars), the original message as context in the description, an honest priority/category, and the listingId if you found one.
4. Reply with a single short line confirming the task title.

Original message author: <@${original.user ?? "unknown"}>
Message text:
"""
${original.text}
"""`;
          const result = await runAgent({
            agent: agentName,
            userMessage: prompt,
            triggeredBy: "slack",
            slack: { channelId: channel, threadTs: itemTs, userId: slackUser, teamId },
            wandUserId,
          });
          if (result.reply) {
            await postSlackMessage(
              agent.slackBotToken,
              channel,
              result.reply,
              itemTs
            );
          } else if (result.error) {
            await postSlackMessage(
              agent.slackBotToken,
              channel,
              `:warning: ${agent.displayName} hit an error: ${result.error}`,
              itemTs
            );
          }
        } catch (err: any) {
          console.error(`[slack:${agentName}] reaction handler error:`, err.message);
        }
        return;
      }

      // ── DM / @-mention flow ──────────────────────────────────────────
      const text: string = event.text ?? "";
      const channel: string = event.channel;
      const threadTs: string | undefined = event.thread_ts ?? event.ts;

      // Phase 4: for Starry DMs (not mentions), pre-classify the message so
      // the agent loop has a clear intent signal. The classification is
      // advisory — the agent can re-classify mid-conversation via the tool.
      let userMessage = text;
      if (agentName === "starry" && isDm && text.trim().length > 0) {
        try {
          const cls = await classifyCleanerMessage(text);
          const routing = getIntentRouting(cls.intent);
          userMessage = `[pre-classified by Starry: intent=${cls.intent}, confidence=${cls.confidence.toFixed(2)}, department=${routing.department}${
            routing.includeWanda ? " + wanda" : ""
          }${cls.listingHint ? `, listingHint="${cls.listingHint}"` : ""}${
            cls.taskHint ? `, taskHint="${cls.taskHint}"` : ""
          }]

Cleaner's DM (verbatim):
"""
${text}
"""

If this is a real escalation (intent is not "other"), resolve the Breezeway task (call getCleanerActiveBreezewayTasks when a taskHint or listingHint is present) and call routeEscalation with the intent, department, breezewayTaskId, listingId, a short paraphrase, and the original text above. Then reply to the cleaner with one sentence confirming who got looped in. If intent=other, just respond conversationally — do not route.`;
        } catch (err: any) {
          console.error(`[slack:starry] pre-classification failed:`, err.message);
        }
      }

      try {
        const result = await runAgent({
          agent: agentName,
          userMessage,
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
 * Open a DM channel between the bot and a Slack user. Returns the IM
 * channel id so we can post a confirmation back to the invoker.
 */
async function openSlackDm(
  botToken: string,
  userId: string
): Promise<string | null> {
  const res = await fetch(`${SLACK_API}/conversations.open`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ users: userId }),
  });
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    channel?: { id: string };
  };
  if (!json.ok) {
    console.error(`[slack] conversations.open failed: ${json.error}`);
    return null;
  }
  return json.channel?.id ?? null;
}

/**
 * Handler for the "Send to Wanda" / "Send to Starry" message shortcut.
 *
 * Triggered when a user picks the shortcut from the ⋯ menu on any Slack
 * message — including private DMs the bot isn't a participant in. The
 * payload includes the message text + author + originating channel, so
 * we can capture it without needing to read the channel directly.
 */
function makeInteractiveHandler(agentName: AgentName) {
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

    // Slack interactivity payloads are form-urlencoded with a `payload` field
    // containing the actual JSON.
    const params = new URLSearchParams(rawBody.toString("utf8"));
    const payloadStr = params.get("payload");
    if (!payloadStr) {
      res.status(400).send("missing payload");
      return;
    }
    let payload: any;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      res.status(400).send("invalid payload json");
      return;
    }

    // Ack within 3s, then process async.
    res.status(200).send();

    if (payload.type !== "message_action") return;

    const teamId: string = payload.team?.id ?? "";
    const slackUserId: string = payload.user?.id ?? "";
    const message = payload.message ?? {};
    const messageText: string = message.text ?? "";
    const messageAuthor: string = message.user ?? "unknown";
    const originChannelId: string = payload.channel?.id ?? "";
    const originChannelName: string = payload.channel?.name ?? "(direct message)";

    if (!messageText.trim()) return;

    const wandUserId = await resolveWandUserFromSlack(teamId, slackUserId);

    const prompt = `A team member used the "Send to ${agent.displayName}" shortcut on a Slack message — propose a task for it.

Process:
1. Read the message text below.
2. If it mentions a property (even loosely — "Skylar", "the bunk room at Quo", "Kimble"), call findListing FIRST. Use the matched listing id when you create the task. If no clear match, omit listingId.
3. Then call createTaskDraft with: a short imperative title (≤80 chars), the message as context in the description, an honest priority/category, and the listingId if you found one.
4. Reply with a single short line confirming the task title (will be DM'd back to the invoker).

Captured from: #${originChannelName}
Original author: <@${messageAuthor}>
Message text:
"""
${messageText}
"""`;

    try {
      const result = await runAgent({
        agent: agentName,
        userMessage: prompt,
        triggeredBy: "slack",
        wandUserId,
      });

      // Reply via DM to the invoker — works even when origin was a DM the bot isn't in.
      const dmChannel = await openSlackDm(agent.slackBotToken, slackUserId);
      if (dmChannel) {
        const reply = result.reply
          ? result.reply
          : result.error
            ? `:warning: ${agent.displayName} hit an error: ${result.error}`
            : `Captured the message but didn't have anything to add.`;
        await postSlackMessage(agent.slackBotToken, dmChannel, reply);
      }
    } catch (err: any) {
      console.error(
        `[slack:${agentName}] interactive shortcut error:`,
        err.message
      );
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
  // Interactivity payloads come as form-urlencoded; capture as raw too.
  const rawForm = express.raw({
    type: "application/x-www-form-urlencoded",
    limit: "1mb",
  });

  // Events endpoints
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

  // Interactivity endpoints (message shortcuts)
  app.post(
    "/api/slack/wanda/interactive",
    rawForm,
    (req, _res, next) => {
      (req as any).rawBody = req.body as Buffer;
      next();
    },
    makeInteractiveHandler("wanda")
  );

  app.post(
    "/api/slack/starry/interactive",
    rawForm,
    (req, _res, next) => {
      (req as any).rawBody = req.body as Buffer;
      next();
    },
    makeInteractiveHandler("starry")
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
