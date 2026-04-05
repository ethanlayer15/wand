async function main() {
  const { getDb } = await import('/home/ubuntu/wandai/server/db.ts');
  const { vivAirbnbBookings, vivAirbnbReviews } = await import('/home/ubuntu/wandai/drizzle/schema.ts');

  const db = await getDb();
  
  console.log('=== BOOKINGS ===');
  const bookings = await db.select().from(vivAirbnbBookings);
  for (const b of bookings) {
    console.log(`ID ${b.id} | UID ${b.uid} | Subject: ${b.rawSubject}`);
    console.log(`  Snippet: ${(b.rawSnippet || '').slice(0, 200)}`);
    console.log(`  Property: ${b.propertyName} | Guest: ${b.guestName} | CheckIn: ${b.checkIn} | CheckOut: ${b.checkOut} | Rate: ${b.nightlyRate} | Nights: ${b.numNights}`);
    console.log('---');
  }
  
  console.log('\n=== REVIEWS ===');
  const reviews = await db.select().from(vivAirbnbReviews);
  for (const r of reviews) {
    console.log(`ID ${r.id} | UID ${r.uid} | Subject: ${r.rawSubject}`);
    console.log(`  Snippet: ${(r.reviewSnippet || '').slice(0, 200)}`);
    console.log(`  Property: ${r.propertyName} | Guest: ${r.guestName} | Rating: ${r.rating} | aiProcessed: ${r.aiProcessed}`);
    const h = r.highlights ? (Array.isArray(r.highlights) ? r.highlights : []) : [];
    const imp = r.improvements ? (Array.isArray(r.improvements) ? r.improvements : []) : [];
    console.log(`  Highlights: ${h.length} | Improvements: ${imp.length}`);
    console.log('---');
  }
  
  process.exit(0);
}

main().catch(console.error);
