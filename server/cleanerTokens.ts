/**
 * Cleaner Dashboard Token Management
 *
 * Generates and manages unique tokens for cleaner public dashboard URLs.
 * Each cleaner gets a unique token like: /cleaner/abc123def456
 * No authentication required — the token IS the auth.
 */

import { randomBytes } from "crypto";
import { eq, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { cleaners } from "../drizzle/schema";

/**
 * Generate a cryptographically random token (URL-safe).
 */
export function generateToken(length = 24): string {
  return randomBytes(length).toString("base64url").slice(0, length);
}

/**
 * Ensure a cleaner has a dashboard token. If not, generate one.
 */
export async function ensureCleanerToken(cleanerId: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [cleaner] = await db.select().from(cleaners).where(eq(cleaners.id, cleanerId));
  if (!cleaner) throw new Error("Cleaner not found");

  if (cleaner.dashboardToken) return cleaner.dashboardToken;

  // Generate a new unique token
  let token: string;
  let attempts = 0;
  do {
    token = generateToken();
    const existing = await db
      .select()
      .from(cleaners)
      .where(eq(cleaners.dashboardToken, token));
    if (existing.length === 0) break;
    attempts++;
  } while (attempts < 10);

  if (attempts >= 10) throw new Error("Failed to generate unique token");

  await db
    .update(cleaners)
    .set({ dashboardToken: token })
    .where(eq(cleaners.id, cleanerId));

  return token;
}

/**
 * Generate tokens for all cleaners that don't have one yet.
 */
export async function generateAllMissingTokens(): Promise<{
  generated: number;
  errors: string[];
}> {
  const db = await getDb();
  if (!db) return { generated: 0, errors: ["Database not available"] };

  const cleanersWithoutTokens = await db
    .select()
    .from(cleaners)
    .where(isNull(cleaners.dashboardToken));

  let generated = 0;
  const errors: string[] = [];

  for (const cleaner of cleanersWithoutTokens) {
    try {
      await ensureCleanerToken(cleaner.id);
      generated++;
    } catch (err: any) {
      errors.push(`Cleaner ${cleaner.name}: ${err.message}`);
    }
  }

  return { generated, errors };
}

/**
 * Get a cleaner by their dashboard token.
 */
export async function getCleanerByToken(token: string) {
  const db = await getDb();
  if (!db) return null;

  const [cleaner] = await db
    .select()
    .from(cleaners)
    .where(eq(cleaners.dashboardToken, token));

  return cleaner ?? null;
}

/**
 * Regenerate a cleaner's dashboard token (e.g., if compromised).
 */
export async function regenerateToken(cleanerId: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Clear existing token
  await db
    .update(cleaners)
    .set({ dashboardToken: null })
    .where(eq(cleaners.id, cleanerId));

  // Generate new one
  return ensureCleanerToken(cleanerId);
}
