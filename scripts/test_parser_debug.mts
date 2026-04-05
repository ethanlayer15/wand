import { extractBookingDataRegex } from './server/vivAirbnb';
import { fetchEmail } from './server/gmail';

async function test() {
  console.log('Fetching email 132275...');
  const email = await fetchEmail(132275);
  console.log('bodyText length:', email?.bodyText?.length || 0);
  console.log('bodyHtml length:', email?.bodyHtml?.length || 0);
  
  if (email?.bodyText) {
    // Check if the property name regex works on the text body
    const propMatch = email.bodyText.match(/airbnb\.com\/rooms\/[^\n]+\n\s*\n([^\n]+)\n\s*\nEntire/i);
    console.log('Property from text regex:', propMatch ? propMatch[1] : 'NOT FOUND');
    
    // Check if rate regex works
    const rateMatch = email.bodyText.match(/\$([\d,.]+)\s*x\s*(\d+)\s*nights?/i);
    console.log('Rate from text regex:', rateMatch ? rateMatch[0] : 'NOT FOUND');
  }
  
  const result = extractBookingDataRegex(
    'Reservation confirmed - Holly Mitchell arrives Mar 22',
    email?.bodyText,
    'New booking confirmed!',
    email?.bodyHtml
  );
  console.log('Result:', JSON.stringify(result, null, 2));
}

test().catch(console.error);
