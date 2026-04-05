/**
 * One-shot script to sync Hostaway listings with internalName and full-res photos.
 * Run with: node scripts/sync-listings.mjs
 */
import { createRequire } from "module";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use tsx to run the TypeScript sync function
const result = execSync(
  `cd /home/ubuntu/wandai && node_modules/.bin/tsx -e "
import { syncHostawayListings } from './server/sync.ts';
const result = await syncHostawayListings();
console.log(JSON.stringify(result));
"`,
  { encoding: "utf-8", env: { ...process.env }, timeout: 120000 }
);

console.log("Sync result:", result);
