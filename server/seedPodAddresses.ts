/**
 * Seed POD storage addresses.
 * Called from a tRPC admin procedure to set the 3 POD storage addresses.
 */
import { getDb } from "./db";
import { pods } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const POD_ADDRESSES: Record<string, string> = {
  "WNC - West": "2895 Cope Creek Rd, Sylva, NC 28779",
  "WNC - East": "21 Riverwood Rd, Swannanoa, NC 28778",
  "WNC - AVL": "1515 Smokey Park Hwy, Candler, NC 28715",
};

export async function seedPodStorageAddresses(): Promise<{
  updated: number;
  created: number;
  skipped: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let updated = 0;
  let created = 0;
  let skipped = 0;

  for (const [podName, address] of Object.entries(POD_ADDRESSES)) {
    // Check if pod exists
    const [existing] = await db
      .select()
      .from(pods)
      .where(eq(pods.name, podName))
      .limit(1);

    if (existing) {
      if (existing.storageAddress !== address) {
        await db
          .update(pods)
          .set({ storageAddress: address })
          .where(eq(pods.id, existing.id));
        updated++;
        console.log(`[SeedPOD] Updated ${podName}: ${address}`);
      } else {
        skipped++;
        console.log(`[SeedPOD] ${podName} already has correct address`);
      }
    } else {
      // Create the pod
      await db.insert(pods).values({
        name: podName,
        region: podName.includes("West")
          ? "Western NC (Sylva, Dillsboro, Bryson City)"
          : podName.includes("East")
          ? "Eastern WNC (Swannanoa, Black Mountain)"
          : "Asheville Metro (Candler, West Asheville)",
        storageAddress: address,
      });
      created++;
      console.log(`[SeedPOD] Created ${podName}: ${address}`);
    }
  }

  return { updated, created, skipped };
}
