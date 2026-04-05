import { syncHostawayListings } from "../server/sync.ts";
import { getListings } from "../server/db.ts";

const result = await syncHostawayListings();
console.log("Sync result: synced=", result.synced, "errors=", result.errors?.length ?? 0);

const listings = await getListings();
const withInternalName = listings.filter((l) => l.internalName);
const withPhoto = listings.filter((l) => l.photoUrl);
const withoutPhoto = listings.filter((l) => !l.photoUrl);

console.log(`\nTotal listings: ${listings.length}`);
console.log(`With internalName: ${withInternalName.length}`);
console.log(`With photoUrl: ${withPhoto.length}`);
console.log(`Without photoUrl: ${withoutPhoto.length}`);

console.log("\nSample listings with internalName:");
withInternalName.slice(0, 5).forEach((l) => {
  console.log(`  - [${l.id}] "${l.internalName}" | photo: ${l.photoUrl ? l.photoUrl.slice(0, 60) + "..." : "NONE"}`);
});

if (withoutPhoto.length > 0) {
  console.log("\nListings without photos:");
  withoutPhoto.slice(0, 5).forEach((l) => {
    console.log(`  - [${l.id}] "${l.internalName || l.name}"`);
  });
}

process.exit(0);
