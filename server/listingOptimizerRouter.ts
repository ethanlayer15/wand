import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";

const EXAMPLE_FORMAT = `
Title example: "10 min to Asheville | Creekside, Fire Table, Games"

Description format (use exactly these section headers):
ABOUT THIS SPACE:
[2-3 sentence hook paragraph about the property's story and vibe]
✦ [Key feature 1]
✦ [Key feature 2]
✦ [Key feature 3]
✦ [Key feature 4]
✦ [Key feature 5]

THE SPACE:
[1-2 sentences describing the setting, style, and atmosphere]
✦ [Nearby attraction] – [X] minutes
✦ [Nearby attraction] – [X] minutes
✦ [Nearby attraction] – [X] minutes
✦ [Nearby attraction] – [X] minutes
✦ [Nearby attraction] – [X] minutes
✦ [Nearby attraction] – [X] minutes
✦ [Nearby attraction] – [X] minutes
✦ [Nearby attraction] – [X] minutes
✦ [Nearby attraction] – [X] minutes
✦ [Nearby attraction] – [X] minutes

GUEST ACCESS:
[Short paragraph about what guests can access]

OTHER THINGS TO NOTE:
- [Note 1]
- [Note 2]
- [Note 3]
`.trim();

async function scrapeAirbnbListing(url: string): Promise<{ title: string; description: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;
    const html = await res.text();

    // Strategy 1: JSON-LD structured data (most stable)
    const ldMatches = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of ldMatches) {
      try {
        const data = JSON.parse(match[1]);
        const candidates = Array.isArray(data) ? data : [data];
        for (const item of candidates) {
          if (item.name && item.description) {
            return { title: item.name, description: item.description };
          }
        }
      } catch { /* skip malformed */ }
    }

    // Strategy 2: __NEXT_DATA__ JSON blob
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      try {
        const json = JSON.parse(nextDataMatch[1]);
        const str = JSON.stringify(json);

        // Pull the listing name from common paths
        const nameVal =
          deepGet(json, ["props", "pageProps", "listing", "name"]) ??
          deepGet(json, ["props", "pageProps", "listingTitle"]) ??
          extractJsonValue(str, "listingTitle") ??
          extractJsonValue(str, "pdpTitle");

        // Pull description — Airbnb stores it across multiple "sections"
        const descVal =
          deepGet(json, ["props", "pageProps", "listing", "description"]) ??
          extractJsonValue(str, "htmlDescription") ??
          extractJsonValue(str, "descriptionItems");

        if (nameVal || descVal) {
          return {
            title: String(nameVal ?? ""),
            description: Array.isArray(descVal) ? descVal.join("\n") : String(descVal ?? ""),
          };
        }
      } catch { /* skip */ }
    }

    // Strategy 3: <title> tag as last-resort name
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch?.[1]?.replace(/ - Airbnb$/, "").trim() ?? "";
    if (pageTitle) return { title: pageTitle, description: "" };

    return null;
  } catch {
    return null;
  }
}

function deepGet(obj: any, path: string[]): any {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur ?? undefined;
}

function extractJsonValue(str: string, key: string): string | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = str.match(re);
  return m ? m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : undefined;
}

