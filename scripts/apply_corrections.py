"""
Apply manual corrections to the fuzzy match results and produce:
1. HIGH confidence matches (auto-apply)
2. REVIEW items (need user confirmation)
3. NOT FOUND items (not in Wand DB)

Outputs a final JSON and a human-readable report.
"""

import json
from pathlib import Path

with open('/home/ubuntu/Downloads/wand_properties.json') as f:
    wand_props = json.load(f)

# Build lookup by name (internalName or name)
by_name = {}
for p in wand_props:
    display = p.get('internalName') or p.get('name')
    by_name[display.lower()] = p

def find_prop(name):
    return by_name.get(name.lower())

# ── HIGH CONFIDENCE MATCHES (apply automatically) ────────────────────────────
# These are clear, unambiguous matches confirmed by review.

high = [
    # WNC tab
    {"sheet_name": "Bens Cove", "wand_name": "Bass Cove", "fee": 410.0,
     "note": "Likely same property — 'Bens Cove' is the Airbnb name, 'Bass Cove' is internal name"},
    {"sheet_name": "Countryside", "wand_name": "Countryside", "fee": 270.0},
    {"sheet_name": "Treetop Towers", "wand_name": "Treetop Towers Near Grove Park Inn", "fee": 440.0},
    {"sheet_name": "Naples", "wand_name": None, "fee": 515.0,
     "note": "NOT IN WAND DB — no property named 'Naples' found"},
    {"sheet_name": "Forest Lane", "wand_name": None, "fee": 215.0,
     "note": "NOT IN WAND DB — no property named 'Forest Lane' found"},
    {"sheet_name": "Daltun's", "wand_name": "Daltun's Ranch", "fee": 250.0},
    {"sheet_name": "Hickory Hills", "wand_name": "Hickory Hills", "fee": 330.0},
    {"sheet_name": "Japandi", "wand_name": "Japandi", "fee": 85.0},
    {"sheet_name": "Longview", "wand_name": "Longview", "fee": 185.0},
    {"sheet_name": "Luck's Lookout", "wand_name": "Luck's Lookout", "fee": 295.0},
    {"sheet_name": "Nine Peaks", "wand_name": "Nine Peaks", "fee": 325.0},
    {"sheet_name": "North Shore", "wand_name": "North Shore Lakehouse", "fee": 295.0},
    {"sheet_name": "Rushing Creek Retreat", "wand_name": "Rushing Creek Retreat", "fee": 165.0},
    # Saddle Hills Unit 1 & 2 → BOTH Unit 1 and Unit 2 get $125
    {"sheet_name": "Saddle Hills Unit 1 & 2", "wand_name": "Saddle Hills Unit 1 (2BR)", "fee": 125.0,
     "note": "Combo row split — Unit 1 gets $125"},
    {"sheet_name": "Saddle Hills Unit 1 & 2", "wand_name": "Saddle Hills Unit 2 (2BR)", "fee": 125.0,
     "note": "Combo row split — Unit 2 gets $125"},
    {"sheet_name": "Saddle Hills Unit 3", "wand_name": "Saddle Hills Unit 3 (3BR)", "fee": 180.0},
    {"sheet_name": "Saddle Hills Combo", "wand_name": "Saddle Hills (combo listing)", "fee": 430.0},
    # Great Escape combo → individual properties each get $85
    {"sheet_name": "Great Escape", "wand_name": "The Great Escape", "fee": 85.0},
    {"sheet_name": "Cast Away", "wand_name": "Cast Away", "fee": 85.0},
    {"sheet_name": "Streams and Dreams", "wand_name": "Streams & Dreams", "fee": 85.0},
    {"sheet_name": "All Tuckered Out", "wand_name": "All Tuckered Out", "fee": 85.0},
    {"sheet_name": "Tucked Away", "wand_name": "Tucked Away", "fee": 85.0},
    # Kimble/Breezy/Florio/River Run/River Rest combo → each gets $75
    {"sheet_name": "Kimble", "wand_name": "The Kimble", "fee": 75.0},
    {"sheet_name": "Breezy", "wand_name": "Breezy", "fee": 75.0},
    {"sheet_name": "Florio", "wand_name": "Florio", "fee": 75.0},
    {"sheet_name": "River Run", "wand_name": "River Run", "fee": 75.0},
    {"sheet_name": "River Rest", "wand_name": "River Rest", "fee": 75.0},
    {"sheet_name": "Tiny Bearadise", "wand_name": "Tiny Bearadise", "fee": 95.0},
    {"sheet_name": "Whistler Retreat", "wand_name": "Whistler Retreat", "fee": 155.0},
    {"sheet_name": "Writer's Retreat", "wand_name": "Writer's Retreat", "fee": 110.0},
    # Kindling Meadows / Kindling Falls — NOT IN WAND DB
    {"sheet_name": "Kindling Meadows", "wand_name": None, "fee": 630.0,
     "note": "NOT IN WAND DB — no property named 'Kindling Meadows' found"},
    {"sheet_name": "Kindling Falls", "wand_name": None, "fee": 550.0,
     "note": "NOT IN WAND DB — no property named 'Kindling Falls' found"},
    # Smokey Mountain — NOT IN WAND DB
    {"sheet_name": "Smokey Mountain (main)", "wand_name": None, "fee": 355.0,
     "note": "NOT IN WAND DB — no 'Smokey Mountain' property found"},
    {"sheet_name": "Smokey Mountain Cottage", "wand_name": None, "fee": 155.0,
     "note": "NOT IN WAND DB — no 'Smokey Mountain Cottage' found"},
    {"sheet_name": "Borrowed Time", "wand_name": "Borrowed Time", "fee": 320.0},
    {"sheet_name": "Ceilidh Cottage", "wand_name": "Ceilidh Cottage", "fee": 330.0},
    {"sheet_name": "Crashing Creek Cabin", "wand_name": "Crashing Creek Cabin", "fee": 185.0},
    # Evergreen/Locust/Twig/Portkey combo → each gets $80
    {"sheet_name": "Evergreen", "wand_name": "The Evergreen", "fee": 80.0},
    {"sheet_name": "Locust", "wand_name": "The Locust", "fee": 80.0},
    {"sheet_name": "Twig", "wand_name": "The Twig", "fee": 80.0},
    # Portkey/Fern → individual fees $95 each (separate from combo row)
    {"sheet_name": "Portkey/Fern (individual)", "wand_name": "Portkey", "fee": 95.0,
     "note": "Individual Portkey fee from Portkey/Fern row"},
    {"sheet_name": "Fern", "wand_name": "The Fern", "fee": 95.0},
    {"sheet_name": "Friendswood", "wand_name": "The Friendswood", "fee": 230.0,
     "note": "Corrected: 'Friendswood' → 'The Friendswood', not 'Little Friendswood'"},
    {"sheet_name": "Little Friendswood", "wand_name": "Little Friendswood", "fee": 210.0},
    {"sheet_name": "Pennsylvania", "wand_name": "Pennsylvania", "fee": 250.0},
    {"sheet_name": "Kamp Wildkat", "wand_name": "Kamp Wildkat", "fee": 255.0},
    {"sheet_name": "Peach Perch", "wand_name": "The Peach Perch", "fee": 70.0},
    # Skyland — NOT IN WAND DB
    {"sheet_name": "Skyland", "wand_name": None, "fee": 375.0,
     "note": "NOT IN WAND DB — no property named 'Skyland' found"},
    {"sheet_name": "Kimberly", "wand_name": "Kimberly", "fee": 140.0},
    {"sheet_name": "Dome", "wand_name": "Glamping Dome", "fee": 140.0},
    # Bent Creek/Blue Ridge Luxury Cottages — NOT IN WAND DB
    {"sheet_name": "Bent Creek/Blue Ridge Luxury Cottages", "wand_name": None, "fee": 170.0,
     "note": "NOT IN WAND DB — no 'Bent Creek' or 'Blue Ridge Luxury Cottages' found"},
    # Rosewood/Laurel Luxury Cottages — NOT IN WAND DB
    {"sheet_name": "Rosewood/Laurel Luxury Cottages", "wand_name": None, "fee": 140.0,
     "note": "NOT IN WAND DB — no 'Rosewood' or 'Laurel Luxury Cottages' found"},
    # 534 A, B, C, D → Mountain View 534 units each get $150
    {"sheet_name": "534 A, B, C, D", "wand_name": "Mountain View 534 A", "fee": 150.0,
     "note": "Combo row — each unit gets $150"},
    {"sheet_name": "534 A, B, C, D", "wand_name": "Mountain View 534 B", "fee": 150.0,
     "note": "Combo row — each unit gets $150"},
    {"sheet_name": "534 A, B, C, D", "wand_name": "Mountain View 534 C", "fee": 150.0,
     "note": "Combo row — each unit gets $150"},
    {"sheet_name": "534 A, B, C, D", "wand_name": "Mountain View 534 D", "fee": 150.0,
     "note": "Combo row — each unit gets $150"},
    # Gaston, Patriots, Lawterdale, Riceville — NOT IN WAND DB
    {"sheet_name": "Gaston", "wand_name": None, "fee": 420.0,
     "note": "NOT IN WAND DB"},
    {"sheet_name": "Patriots", "wand_name": None, "fee": 180.0,
     "note": "NOT IN WAND DB"},
    {"sheet_name": "Lawterdale", "wand_name": None, "fee": 290.0,
     "note": "NOT IN WAND DB"},
    {"sheet_name": "Riceville", "wand_name": None, "fee": 290.0,
     "note": "NOT IN WAND DB"},
    {"sheet_name": "Majestic", "wand_name": "Majestic", "fee": 360.0},
    {"sheet_name": "Glenna", "wand_name": "Glenna", "fee": 210.0},
    {"sheet_name": "Brownstone", "wand_name": "Brownstone Escape", "fee": 260.0},
    # Abbey View, Kings Ridge, 67/69 Flat Top, 513 Laurel — NOT IN WAND DB
    {"sheet_name": "Abbey View", "wand_name": None, "fee": 275.0,
     "note": "NOT IN WAND DB"},
    {"sheet_name": "Kings Ridge", "wand_name": None, "fee": 190.0,
     "note": "NOT IN WAND DB"},
    {"sheet_name": "67 Flat Top", "wand_name": None, "fee": 140.0,
     "note": "NOT IN WAND DB"},
    {"sheet_name": "69 Flat Top", "wand_name": None, "fee": 265.0,
     "note": "NOT IN WAND DB"},
    {"sheet_name": "Laurel House", "wand_name": "Laurel House", "fee": 395.0},
    {"sheet_name": "Blue Haven", "wand_name": "Blue Haven Retreat", "fee": 270.0},
    {"sheet_name": "513 Laurel", "wand_name": None, "fee": 270.0,
     "note": "NOT IN WAND DB — could be 'Laurel Bush combo listing' or 'Laurel Creek Falls' but unclear"},
    # LYH tab entries (Lynchburg)
    {"sheet_name": "Riverwood Retreat", "wand_name": "Riverwood Retreat", "fee": 290.0},
    {"sheet_name": "Golden Jewel", "wand_name": "Golden Jewel", "fee": 225.0},
    {"sheet_name": "Harbor Ridge Retreat", "wand_name": "Harbor Ridge Retreat", "fee": 225.0},
    {"sheet_name": "POOL HOUSE / Quaint Cottage (combo)", "wand_name": "Quaint Cottage", "fee": 140.0,
     "note": "Combo row — Quaint Cottage gets $140"},
    {"sheet_name": "Commerce Loft", "wand_name": "Commerce Loft", "fee": 150.0},
    {"sheet_name": "Mack's Retreat", "wand_name": "Mack's Retreat", "fee": 230.0},
    {"sheet_name": "Redwing", "wand_name": "Redwing Farm Cottage", "fee": 165.0},
    {"sheet_name": "Hideaway Haven", "wand_name": "Hideaway Haven", "fee": 280.0},
    {"sheet_name": "Cozy Cottage on Perrymont", "wand_name": "Perrymont", "fee": 115.0,
     "note": "Cozy Cottage on Perrymont = Perrymont (Lynchburg, VA)"},
]

