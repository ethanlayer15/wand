/**
 * Onboarding Router — property-onboarding projects with staged handoffs.
 *
 * Anyone (any logged-in user) can create a project. Stages run in parallel:
 * an owner can hand off to the next stage ("notify next") without closing
 * their own. Each stage holds its own checklist state + per-stage fields,
 * both of which can be extended ad-hoc per project (every property is
 * unique).
 *
 * Slack/email notification firing is wired in a later phase — for now,
 * every meaningful action writes an `onboardingEvents` row that the
 * notifier can pick up.
 */
import { z } from "zod";
import { and, desc, eq, asc } from "drizzle-orm";
import {
  protectedProcedure,
  managerProcedure,
  router,
} from "./_core/trpc";
import {
  onboardingTemplates,
  onboardingProjects,
  onboardingStageInstances,
  onboardingEvents,
  slackUserLinks,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { TRPCError } from "@trpc/server";
import { postSlackMessage } from "./agents/slack";
import { ENV } from "./_core/env";

const projectStatusEnum = z.enum(["active", "blocked", "done", "cancelled"]);

/** Pull the current user id from tRPC context, throw if anonymous. */
function requireUserId(ctx: any): number {
  const id = ctx?.user?.id ?? ctx?.user?.userId;
  if (!id) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to use Onboarding",
    });
  }
  return Number(id);
}

