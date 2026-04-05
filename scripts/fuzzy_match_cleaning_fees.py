"""
Fuzzy-match cleaning fee data from the Google Spreadsheet to Wand properties.

Spreadsheet has two tabs:
  - WNC tab (gid=0): main list with Property + total columns
  - LYH tab (gid=928201845): Lynchburg properties with Cleaning + total columns

The "total" column in the WNC tab is the cleaning fee charged to guests.
The "total" column in the LYH tab is also the cleaning fee total.

Strategy:
1. Normalise property names (lowercase, strip punctuation, collapse spaces)
2. Try exact match first
3. Try substring / token overlap
4. Use difflib SequenceMatcher for fuzzy ratio
5. Confidence:
   - HIGH  (ratio >= 0.85 OR exact/near-exact token match): apply automatically
   - MEDIUM (0.65 <= ratio < 0.85): flag for review
   - LOW   (ratio < 0.65): flag as no-match / needs manual assignment

Special cases:
  - Spreadsheet rows that map to MULTIPLE Wand properties (e.g. "Saddle Hills Unit 1 & 2")
    → flag as multi-match, user must split manually
  - Spreadsheet rows where the name is a combo (e.g. "Great Escape / Cast Away / ...")
    → each slash-separated name is matched individually
"""

import json
import csv
import re
from difflib import SequenceMatcher
from pathlib import Path

# ── Load data ────────────────────────────────────────────────────────────────

PROPERTIES_FILE = Path("/home/ubuntu/Downloads/wand_properties.json")
WNC_CSV = Path("/home/ubuntu/Downloads/wand_pricing.csv")
LYH_CSV = Path("/home/ubuntu/Downloads/wand_pricing_lyh.csv")

with open(PROPERTIES_FILE) as f:
    wand_props = json.load(f)

# ── Helpers ──────────────────────────────────────────────────────────────────

def normalise(s: str) -> str:
    """Lowercase, strip punctuation (except &/), collapse spaces."""
    s = s.lower().strip()
    # Keep & and / as word separators
    s = re.sub(r"[''`]", "", s)        # remove apostrophes
    s = re.sub(r"[^a-z0-9&/ ]", " ", s)  # replace other punctuation with space
    s = re.sub(r"\s+", " ", s).strip()
    return s

def tokens(s: str) -> set:
    return set(normalise(s).split())

def ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, normalise(a), normalise(b)).ratio()

def best_match(sheet_name: str, candidates: list[dict]) -> tuple[dict | None, float, str]:
    """
    Return (best_candidate, score, match_type) where match_type is one of:
      'exact', 'token', 'fuzzy', 'none'
    """
    norm_sheet = normalise(sheet_name)
    sheet_toks = tokens(sheet_name)

    best_cand = None
    best_score = 0.0
    best_type = "none"

    for c in candidates:
        display = c.get("internalName") or c.get("name")
        norm_cand = normalise(display)
        cand_toks = tokens(display)

        # Exact match
        if norm_sheet == norm_cand:
            return c, 1.0, "exact"

        # Substring: sheet name is fully contained in candidate or vice versa
        if norm_sheet in norm_cand or norm_cand in norm_sheet:
            sc = 0.95
            if sc > best_score:
                best_score = sc
                best_cand = c
                best_type = "substring"
            continue

        # Token overlap: Jaccard similarity
        if sheet_toks and cand_toks:
            overlap = len(sheet_toks & cand_toks) / len(sheet_toks | cand_toks)
            if overlap >= 0.7:
                sc = 0.9 * overlap + 0.1 * ratio(sheet_name, display)
                if sc > best_score:
                    best_score = sc
                    best_cand = c
                    best_type = "token"
                continue

        # Fuzzy ratio
        sc = ratio(sheet_name, display)
        if sc > best_score:
            best_score = sc
            best_cand = c
            best_type = "fuzzy"

    return best_cand, best_score, best_type


# ── Parse spreadsheet rows ───────────────────────────────────────────────────

def parse_fee(fee_str: str) -> float | None:
    """Parse '$410' or '410' or '$410.00' → 410.0"""
    if not fee_str:
        return None
    cleaned = re.sub(r"[^0-9.]", "", fee_str)
    try:
        return float(cleaned)
    except ValueError:
        return None

sheet_rows = []  # list of {name, fee, source}

