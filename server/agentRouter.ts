/**
 * Wand AI Agents — tRPC Router
 *
 * Endpoints:
 *   - agent.chat            Run Claude with the full tool catalog
 *   - agent.listSuggestions List Ops Inbox suggestions (filter by status/agent)
 *   - agent.getSuggestion   Fetch a single suggestion with full payload
 *   - agent.approve         Approve + execute a suggestion
 *   - agent.dismiss         Dismiss a suggestion
 *   - agent.snooze          Snooze a suggestion until a given timestamp
 *   - agent.pendingCount    Sidebar badge count
 *   - agent.runReviewDrafter Manually trigger the review reply drafter
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, managerProcedure, router } from "./_core/trpc";
import { runAgent, type ChatMessage } from "./agent/runner";
import {
  countPendingSuggestions,
  getSuggestionById,
  listSuggestions,
  updateSuggestionStatus,
} from "./agent/agentDb";
import { executeSuggestion } from "./agent/executors";
import { runReviewDrafter } from "./agent/reviewDrafter";
import { getDb } from "./db";
import { agentSuggestions } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const suggestionStatusSchema = z.enum([
  "pending",
  "approved",
  "dismissed",
  "edited",
  "snoozed",
  "executed",
  "failed",
]);

export const agentRouter = router({
  /**
   * Run a single turn with Claude using the full Wand tool catalog.
   *
   * Input: the full chat history so far (last message must be from user).
   * Output: the new assistant message + a trail of tool calls Claude made.
   */
  chat: protectedProcedure
    .input(
      z.object({
        messages: z.array(chatMessageSchema).min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const last = input.messages[input.messages.length - 1];
      if (!last || last.role !== "user") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Last message must be from 'user'",
        });
      }

      try {
        const result = await runAgent({
          user: ctx.user,
          agentName: "chat",
          triggeredBy: "chat",
          messages: input.messages as ChatMessage[],
        });
        return {
          runId: result.runId,
          reply: result.finalText,
          toolCalls: result.toolCalls.map((t) => ({
            name: t.name,
            success: t.success,
            durationMs: t.durationMs,
          })),
          stopReason: result.stopReason,
          iterations: result.iterations,
          usage: result.usage ?? null,
        };
      } catch (err: any) {
        console.error("[AgentRouter] chat failed:", err?.message ?? err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message ?? "Agent run failed",
        });
      }
    }),

  /**
   * List suggestions in the Ops Inbox.
   */
  listSuggestions: protectedProcedure
    .input(
      z
        .object({
          status: suggestionStatusSchema.optional(),
          agentName: z.string().optional(),
          limit: z.number().min(1).max(500).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const rows = await listSuggestions({
        status: input?.status,
        agentName: input?.agentName,
        limit: input?.limit,
      });
      return { suggestions: rows, count: rows.length };
    }),

  /**
   * Get a single suggestion with its full proposed action payload.
   */
  getSuggestion: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const suggestion = await getSuggestionById(input.id);
      if (!suggestion) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Suggestion ${input.id} not found`,
        });
      }
      return { suggestion };
    }),

  /**
   * Approve a suggestion and execute its side effects.
   * For review_reply: saves the draft to the review record.
   */
  approve: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        notes: z.string().optional(),
        editedContent: z.string().optional(), // allow editing the draft before approval
      })
    )
    .mutation(async ({ input, ctx }) => {
      await updateSuggestionStatus(
        input.id,
        "approved",
        ctx.user.id,
        input.notes
      );
      // Execute the suggestion's side effects
      const execResult = await executeSuggestion(input.id, input.editedContent);
      return {
        success: execResult.success,
        id: input.id,
        status: "approved" as const,
        executionMessage: execResult.message,
      };
    }),

  /**
   * Dismiss a suggestion (ops decided not to act on it).
   */
  dismiss: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await updateSuggestionStatus(
        input.id,
        "dismissed",
        ctx.user.id,
        input.notes
      );
      return { success: true, id: input.id, status: "dismissed" as const };
    }),

  /**
   * Snooze a suggestion until a given ISO timestamp.
   */
  snooze: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        snoozedUntil: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      }
      await db
        .update(agentSuggestions)
        .set({
          status: "snoozed",
          snoozedUntil: new Date(input.snoozedUntil),
          reviewedBy: ctx.user.id,
          reviewedAt: new Date(),
        } as any)
        .where(eq(agentSuggestions.id, input.id));
      return { success: true, id: input.id, status: "snoozed" as const };
    }),

  /**
   * Lightweight count for the sidebar badge.
   */
  pendingCount: protectedProcedure.query(async () => {
    const count = await countPendingSuggestions();
    return { count };
  }),

  /**
   * Manually trigger the review reply drafter.
   * Finds unreplied reviews, drafts responses, and queues suggestions.
   */
  runReviewDrafter: managerProcedure
    .input(z.object({ limit: z.number().min(1).max(50).optional() }).optional())
    .mutation(async ({ input }) => {
      const result = await runReviewDrafter(input?.limit ?? 10);
      return result;
    }),
});
