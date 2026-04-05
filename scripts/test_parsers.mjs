import fs from 'fs';

async function main() {
  const { parseBookingFromBody, parseBookingFromSnippet, parseBookingFromSubject, parseReviewFromBody, parseReviewFromSnippet } = await import('/home/ubuntu/wandai/server/airbnbParser.ts');

  console.log('=== BOOKING PARSER (from body) ===');
  const bookingBody = fs.readFileSync('/tmp/booking_email_1.txt', 'utf-8');
  const bookingSubject = 'Reservation confirmed - Sara McElwee arrives Jul 17';
  const parsed1 = parseBookingFromBody(bookingBody, bookingSubject);
  console.log(JSON.stringify(parsed1, null, 2));

  console.log('\n=== BOOKING PARSER (from snippet) ===');
  const snippet2 = 'NEW BOOKING CONFIRMED! LAURENCE ARRIVES MAR 28. Send | SAUNA, HIKING, GREAT FOOD Entire home/apt [ Check-in Checkout Sat, Mar 28 Mon, Mar 30 PM AM GUESTS 2 adults MORE DETAILS ABOUT WHOS COMI';
  const subject2 = 'Reservation confirmed - Laurence Tremblay arrives Mar 28';
  const parsed2 = parseBookingFromSnippet(snippet2, subject2);
  console.log(JSON.stringify(parsed2, null, 2));

  console.log('\n=== BOOKING PARSER (from subject - canceled) ===');
  const subject3 = 'Canceled: Reservation HMEMW42W9J for Sep';
  const parsed3 = parseBookingFromSubject(subject3);
  console.log(JSON.stringify(parsed3, null, 2));

  console.log('\n=== REVIEW PARSER (from body - Rebecca) ===');
  const reviewBody1 = fs.readFileSync('/tmp/review_email_1.txt', 'utf-8');
  const reviewSubject1 = 'Rebecca left a 5-star review!';
  const parsedR1 = parseReviewFromBody(reviewBody1, reviewSubject1);
  console.log(JSON.stringify(parsedR1, null, 2));

  console.log('\n=== REVIEW PARSER (from body - Stepheny) ===');
  const reviewBody3 = fs.readFileSync('/tmp/review_email_3.txt', 'utf-8');
  const reviewSubject3 = 'Stepheny left a 5-star review!';
  const parsedR3 = parseReviewFromBody(reviewBody3, reviewSubject3);
  console.log(JSON.stringify(parsedR3, null, 2));

  console.log('\n=== REVIEW PARSER (from snippet) ===');
  const snippet5 = 'We absolutely loved staying here! Sylva is a great place to stay for hiking in the Smokys! It was in a sort of campground area, but there are wood div + More';
  const subject5 = 'Ambry left a 5-star review!';
  const parsedR5 = parseReviewFromSnippet(snippet5, subject5);
  console.log(JSON.stringify(parsedR5, null, 2));

  console.log('\n=== REVIEW PARSER (from snippet - anonymous) ===');
  const snippet10 = "Upon check in key pad didn't work. They asked me if I'd be willing to cha for the batteries in the lock pad, umm no! + More";
  const subject10 = 'A recent guest left a 3-star review';
  const parsedR10 = parseReviewFromSnippet(snippet10, subject10);
  console.log(JSON.stringify(parsedR10, null, 2));

  process.exit(0);
}

main().catch(console.error);