# ── REVIEW ITEMS (need user confirmation) ────────────────────────────────────
review = [
    {"sheet_name": "Dillingham", "fee": 205.0,
     "issue": "NOT IN WAND DB — no property named 'Dillingham' found. Please identify which Wand property this is."},
    {"sheet_name": "Southern Pines", "fee": 320.0,
     "issue": "NOT IN WAND DB — no property named 'Southern Pines' found. Please identify which Wand property this is."},
    {"sheet_name": "Adventure LKJ", "fee": 395.0,
     "suggested_wand_name": "Adventure Awaits LKJ",
     "issue": "Score 0.79 — 'Adventure LKJ' likely = 'Adventure Awaits LKJ' (Marion, NC). Please confirm."},
    {"sheet_name": "Madison Ave", "fee": 260.0,
     "suggested_wand_name": "The Madison",
     "issue": "Score 0.64 — 'Madison Ave' may = 'The Madison' (Madison Heights, VA). Please confirm."},
    {"sheet_name": "Madison (LYH tab)", "fee": 175.0,
     "suggested_wand_name": "The Madison",
     "issue": "LYH tab 'Madison' ($175) — likely 'The Madison' (Madison Heights, VA), but WNC tab also has 'Madison Ave' ($260). Are these the same property at different prices, or two different properties?"},
    {"sheet_name": "Wyndsong (LYH tab)", "fee": 195.0,
     "suggested_wand_name": "The Wyndsong",
     "issue": "LYH tab 'Wyndsong' ($195) — same as WNC tab? If so, which fee is correct: $195 or the WNC tab value?"},
]

