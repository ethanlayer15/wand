import { fetchEmail } from '/home/ubuntu/wandai/server/gmail.ts';
import { getDb } from '/home/ubuntu/wandai/server/db.ts';
import { vivAirbnbBookings } from '/home/ubuntu/wandai/drizzle/schema.ts';
import fs from 'fs';

const db = await getDb();
const bookings = await db.select().from(vivAirbnbBookings);

for (let i = 1; i < bookings.length; i++) {
  const b = bookings[i];
  console.log(`Booking ${i + 1} UID: ${b.uid} Subject: ${b.rawSubject}`);
  const email = await fetchEmail(b.uid);
  console.log(`  hasHtml: ${!!email?.bodyHtml} hasText: ${!!email?.bodyText}`);
  if (email?.bodyHtml) {
    fs.writeFileSync(`/tmp/booking_html_${i + 1}.html`, email.bodyHtml);
    const text = email.bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    fs.writeFileSync(`/tmp/booking_stripped_${i + 1}.txt`, text);
    console.log(`  HTML length: ${email.bodyHtml.length}`);
  }
}
process.exit(0);
