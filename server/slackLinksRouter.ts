/**
 * Slack ↔ Wand user linking (Phase 2).
 *
 * Connects a Wand user (email-keyed) to their Slack user_id so the agents
 * (Wanda, Starry) can identify the message author and surface that user's
 * private + assigned tasks via Slack DM.
 *
 * autoMatch: calls Slack `users.list` once per configured workspace and
 * matches by email — works whenever a team member's Slack account uses the
 * same email as their Wand login. Existing links are not overwritten unless
 * `force: true` is passed.
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  protectedProcedure,
  managerProcedure,
  router,
} from "./_core/trpc";
import { slackUserLinks, users } from "../drizzle/schema";
import { getDb } from "./db";
import { ENV } from "./_core/env";
import { TRPCError } from "@trpc/server";

interface SlackUser {
  id: string;
  team_id: string;
  name: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { email?: string; real_name?: string; display_name?: string };
}

async function fetchSlackUsers(botToken: string): Promise<SlackUser[]> {
  const out: SlackUser[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`https://slack.com/api/users.list?${params}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const json = (await res.json()) as {
      ok: boolean;
      error?: string;
      members?: SlackUser[];
      response_metadata?: { next_cursor?: string };
    };
    if (!json.ok) {
      throw new Error(`Slack users.list failed: ${json.error ?? "unknown"}`);
    }
    if (json.members) out.push(...json.members);
    cursor = json.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return out;
}

export const slackLinksRouter = router({
  /** All current links, joined with users so the UI can show name + email. */
  list: managerProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({
        link: slackUserLinks,
        userName: users.name,
        userEmail: users.email,
      })
      .from(slackUserLinks)
      .leftJoin(users, eq(users.id, slackUserLinks.userId));
    return rows.map((r) => ({
      ...r.link,
      userName: r.userName,
      userEmail: r.userEmail,
    }));
  }),

  /** Manually link a Wand user to a Slack user_id. */
  upsert: managerProcedure
    .input(
      z.object({
        userId: z.number(),
        workspaceId: z.string().min(1).max(64),
        slackUserId: z.string().min(1).max(64),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Remove any existing link for this slack user (uniqueness on workspace+slack)
      await db
        .delete(slackUserLinks)
        .where(
          and(
            eq(slackUserLinks.workspaceId, input.workspaceId),
            eq(slackUserLinks.slackUserId, input.slackUserId)
          )
        );
      // Remove any existing link for this Wand user in this workspace
      await db
        .delete(slackUserLinks)
        .where(
          and(
            eq(slackUserLinks.userId, input.userId),
            eq(slackUserLinks.workspaceId, input.workspaceId)
          )
        );
      const [res] = await db.insert(slackUserLinks).values(input);
      return { id: res.insertId };
    }),

  /** Remove a link. */
  delete: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(slackUserLinks).where(eq(slackUserLinks.id, input.id));
      return { ok: true };
    }),

  /**
   * Auto-match Wand users to Slack users by email.
   *
   * Iterates over each configured agent's bot token (Wanda first, falls back
   * to Starry), pulls all Slack workspace members, and creates a link for
   * any Wand user whose email matches a non-bot Slack profile email.
   *
   * Does not overwrite existing links unless `force: true` is passed.
   */
  autoMatch: managerProcedure
    .input(z.object({ force: z.boolean().default(false) }).optional())
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Pick the first available bot token — both bots see the same workspace
      // members, so we only need one call. Fall back to Starry if Wanda isn't
      // configured.
      const botToken = ENV.slackWandaBotToken || ENV.slackStarryBotToken;
      if (!botToken) {
        throw new TRPCError({
          code: "FAILED_PRECONDITION",
          message:
            "No Slack bot token configured. Add SLACK_WANDA_BOT_TOKEN or SLACK_STARRY_BOT_TOKEN.",
        });
      }

      let slackUsers: SlackUser[];
      try {
        slackUsers = await fetchSlackUsers(botToken);
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Slack API: ${err.message}`,
        });
      }

      const force = input?.force ?? false;

      // Build email → slack user lookup
      const emailToSlack = new Map<
        string,
        { teamId: string; slackUserId: string }
      >();
      for (const u of slackUsers) {
        if (u.deleted || u.is_bot) continue;
        const email = u.profile?.email?.toLowerCase();
        if (!email) continue;
        emailToSlack.set(email, { teamId: u.team_id, slackUserId: u.id });
      }

      // Get all Wand users + existing links
      const wandUsers = await db.select().from(users);
      const existingLinks = await db.select().from(slackUserLinks);
      const existingByUserId = new Map(
        existingLinks.map((l) => [l.userId, l])
      );

      let matched = 0;
      let alreadyLinked = 0;
      let skippedNoEmail = 0;
      let skippedNoSlack = 0;
      const matchedEmails: string[] = [];

      for (const u of wandUsers) {
        const email = u.email?.toLowerCase();
        if (!email) {
          skippedNoEmail++;
          continue;
        }
        const slack = emailToSlack.get(email);
        if (!slack) {
          skippedNoSlack++;
          continue;
        }
        const existing = existingByUserId.get(u.id);
        if (existing && !force) {
          alreadyLinked++;
          continue;
        }
        // Replace or insert
        if (existing) {
          await db
            .delete(slackUserLinks)
            .where(eq(slackUserLinks.id, existing.id));
        }
        await db.insert(slackUserLinks).values({
          userId: u.id,
          workspaceId: slack.teamId,
          slackUserId: slack.slackUserId,
        });
        matched++;
        matchedEmails.push(email);
      }

      return {
        matched,
        alreadyLinked,
        skippedNoEmail,
        skippedNoSlack,
        totalWandUsers: wandUsers.length,
        totalSlackUsers: slackUsers.length,
        matchedEmails,
      };
    }),
});
