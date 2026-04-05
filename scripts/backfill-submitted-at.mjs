/**
 * One-time backfill: fetch submittedAt (or insertedOn) from Hostaway API
 * and batch-update the reviews table.
 * Run with: node --import tsx/esm scripts/backfill-submitted-at.mjs
 */

import { getDb } from '../server/db.ts';
import { reviews } from '../drizzle/schema.ts';
import { eq, isNull, sql } from 'drizzle-orm';
import { getHostawayClient } from '../server/hostaway.ts';

async function main() {
  const db = await getDb();
  if (!db) { console.error('No DB'); process.exit(1); }

  const client = getHostawayClient();

  // Build a map from all Hostaway reviews: hostawayReviewId → date
  const dateMap = new Map();
  let offset = 0;
  const limit = 100;
  let totalFetched = 0;

  console.log('[Backfill] Fetching Hostaway reviews in pages of 100...');
  while (true) {
    const page = await client.getReviews(undefined, limit, offset);
    if (!page.result || page.result.length === 0) break;

    for (const r of page.result) {
      // Prefer submittedAt, fall back to insertedOn
      const dateStr = r.submittedAt || r.insertedOn;
      if (dateStr) {
        dateMap.set(String(r.id), new Date(dateStr.replace(' ', 'T') + 'Z'));
      }
    }

    totalFetched += page.result.length;
    if (totalFetched % 1000 === 0) {
      console.log(`[Backfill] Fetched ${totalFetched} of ${page.count} from API...`);
    }

    if (totalFetched >= page.count || page.result.length < limit) break;
    offset += limit;
  }

  console.log(`[Backfill] Fetched ${totalFetched} reviews, ${dateMap.size} have dates`);

  // Get all DB reviews with NULL submittedAt
  const dbReviews = await db.select({
    id: reviews.id,
    hostawayReviewId: reviews.hostawayReviewId,
  }).from(reviews).where(isNull(reviews.submittedAt));

  console.log(`[Backfill] ${dbReviews.length} DB reviews need submittedAt`);

  // Batch update in chunks of 50
  let updated = 0;
  let missing = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < dbReviews.length; i += BATCH_SIZE) {
    const batch = dbReviews.slice(i, i + BATCH_SIZE);
    const promises = [];

    for (const dbReview of batch) {
      const date = dateMap.get(dbReview.hostawayReviewId);
      if (date) {
        promises.push(
          db.update(reviews)
            .set({ submittedAt: date })
            .where(eq(reviews.id, dbReview.id))
        );
        updated++;
      } else {
        missing++;
      }
    }

    await Promise.all(promises);

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= dbReviews.length) {
      console.log(`[Backfill] Progress: ${Math.min(i + BATCH_SIZE, dbReviews.length)}/${dbReviews.length} (updated: ${updated}, missing: ${missing})`);
    }
  }

  console.log(`[Backfill] Done! Updated: ${updated}, Not found in API: ${missing}`);
  process.exit(0);
}

main().catch(err => {
  console.error('[Backfill] Error:', err);
  process.exit(1);
});
