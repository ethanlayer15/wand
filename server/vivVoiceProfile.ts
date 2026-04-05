/**
 * Viv Voice Profile — scan sent emails, build AI writing style profile,
 * integrate into draft replies, learn from user edits.
 */
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { vivVoiceProfile, vivDraftCorrections } from "../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { fetchEmailList } from "./gmail";

// ── Types ──────────────────────────────────────────────────────────────

export interface VoiceProfileData {
  greetingStyle: string;
  tone: string;
  signOffStyle: string;
  commonPhrases: string[];
  topicPatterns: Record<string, string>;
  levelOfDetail: string;
  personalityTraits: string[];
  systemPrompt: string;
}

// ── Scan Sent Emails ───────────────────────────────────────────────────

/**
 * Fetch sent emails from Gmail's Sent folder.
 * Returns a list of email objects suitable for voice analysis.
 */
export async function scanSentEmails(limit = 75): Promise<Array<{
  subject: string;
  to: string;
  snippet: string;
  date: string;
}>> {
  try {
    // Try "[Gmail]/Sent Mail" first (standard Gmail), fall back to "Sent"
    let sentEmails: Awaited<ReturnType<typeof fetchEmailList>> | null = null;

    for (const folder of ["[Gmail]/Sent Mail", "Sent", "SENT", "Sent Items"]) {
      try {
        sentEmails = await fetchEmailList(folder, limit, 0);
        if (sentEmails.emails.length > 0) {
          console.log(`[VoiceProfile] Found ${sentEmails.emails.length} sent emails in "${folder}"`);
          break;
        }
      } catch (e: any) {
        console.log(`[VoiceProfile] Folder "${folder}" not accessible:`, e.message);
      }
    }

    if (!sentEmails || sentEmails.emails.length === 0) {
      console.log("[VoiceProfile] No sent emails found");
      return [];
    }

    return sentEmails.emails.map((e) => ({
      subject: e.subject || "(no subject)",
      to: e.to?.map((t) => t.address || t.name || "").filter(Boolean).join(", ") || "unknown",
      snippet: e.snippet || "",
      date: e.date || "",
    }));
  } catch (e: any) {
    console.error("[VoiceProfile] Failed to scan sent emails:", e.message);
    return [];
  }
}

// ── Build Voice Profile ────────────────────────────────────────────────

/**
 * Analyze sent emails with AI to extract writing style profile.
 */
export async function buildVoiceProfileFromEmails(
  emails: Array<{ subject: string; to: string; snippet: string; date: string }>
): Promise<VoiceProfileData | null> {
  if (emails.length === 0) return null;

  // Format emails for analysis — take the most informative ones
  const emailSamples = emails
    .filter((e) => e.snippet && e.snippet.length > 30)
    .slice(0, 60)
    .map((e, i) => `--- Email ${i + 1} ---\nTo: ${e.to}\nSubject: ${e.subject}\nContent: ${e.snippet.slice(0, 400)}`)
    .join("\n\n");

  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are an expert writing style analyst. You analyze a person's sent emails to extract their unique communication style and voice. 
Your goal is to create a detailed writing style profile that can be used to generate AI draft replies that sound exactly like the person wrote them.
Return valid JSON only.`,
        },
        {
          role: "user",
          content: `Analyze these sent emails from a short-term rental property manager (Ethan at Leisr Stays). Extract their unique writing voice and style:

${emailSamples}

Return a JSON profile with:
- greetingStyle: how they typically open emails (e.g., "Hey [FirstName]", "Hi [Name]", "Hello", etc.)
- tone: overall communication tone (e.g., "warm and professional", "direct and efficient", "friendly and casual")
- signOffStyle: how they typically close emails (e.g., "Thanks, Ethan", "Best,", "Cheers,")
- commonPhrases: array of 5-10 phrases or expressions they frequently use
- topicPatterns: object mapping topics to how they handle them. Keys: "payouts", "maintenance", "scheduling", "complaints", "bookings", "general". Values: brief description of their approach for each topic.
- levelOfDetail: how much detail they typically include (e.g., "concise and to the point", "thorough with context", "brief bullet points")
- personalityTraits: array of 3-5 personality traits evident in their writing (e.g., "responsive", "solution-oriented", "empathetic")
- systemPrompt: a ready-to-use system prompt (2-4 paragraphs) that instructs an AI to write exactly like this person. Include specific examples of their language, tone, and patterns. This will be injected into every AI draft reply.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "voice_profile",
          strict: true,
          schema: {
            type: "object",
            properties: {
              greetingStyle: { type: "string" },
              tone: { type: "string" },
              signOffStyle: { type: "string" },
              commonPhrases: { type: "array", items: { type: "string" } },
              topicPatterns: {
                type: "object",
                properties: {
                  payouts: { type: "string" },
                  maintenance: { type: "string" },
                  scheduling: { type: "string" },
                  complaints: { type: "string" },
                  bookings: { type: "string" },
                  general: { type: "string" },
                },
                required: ["payouts", "maintenance", "scheduling", "complaints", "bookings", "general"],
                additionalProperties: false,
              },
              levelOfDetail: { type: "string" },
              personalityTraits: { type: "array", items: { type: "string" } },
              systemPrompt: { type: "string" },
            },
            required: ["greetingStyle", "tone", "signOffStyle", "commonPhrases", "topicPatterns", "levelOfDetail", "personalityTraits", "systemPrompt"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = result.choices[0]?.message?.content;
    if (typeof content === "string") {
      return JSON.parse(content) as VoiceProfileData;
    }
  } catch (e: any) {
    console.error("[VoiceProfile] AI analysis failed:", e.message);
  }

  return null;
}

// ── DB Helpers ─────────────────────────────────────────────────────────

/**
 * Get the current voice profile from DB.
 */
export async function getVoiceProfile(): Promise<{
  id: number;
  profile: VoiceProfileData;
  sampleCount: number;
  lastUpdated: Date;
} | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(vivVoiceProfile)
    .orderBy(desc(vivVoiceProfile.lastUpdated))
    .limit(1);

  if (rows.length === 0) return null;

  return {
    id: rows[0].id,
    profile: rows[0].profile as VoiceProfileData,
    sampleCount: rows[0].sampleCount || 0,
    lastUpdated: rows[0].lastUpdated,
  };
}

