/**
 * POD Auto-Assignment Logic
 *
 * Maps property locations (city + state) to the 8 known geographic PODs.
 * Returns a confidence level for each match:
 *   - "high"   → clear, unambiguous match
 *   - "low"    → possible match but location is ambiguous or on a boundary
 *   - "random" → no geographic match → assign to "Random" pod
 *
 * POD definitions (from the app):
 *   Boone           → Boone / Watauga County, NC
 *   Lynchburg       → Lynchburg, VA area
 *   Ocean Lakes     → Ocean Lakes / Myrtle Beach, SC
 *   Random          → Catch-all for one-off properties
 *   Smith Mountain Lake → Smith Mountain Lake, VA area
 *   WNC - AVL       → Asheville, NC metro area
 *   WNC - East      → Black Mountain, NC area
 *   WNC - West      → Sylva / Jackson County, NC
 */

export type PodMatchConfidence = "high" | "low" | "random";

export interface PodAssignment {
  listingId: number;
  podName: string;       // name of the matched pod
  confidence: PodMatchConfidence;
  reason: string;        // human-readable explanation
}

/**
 * Normalise a string for comparison: lowercase, trim, collapse spaces.
 */
function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Check if a string contains any of the given keywords (case-insensitive).
 */
function contains(haystack: string, ...needles: string[]): boolean {
  const h = norm(haystack);
  return needles.some((n) => h.includes(norm(n)));
}

/**
 * Determine which POD a property belongs to based on city + state.
 * Returns the POD name (matching pods.name in the DB) and a confidence level.
 */
