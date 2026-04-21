/**
 * Slack Web API helpers used by Phase 4 routing tools.
 *
 * These wrap the few endpoints tools need: post a message, open a 1:1 DM,
 * open a group DM (mpim), and resolve a user's email. Kept separate from
 * slackApp.ts so both the event handlers and the tool runner can share
 * the same wire logic.
 */

const SLACK_API = "https://slack.com/api";

export interface SlackPostResult {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

export async function postSlackMessage(
  botToken: string,
  channel: string,
  text: string,
  threadTs?: string
): Promise<SlackPostResult> {
  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel, text, thread_ts: threadTs }),
  });
  const json = (await res.json()) as SlackPostResult;
  if (!json.ok) {
    console.error(`[slack] postMessage failed: ${json.error}`);
  }
  return json;
}

/** Open a 1:1 DM channel between the bot and one user. */
export async function openSlackDm(
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
    console.error(`[slack] conversations.open (dm) failed: ${json.error}`);
    return null;
  }
  return json.channel?.id ?? null;
}

/**
 * Open a multi-party DM ("mpim"). Slack caps mpims at 8 users including
 * the initiating bot. Requires the `mpim:write` scope on the bot token.
 *
 * Returns the mpim channel id on success. If the token lacks the scope
 * Slack returns `missing_scope` — caller should surface that to logs.
 */
export async function openSlackGroupDm(
  botToken: string,
  userIds: string[]
): Promise<{ channelId: string | null; error?: string }> {
  if (userIds.length === 0) {
    return { channelId: null, error: "no_users" };
  }
  const res = await fetch(`${SLACK_API}/conversations.open`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ users: userIds.join(",") }),
  });
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    channel?: { id: string };
  };
  if (!json.ok) {
    console.error(`[slack] conversations.open (mpim) failed: ${json.error}`);
    return { channelId: null, error: json.error };
  }
  return { channelId: json.channel?.id ?? null };
}

/**
 * Resolve a Slack user's email via users.info. Needed to match a cleaner's
 * Slack identity to their `breezewayTeam.email` row. Returns null if the
 * user's email isn't visible to the bot (private workspace, restricted
 * profile, etc.).
 */
export async function getSlackUserEmail(
  botToken: string,
  userId: string
): Promise<string | null> {
  const params = new URLSearchParams({ user: userId });
  const res = await fetch(`${SLACK_API}/users.info?${params}`, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    user?: { profile?: { email?: string } };
  };
  if (!json.ok) {
    console.error(`[slack] users.info failed: ${json.error}`);
    return null;
  }
  return json.user?.profile?.email?.toLowerCase() ?? null;
}