export const onboardingRouter = router({
  // ── Templates ─────────────────────────────────────────────────────────
  templates: router({
    list: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(onboardingTemplates)
        .where(eq(onboardingTemplates.isActive, true))
        .orderBy(asc(onboardingTemplates.id));
      // Derive stageOwnerDefaults from defaultOwnerId stored in each stage
      return rows.map((t) => ({
        ...t,
        stageOwnerDefaults: Object.fromEntries(
          ((t.stagesConfig ?? []) as any[])
            .filter((s) => s.defaultOwnerId != null)
            .map((s) => [s.key, s.defaultOwnerId as number]),
        ) as Record<string, number>,
      }));
    }),

    get: protectedProcedure
      .input(
        z.union([
          z.object({ id: z.number() }),
          z.object({ slug: z.string() }),
        ]),
      )
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        const where =
          "id" in input
            ? eq(onboardingTemplates.id, input.id)
            : eq(onboardingTemplates.slug, input.slug);
        const [row] = await db
          .select()
          .from(onboardingTemplates)
          .where(where)
          .limit(1);
        return row ?? null;
      }),

    /** Persist default assignee (user id) per stage key for a template. */
    setStageDefaults: managerProcedure
      .input(z.object({
        templateId: z.number(),
        defaults: z.record(z.string(), z.number()),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const [tmpl] = await db
          .select()
          .from(onboardingTemplates)
          .where(eq(onboardingTemplates.id, input.templateId))
          .limit(1);
        if (!tmpl) throw new TRPCError({ code: "NOT_FOUND" });
        const updated = ((tmpl.stagesConfig ?? []) as any[]).map((s) => ({
          ...s,
          defaultOwnerId: input.defaults[s.key] ?? s.defaultOwnerId ?? null,
        }));
        await db
          .update(onboardingTemplates)
          .set({ stagesConfig: updated as any })
          .where(eq(onboardingTemplates.id, input.templateId));
        return { ok: true };
      }),

    /** Replace the full stagesConfig for a template (checklist edits). */
    updateChecklist: managerProcedure
      .input(z.object({
        templateId: z.number(),
        stagesConfig: z.array(z.any()),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await db
          .update(onboardingTemplates)
          .set({ stagesConfig: input.stagesConfig as any })
          .where(eq(onboardingTemplates.id, input.templateId));
        return { ok: true };
      }),
  }),

  // ── Projects ──────────────────────────────────────────────────────────
  projects: router({
    /** All projects, with template name + creator. Filter by status / template. */
    list: protectedProcedure
      .input(
        z
          .object({
            status: projectStatusEnum.optional(),
            templateId: z.number().optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const conds: any[] = [];
        if (input?.status) conds.push(eq(onboardingProjects.status, input.status));
        if (input?.templateId)
          conds.push(eq(onboardingProjects.templateId, input.templateId));

        const rows = await db
          .select({
            project: onboardingProjects,
            templateName: onboardingTemplates.name,
            templateSlug: onboardingTemplates.slug,
            creatorName: users.name,
          })
          .from(onboardingProjects)
          .leftJoin(
            onboardingTemplates,
            eq(onboardingTemplates.id, onboardingProjects.templateId),
          )
          .leftJoin(users, eq(users.id, onboardingProjects.createdBy))
          .where(conds.length > 0 ? and(...conds) : undefined)
          .orderBy(desc(onboardingProjects.id));

        return rows.map((r) => ({
          ...r.project,
          templateName: r.templateName,
          templateSlug: r.templateSlug,
          creatorName: r.creatorName,
        }));
      }),

    /** Single project + its stage instances + recent events. */
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        const [project] = await db
          .select()
          .from(onboardingProjects)
          .where(eq(onboardingProjects.id, input.id))
          .limit(1);
        if (!project) return null;

        const [template] = await db
          .select()
          .from(onboardingTemplates)
          .where(eq(onboardingTemplates.id, project.templateId))
          .limit(1);

        const stages = await db
          .select({
            stage: onboardingStageInstances,
            ownerName: users.name,
            ownerEmail: users.email,
            ownerSlackUserId: slackUserLinks.slackUserId,
          })
          .from(onboardingStageInstances)
          .leftJoin(users, eq(users.id, onboardingStageInstances.ownerUserId))
          .leftJoin(slackUserLinks, eq(slackUserLinks.userId, onboardingStageInstances.ownerUserId))
          .where(eq(onboardingStageInstances.projectId, input.id))
          .orderBy(onboardingStageInstances.stageIndex);

        // For stages with no explicit owner, fall back to template defaultOwnerId
        const stagesConfig = (template?.stagesConfig ?? []) as Array<{ key: string; defaultOwnerId?: number | null }>;
        const missingOwnerIds = Array.from(new Set(
          stages
            .filter((s) => s.stage.ownerUserId == null)
            .map((_s, i) => stagesConfig[i]?.defaultOwnerId)
            .filter((id): id is number => id != null),
        ));

        const defaultOwnerMap = new Map<number, { name: string | null; slackUserId: string | null }>();
        if (missingOwnerIds.length > 0) {
          const defaultUsers = await db
            .select({ id: users.id, name: users.name, slackUserId: slackUserLinks.slackUserId })
            .from(users)
            .leftJoin(slackUserLinks, eq(slackUserLinks.userId, users.id))
            .where(eq(users.id, missingOwnerIds[0])); // fetched one-by-one below is fine for small N
          // Re-fetch all at once via in() isn't imported — loop instead
          await Promise.all(
            missingOwnerIds.map(async (uid) => {
              const [u] = await db
                .select({ name: users.name, slackUserId: slackUserLinks.slackUserId })
                .from(users)
                .leftJoin(slackUserLinks, eq(slackUserLinks.userId, users.id))
                .where(eq(users.id, uid))
                .limit(1);
              if (u) defaultOwnerMap.set(uid, { name: u.name ?? null, slackUserId: u.slackUserId ?? null });
            }),
          );
          // discard the first query result (it was redundant)
          void defaultUsers;
        }

        const events = await db
          .select()
          .from(onboardingEvents)
          .where(eq(onboardingEvents.projectId, input.id))
          .orderBy(desc(onboardingEvents.id))
          .limit(50);

        return {
          project,
          template,
          stages: stages.map((s, i) => {
            const defId = s.stage.ownerUserId == null ? (stagesConfig[i]?.defaultOwnerId ?? null) : null;
            const defOwner = defId != null ? defaultOwnerMap.get(defId) : null;
            return {
              ...s.stage,
              ownerUserId: s.stage.ownerUserId ?? defId ?? null,
              ownerName: s.ownerName ?? defOwner?.name ?? null,
              ownerEmail: s.ownerEmail ?? null,
              ownerSlackUserId: s.ownerSlackUserId ?? defOwner?.slackUserId ?? null,
            };
          }),
          events,
        };
      }),

    /**
     * Create a new project from a template. All stage instances are created
     * up front in `not_started` state; stage 0 is started immediately.
     * No required fields — partial kickoff data is fine.
     */
    create: protectedProcedure
      .input(
        z.object({
          templateId: z.number(),
          propertyName: z.string().min(1).max(256),
          address: z.string().max(2000).optional(),
          listingId: z.number().optional(),
          kickoffData: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const userId = requireUserId(ctx);

        const [template] = await db
          .select()
          .from(onboardingTemplates)
          .where(eq(onboardingTemplates.id, input.templateId))
          .limit(1);
        if (!template) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
        }
        const stages = (template.stagesConfig ?? []) as Array<{
          key: string;
          label: string;
          defaultOwnerId?: number | null;
        }>;
        if (stages.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Template has no stages configured",
          });
        }

        const [insertProject] = await db.insert(onboardingProjects).values({
          templateId: input.templateId,
          propertyName: input.propertyName,
          address: input.address ?? null,
          listingId: input.listingId ?? null,
          currentStageIndex: 0,
          status: "active",
          kickoffData: input.kickoffData ?? null,
          createdBy: userId,
        });
        const projectId = insertProject.insertId;

        // Create one stage instance per template stage, seeding ownerUserId from template defaults
        await db.insert(onboardingStageInstances).values(
          stages.map((s, i) => ({
            projectId,
            stageIndex: i,
            stageKey: s.key,
            state: i === 0 ? ("in_progress" as const) : ("not_started" as const),
            startedAt: i === 0 ? new Date() : null,
            ownerUserId: s.defaultOwnerId ?? null,
            checklistState: {},
            stageData: {},
          })),
        );

        await db.insert(onboardingEvents).values([
          {
            projectId,
            eventType: "project_created",
            actorUserId: userId,
            data: { templateId: input.templateId, templateSlug: template.slug },
          },
          {
            projectId,
            eventType: "stage_started",
            actorUserId: userId,
            data: { stageIndex: 0, stageKey: stages[0].key, auto: true },
          },
        ]);

        return { id: projectId };
      }),

    /** Update top-level project metadata (status, address, listingId, kickoff fields). */
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          propertyName: z.string().min(1).max(256).optional(),
          address: z.string().max(2000).nullable().optional(),
          listingId: z.number().nullable().optional(),
          status: projectStatusEnum.optional(),
          kickoffData: z.record(z.string(), z.unknown()).optional(),
          currentStageIndex: z.number().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const userId = requireUserId(ctx);

        const { id, ...rest } = input;
        await db
          .update(onboardingProjects)
          .set(rest)
          .where(eq(onboardingProjects.id, id));

        if (input.status) {
          await db.insert(onboardingEvents).values({
            projectId: id,
            eventType: "status_changed",
            actorUserId: userId,
            data: { newStatus: input.status },
          });
        }
        return { ok: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await db.delete(onboardingEvents).where(eq(onboardingEvents.projectId, input.id));
        await db.delete(onboardingStageInstances).where(eq(onboardingStageInstances.projectId, input.id));
        await db.delete(onboardingProjects).where(eq(onboardingProjects.id, input.id));
        return { ok: true };
      }),

    /** Return all users (for recipient selection in the email dialog). */
    members: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .orderBy(asc(users.name));
    }),

    /** Post a message to the #onboarding Slack channel. */
    notifyTeam: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          message: z.string().min(1).max(4000),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const actorId = requireUserId(ctx);

        const token = ENV.onboardingSlackBotToken;
        const channel = ENV.onboardingSlackChannelId;
        if (!token || !channel) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Onboarding Slack is not configured (missing bot token or channel ID).",
          });
        }

        const result = await postSlackMessage(token, channel, input.message);
        if (!result.ok) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Slack error: ${result.error ?? "unknown"}`,
          });
        }

        // Persist thread TS on the project so notifyNext can reply in-thread
        if (result.ts) {
          const [proj] = await db
            .select({ kickoffData: onboardingProjects.kickoffData })
            .from(onboardingProjects)
            .where(eq(onboardingProjects.id, input.projectId))
            .limit(1);
          await db
            .update(onboardingProjects)
            .set({ kickoffData: { ...(proj?.kickoffData ?? {}), _kickoffSlackTs: result.ts } })
            .where(eq(onboardingProjects.id, input.projectId));
        }

        await db.insert(onboardingEvents).values({
          projectId: input.projectId,
          eventType: "notify_next",
          actorUserId: actorId,
          data: { slackTs: result.ts },
        });

        return { ok: true };
      }),
  }),

  // ── Stages ────────────────────────────────────────────────────────────
  stages: router({
    /** Assign / reassign a stage owner. */
    assign: protectedProcedure
      .input(
        z.object({
          stageInstanceId: z.number(),
          ownerUserId: z.number().nullable(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const userId = requireUserId(ctx);

        const [stage] = await db
          .select()
          .from(onboardingStageInstances)
          .where(eq(onboardingStageInstances.id, input.stageInstanceId))
          .limit(1);
        if (!stage) throw new TRPCError({ code: "NOT_FOUND" });

        await db
          .update(onboardingStageInstances)
          .set({ ownerUserId: input.ownerUserId })
          .where(eq(onboardingStageInstances.id, input.stageInstanceId));

        await db.insert(onboardingEvents).values({
          projectId: stage.projectId,
          stageInstanceId: stage.id,
          eventType: "owner_reassigned",
          actorUserId: userId,
          data: { newOwnerUserId: input.ownerUserId, stageIndex: stage.stageIndex },
        });
        return { ok: true };
      }),

    /**
     * Mark stage complete. Does NOT auto-advance — use `notifyNext` for that.
     * (Often a stage is finished before the next person was notified, or
     * the next person was notified early while this stage was still open.)
     */
    complete: protectedProcedure
      .input(z.object({ stageInstanceId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const userId = requireUserId(ctx);

        const [stage] = await db
          .select()
          .from(onboardingStageInstances)
          .where(eq(onboardingStageInstances.id, input.stageInstanceId))
          .limit(1);
        if (!stage) throw new TRPCError({ code: "NOT_FOUND" });

        await db
          .update(onboardingStageInstances)
          .set({ state: "done", completedAt: new Date() })
          .where(eq(onboardingStageInstances.id, input.stageInstanceId));

        await db.insert(onboardingEvents).values({
          projectId: stage.projectId,
          stageInstanceId: stage.id,
          eventType: "stage_completed",
          actorUserId: userId,
          data: { stageIndex: stage.stageIndex, stageKey: stage.stageKey },
        });

        // If every stage is done, mark the project done.
        const remaining = await db
          .select({ id: onboardingStageInstances.id })
          .from(onboardingStageInstances)
          .where(
            and(
              eq(onboardingStageInstances.projectId, stage.projectId),
              eq(onboardingStageInstances.state, "in_progress"),
            ),
          );
        const notStarted = await db
          .select({ id: onboardingStageInstances.id })
          .from(onboardingStageInstances)
          .where(
            and(
              eq(onboardingStageInstances.projectId, stage.projectId),
              eq(onboardingStageInstances.state, "not_started"),
            ),
          );
        if (remaining.length === 0 && notStarted.length === 0) {
          await db
            .update(onboardingProjects)
            .set({ status: "done" })
            .where(eq(onboardingProjects.id, stage.projectId));
          await db.insert(onboardingEvents).values({
            projectId: stage.projectId,
            eventType: "status_changed",
            actorUserId: userId,
            data: { newStatus: "done", auto: true },
          });
        } else {
          // Auto-advance the board column when completing the current stage.
          const [project] = await db
            .select({ currentStageIndex: onboardingProjects.currentStageIndex })
            .from(onboardingProjects)
            .where(eq(onboardingProjects.id, stage.projectId))
            .limit(1);

          if (project && project.currentStageIndex === stage.stageIndex) {
            const nextIndex = stage.stageIndex + 1;
            const [nextStage] = await db
              .select()
              .from(onboardingStageInstances)
              .where(
                and(
                  eq(onboardingStageInstances.projectId, stage.projectId),
                  eq(onboardingStageInstances.stageIndex, nextIndex),
                ),
              )
              .limit(1);

            if (nextStage) {
              if (nextStage.state === "not_started") {
                await db
                  .update(onboardingStageInstances)
                  .set({ state: "in_progress", startedAt: new Date() })
                  .where(eq(onboardingStageInstances.id, nextStage.id));
                await db.insert(onboardingEvents).values({
                  projectId: stage.projectId,
                  stageInstanceId: nextStage.id,
                  eventType: "stage_started",
                  actorUserId: userId,
                  data: { stageIndex: nextIndex, stageKey: nextStage.stageKey, auto: true },
                });
              }
              await db
                .update(onboardingProjects)
                .set({ currentStageIndex: nextIndex })
                .where(eq(onboardingProjects.id, stage.projectId));
            }
          }
        }
        return { ok: true };
      }),

    /** Reopen a previously completed stage (Chloe sends back to Yosimar, etc.). */
    reopen: protectedProcedure
      .input(
        z.object({
          stageInstanceId: z.number(),
          reason: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const userId = requireUserId(ctx);

        const [stage] = await db
          .select()
          .from(onboardingStageInstances)
          .where(eq(onboardingStageInstances.id, input.stageInstanceId))
          .limit(1);
        if (!stage) throw new TRPCError({ code: "NOT_FOUND" });

        await db
          .update(onboardingStageInstances)
          .set({ state: "in_progress", completedAt: null })
          .where(eq(onboardingStageInstances.id, input.stageInstanceId));

        await db.insert(onboardingEvents).values({
          projectId: stage.projectId,
          stageInstanceId: stage.id,
          eventType: "stage_reopened",
          actorUserId: userId,
          data: {
            stageIndex: stage.stageIndex,
            stageKey: stage.stageKey,
            reason: input.reason ?? null,
          },
        });
        return { ok: true };
      }),

    /**
     * Hand off to the next stage without closing the current one.
     * Starts the next stage instance + bumps project.currentStageIndex
     * (used for board column placement). Notifications fire later off the
     * `notify_next` event.
     */
    notifyNext: protectedProcedure
      .input(z.object({
        stageInstanceId: z.number(),
        slackMessage: z.string().max(4000).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const userId = requireUserId(ctx);

        const [stage] = await db
          .select()
          .from(onboardingStageInstances)
          .where(eq(onboardingStageInstances.id, input.stageInstanceId))
          .limit(1);
        if (!stage) throw new TRPCError({ code: "NOT_FOUND" });

        const nextIndex = stage.stageIndex + 1;
        const [nextStage] = await db
          .select()
          .from(onboardingStageInstances)
          .where(
            and(
              eq(onboardingStageInstances.projectId, stage.projectId),
              eq(onboardingStageInstances.stageIndex, nextIndex),
            ),
          )
          .limit(1);
        if (!nextStage) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No next stage to notify",
          });
        }

        const now = new Date();
        const skipped = !input.slackMessage;

        if (nextStage.state === "not_started") {
          await db
            .update(onboardingStageInstances)
            .set({ state: "in_progress", startedAt: now })
            .where(eq(onboardingStageInstances.id, nextStage.id));
          await db.insert(onboardingEvents).values({
            projectId: stage.projectId,
            stageInstanceId: nextStage.id,
            eventType: "stage_started",
            actorUserId: userId,
            data: { stageIndex: nextStage.stageIndex, stageKey: nextStage.stageKey },
          });
        }

        // Stamp the next stage with notification status
        await db
          .update(onboardingStageInstances)
          .set({ notifiedAt: now, notificationSkipped: skipped })
          .where(eq(onboardingStageInstances.id, nextStage.id));

        await db
          .update(onboardingProjects)
          .set({ currentStageIndex: nextIndex })
          .where(eq(onboardingProjects.id, stage.projectId));

        await db.insert(onboardingEvents).values({
          projectId: stage.projectId,
          stageInstanceId: nextStage.id,
          eventType: "notify_next",
          actorUserId: userId,
          data: {
            fromStageIndex: stage.stageIndex,
            fromStageKey: stage.stageKey,
            toStageIndex: nextStage.stageIndex,
            toStageKey: nextStage.stageKey,
            currentStageStillOpen: stage.state !== "done",
          },
        });

        // Post to #onboarding as a thread reply on the kickoff message
        if (input.slackMessage) {
          const token = ENV.onboardingSlackBotToken;
          const channel = ENV.onboardingSlackChannelId;
          if (token && channel) {
            const [proj] = await db
              .select({ kickoffData: onboardingProjects.kickoffData })
              .from(onboardingProjects)
              .where(eq(onboardingProjects.id, stage.projectId))
              .limit(1);
            const threadTs = (proj?.kickoffData as any)?._kickoffSlackTs as string | undefined;
            await postSlackMessage(token, channel, input.slackMessage, threadTs);
          }
        }

        return { ok: true, nextStageInstanceId: nextStage.id };
      }),

    /** Stage owner confirms they received the handoff — lets the team know they're on it. */
    markNotificationReceived: protectedProcedure
      .input(z.object({ stageInstanceId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const userId = requireUserId(ctx);

        const [stage] = await db
          .select()
          .from(onboardingStageInstances)
          .where(eq(onboardingStageInstances.id, input.stageInstanceId))
          .limit(1);
        if (!stage) throw new TRPCError({ code: "NOT_FOUND" });

        await db
          .update(onboardingStageInstances)
          .set({ notificationReceivedAt: new Date() })
          .where(eq(onboardingStageInstances.id, input.stageInstanceId));

        await db.insert(onboardingEvents).values({
          projectId: stage.projectId,
          stageInstanceId: stage.id,
          eventType: "stage_started",
          actorUserId: userId,
          data: { acknowledged: true, stageIndex: stage.stageIndex, stageKey: stage.stageKey },
        });

        return { ok: true };
      }),

    /** Toggle a checklist item done / undone (with optional note). */
    toggleChecklistItem: protectedProcedure
      .input(
        z.object({
          stageInstanceId: z.number(),
          itemId: z.string(),
          done: z.boolean(),
          note: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const userId = requireUserId(ctx);

        const [stage] = await db
          .select()
          .from(onboardingStageInstances)
          .where(eq(onboardingStageInstances.id, input.stageInstanceId))
          .limit(1);
        if (!stage) throw new TRPCError({ code: "NOT_FOUND" });

        const state = (stage.checklistState as Record<string, any>) ?? {};
        const prev = state[input.itemId] ?? {};
        state[input.itemId] = {
          ...prev,
          done: input.done,
          by: userId,
          at: new Date().toISOString(),
          ...(input.note !== undefined ? { note: input.note } : {}),
        };

        await db
          .update(onboardingStageInstances)
          .set({ checklistState: state })
          .where(eq(onboardingStageInstances.id, input.stageInstanceId));

        await db.insert(onboardingEvents).values({
          projectId: stage.projectId,
          stageInstanceId: stage.id,
          eventType: "checklist_item_toggled",
          actorUserId: userId,
          data: { itemId: input.itemId, done: input.done },
        });
        return { ok: true };
      }),

    /** Add an ad-hoc checklist item to a stage (this property is unique). */
    addCustomChecklistItem: protectedProcedure
      .input(
        z.object({
          stageInstanceId: z.number(),
          label: z.string().min(1).max(500),
          hint: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const userId = requireUserId(ctx);

        const [stage] = await db
          .select()
          .from(onboardingStageInstances)
          .where(eq(onboardingStageInstances.id, input.stageInstanceId))
          .limit(1);
        if (!stage) throw new TRPCError({ code: "NOT_FOUND" });

        const state = (stage.checklistState as Record<string, any>) ?? {};
        const itemId = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        state[itemId] = {
          custom: true,
          label: input.label,
          hint: input.hint ?? null,
          addedBy: userId,
          addedAt: new Date().toISOString(),
          done: false,
        };

        await db
          .update(onboardingStageInstances)
          .set({ checklistState: state })
          .where(eq(onboardingStageInstances.id, input.stageInstanceId));

        await db.insert(onboardingEvents).values({
          projectId: stage.projectId,
          stageInstanceId: stage.id,
          eventType: "checklist_item_added",
          actorUserId: userId,
          data: { itemId, label: input.label },
        });
        return { ok: true, itemId };
      }),

    /** Set a value on an existing template field (or a previously-added custom field). */
    updateField: protectedProcedure
      .input(
        z.object({
          stageInstanceId: z.number(),
          fieldKey: z.string().min(1).max(64),
          value: z.unknown(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const userId = requireUserId(ctx);

        const [stage] = await db
          .select()
          .from(onboardingStageInstances)
          .where(eq(onboardingStageInstances.id, input.stageInstanceId))
          .limit(1);
        if (!stage) throw new TRPCError({ code: "NOT_FOUND" });

        const data = (stage.stageData as Record<string, any>) ?? {};
        data[input.fieldKey] = input.value;

        await db
          .update(onboardingStageInstances)
          .set({ stageData: data })
          .where(eq(onboardingStageInstances.id, input.stageInstanceId));

        await db.insert(onboardingEvents).values({
          projectId: stage.projectId,
          stageInstanceId: stage.id,
          eventType: "field_updated",
          actorUserId: userId,
          data: { fieldKey: input.fieldKey },
        });
        return { ok: true };
      }),

    /** Add an ad-hoc field to a stage (per-property uniqueness). */
    addCustomField: protectedProcedure
      .input(
        z.object({
          stageInstanceId: z.number(),
          key: z.string().min(1).max(64),
          label: z.string().min(1).max(128),
          type: z.enum(["text", "longtext", "number", "money", "url", "boolean", "date"]),
          value: z.unknown().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const userId = requireUserId(ctx);

        const [stage] = await db
          .select()
          .from(onboardingStageInstances)
          .where(eq(onboardingStageInstances.id, input.stageInstanceId))
          .limit(1);
        if (!stage) throw new TRPCError({ code: "NOT_FOUND" });

        const data = (stage.stageData as Record<string, any>) ?? {};
        const customs = Array.isArray(data._custom) ? data._custom : [];
        customs.push({
          key: input.key,
          label: input.label,
          type: input.type,
          value: input.value ?? null,
          addedBy: userId,
          addedAt: new Date().toISOString(),
        });
        data._custom = customs;
        if (input.value !== undefined) data[input.key] = input.value;

        await db
          .update(onboardingStageInstances)
          .set({ stageData: data })
          .where(eq(onboardingStageInstances.id, input.stageInstanceId));

        await db.insert(onboardingEvents).values({
          projectId: stage.projectId,
          stageInstanceId: stage.id,
          eventType: "field_updated",
          actorUserId: userId,
          data: { fieldKey: input.key, custom: true, label: input.label },
        });
        return { ok: true };
      }),

    /**
     * Rename or hide a checklist item on a specific stage instance.
     * Stores overrides in checklistState so the template is never touched.
     */
    updateChecklistItemMeta: protectedProcedure
      .input(
        z.object({
          stageInstanceId: z.number(),
          itemId: z.string(),
          label: z.string().min(1).max(500).optional(),
          hidden: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const userId = requireUserId(ctx);

        const [stage] = await db
          .select()
          .from(onboardingStageInstances)
          .where(eq(onboardingStageInstances.id, input.stageInstanceId))
          .limit(1);
        if (!stage) throw new TRPCError({ code: "NOT_FOUND" });

        const state = (stage.checklistState as Record<string, any>) ?? {};
        const prev = state[input.itemId] ?? {};
        if (input.label !== undefined) prev.labelOverride = input.label;
        if (input.hidden !== undefined) prev.hidden = input.hidden;
        state[input.itemId] = prev;

        await db
          .update(onboardingStageInstances)
          .set({ checklistState: state })
          .where(eq(onboardingStageInstances.id, input.stageInstanceId));

        await db.insert(onboardingEvents).values({
          projectId: stage.projectId,
          stageInstanceId: stage.id,
          eventType: "checklist_item_toggled",
          actorUserId: userId,
          data: { itemId: input.itemId, ...(input.hidden ? { hidden: true } : { labelOverride: input.label }) },
        });
        return { ok: true };
      }),

    /** Delete a comment from the events feed. */
    deleteComment: protectedProcedure
      .input(z.object({ eventId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        requireUserId(ctx);
        await db.delete(onboardingEvents).where(eq(onboardingEvents.id, input.eventId));
        return { ok: true };
      }),

    /** Add a free-text comment on a stage (pinned to events feed). */
    comment: protectedProcedure
      .input(
        z.object({
          stageInstanceId: z.number(),
          body: z.string().min(1).max(8000),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const userId = requireUserId(ctx);

        const [stage] = await db
          .select()
          .from(onboardingStageInstances)
          .where(eq(onboardingStageInstances.id, input.stageInstanceId))
          .limit(1);
        if (!stage) throw new TRPCError({ code: "NOT_FOUND" });

        const [res] = await db.insert(onboardingEvents).values({
          projectId: stage.projectId,
          stageInstanceId: stage.id,
          eventType: "comment_added",
          actorUserId: userId,
          data: { body: input.body },
        });
        return { ok: true, eventId: res.insertId };
      }),
  }),

  // ── Admin: template authoring (manager+) ──────────────────────────────
  admin: router({
    upsertTemplate: managerProcedure
      .input(
        z.object({
          slug: z.string().min(1).max(64),
          name: z.string().min(1).max(128),
          description: z.string().max(2000).optional(),
          kickoffFieldSchema: z.array(z.record(z.string(), z.unknown())),
          stagesConfig: z.array(z.record(z.string(), z.unknown())),
          isActive: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [existing] = await db
          .select()
          .from(onboardingTemplates)
          .where(eq(onboardingTemplates.slug, input.slug))
          .limit(1);

        if (existing) {
          await db
            .update(onboardingTemplates)
            .set({
              name: input.name,
              description: input.description ?? existing.description,
              kickoffFieldSchema: input.kickoffFieldSchema as any,
              stagesConfig: input.stagesConfig as any,
              isActive: input.isActive ?? existing.isActive,
            })
            .where(eq(onboardingTemplates.id, existing.id));
          return { id: existing.id, updated: true };
        }
        const [res] = await db.insert(onboardingTemplates).values({
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          kickoffFieldSchema: input.kickoffFieldSchema as any,
          stagesConfig: input.stagesConfig as any,
          isActive: input.isActive ?? true,
        });
        return { id: res.insertId, updated: false };
      }),
  }),
});