export function classifyPropertyToPod(
  city: string | null | undefined,
  state: string | null | undefined,
  address: string | null | undefined = null
): { podName: string; confidence: PodMatchConfidence; reason: string } {
  const c = norm(city);
  const s = norm(state);
  const a = norm(address);
  const full = [c, s, a].filter(Boolean).join(" ");

  // ── South Carolina → Ocean Lakes ────────────────────────────────────
  if (s === "sc" || s === "south carolina") {
    if (contains(full, "myrtle beach", "ocean lakes", "surfside", "garden city",
                       "pawleys island", "conway", "loris", "little river", "north myrtle beach",
                       "longs", "aynor", "horry")) {
      return { podName: "Ocean Lakes", confidence: "high", reason: `SC coastal: ${city}` };
    }
    // Any other SC city — still likely Ocean Lakes territory
    return { podName: "Ocean Lakes", confidence: "low", reason: `SC property (${city}) — assumed Ocean Lakes` };
  }

  // ── Virginia → Lynchburg or Smith Mountain Lake ──────────────────────
  if (s === "va" || s === "virginia") {
    // Smith Mountain Lake area
    if (contains(full, "moneta", "huddleston", "hardy", "smith mountain lake",
                       "penhook", "burnt chimney", "henry", "bedford", "boones mill",
                       "rocky mount", "wirtz")) {
      return { podName: "Smith Mountain Lake", confidence: "high", reason: `SML area: ${city}` };
    }
    // Lynchburg area
    if (contains(full, "lynchburg", "forest", "rustburg", "amherst", "appomattox",
                       "madison heights", "altavista", "campbell", "liberty")) {
      return { podName: "Lynchburg", confidence: "high", reason: `Lynchburg area: ${city}` };
    }
    // Roanoke — closer to SML or Lynchburg; call it low confidence Lynchburg
    if (contains(full, "roanoke", "salem", "vinton")) {
      return { podName: "Lynchburg", confidence: "low", reason: `Roanoke area (${city}) — may be Lynchburg or SML` };
    }
    // Any other VA city — low confidence, assign to Lynchburg as nearest known VA pod
    return { podName: "Lynchburg", confidence: "low", reason: `VA property (${city}) — assumed Lynchburg` };
  }

  // ── North Carolina ────────────────────────────────────────────────────
  if (s === "nc" || s === "north carolina") {
    // Boone / Watauga County
    if (contains(full, "boone", "blowing rock", "banner elk", "beech mountain",
                       "newland", "linville", "sugar mountain", "seven devils",
                       "valle crucis", "deep gap", "watauga", "avery", "caldwell",
                       "lenoir", "morganton", "hickory", "hudson", "granite falls")) {
      return { podName: "Boone", confidence: "high", reason: `Boone/High Country area: ${city}` };
    }

    // WNC - AVL: Asheville metro
    if (contains(full, "asheville", "arden", "fletcher", "candler", "swannanoa",
                       "weaverville", "woodfin", "biltmore", "leicester", "fairview",
                       "skyland", "enka", "buncombe")) {
      return { podName: "WNC - AVL", confidence: "high", reason: `Asheville metro: ${city}` };
    }

    // WNC - East: Black Mountain, Old Fort, Marion, Chimney Rock corridor
    if (contains(full, "black mountain", "old fort", "marion", "chimney rock",
                       "lake lure", "rutherfordton", "forest city", "bat cave",
                       "gerton", "mcdowell", "rutherford", "montreat")) {
      return { podName: "WNC - East", confidence: "high", reason: `WNC East area: ${city}` };
    }

    // WNC - West: Sylva, Cashiers, Highlands, Jackson County, Cherokee
    if (contains(full, "sylva", "cashiers", "highlands", "jackson", "cullowhee",
                       "dillsboro", "bryson city", "cherokee", "maggie valley",
                       "waynesville", "canton", "clyde", "haywood", "swain",
                       "murphy", "andrews", "robbinsville", "graham", "clay",
                       "hayesville", "topton", "nantahala", "franklin", "macon")) {
      return { podName: "WNC - West", confidence: "high", reason: `WNC West area: ${city}` };
    }

    // Hendersonville / Brevard — on the AVL/West boundary
    if (contains(full, "hendersonville", "brevard", "flat rock", "horse shoe",
                       "mills river", "etowah", "transylvania", "henderson")) {
      return { podName: "WNC - AVL", confidence: "low", reason: `${city} — on AVL/West boundary` };
    }

    // Spruce Pine / Mitchell County — on Boone/AVL boundary
    if (contains(full, "spruce pine", "bakersville", "burnsville", "yancey",
                       "mitchell", "little switzerland")) {
      return { podName: "Boone", confidence: "low", reason: `${city} — on Boone/AVL boundary` };
    }

    // Any other NC city not matched → low confidence WNC-AVL as nearest WNC hub
    return { podName: "WNC - AVL", confidence: "low", reason: `NC property (${city}) — unrecognised, assumed WNC-AVL` };
  }

  // ── No geographic match → Random ─────────────────────────────────────
  return {
    podName: "Random",
    confidence: "random",
    reason: `No POD match for ${city || "unknown city"}, ${state || "unknown state"}`,
  };
}

/**
 * Classify a batch of properties and return assignment suggestions.
 * Properties already assigned to a pod are still included so the user
 * can see them, but they are flagged with their current assignment.
 */
export interface PropertyForAssignment {
  id: number;
  name: string;
  internalName: string | null;
  city: string | null;
  state: string | null;
  address?: string | null;
  podId: number | null;
}

export interface AssignmentSuggestion {
  listingId: number;
  propertyName: string;
  city: string | null;
  state: string | null;
  currentPodId: number | null;
  suggestedPodName: string;
  confidence: PodMatchConfidence;
  reason: string;
}

export function buildAssignmentSuggestions(
  properties: PropertyForAssignment[]
): AssignmentSuggestion[] {
  return properties.map((p) => {
    const { podName, confidence, reason } = classifyPropertyToPod(p.city, p.state, p.address);
    return {
      listingId: p.id,
      propertyName: p.internalName || p.name,
      city: p.city,
      state: p.state,
      currentPodId: p.podId,
      suggestedPodName: podName,
      confidence,
      reason,
    };
  });
}
