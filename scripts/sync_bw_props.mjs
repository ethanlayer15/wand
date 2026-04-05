// Script to sync Breezeway properties and populate referencePropertyId
import { syncBreezewayProperties } from '/home/ubuntu/wandai/server/sync.ts';

console.log('[Script] Starting Breezeway property sync to populate referencePropertyId...');
try {
  const result = await syncBreezewayProperties();
  console.log('[Script] Sync result:', JSON.stringify(result, null, 2));
} catch (err) {
  console.error('[Script] Error:', err.message);
  console.error(err.stack);
}
process.exit(0);