export const listingOptimizerRouter = router({
  fetchListing: protectedProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      // Normalize: ensure it's an airbnb.com URL
      if (!input.url.includes("airbnb.com")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Please paste an Airbnb listing URL" });
      }
      const data = await scrapeAirbnbListing(input.url);
      if (!data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Couldn't read the listing — Airbnb may have blocked the request. Paste the content manually.",
        });
      }
      return data;
    }),

  generate: protectedProcedure
    .input(
      z.object({
        projectId: z.number().optional(),
        address: z.string().min(1).max(500),
        propertyName: z.string().max(200).optional(),
        amenities: z.array(z.string()).max(30),
        extraNotes: z.string().max(1000).optional(),
        draftTitle: z.string().max(200).optional(),
        draftDescription: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (!ENV.anthropicApiKey) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI service not configured" });
      }

      const client = new Anthropic({ apiKey: ENV.anthropicApiKey });

      const propertyLabel = input.propertyName
        ? `"${input.propertyName}" at ${input.address}`
        : input.address;

      const amenitiesText =
        input.amenities.length > 0 ? input.amenities.join(", ") : "No amenities specified";

      const hasDraft = input.draftTitle || input.draftDescription;
      const draftSection = hasDraft
        ? `\nSeth's rough draft to improve upon:\nTitle: ${input.draftTitle ?? "(none)"}\nDescription: ${input.draftDescription ?? "(none)"}\n`
        : "";

      const extraNotesText = input.extraNotes
        ? `\nAdditional context: ${input.extraNotes}`
        : "";

      const draftInstruction = hasDraft
        ? "You have Seth's rough draft above. Use it as the factual foundation — keep any specific details, distances, or features mentioned — but rewrite everything in the polished style described below."
        : "Research the top 10 most popular attractions/places near this address and estimate realistic drive times.";

      const prompt = `You are an expert Airbnb copywriter for Leisr Stays, a premium short-term rental operator. ${hasDraft ? "Optimize this existing draft listing" : "Generate a high-converting Airbnb listing"} for this property.

Property: ${propertyLabel}
Amenities: ${amenitiesText}${draftSection}${extraNotesText}

Instructions:
1. ${draftInstruction}
2. Write an Airbnb-optimized listing using the exact format below.
3. Title must be ≤50 characters. Use the format: "[X] min to [Nearest Major City] | [Unique Feature], [Feature]"
4. Each section should be ~400-500 characters (Airbnb's limits).
5. Use ✦ for bullet points (not • or -).
6. Write in a warm, inviting, aspirational tone. Lead with the experience, not the features.
7. Make the "About this space" hook paragraph feel personal and story-like.
8. "The space" section should paint a picture of the setting before listing nearby attractions.
9. "Guest access" should be welcoming and clear.
10. "Other things to note" should use dashes and cover practical info (check-in, pets, parking, etc.).

${EXAMPLE_FORMAT}

Respond with ONLY the listing content in the exact format shown above. No preamble, no explanation.`;

      let rawText = "";
      try {
        const response = await client.messages.create({
          model: ENV.anthropicModel,
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        });
        rawText =
          response.content
            .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("") ?? "";
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `AI generation failed: ${err.message}`,
        });
      }

      return parseListingOutput(rawText);
    }),
});

function parseListingOutput(raw: string): {
  title: string;
  aboutThisSpace: string;
  theSpace: string;
  guestAccess: string;
  otherThingsToNote: string;
  raw: string;
} {
  const lines = raw.split("\n");

  const title = lines.find((l) => l.trim().length > 0)?.trim() ?? "";

  function extractSection(header: string): string {
    const headerUpper = header.toUpperCase();
    const start = lines.findIndex((l) => l.toUpperCase().includes(headerUpper));
    if (start === -1) return "";
    const end = lines.findIndex(
      (l, i) =>
        i > start + 1 &&
        (l.toUpperCase().includes("ABOUT THIS SPACE:") ||
          l.toUpperCase().includes("THE SPACE:") ||
          l.toUpperCase().includes("GUEST ACCESS:") ||
          l.toUpperCase().includes("OTHER THINGS TO NOTE:")),
    );
    const slice = end === -1 ? lines.slice(start + 1) : lines.slice(start + 1, end);
    return slice.join("\n").trim();
  }

  return {
    title,
    aboutThisSpace: extractSection("ABOUT THIS SPACE:"),
    theSpace: extractSection("THE SPACE:"),
    guestAccess: extractSection("GUEST ACCESS:"),
    otherThingsToNote: extractSection("OTHER THINGS TO NOTE:"),
    raw,
  };
}