# WNC tab — col A = Property, col B = total
with open(WNC_CSV, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        name = (row.get("Property") or "").strip()
        fee = parse_fee(row.get("total") or "")
        if name and fee is not None:
            sheet_rows.append({"name": name, "fee": fee, "source": "WNC"})

# LYH tab — col A = Property, col F = total
with open(LYH_CSV, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        name = (row.get("Property") or "").strip()
        fee = parse_fee(row.get("total") or "")
        if name and fee is not None:
            sheet_rows.append({"name": name, "fee": fee, "source": "LYH"})

print(f"Spreadsheet rows: {len(sheet_rows)}")

# ── Expand combo rows (slash-separated names) ────────────────────────────────

expanded_rows = []
for row in sheet_rows:
    parts = [p.strip() for p in row["name"].split("/")]
    # Only split if each part looks like a real property name (>= 3 chars)
    # and there are multiple parts
    if len(parts) > 1 and all(len(p) >= 3 for p in parts):
        for part in parts:
            expanded_rows.append({
                "name": part,
                "fee": row["fee"],
                "source": row["source"],
                "original_name": row["name"],
                "is_combo": True,
            })
    else:
        expanded_rows.append({**row, "original_name": row["name"], "is_combo": False})

print(f"Expanded rows (after combo split): {len(expanded_rows)}")

# ── Match ────────────────────────────────────────────────────────────────────

HIGH_THRESHOLD = 0.82
MEDIUM_THRESHOLD = 0.60

results_high = []    # auto-apply
results_medium = []  # flag for review
results_low = []     # no match

# Track which wand properties have already been matched to avoid double-assignment
matched_wand_ids = {}  # wand_id -> sheet_name

for row in expanded_rows:
    cand, score, match_type = best_match(row["name"], wand_props)

    if cand is None or score < MEDIUM_THRESHOLD:
        results_low.append({
            "sheet_name": row["name"],
            "original_name": row["original_name"],
            "fee": row["fee"],
            "source": row["source"],
            "is_combo": row["is_combo"],
            "score": round(score, 3),
            "reason": "No match found",
        })
        continue

    display = cand.get("internalName") or cand.get("name")
    entry = {
        "sheet_name": row["name"],
        "original_name": row["original_name"],
        "fee": row["fee"],
        "source": row["source"],
        "is_combo": row["is_combo"],
        "wand_id": cand["id"],
        "wand_name": display,
        "wand_city": cand.get("city"),
        "wand_state": cand.get("state"),
        "current_fee": cand.get("cleaningFeeCharge"),
        "score": round(score, 3),
        "match_type": match_type,
    }

    # Check for duplicate assignment
    if cand["id"] in matched_wand_ids:
        entry["duplicate_of"] = matched_wand_ids[cand["id"]]
        entry["reason"] = f"Duplicate: already matched to '{matched_wand_ids[cand['id']]}'"
        results_medium.append(entry)
        continue

    matched_wand_ids[cand["id"]] = row["name"]

    if score >= HIGH_THRESHOLD:
        results_high.append(entry)
    else:
        entry["reason"] = f"Score {score:.2f} below high threshold ({HIGH_THRESHOLD})"
        results_medium.append(entry)

# ── Find unmatched Wand properties ───────────────────────────────────────────

matched_ids = set(r["wand_id"] for r in results_high + results_medium if "wand_id" in r)
unmatched_wand = [
    p for p in wand_props
    if p["id"] not in matched_ids
]

# ── Print summary ────────────────────────────────────────────────────────────

print(f"\n=== RESULTS ===")
print(f"HIGH confidence (auto-apply): {len(results_high)}")
print(f"MEDIUM confidence (review):   {len(results_medium)}")
print(f"LOW / no match:               {len(results_low)}")
print(f"Unmatched Wand properties:    {len(unmatched_wand)}")

print(f"\n--- HIGH CONFIDENCE ---")
for r in sorted(results_high, key=lambda x: x["wand_name"]):
    print(f"  [{r['score']:.2f}] '{r['sheet_name']}' → {r['wand_name']} ({r['wand_city']}, {r['wand_state']}) fee=${r['fee']}")

print(f"\n--- MEDIUM CONFIDENCE (needs review) ---")
for r in sorted(results_medium, key=lambda x: x["score"], reverse=True):
    reason = r.get("reason", "")
    dup = f" [DUPLICATE of '{r.get('duplicate_of', '')}']" if "duplicate_of" in r else ""
    print(f"  [{r['score']:.2f}] '{r['sheet_name']}' → {r.get('wand_name','?')} ({r.get('wand_city','?')}, {r.get('wand_state','?')}) fee=${r['fee']}{dup}")

print(f"\n--- LOW / NO MATCH ---")
for r in results_low:
    print(f"  [{r['score']:.2f}] '{r['sheet_name']}' (fee=${r['fee']}) — {r['reason']}")

print(f"\n--- UNMATCHED WAND PROPERTIES (no spreadsheet entry) ---")
for p in sorted(unmatched_wand, key=lambda x: x.get("internalName") or x.get("name")):
    print(f"  {p.get('internalName') or p.get('name')} ({p.get('city')}, {p.get('state')})")

# ── Save results ─────────────────────────────────────────────────────────────

output = {
    "high": results_high,
    "medium": results_medium,
    "low": results_low,
    "unmatched_wand": [
        {"id": p["id"], "name": p.get("internalName") or p.get("name"),
         "city": p.get("city"), "state": p.get("state")}
        for p in unmatched_wand
    ],
}
with open("/home/ubuntu/Downloads/cleaning_fee_matches.json", "w") as f:
    json.dump(output, f, indent=2)
print(f"\nResults saved to /home/ubuntu/Downloads/cleaning_fee_matches.json")
