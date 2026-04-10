/**
 * One-time backfill: read Hostaway reviewCategory arrays and populate the
 * cleanlinessRating column for existing reviews that have it as NULL.
 *
 * Background: an earlier version of reviewPipeline.ts read cleanliness from
 * `review.categoryRatings.cleanliness` / `review.subRatings.cleanliness` — but
 * Hostaway actually returns sub-scores in `review.reviewCategory` (array of
 * { category, rating }). Fixed going forward in reviewPipeline.ts; this
 * script patches up the existing rows.
 *
 * Airbnb uses a 10-point scale — normalized to 5-point here to match the
 * forward-going sync.
 *
 * Run with: node --import tsx/esm scripts/backfill-cleanliness-ratings.mjs
 */

import { getDb } from '../server/db.ts';
import { reviews } from '../drizzle/schema.ts';
import { eq, isNull } from 'drizzle-orm';
import { getHostawayClient } from '../server/hostaway.ts';

async function main() {
  const db = await getDb();
  if (!db) { console.error('No DB'); process.exit(1); }

  const client = getHostawayClient();

  // Build a map: hostawayReviewId → normalized cleanliness rating
  const cleanlinessMap = new Map();
  let offset = 0;
  const limit = 100;
  let totalFetched = 0;

  console.log('[Backfill] Fetching Hostaway reviews in pages of 100...');
  while (true) {
    const page = await client.getReviews(undefined, limit, offset);
    if (!page.result || page.result.length === 0) break;

    for (const r of page.result) {
      if (!Array.isArray(r.reviewCategory)) continue;
      const cleanCat = r.reviewCategory.find(
        (c) => c && typeof c.category === 'string' && c.category.toLowerCase() === 'cleanliness'
      );
      if (cleanCat?.rating == null) continue;
      const raw = Number(cleanCat.rating);
      if (Number.isNaN(raw)) continue;
      const normalized = raw > 5 ? Math.round(raw / 2) : raw;
      cleanlinessMap.set(String(r.id), normalized);
    }

    totalFetched += page.result.length;
    if (totalFetched % 1000 === 0) {
      console.log(`[Backfill] Fetched ${totalFetched} reviews from API...`);
    }

    if (page.result.length < limit) break;
    offset += limit;
  }

  console.log(`[Backfill] Scanned ${totalFetched} reviews — ${cleanlinessMap.size} have cleanliness sub-scores`);

  // Get all DB reviews with NULL cleanlinessRating
  const dbReviews = await db
    .select({
      id: reviews.id,
      hostawayReviewId: reviews.hostawayReviewId,
    })
    .from(reviews)
    .where(isNull(reviews.cleanlinessRating));

  console.log(`[Backfill] ${dbReviews.length} DB reviews need cleanlinessRating`);

  // Batch update in chunks of 50
  let updated = 0;
  let missing = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < dbReviews.length; i += BATCH_SIZE) {
    const batch = dbReviews.slice(i, i + BATCH_SIZE);
    const promises = [];

    for (const dbReview of batch) {
      const rating = cleanlinessMap.get(dbReview.hostawayReviewId);
      if (rating != null) {
        promises.push(
          db
            .update(reviews)
            .set({ cleanlinessRating: rating })
            .where(eq(reviews.id, dbReview.id))
        );
        updated++;
      } else {
        missing++;
      }
    }

    await Promise.all(promises);

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= dbReviews.length) {
      console.log(
        `[Backfill] Progress: ${Math.min(i + BATCH_SIZE, dbReviews.length)}/${dbReviews.length} ` +
        `(updated: ${updated}, no sub-score in Hostaway: ${missing})`
      );
    }
  }

  console.log(`[Backfill] Done! Updated: ${updated}, not found / no sub-score: ${missing}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Backfill] Error:', err);
  process.exit(1);
});