/**
 * Save or update the voice profile in DB.
 */
export async function saveVoiceProfile(profile: VoiceProfileData, sampleCount: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Check if profile exists
  const existing = await db.select({ id: vivVoiceProfile.id }).from(vivVoiceProfile).limit(1);

  if (existing.length > 0) {
    await db.update(vivVoiceProfile)
      .set({ profile, sampleCount, lastUpdated: new Date() })
      .where(eq(vivVoiceProfile.id, existing[0].id));
  } else {
    await db.insert(vivVoiceProfile).values({ profile, sampleCount, lastUpdated: new Date() });
  }
}

/**
 * Save a draft correction (original AI draft vs user-edited version).
 */
export async function saveDraftCorrection(opts: {
  originalDraft: string;
  editedDraft: string;
  emailSubject?: string;
  emailFrom?: string;
  emailSnippet?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Only save if there's a meaningful difference
  if (opts.originalDraft.trim() === opts.editedDraft.trim()) return;

  await db.insert(vivDraftCorrections).values({
    originalDraft: opts.originalDraft,
    editedDraft: opts.editedDraft,
    emailSubject: opts.emailSubject,
    emailFrom: opts.emailFrom,
    emailSnippet: opts.emailSnippet,
  });
}

/**
 * Get the voice profile system prompt for use in AI draft replies.
 * Returns a default prompt if no profile has been built yet.
 */
export async function getVoiceSystemPrompt(): Promise<string> {
  const profile = await getVoiceProfile();

  if (profile?.profile?.systemPrompt) {
    return profile.profile.systemPrompt;
  }

  // Default prompt if no voice profile has been built yet
  return `You are drafting email replies on behalf of Ethan at Leisr Stays, a short-term rental property management company.
Write in a warm, professional, and direct tone. Be concise but thorough. 
Sign off as "Ethan" or "Ethan | Leisr Stays" depending on context.
Focus on being helpful, solution-oriented, and responsive.`;
}

/**
 * Full pipeline: scan sent emails → build profile → save to DB.
 */
export async function runVoiceProfileBuild(): Promise<{
  success: boolean;
  sampleCount: number;
  profile?: VoiceProfileData;
  error?: string;
}> {
  console.log("[VoiceProfile] Starting voice profile build...");

  // 1. Scan sent emails
  const sentEmails = await scanSentEmails(80);
  if (sentEmails.length === 0) {
    return { success: false, sampleCount: 0, error: "No sent emails found. Make sure the Gmail account has sent emails." };
  }

  console.log(`[VoiceProfile] Analyzing ${sentEmails.length} sent emails...`);

  // 2. Build profile with AI
  const profile = await buildVoiceProfileFromEmails(sentEmails);
  if (!profile) {
    return { success: false, sampleCount: sentEmails.length, error: "AI analysis failed. Please try again." };
  }

  // 3. Save to DB
  await saveVoiceProfile(profile, sentEmails.length);

  console.log("[VoiceProfile] Voice profile built and saved successfully");
  return { success: true, sampleCount: sentEmails.length, profile };
}
