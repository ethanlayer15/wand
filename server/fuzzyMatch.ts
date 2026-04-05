/**
 * Fuzzy matching utilities for auto-mapping Breezeway properties to Stripe customers.
 *
 * Scoring strategy:
 *  1. Exact normalised match → 1.0
 *  2. One string contains the other → 0.85
 *  3. Token overlap (Dice coefficient on significant words) → 0.0–0.8
 *  4. Bigram similarity (character-level) → 0.0–0.6
 *
 * Final score = max(containsScore, 0.6 * tokenScore + 0.4 * bigramScore)
 * Confidence bands:
 *   ≥ 0.70  → "high"
 *   ≥ 0.40  → "possible"
 *   < 0.40  → no suggestion
 */

// Words too common to be useful for matching
const STOP_WORDS = new Set([
  "the", "and", "llc", "inc", "co", "corp", "ltd", "at", "of", "in", "on",
  "for", "a", "an", "no", "pets", "new", "unit", "all", "check", "out",
  "am", "pm", "str", "bnb",
]);

/** Lowercase, strip punctuation, collapse whitespace */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract significant words (length > 1, not in stop list) */
export function significantTokens(s: string): string[] {
  return normalise(s)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** Dice coefficient on two token sets */
function tokenDice(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let overlap = 0;
  for (const w of a) {
    if (setB.has(w)) overlap++;
  }
  return (2 * overlap) / (a.length + b.length);
}

/** Character bigram set */
function bigrams(s: string): Set<string> {
  const norm = normalise(s);
  const bg = new Set<string>();
  for (let i = 0; i < norm.length - 1; i++) {
    bg.add(norm.slice(i, i + 2));
  }
  return bg;
}

/** Dice coefficient on character bigrams */
function bigramDice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  Array.from(a).forEach((bg) => {
    if (b.has(bg)) overlap++;
  });
  return (2 * overlap) / (a.size + b.size);
}

export type ConfidenceLevel = "high" | "possible";

export interface MatchSuggestion {
  breezewayPropertyId: string;
  breezewayPropertyName: string;
  stripeCustomerId: string;
  stripeCustomerName: string;
  stripeCustomerEmail: string | null;
  score: number;
  confidence: ConfidenceLevel;
}

interface BreezewayProp {
  id: string;
  name: string;
}

interface StripeCustomer {
  id: string;
  name: string | null;
  email: string | null;
}

/**
 * Score how well a Breezeway property name matches a Stripe customer name/email.
 * Returns a value between 0 and 1.
 */
export function matchScore(bwName: string, scName: string): number {
  const normBw = normalise(bwName);
  const normSc = normalise(scName);

  // Exact
  if (normBw === normSc) return 1.0;

  // Contains (one fully inside the other)
  if (normBw.length >= 3 && normSc.length >= 3) {
    if (normSc.includes(normBw) || normBw.includes(normSc)) return 0.85;
  }

  // Token overlap + bigram similarity
  const tokBw = significantTokens(bwName);
  const tokSc = significantTokens(scName);
  const tScore = tokenDice(tokBw, tokSc);
  const bScore = bigramDice(bigrams(bwName), bigrams(scName));

  return 0.6 * tScore + 0.4 * bScore;
}

/**
 * Given Breezeway properties and Stripe customers, produce ranked match suggestions.
 * Excludes properties that already have a mapping (by breezewayOwnerId).
 */
export function autoMapSuggestions(
  properties: BreezewayProp[],
  customers: StripeCustomer[],
  existingMappedIds: Set<string>
): MatchSuggestion[] {
  const suggestions: MatchSuggestion[] = [];

  for (const prop of properties) {
    // Skip already-mapped properties
    if (existingMappedIds.has(prop.id)) continue;

    let bestScore = 0;
    let bestCustomer: StripeCustomer | null = null;

    for (const cust of customers) {
      // Match against customer name
      const nameStr = cust.name || "";
      if (!nameStr) continue;

      const score = matchScore(prop.name, nameStr);

      // Also try matching against email prefix (before @)
      let emailScore = 0;
      if (cust.email) {
        const emailPrefix = cust.email.split("@")[0].replace(/[._-]/g, " ");
        emailScore = matchScore(prop.name, emailPrefix) * 0.7; // discount email matches
      }

      const finalScore = Math.max(score, emailScore);

      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestCustomer = cust;
      }
    }

    if (bestCustomer && bestScore >= 0.40) {
      suggestions.push({
        breezewayPropertyId: prop.id,
        breezewayPropertyName: prop.name,
        stripeCustomerId: bestCustomer.id,
        stripeCustomerName: bestCustomer.name || "Unnamed",
        stripeCustomerEmail: bestCustomer.email,
        score: Math.round(bestScore * 100) / 100,
        confidence: bestScore >= 0.70 ? "high" : "possible",
      });
    }
  }

  // Sort by score descending
  suggestions.sort((a, b) => b.score - a.score);
  return suggestions;
}
