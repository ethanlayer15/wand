"""
Manual corrections for the fuzzy matching results.

After reviewing the full list of Wand properties vs. spreadsheet names,
here are the manual corrections and resolutions:

ISSUES FOUND:

1. DUPLICATE ROWS (same property in both WNC + LYH tabs):
   The LYH tab contains the Lynchburg properties that are ALSO in the WNC tab.
   The LYH tab has a "Cleaning" column (the cleaning fee component) and a "total" column.
   The WNC tab "total" column is the FULL cleaning fee.
   → Use WNC tab "total" as the authoritative cleaning fee for properties in both tabs.
   → LYH tab duplicates should be IGNORED (they're the same properties).

2. PROPERTIES IN SPREADSHEET BUT NOT IN WAND DB (truly missing):
   These names don't match any Wand property — they may be old/retired properties
   or use completely different names:
   - Dillingham ($205)
   - Southern Pines ($320)
   - Naples ($515)
   - Forest Lane ($215)
   - Kindling Meadows ($630)
   - Kindling Falls ($550)
   - Smokey Mountain (main) ($355)
   - Skyland ($375)
   - Bent Creek ($170) — note: "Bent Creek/Blue Ridge Luxury Cottages" in sheet
   - Blue Ridge Luxury Cottages ($170) — combo with Bent Creek
   - Rosewood ($140) — "Rosewood/Laurel Luxury Cottages" in sheet
   - Laurel Luxury Cottages ($140) — combo with Rosewood
   - 534 A, B, C, D ($150) — likely Mountain View 534 units (but which fee applies to each?)
   - Gaston ($420)
   - Patriots ($180)
   - Lawterdale ($290)
   - Riceville ($290)
   - Abbey View ($275)
   - Kings Ridge ($190)
   - 67 Flat Top ($140)
   - 69 Flat Top ($265)
   - 513 Laurel ($270)

3. MEDIUM CONFIDENCE (non-duplicates) — need manual review:
   - 'Bens Cove' ($410) → matched to 'Bass Cove' (Huddleston, VA) [score 0.78]
     → LIKELY WRONG: "Bens Cove" sounds like a WNC property, not VA
   - 'Smokey Mountain Cottage' ($155) → matched to 'Sunset Mountain Lodge' [score 0.68]
     → LIKELY WRONG: no "Smokey Mountain" in Wand DB
   - 'Adventure LKJ' ($395) → matched to 'Adventure Awaits LKJ' (Marion, NC) [score 0.79]
     → LIKELY CORRECT: same property, abbreviated name
   - 'Madison Ave' ($260) → matched to 'The Madison' (Madison Heights, VA) [score 0.64]
     → UNCERTAIN: "Madison Ave" could be a different property
   - 'POOL HOUSE' ($140) → matched to 'Knoll House (104)' (Brevard, NC) [score 0.64]
     → LIKELY WRONG: "POOL HOUSE / Quaint Cottage" in sheet → Quaint Cottage matched separately

4. COMBO ROWS THAT NEED SPLITTING:
   - 'Saddle Hills Unit 1 & 2' ($125) → matched to Unit 1 only; Unit 2 also needs $125
   - '534 A, B, C, D' ($150) → Mountain View 534 A/B/C/D each get $150 (per unit)
   - 'Bent Creek/Blue Ridge Luxury Cottages' ($170) → need to find both in Wand
   - 'Rosewood/Laurel Luxury Cottages' ($140) → need to find both in Wand

5. FRIENDSWOOD CONFUSION:
   - Sheet has 'Friendswood' ($230) → matched to 'Little Friendswood' (WRONG)
   - Sheet has 'Little Friendswood' ($210) → matched to 'Little Friendswood' (correct)
   - Wand has BOTH 'Little Friendswood' AND 'The Friendswood'
   → 'Friendswood' ($230) should match 'The Friendswood', not 'Little Friendswood'

6. PORTKEY CONFUSION:
   - Sheet has 'Portkey/Fern' ($95) → split to 'Portkey' ($95) and 'Fern' ($95)
   - 'Portkey' matched correctly to Portkey (Sylva, NC) with $80 from Evergreen/Locust/Twig/Portkey
   - But 'Portkey/Fern' ($95) is a DIFFERENT fee than the combo row
   → The combo row fee ($80) is for the combo; individual Portkey = $95, Fern = $95

7. MADISON CONFUSION:
   - Sheet has 'Madison' ($175) in LYH tab → matched to 'Golden Jewel/Madison (Combo Listing)'
   - But 'The Madison' is a separate property in Wand
   → 'Madison' ($175) should match 'The Madison' (Madison Heights, VA)

8. COZY COTTAGE ON PERRYMONT:
   - Sheet has 'Cozy Cottage on Perrymont' ($115) → matched to 'Perrymont' (Lynchburg, VA)
   → LIKELY CORRECT: same property, different name

9. BLUE HAVEN:
   - Sheet has 'Blue Haven' ($270) → matched to 'Blue Haven Retreat' (Black Mountain, NC)
   → CORRECT

10. DOME:
    - Sheet has 'Dome' ($140) → matched to 'Glamping Dome' (Fairview, NC)
    → CORRECT

11. BENS COVE:
    - No "Bens Cove" in Wand DB. This is likely a property not yet in the system,
      or it uses a completely different name.

12. SADDLE HILLS UNIT 2:
    - Sheet has 'Saddle Hills Unit 1 & 2' ($125) → should apply to BOTH Unit 1 AND Unit 2
    - Wand has: Saddle Hills Unit 1 (2BR), Saddle Hills Unit 2 (2BR), Saddle Hills Unit 3 (3BR)
    → Both Unit 1 and Unit 2 should get $125

13. MADISON AVE:
    - "Madison Ave" ($260) in WNC sheet. Wand has "The Madison" (Madison Heights, VA).
    - These are likely the same property. Score 0.64 is borderline.
    → Flag for review.
"""

# This script just documents the analysis — no code to run
print("Analysis documented above")
