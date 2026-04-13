/**
 * Duplicate task detection — fuzzy-matches a task against all active board
 * tasks plus recently archived tasks (completed, ignored, ideas_for_later
 * within the last 14 days).
 *
 * Uses title + description similarity via token/bigram matching, scoped
 * to the same property when possible.
 */

import { eq, and, gte, or, inArray } from "drizzle-orm";
import { tasks } from "../drizzle/schema";
import { getDb } from "./db";
import { normalise, significantTokens } from "./fuzzyMatch";

// ── Fuzzy matching tuned for task titles ────────────────────────────────

const TASK_STOP_WORDS = new Set([
  "the", "and", "a", "an", "at", "of", "in", "on", "for", "to", "is",
  "was", "are", "from", "with", "by", "not", "but", "or", "has", "had",
  "that", "this", "it", "be", "been", "being", "have", "do", "does",
  "guest", "review", "message", "question", "other", "reported",
  "about", "their", "property", "cabin", "house", "home",
]);

function taskTokens(s: string): string[] {
  return normalise(s)
    .split(" ")
    .filter((w) => w.length > 2 && !TASK_STOP_WORDS.has(w));
}

function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let overlap = 0;
  for (const w of a) {
    if (setB.has(w)) overlap++;
  }
  return (2 * overlap) / (a.length + b.length);
}

function bigramSet(s: string): Set<string> {
  const norm = normalise(s);
  const bg = new Set<string>();
  for (let i = 0; i < norm.length - 1; i++) {
    bg.add(norm.slice(i, i + 2));
  }
  return bg;
}

function bigramSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const bg of a) {
    if (b.has(bg)) overlap++;
  }
  return (2 * overlap) / (a.size + b.size);
}

function taskSimilarity(titleA: string, titleB: string, descA?: string | null, descB?: string | null): number {
  // Title similarity (primary signal)
  const normA = normalise(titleA);
  const normB = normalise(titleB);

  // Exact title match
  if (normA === normB) return 1.0;

  // One contains the other
  if (normA.length >= 4 && normB.length >= 4) {
    if (normA.includes(normB) || normB.includes(normA)) return 0.9;
  }

  // Token + bigram on titles
  const tokA = taskTokens(titleA);
  const tokB = taskTokens(titleB);
  const titleTokenScore = tokenOverlap(tokA, tokB);
  const titleBigramScore = bigramSimilarity(bigramSet(titleA), bigramSet(titleB));
  let titleScore = 0.6 * titleTokenScore + 0.4 * titleBigramScore;

  // Boost with description similarity if available
  let descScore = 0;
  if (descA && descB) {
    // Extract just the summary/issues lines, not the full message body
    const extractKey = (d: string) => {
      const lines = d.split("\n").slice(0, 3).join(" ");
      return lines.slice(0, 200);
    };
    const dA = extractKey(descA);
    const dB = extractKey(descB);
    const descTokens = tokenOverlap(taskTokens(dA), taskTokens(dB));
    descScore = descTokens;
  }

  // Combined: title is primary, description is secondary boost
  return Math.min(1.0, titleScore * 0.75 + descScore * 0.25);
}

// ── Main API ────────────────────────────────────────────────────────────

export interface DuplicateCandidate {
  id: number;
  title: string;
  status: string;
  source: string;
  listingId: number | null;
  listingName?: string;
  createdAt: string;
  similarity: number;
  confidence: "high" | "possible";
  reason: string;
}

const ACTIVE_STATUSES = ["created", "needs_review", "up_next", "in_progress"] as const;
const ARCHIVED_STATUSES = ["completed", "ignored", "ideas_for_later"] as const;

export async function findDuplicateTasks(taskId: number): Promise<DuplicateCandidate[]> {
  const db = await getDb();
  if (!db) return [];

  // Get the target task
  const [target] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!target) return [];

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  // Get candidate tasks: all active + recently archived
  const candidates = await db
    .select()
    .from(tasks)
    .where(
      or(
        // All active board tasks
        inArray(tasks.status, [...ACTIVE_STATUSES]),
        // Recently archived tasks (last 14 days)
        and(
          inArray(tasks.status, [...ARCHIVED_STATUSES]),
          gte(tasks.updatedAt, fourteenDaysAgo)
        )
      )
    );

  const results: DuplicateCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.id === taskId) continue;

    // Same property boost: tasks at the same listing are much more likely duplicates
    const sameProperty = target.listingId && candidate.listingId && target.listingId === candidate.listingId;

    const sim = taskSimilarity(
      target.title || "",
      candidate.title || "",
      target.description,
      candidate.description
    );

    // Apply thresholds — lower threshold for same property
    const threshold = sameProperty ? 0.25 : 0.45;
    const highThreshold = sameProperty ? 0.40 : 0.60;

    if (sim < threshold) continue;

    // Also check time proximity — tasks created >30 days apart are less likely duplicates
    const daysDiff = Math.abs(
      new Date(target.createdAt).getTime() - new Date(candidate.createdAt).getTime()
    ) / (1000 * 60 * 60 * 24);
    if (daysDiff > 30) continue;

    const confidence: "high" | "possible" = sim >= highThreshold ? "high" : "possible";

    // Build reason string
    const reasons: string[] = [];
    if (sameProperty) reasons.push("same property");
    if (target.source !== candidate.source) reasons.push("different source");
    if (sim >= 0.7) reasons.push("very similar title");
    else if (sim >= 0.4) reasons.push("similar title");
    if (ARCHIVED_STATUSES.includes(candidate.status as any)) {
      reasons.push(candidate.status === "completed" ? "already done" : candidate.status === "ignored" ? "previously ignored" : "in ideas");
    }

    results.push({
      id: candidate.id,
      title: candidate.title || "",
      status: candidate.status,
      source: candidate.source || "unknown",
      listingId: candidate.listingId,
      createdAt: candidate.createdAt?.toISOString?.() ?? String(candidate.createdAt),
      similarity: Math.round(sim * 100) / 100,
      confidence,
      reason: reasons.join(", "),
    });
  }

  // Sort by similarity descending, take top 5
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, 5);
}
