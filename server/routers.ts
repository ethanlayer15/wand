import { z } from "zod";
import { eq } from "drizzle-orm";
import { COOKIE_NAME } from "@shared/const";
import {
  getListings,
  getTasks,
  getReviews,
  getFlaggedReviews,
  getIntegrations,
  getIntegration,
  getBreezewayProperties,
  getBreezewayTeam,
  getReviewAnalyses,
  getGuestMessages,
  getDb,
} from "./db";
import { breezewayProperties, listings } from "../drizzle/schema";
import { createBreezewayClient } from "./breezeway";
import {
  runFullSync,
  syncHostawayListings,
  syncHostawayReviews,
  syncBreezewayProperties,
  syncBreezewayTeam,
  registerBreezewayWebhooks,
  listBreezewayWebhooks,
} from "./sync";
import { publicProcedure, protectedProcedure, managerProcedure, adminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { systemRouter } from "./_core/systemRouter";
import { billingRouter } from "./billingRouter";
import { analyzeRouter } from "./analyzeRouter";
import { compensationRouter } from "./compensationRouter";
import { podRouter } from "./podRouter";
import { cleanerDashboardRouter } from "./cleanerDashboardRouter";
import { cleaningReportsRouter } from "./cleaningReportsRouter";
import { ENV } from "./_core/env";
import { sendSlackNotification, checkAndNotifyUnassignedSdts } from "./sdtNotifier";
import { updateIntegrationStatus } from "./db";
import { pushTaskToBreezeway, startGuestMessagePipelineJob, getPipelineJobStatus } from "./taskCreator";
import { startReviewPipelineJob, getReviewPipelineJobStatus } from "./reviewPipeline";
import { activateBreezewayTaskSync, deactivateBreezewayTaskSync, pollBreezewayTasks, closeBreezewayTask, reopenBreezewayTask } from "./breezewayTaskSync";
import { getBreezewaySyncConfig, getTaskByBreezewayId } from "./db";
import { updateTaskStatus, updateTaskAssignee, updateTaskTitle, getTeamMembersForAssignment, getTaskDetail, listTeamMembers, listInvitations, createInvitation, revokeInvitation, changeUserRole, removeTeamMember, getUserByEmail, toggleTaskUrgent, createTask, getUrgentTasks, reopenAutoResolvedTask, confirmResolution, addTaskComment, addTaskAttachment, getTaskAttachments, deleteTaskAttachment } from "./db";
import { storagePut } from "./storage";
import { sendEmail } from "./gmail";
import crypto from "crypto";

export const appRouter = router({
  system: systemRouter,
  billing: billingRouter,
  analyze: analyzeRouter,
  compensation: compensationRouter,
  pods: podRouter,
  cleanerDashboard: cleanerDashboardRouter,
  cleaningReports: cleaningReportsRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = {
        secure: true,
        sameSite: "none" as const,
        httpOnly: true,
        path: "/",
      };
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // Dashboard data
  dashboard: router({
    stats: protectedProcedure.query(async () => {
      const [listings, tasks, reviews, flaggedReviews, analyses, messages] = await Promise.all([
        getListings(),
        getTasks(),
        getReviews(),
        getFlaggedReviews(),
        getReviewAnalyses(),
        getGuestMessages(),
      ]);

      // Sentiment from AI analyses
      const sentimentDist = { positive: 0, neutral: 0, negative: 0 };
      for (const a of analyses) {
        const score = a.sentimentScore ?? 0;
        if (score > 20) sentimentDist.positive++;
        else if (score < -20) sentimentDist.negative++;
        else sentimentDist.neutral++;
      }

      // Top issues
      const issueCounts: Record<string, number> = {};
      for (const a of analyses) {
        if (a.issues && Array.isArray(a.issues)) {
          for (const issue of a.issues as Array<{ type: string }>) {
            issueCounts[issue.type] = (issueCounts[issue.type] || 0) + 1;
          }
        }
      }
      const topIssues = Object.entries(issueCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([type, count]) => ({ type, count }));

      // Urgent messages
      const urgentMessages = messages.filter((m) => m.aiUrgency === "high" || m.aiUrgency === "critical");

      return {
        totalReviews: reviews.length,
        urgentCount: tasks.filter((t) => t.priority === "high").length,
        openTasksCount: tasks.filter((t) => t.status !== "completed").length,
        propertiesCount: listings.length,
        flaggedReviewsCount: flaggedReviews.length,
        analyzedCount: analyses.length,
        sentimentDist,
        topIssues,
        totalMessages: messages.length,
        urgentMessageCount: urgentMessages.length,
      };
    }),

    // Time-filtered average rating for the Dashboard stat card
    avgRating: protectedProcedure
      .input(z.object({ timeRange: z.enum(["30d", "quarter", "all"]).default("30d") }))
      .query(async ({ input }) => {
        const reviews = await getReviews();

        // Published guest reviews with a rating
        let filtered = reviews.filter(
          (r) => r.rating != null &&
                 r.reviewStatus === "published" &&
                 (r.reviewType === "guest-to-host" || r.reviewType == null)
        );

        // Apply time range filter using submittedAt (actual review date from Hostaway)
        // Fall back to createdAt only if submittedAt is null
        if (input.timeRange !== "all") {
          const now = new Date();
          let cutoff: Date;
          if (input.timeRange === "30d") {
            cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          } else {
            // "quarter" — start of current quarter
            const q = Math.floor(now.getMonth() / 3);
            cutoff = new Date(now.getFullYear(), q * 3, 1);
          }
          filtered = filtered.filter((r) => {
            const reviewDate = r.submittedAt ?? r.createdAt;
            return reviewDate >= cutoff;
          });
        }

        const avgRating =
          filtered.length > 0
            ? (
                filtered.reduce((sum, r) => {
                  const raw = r.rating!;
                  return sum + (raw > 5 ? raw / 2 : raw);
                }, 0) / filtered.length
              ).toFixed(2)
            : "\u2014";

        return { avgRating, reviewCount: filtered.length };
      }),

    recentReviews: protectedProcedure.query(async () => {
      const reviews = await getReviews();
      return reviews.slice(0, 10);
    }),

    recentTasks: protectedProcedure.query(async () => {
      const tasks = await getTasks();
      return tasks.slice(0, 10);
    }),

    // Urgent alerts: flagged reviews + high-urgency messages
    urgentAlerts: protectedProcedure.query(async () => {
      const [flagged, messages, analyses] = await Promise.all([
        getFlaggedReviews(),
        getGuestMessages({ limit: 100 }),
        getReviewAnalyses(),
      ]);

      // Critical/high severity issues from analyses
      const criticalIssues: Array<{
        type: "review" | "message";
        id: number;
        title: string;
        description: string;
        severity: string;
        date: Date;
      }> = [];

      for (const a of analyses) {
        if (a.issues && Array.isArray(a.issues)) {
          for (const issue of a.issues as Array<{ type: string; description: string; severity: string }>) {
            if (issue.severity === "critical" || issue.severity === "high") {
              criticalIssues.push({
                type: "review",
                id: a.reviewId,
                title: `${issue.type} issue`,
                description: issue.description,
                severity: issue.severity,
                date: a.createdAt,
              });
            }
          }
        }
      }

      // High-urgency messages
      for (const m of messages) {
        if (m.aiUrgency === "high" || m.aiUrgency === "critical") {
          criticalIssues.push({
            type: "message",
            id: m.id,
            title: m.aiCategory || "Guest message",
            description: m.aiSummary || m.body?.slice(0, 100) || "",
            severity: m.aiUrgency,
            date: m.createdAt,
          });
        }
      }

      return criticalIssues
        .sort((a, b) => {
          const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
          return (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
        })
        .slice(0, 10);
    }),
  }),

  // Listings (all authenticated users can list; search is manager+)
  listings: router({
    list: protectedProcedure.query(async () => {
      return getListings();
    }),

    search: managerProcedure
      .input(z.object({ query: z.string() }))
      .query(async ({ input }) => {
        const listings = await getListings();
        const q = input.query.toLowerCase();
        return listings.filter(
          (l) =>
            (l.internalName || l.name).toLowerCase().includes(q) ||
            l.name.toLowerCase().includes(q) ||
            l.city?.toLowerCase().includes(q)
        );
      }),
  }),

  // Tasks
  tasks: router({
    list: protectedProcedure.query(async () => {
      return getTasks();
    }),

    byStatus: protectedProcedure
      .input(z.object({ status: z.string() }))
      .query(async ({ input }) => {
        const tasks = await getTasks();
        return tasks.filter((t) => t.status === input.status);
      }),

    byCategory: protectedProcedure
      .input(z.object({ category: z.string() }))
      .query(async ({ input }) => {
        const tasks = await getTasks();
        return tasks.filter((t) => t.category === input.category);
      }),

    pushToBreezeway: managerProcedure
      .input(z.object({ taskId: z.number() }))
      .mutation(async ({ input }) => {
        return pushTaskToBreezeway(input.taskId);
      }),

    triggerGuestMessagePipeline: managerProcedure.mutation(async () => {
      return startGuestMessagePipelineJob();
    }),

    pipelineStatus: managerProcedure.query(async () => {
      return getPipelineJobStatus();
    }),

    triggerReviewPipeline: managerProcedure.mutation(async () => {
      return startReviewPipelineJob();
    }),

    reviewPipelineStatus: managerProcedure.query(async () => {
      return getReviewPipelineJobStatus();
    }),

    updateStatus: protectedProcedure
      .input(z.object({
        taskId: z.number(),
        status: z.enum(["created", "needs_review", "up_next", "in_progress", "completed", "ignored", "ideas_for_later"]),
      }))
      .mutation(async ({ input }) => {
        // Two-way sync: if this is a Breezeway-sourced task, sync status changes back
        const existingTask = await getTaskDetail(input.taskId);
        const result = await updateTaskStatus(input.taskId, input.status);

        // Phase 3: Two-way sync for Breezeway tasks
        if (existingTask?.task?.breezewayTaskId && existingTask?.task?.source === "breezeway") {
          const bwId = existingTask.task.breezewayTaskId;
          const oldStatus = existingTask.task.status;
          const newStatus = input.status;

          // Dragged to Done → close in Breezeway
          if (newStatus === "completed" && oldStatus !== "completed") {
            closeBreezewayTask(bwId, input.taskId).catch((err) =>
              console.error(`[TwoWaySync] Failed to close BW task ${bwId}:`, err)
            );
          }
          // Dragged from Done back to active → reopen in Breezeway
          else if (
            oldStatus === "completed" &&
            (newStatus === "created" || newStatus === "in_progress")
          ) {
            reopenBreezewayTask(bwId, input.taskId).catch((err) =>
              console.error(`[TwoWaySync] Failed to reopen BW task ${bwId}:`, err)
            );
          }
          // Dragged to Ignored → do NOTHING on Breezeway side (Wand-only dismissal)
        }

        return result;
      }),

    updateAssignee: managerProcedure
      .input(z.object({
        taskId: z.number(),
        assignedTo: z.string().nullable(),
      }))
      .mutation(async ({ input }) => {
        return updateTaskAssignee(input.taskId, input.assignedTo);
      }),

    reopenResolved: protectedProcedure
      .input(z.object({ taskId: z.number() }))
      .mutation(async ({ input }) => {
        return reopenAutoResolvedTask(input.taskId);
      }),

    confirmResolution: protectedProcedure
      .input(z.object({ taskId: z.number() }))
      .mutation(async ({ input }) => {
        return confirmResolution(input.taskId);
      }),

    teamMembers: protectedProcedure.query(async () => {
      return getTeamMembersForAssignment();
    }),

    detail: protectedProcedure
      .input(z.object({ taskId: z.number() }))
      .query(async ({ input }) => {
        return getTaskDetail(input.taskId);
      }),

    toggleUrgent: managerProcedure
      .input(z.object({
        taskId: z.number(),
        isUrgent: z.boolean(),
      }))
      .mutation(async ({ input }) => {
        return toggleTaskUrgent(input.taskId, input.isUrgent);
      }),

    create: managerProcedure
      .input(z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]),
        taskType: z.enum(["maintenance", "housekeeping", "inspection", "safety", "other"]).optional(),
        listingId: z.number().optional(),
        assignedTo: z.string().optional(),
        status: z.enum(["created", "needs_review", "up_next", "in_progress", "completed", "ignored", "ideas_for_later"]).optional(),
      }))
      .mutation(async ({ input }) => {
        return createTask(input);
      }),

    urgent: protectedProcedure.query(async () => {
      return getUrgentTasks();
    }),

    addComment: protectedProcedure
      .input(z.object({
        taskId: z.number(),
        content: z.string().min(1).max(5000),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
        return addTaskComment({
          taskId: input.taskId,
          userId: ctx.user.id,
          userName: ctx.user.name || "Unknown",
          content: input.content,
        });
      }),

    updateTitle: protectedProcedure
      .input(z.object({
        taskId: z.number(),
        title: z.string().min(1).max(1000),
      }))
      .mutation(async ({ input }) => {
        return updateTaskTitle(input.taskId, input.title.trim());
      }),

    // ── Attachments (photos/videos) ──────────────────────────────────
    uploadAttachment: protectedProcedure
      .input(z.object({
        taskId: z.number(),
        fileName: z.string(),
        mimeType: z.string(),
        size: z.number(),
        base64Data: z.string(), // base64-encoded file content
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
        // Validate file type
        const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "video/mp4", "video/quicktime", "video/webm"];
        if (!allowedTypes.includes(input.mimeType)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `File type ${input.mimeType} is not supported. Allowed: images (JPEG, PNG, GIF, WebP, HEIC) and videos (MP4, MOV, WebM).` });
        }
        // Validate file size (50MB max)
        if (input.size > 50 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "File size exceeds 50MB limit." });
        }
        // Upload to S3
        const randomSuffix = crypto.randomBytes(8).toString("hex");
        const ext = input.fileName.split(".").pop() || "bin";
        const fileKey = `task-attachments/${input.taskId}/${randomSuffix}.${ext}`;
        const buffer = Buffer.from(input.base64Data, "base64");
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        // Save metadata to DB
        const result = await addTaskAttachment({
          taskId: input.taskId,
          url,
          fileKey,
          fileName: input.fileName,
          mimeType: input.mimeType,
          size: input.size,
          uploadedBy: ctx.user.id,
          uploadedByName: ctx.user.name || "Unknown",
        });
        return { id: result.id, url, fileName: input.fileName, mimeType: input.mimeType };
      }),

    getAttachments: protectedProcedure
      .input(z.object({ taskId: z.number() }))
      .query(async ({ input }) => {
        return getTaskAttachments(input.taskId);
      }),

    deleteAttachment: managerProcedure
      .input(z.object({ attachmentId: z.number() }))
      .mutation(async ({ input }) => {
        await deleteTaskAttachment(input.attachmentId);
        return { success: true };
      }),
  }),

  // Reviews & Analyze (manager+)
  reviews: router({
    list: managerProcedure.query(async () => {
      return getReviews();
    }),

    flagged: managerProcedure.query(async () => {
      return getFlaggedReviews();
    }),
  }),

  // Integrations (admin only)
  integrations: router({
    list: adminProcedure.query(async () => {
      return getIntegrations();
    }),

    status: adminProcedure
      .input(z.object({ name: z.string() }))
      .query(async ({ input }) => {
        const integration = await getIntegration(input.name);
        return integration;
      }),

    // Trigger a full sync of all integrations
    syncAll: adminProcedure.mutation(async () => {
      const result = await runFullSync();
      return result;
    }),

    // Sync only Hostaway listings
    syncHostawayListings: adminProcedure.mutation(async () => {
      return syncHostawayListings();
    }),

    // Sync only Hostaway reviews
    syncHostawayReviews: adminProcedure.mutation(async () => {
      return syncHostawayReviews();
    }),

    // Sync only Breezeway properties
    syncBreezewayProperties: adminProcedure.mutation(async () => {
      return syncBreezewayProperties();
    }),

    // Sync property tags from Breezeway — tries multiple API approaches
    syncBreezewayPropertyTags: adminProcedure.mutation(async () => {
      const client = createBreezewayClient();
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const allProps = await getBreezewayProperties();
      let updated = 0;
      let errors = 0;
      const debugLog: string[] = [];

      // ── Strategy 1: Try /property list with tag filter ──
      try {
        debugLog.push("Strategy 1: /property?tag=Leisr Billing");
        const taggedResult = await client.get<{ results?: any[]; total_results?: number }>("/property", {
          tag: "Leisr Billing",
          limit: 500,
          page: 1,
        });
        const taggedProps = taggedResult.results || [];
        debugLog.push(`→ Got ${taggedProps.length} properties with tag filter`);
        console.log(`[TagSync] Strategy 1: /property?tag=Leisr Billing returned ${taggedProps.length} results`);

        if (taggedProps.length > 0) {
          // We found tagged properties! Update their tags in DB
          const taggedIds = new Set(taggedProps.map((p: any) => String(p.id)));
          for (const prop of allProps) {
            if (taggedIds.has(prop.breezewayId)) {
              try {
                const existingTags: string[] = prop.tags ? JSON.parse(prop.tags as string) : [];
                if (!existingTags.includes("Leisr Billing")) {
                  existingTags.push("Leisr Billing");
                }
                await db
                  .update(breezewayProperties)
                  .set({ tags: JSON.stringify(existingTags) })
                  .where(eq(breezewayProperties.breezewayId, prop.breezewayId));
                updated++;
              } catch { errors++; }
            }
          }
          debugLog.push(`→ Updated ${updated} properties`);
          return { updated, errors, total: allProps.length, strategy: "property?tag=filter", debugLog: debugLog.join(' | ') };
        }
      } catch (err: any) {
        debugLog.push(`→ Failed: ${err.message?.substring(0, 80)}`);
        console.log(`[TagSync] Strategy 1 failed: ${err.message}`);
      }

      // ── Strategy 2: Try /tags global list to find tag ID, then filter ──
      try {
        debugLog.push("Strategy 2: /tags global list");
        const tagsResult = await client.get<any>("/tags");
        const rawStr = JSON.stringify(tagsResult).substring(0, 300);
        debugLog.push(`→ Response: ${rawStr}`);
        console.log(`[TagSync] Strategy 2 /tags: ${rawStr}`);

        // Try to find the Leisr Billing tag
        const tagsList = Array.isArray(tagsResult) ? tagsResult : tagsResult?.results || tagsResult?.tags || [];
        const leisrTag = tagsList.find((t: any) =>
          (typeof t === "string" && t === "Leisr Billing") ||
          (t?.name === "Leisr Billing") ||
          (t?.label === "Leisr Billing")
        );

        if (leisrTag) {
          const tagId = typeof leisrTag === "object" ? leisrTag.id : null;
          debugLog.push(`→ Found Leisr Billing tag (id: ${tagId})`);

          if (tagId) {
            // Try /tags/{id}/properties or /property?tag_id={id}
            try {
              const tagProps = await client.get<{ results?: any[] }>(`/tags/${tagId}/properties`, { limit: 500 });
              const props = tagProps.results || [];
              debugLog.push(`→ /tags/${tagId}/properties: ${props.length} results`);
              if (props.length > 0) {
                const taggedIds = new Set(props.map((p: any) => String(p.id)));
                for (const prop of allProps) {
                  if (taggedIds.has(prop.breezewayId)) {
                    const existingTags: string[] = prop.tags ? JSON.parse(prop.tags as string) : [];
                    if (!existingTags.includes("Leisr Billing")) existingTags.push("Leisr Billing");
                    await db.update(breezewayProperties).set({ tags: JSON.stringify(existingTags) }).where(eq(breezewayProperties.breezewayId, prop.breezewayId));
                    updated++;
                  }
                }
                return { updated, errors, total: allProps.length, strategy: "tags/{id}/properties", debugLog: debugLog.join(' | ') };
              }
            } catch (err: any) {
              debugLog.push(`→ /tags/${tagId}/properties failed: ${err.message?.substring(0, 60)}`);
            }
          }
        }
      } catch (err: any) {
        debugLog.push(`→ Failed: ${err.message?.substring(0, 80)}`);
        console.log(`[TagSync] Strategy 2 failed: ${err.message}`);
      }

      // ── Strategy 3: Try /property_tag endpoint ──
      try {
        debugLog.push("Strategy 3: /property_tag");
        const ptResult = await client.get<any>("/property_tag", { limit: 500 });
        const rawStr = JSON.stringify(ptResult).substring(0, 300);
        debugLog.push(`→ Response: ${rawStr}`);
        console.log(`[TagSync] Strategy 3 /property_tag: ${rawStr}`);
      } catch (err: any) {
        debugLog.push(`→ Failed: ${err.message?.substring(0, 80)}`);
      }

      // ── Strategy 4: Per-property /property/{id}/tags — sample broadly ──
      try {
        debugLog.push("Strategy 4: per-property /tags (sampling 20)");
        // Sample 20 properties spread across the list to see if any return tags
        const sampleIndices = Array.from({ length: Math.min(20, allProps.length) }, (_, i) =>
          Math.floor((i / 20) * allProps.length)
        );
        let foundAny = false;

        for (const idx of sampleIndices) {
          const prop = allProps[idx];
          try {
            const tagResult = await client.get<any>(`/property/${prop.breezewayId}/tags`);
            const tagData = Array.isArray(tagResult) ? tagResult
              : tagResult?.results || tagResult?.tags || [];

            if (tagData.length > 0) {
              foundAny = true;
              debugLog.push(`→ ${prop.name} HAS tags: ${JSON.stringify(tagData).substring(0, 100)}`);
              console.log(`[TagSync] Found tags on ${prop.name}: ${JSON.stringify(tagData)}`);
            }
            await new Promise((r) => setTimeout(r, 150));
          } catch { /* skip */ }
        }

        if (foundAny) {
          // Full scan all properties
          debugLog.push("→ Found tags! Running full scan...");
          for (const prop of allProps) {
            try {
              const tagResult = await client.get<any>(`/property/${prop.breezewayId}/tags`);
              const tagData = Array.isArray(tagResult) ? tagResult
                : tagResult?.results || tagResult?.tags || [];
              if (tagData.length > 0) {
                const tagNames = tagData.map((t: any) =>
                  typeof t === "string" ? t : t.name || t.label || String(t)
                );
                await db.update(breezewayProperties).set({ tags: JSON.stringify(tagNames) }).where(eq(breezewayProperties.breezewayId, prop.breezewayId));
                updated++;
              }
              await new Promise((r) => setTimeout(r, 100));
            } catch { errors++; }
          }
        } else {
          debugLog.push("→ No tags found on any sampled properties");
        }
      } catch (err: any) {
        debugLog.push(`→ Failed: ${err.message?.substring(0, 80)}`);
      }

      // ── Strategy 5: Check raw property response for tag-like fields ──
      try {
        debugLog.push("Strategy 5: raw property inspection");
        const rawProp = await client.get<any>(`/property/${allProps[0]?.breezewayId}`);
        const keys = Object.keys(rawProp || {});
        debugLog.push(`→ Property keys: ${keys.join(', ')}`);

        // Look for any tag-related fields
        const tagKeys = keys.filter(k => k.toLowerCase().includes('tag') || k.toLowerCase().includes('label') || k.toLowerCase().includes('category'));
        if (tagKeys.length > 0) {
          debugLog.push(`→ Tag-related keys: ${tagKeys.map(k => `${k}=${JSON.stringify(rawProp[k]).substring(0, 50)}`).join(', ')}`);
        }
      } catch (err: any) {
        debugLog.push(`→ Failed: ${err.message?.substring(0, 80)}`);
      }

      console.log(`[TagSync] Complete: ${updated} updated, ${errors} errors / ${allProps.length} total`);
      console.log(`[TagSync] Debug: ${debugLog.join(' | ')}`);
      return { updated, errors, total: allProps.length, strategy: "multi-probe", debugLog: debugLog.join(' | ') };
    }),

    // Manual bulk-tag properties (for restoring tags wiped by sync)
    bulkTagProperties: adminProcedure
      .input(z.object({
        tag: z.string(),
        propertyIds: z.array(z.number()).optional(), // DB IDs
        propertyNames: z.array(z.string()).optional(), // fuzzy match by name
        action: z.enum(["add", "remove", "set"]).default("add"),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const allProps = await getBreezewayProperties();
        let updated = 0;
        let matched: string[] = [];

        // Determine target properties
        let targets = allProps;
        if (input.propertyIds && input.propertyIds.length > 0) {
          targets = allProps.filter(p => input.propertyIds!.includes(p.id));
        } else if (input.propertyNames && input.propertyNames.length > 0) {
          const searchNames = input.propertyNames.map(n => n.toLowerCase().trim());
          targets = allProps.filter(p => {
            const pName = (p.name || "").toLowerCase();
            return searchNames.some(s => pName.includes(s) || s.includes(pName));
          });
        }

        for (const prop of targets) {
          const existingTags: string[] = prop.tags ? JSON.parse(prop.tags as string) : [];
          let newTags: string[];

          if (input.action === "add") {
            newTags = existingTags.includes(input.tag) ? existingTags : [...existingTags, input.tag];
          } else if (input.action === "remove") {
            newTags = existingTags.filter(t => t !== input.tag);
          } else {
            newTags = [input.tag];
          }

          if (JSON.stringify(newTags) !== JSON.stringify(existingTags)) {
            await db.update(breezewayProperties).set({ tags: JSON.stringify(newTags) }).where(eq(breezewayProperties.breezewayId, prop.breezewayId));
            updated++;
            matched.push(prop.name || prop.breezewayId);
          }
        }

        return { updated, totalTargets: targets.length, matched };
      }),

    // List all properties with their current tags (for tag management UI)
    listPropertyTags: adminProcedure.query(async () => {
      const allProps = await getBreezewayProperties();
      return allProps.map(p => ({
        id: p.id,
        breezewayId: p.breezewayId,
        name: p.name,
        tags: p.tags ? JSON.parse(p.tags as string) : [],
        status: p.status,
      }));
    }),

    // Sync only Breezeway team
    syncBreezewayTeam: adminProcedure.mutation(async () => {
      return syncBreezewayTeam();
    }),

    // Register Breezeway webhooks
    registerBreezewayWebhooks: adminProcedure
      .input(z.object({ webhookUrl: z.string().url() }))
      .mutation(async ({ input }) => {
        return registerBreezewayWebhooks(input.webhookUrl);
      }),

    // List active Breezeway webhooks
    listBreezewayWebhooks: adminProcedure.query(async () => {
      try {
        return listBreezewayWebhooks();
      } catch {
        return [];
      }
    }),

    // Test Slack webhook
    testSlackWebhook: protectedProcedure.mutation(async () => {
      const ok = await sendSlackNotification("✅ Wand Slack integration test — webhook is working!");
      if (ok) {
        await updateIntegrationStatus("slack", "connected", new Date());
      } else {
        await updateIntegrationStatus("slack", "error", undefined, "Webhook URL not configured or invalid");
      }
      return { success: ok };
    }),

    // Manually trigger SDT check
    triggerSdtCheck: adminProcedure.mutation(async () => {
      const result = await checkAndNotifyUnassignedSdts();
      return result;
    }),
  }),

  // Breezeway (manager+)
  breezeway: router({
    properties: router({
      list: managerProcedure.query(async () => {
        return getBreezewayProperties();
      }),

      // Fetch directly from Breezeway API (live data)
      // Also cross-references local listings table to use Hostaway internalName as display name
      fetchLive: managerProcedure.query(async () => {
        try {
          const client = createBreezewayClient();
          const response = await client.get<{
            results?: Array<{
              id: number;
              name: string;
              display?: string;
              address1?: string;
              city?: string;
              state?: string;
              status?: string;
              photos?: Array<{ url: string; default: boolean }>;
            }>;
            total_results?: number;
          }>("/property", { limit: 200, page: 1 });
          const bwResults = response.results || [];

          // Build a map of referencePropertyId -> internalName from local listings
          const db = await getDb();
          let internalNameMap: Record<string, string> = {};
          if (db) {
            const bwProps = await db
              .select({
                referencePropertyId: breezewayProperties.referencePropertyId,
                internalName: listings.internalName,
                listingName: listings.name,
              })
              .from(breezewayProperties)
              .leftJoin(listings, eq(breezewayProperties.referencePropertyId, listings.hostawayId));
            for (const p of bwProps) {
              if (p.referencePropertyId) {
                internalNameMap[p.referencePropertyId] = p.internalName || p.listingName || "";
              }
            }
          }

          // Attach internalName to each Breezeway property result
          return bwResults.map((p) => ({
            ...p,
            name: internalNameMap[String(p.id)] || p.name,
          }));
        } catch {
          return [];
        }
      }),
    }),

    tasks: router({
      // Fetch tasks across all properties (or a filtered subset) from Breezeway API
      // NOTE: Breezeway /task/ API requires home_id — no cross-property query supported.
      // We batch-fetch per property in parallel (10 at a time) and merge results.
      listByProperty: managerProcedure
        .input(
          z.object({
            homeId: z.number().optional(),
            status: z.string().optional(),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            assigneeId: z.number().optional(),
            propertyTags: z.array(z.string()).optional(), // pre-filter by tags server-side
            limit: z.number().default(200),
          })
        )
        .query(async ({ input }) => {
          try {
            const client = createBreezewayClient();

            // Map UI status values to Breezeway API stage codes
            // UI: "scheduled" → BW stage: "open"
            // UI: "in-progress" → BW stage: "started"
            // UI: "completed"  → BW stage: "finished"
            const STATUS_TO_BW_STAGE: Record<string, string> = {
              scheduled: "open",
              "in-progress": "started",
              completed: "finished",
            };
            const bwStage = input.status ? (STATUS_TO_BW_STAGE[input.status] ?? input.status) : undefined;

            type BwTask = {
              id: number;
              name: string;
              home_id: number;
              type_department?: string;
              type_priority?: string;
              type_task_status?: { code: string; name: string; stage: string };
              scheduled_date?: string;
              created_at?: string;
              assignments?: Array<{ id: number; assignee_id: number; name: string; type_task_user_status: string }>;
              created_by?: { id: number; name: string };
            };

            // If a specific homeId is provided, fetch just that property
            if (input.homeId) {
              const params: Record<string, string | number> = {
                home_id: input.homeId,
                limit: input.limit,
                page: 1,
              };
              if (bwStage) params.stage = bwStage;
              if (input.startDate) params.scheduled_date_start = input.startDate;
              if (input.endDate) params.scheduled_date_end = input.endDate;
              if (input.assigneeId) params.assignee_id = input.assigneeId;
              const response = await client.get<{ results?: BwTask[]; total_results?: number }>("/task/", params);
              return { results: response.results || [], totalResults: response.total_results || 0 };
            }

            // Otherwise, fetch all properties from DB and batch-fetch tasks
            const allProperties = await getBreezewayProperties();

            // Filter by property tags if specified
            let targetProperties = allProperties;
            if (input.propertyTags && input.propertyTags.length > 0) {
              targetProperties = allProperties.filter((p) => {
                const propTags: string[] = p.tags ? JSON.parse(p.tags as string) : [];
                return input.propertyTags!.every((tag) => propTags.includes(tag));
              });
            }

            console.log(`[Breezeway] Fetching tasks for ${targetProperties.length} properties (date: ${input.startDate}–${input.endDate})`);

            // Helper: fetch ALL pages for a single property
            // Uses reference_property_id (Hostaway ID) if available, falls back to home_id (Breezeway internal ID)
            const fetchAllPagesForProperty = async (prop: { referencePropertyId?: string | null; breezewayId: string }): Promise<BwTask[]> => {
              const PAGE_LIMIT = 100; // max per page
              const tasks: BwTask[] = [];
              let page = 1;
              while (true) {
                const params: Record<string, string | number> = {
                  limit: PAGE_LIMIT,
                  page,
                };
                // Use referencePropertyId if available, otherwise fall back to breezewayId (home_id)
                if (prop.referencePropertyId) {
                  params.reference_property_id = prop.referencePropertyId;
                } else {
                  params.home_id = Number(prop.breezewayId);
                }
                // Pass date range to Breezeway API for server-side filtering (much faster)
                if (input.startDate) params.scheduled_date_start = input.startDate;
                if (input.endDate) params.scheduled_date_end = input.endDate;
                if (bwStage) params.stage = bwStage;
                if (input.assigneeId) params.assignee_ids = input.assigneeId;
                const res = await client.get<{ results?: BwTask[]; total_pages?: number }>("/task/", params);
                const pageResults = res.results || [];
                tasks.push(...pageResults);
                // Stop if no more results or we've reached the last page
                if (pageResults.length === 0 || (res.total_pages !== undefined && page >= res.total_pages)) break;
                page++;
              }
              return tasks;
            };

            // ALL tagged properties are now queryable — we fall back to home_id for those without referencePropertyId
            const queryableProperties = targetProperties;
            const propsWithRefId = targetProperties.filter((p) => p.referencePropertyId).length;
            const propsWithHomeIdOnly = targetProperties.length - propsWithRefId;
            console.log(`[Breezeway] ${targetProperties.length} target properties (${propsWithRefId} via referencePropertyId, ${propsWithHomeIdOnly} via home_id fallback)`);

            // Track properties using home_id fallback
            const homeIdFallbackProperties = targetProperties
              .filter((p) => !p.referencePropertyId)
              .map((p) => p.name ?? `ID ${p.breezewayId}`);
            if (homeIdFallbackProperties.length > 0) {
              console.log(`[Breezeway] Properties using home_id fallback: ${homeIdFallbackProperties.join(', ')}`);
            }
            const skippedProperties: string[] = []; // No longer skipping any properties

            // Controlled parallel fetch with retry logic
            const BATCH_SIZE = 3;
            const INTER_BATCH_DELAY_MS = 500;
            const MAX_RETRIES = 2;
            const allTasks: BwTask[] = [];
            let fetchErrors = 0;
            const propertyTaskCounts: Record<string, number> = {};
            const failedProperties: string[] = [];

            for (let i = 0; i < queryableProperties.length; i += BATCH_SIZE) {
              const batch = queryableProperties.slice(i, i + BATCH_SIZE);

              // Track which properties in this batch still need fetching
              let pendingProps = batch.map((prop, idx) => ({ prop, idx }));
              let attempt = 0;

              while (pendingProps.length > 0 && attempt <= MAX_RETRIES) {
                if (attempt > 0) {
                  const retryDelay = attempt * 15000;
                  console.warn(`[Breezeway] Retry attempt ${attempt}/${MAX_RETRIES} for ${pendingProps.length} properties — waiting ${retryDelay / 1000}s...`);
                  await new Promise((resolve) => setTimeout(resolve, retryDelay));
                }

                const batchResults = await Promise.allSettled(
                  pendingProps.map(({ prop }) => fetchAllPagesForProperty(prop))
                );

                const stillFailing: typeof pendingProps = [];
                for (let j = 0; j < batchResults.length; j++) {
                  const result = batchResults[j];
                  const propName = pendingProps[j].prop.name ?? 'unknown';
                  if (result.status === 'fulfilled') {
                    allTasks.push(...result.value);
                    propertyTaskCounts[propName] = result.value.length;
                  } else {
                    const errMsg = result.reason?.message ?? String(result.reason);
                    const isRateLimit = errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit');

                    if (isRateLimit && attempt < MAX_RETRIES) {
                      console.warn(`[Breezeway] Rate limited fetching ${propName} — will retry`);
                      stillFailing.push(pendingProps[j]);
                    } else {
                      fetchErrors++;
                      failedProperties.push(propName);
                      console.error(`[Breezeway] Failed to fetch tasks for ${propName} (attempt ${attempt + 1}): ${errMsg}`);
                    }
                  }
                }

                pendingProps = stillFailing;
                attempt++;
              }

              // Delay between batches to be polite to the API
              if (i + BATCH_SIZE < queryableProperties.length) {
                await new Promise((resolve) => setTimeout(resolve, INTER_BATCH_DELAY_MS));
              }
            }

            // Log per-property task counts for diagnostics
            const zeroTaskProps = Object.entries(propertyTaskCounts).filter(([, count]) => count === 0).map(([name]) => name);
            console.log(`[Breezeway] Per-property task counts:`, JSON.stringify(propertyTaskCounts));
            if (zeroTaskProps.length > 0) {
              console.warn(`[Breezeway] Properties with 0 tasks: ${zeroTaskProps.join(', ')}`);
            }
            if (failedProperties.length > 0) {
              console.warn(`[Breezeway] Failed properties: ${failedProperties.join(', ')}`);
            }
            if (fetchErrors > 0) {
              console.warn(`[Breezeway] ${fetchErrors}/${queryableProperties.length} properties failed to fetch after retries`);
            }

            // Post-fetch filtering — apply date range and status as safety net
            // (Breezeway API may not honour all query params server-side)
            let filteredTasks = allTasks;

            // Date filter
            if (input.startDate || input.endDate) {
              const start = input.startDate ? new Date(input.startDate) : null;
              const end = input.endDate ? new Date(input.endDate) : null;
              // Set end date to end of day
              if (end) end.setHours(23, 59, 59, 999);
              filteredTasks = filteredTasks.filter((task) => {
                if (!task.scheduled_date) return false;
                const taskDate = new Date(task.scheduled_date);
                if (start && taskDate < start) return false;
                if (end && taskDate > end) return false;
                return true;
              });
              console.log(`[Breezeway] Date filter (${input.startDate}–${input.endDate}): ${allTasks.length} total → ${filteredTasks.length} in range`);
            }

            // Status filter — compare against the BW stage value
            if (bwStage) {
              const beforeStatusFilter = filteredTasks.length;
              filteredTasks = filteredTasks.filter((task) => {
                const taskStage = task.type_task_status?.stage;
                return taskStage === bwStage;
              });
              console.log(`[Breezeway] Status filter (stage=${bwStage}): ${beforeStatusFilter} → ${filteredTasks.length} tasks`);
            }

            // Sort by scheduled_date ascending
            filteredTasks.sort((a, b) => {
              const da = a.scheduled_date || "";
              const db = b.scheduled_date || "";
              return da.localeCompare(db);
            });

            console.log(`[Breezeway] Returning ${filteredTasks.length} tasks after all filters`);
            return {
              results: filteredTasks,
              totalResults: filteredTasks.length,
              _debug: {
                totalProperties: allProperties.length,
                taggedProperties: targetProperties.length,
                queryableProperties: queryableProperties.length,
                skippedProperties,
                failedProperties,
                zeroTaskProperties: zeroTaskProps,
                propertyTaskCounts,
              },
            };
          } catch (err) {
            console.error("[Breezeway] Failed to fetch tasks:", err);
            return { results: [], totalResults: 0 };
          }
        }),

      // Get a single task by ID
      getById: managerProcedure
        .input(z.object({ taskId: z.number() }))
        .query(async ({ input }) => {
          const client = createBreezewayClient();
          return client.get<{
            id: number;
            name: string;
            description?: string;
            home_id: number;
            type_task_status?: { code: string; name: string; stage: string };
            type_priority?: string;
            type_department?: string;
            scheduled_date?: string;
            created_at?: string;
            updated_at?: string;
            assignments?: Array<{ id: number; name: string }>;
            created_by?: { id: number; name: string };
            photos?: Array<{ id: number; url: string; thumbnail_url?: string; created_at?: string }>;
            notes?: string;
          }>(`/task/${input.taskId}`);
        }),

      // Get task comments
      getComments: managerProcedure
        .input(z.object({ taskId: z.number() }))
        .query(async ({ input }) => {
          const client = createBreezewayClient();
          return client.get<
            Array<{
              id: number;
              comment: string;
              created_by: { id: number; name: string };
              created_at: string;
            }>
          >(`/task/${input.taskId}/comment`);
        }),

      // ── Write actions (all require 2-step confirmation) ──────────────────

      // Create a new task
      create: managerProcedure
        .input(
          z.object({
            homeId: z.number(),
            name: z.string(),
            templateId: z.number().optional(),
            scheduledDate: z.string().optional(),
            typePriority: z
              .enum(["normal", "high", "low"])
              .default("normal"),
            typeDepartment: z
              .enum(["housekeeping", "maintenance", "inspection"])
              .default("housekeeping"),
            assigneeIds: z.array(z.number()).optional(),
            notes: z.string().optional(),
          })
        )
        .mutation(async ({ input }) => {
          const client = createBreezewayClient();
          const body: Record<string, unknown> = {
            home_id: input.homeId,
            name: input.name,
            type_priority: input.typePriority,
            type_department: input.typeDepartment,
          };
          if (input.templateId) body.template_id = input.templateId;
          if (input.scheduledDate) body.scheduled_date = input.scheduledDate;
          if (input.notes) body.notes = input.notes;
          if (input.assigneeIds?.length) {
            body.assignments = input.assigneeIds.map((id) => ({
              assignee_id: id,
            }));
          }
          return client.post<{ id: number; name: string }>("/task/", body);
        }),

      // Close a task
      close: managerProcedure
        .input(z.object({ taskId: z.number() }))
        .mutation(async ({ input }) => {
          const client = createBreezewayClient();
          return client.post<{ success: boolean }>(
            `/task/${input.taskId}/close`,
            {}
          );
        }),

      // Approve a task
      approve: managerProcedure
        .input(z.object({ taskId: z.number() }))
        .mutation(async ({ input }) => {
          const client = createBreezewayClient();
          return client.post<{ success: boolean }>(
            `/task/${input.taskId}/approve`,
            {}
          );
        }),

      // Reopen a task
      reopen: managerProcedure
        .input(z.object({ taskId: z.number() }))
        .mutation(async ({ input }) => {
          const client = createBreezewayClient();
          return client.post<{ success: boolean }>(
            `/task/${input.taskId}/reopen`,
            {}
          );
        }),

      // Add a comment to a task
      addComment: managerProcedure
        .input(z.object({ taskId: z.number(), comment: z.string().min(1) }))
        .mutation(async ({ input }) => {
          const client = createBreezewayClient();
          return client.post<{ id: number; comment: string }>(
            `/task/${input.taskId}/comment`,
            { comment: input.comment }
          );
        }),
    }),

    // ── Task Sync Control ──────────────────────────────────────────────
    taskSync: router({
      // Get sync status
      status: managerProcedure.query(async () => {
        return getBreezewaySyncConfig();
      }),

      // Activate sync (admin only)
      activate: adminProcedure.mutation(async () => {
        return activateBreezewayTaskSync();
      }),

      // Deactivate sync (admin only)
      deactivate: adminProcedure.mutation(async () => {
        await deactivateBreezewayTaskSync();
        return { success: true };
      }),

      // Manual poll (manager+)
      poll: managerProcedure.mutation(async () => {
        return pollBreezewayTasks();
      }),
    }),

    team: router({
      list: managerProcedure.query(async () => {
        return getBreezewayTeam();
      }),

      // Fetch live from Breezeway API
      fetchLive: managerProcedure.query(async () => {
        try {
          const client = createBreezewayClient();
          return client.get<
            Array<{
              id: number;
              first_name?: string;
              last_name?: string;
              emails?: string[];
              active?: boolean;
              type_role?: string;
              type_departments?: string[];
              groups?: Array<{ id: number; name: string }>;
            }>
          >("/people");
        } catch {
          return [];
        }
      }),
    }),
  }),

  // ── Team Management ──────────────────────────────────────────────────
  team: router({
    // List all team members (admin + manager can see)
    members: managerProcedure.query(async () => {
      return listTeamMembers();
    }),

    // List all invitations (admin only)
    invitations: adminProcedure.query(async () => {
      return listInvitations();
    }),

    // Invite a new team member by email (admin only)
    invite: adminProcedure
      .input(
        z.object({
          email: z.string().email(),
          role: z.enum(["manager", "member"]),
          origin: z.string(), // frontend origin for building invite link
        })
      )
      .mutation(async ({ input, ctx }) => {
        const email = input.email.toLowerCase().trim();

        // Validate domain
        if (!email.endsWith("@leisrstays.com")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only @leisrstays.com email addresses can be invited",
          });
        }

        // Check if user already exists
        const existing = await getUserByEmail(email);
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A user with this email already exists",
          });
        }

        // Generate invitation token
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        await createInvitation({
          email,
          role: input.role,
          invitedBy: ctx.user.id,
          token,
          expiresAt,
        });

        // Send invitation email
        const inviteUrl = `${input.origin}/login?invite=${token}`;
        try {
          await sendEmail({
            to: email,
            subject: "You're invited to join Wand",
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1a3a2a;">You've been invited to Wand</h2>
                <p>${ctx.user.name || "An admin"} has invited you to join the Wand team as a <strong>${input.role}</strong>.</p>
                <p>Click the button below to sign in with your Google account:</p>
                <a href="${inviteUrl}" style="display: inline-block; padding: 12px 24px; background-color: #1a3a2a; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">Accept Invitation</a>
                <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
              </div>
            `,
          });
        } catch (err) {
          console.error("[Team] Failed to send invitation email:", err);
          // Invitation is still created, just email failed
        }

        return { success: true, email, expiresAt };
      }),

    // Revoke a pending invitation (admin only)
    revokeInvitation: adminProcedure
      .input(z.object({ invitationId: z.number() }))
      .mutation(async ({ input }) => {
        await revokeInvitation(input.invitationId);
        return { success: true };
      }),

    // Change a team member's role (admin only)
    changeRole: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          role: z.enum(["admin", "manager", "member"]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // Prevent self-demotion
        if (input.userId === ctx.user.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You cannot change your own role",
          });
        }
        await changeUserRole(input.userId, input.role);
        return { success: true };
      }),

    // Remove a team member (admin only)
    removeMember: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        // Prevent self-removal
        if (input.userId === ctx.user.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You cannot remove yourself",
          });
        }
        await removeTeamMember(input.userId);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