# ── APPLY CORRECTIONS ────────────────────────────────────────────────────────

# Separate into: to_apply (has wand_name) and not_found (wand_name is None)
to_apply = []
not_found = []

for item in high:
    if item["wand_name"] is None:
        not_found.append(item)
    else:
        prop = find_prop(item["wand_name"])
        if prop:
            to_apply.append({
                **item,
                "wand_id": prop["id"],
                "wand_city": prop.get("city"),
                "wand_state": prop.get("state"),
            })
        else:
            not_found.append({**item, "note": f"Wand property '{item['wand_name']}' not found in DB"})

print(f"=== FINAL RESULTS ===")
print(f"To apply (auto):     {len(to_apply)}")
print(f"Needs review:        {len(review)}")
print(f"Not in Wand DB:      {len(not_found)}")
print()

print("=== TO APPLY (high confidence) ===")
for item in sorted(to_apply, key=lambda x: x["wand_name"]):
    note = f" [{item['note']}]" if item.get("note") else ""
    print(f"  {item['wand_name']} ({item['wand_city']}, {item['wand_state']}) → ${item['fee']:.2f}{note}")

print()
print("=== NEEDS REVIEW ===")
for item in review:
    suggested = f" → suggested: '{item.get('suggested_wand_name', 'unknown')}'" if item.get("suggested_wand_name") else ""
    print(f"  '{item['sheet_name']}' (${item['fee']:.2f}){suggested}")
    print(f"    Issue: {item['issue']}")

print()
print("=== NOT IN WAND DB ===")
for item in not_found:
    print(f"  '{item['sheet_name']}' (${item['fee']:.2f}) — {item.get('note', 'not found')}")

# Save
output = {
    "to_apply": to_apply,
    "review": review,
    "not_found": not_found,
}
with open("/home/ubuntu/Downloads/cleaning_fee_final.json", "w") as f:
    json.dump(output, f, indent=2)
print(f"\nSaved to /home/ubuntu/Downloads/cleaning_fee_final.json")
