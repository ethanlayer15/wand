/**
 * Cleaner Attribution — matches completed cleans to cleaners and generates scorecards.
 *
 * NOTE: This file was truncated during Manus zip export.
 * Functions are stubs — re-export from Manus to restore full functionality.
 */

export interface CleanerScorecard {
  cleanerId: number;
  cleanerName: string;
  totalCleans: number;
  totalRevenue: number;
  averageScore: number;
  rollingScore: number | null;
}

export interface AttributionStats {
  totalCleans: number;
  attributedCleans: number;
  unattributedCleans: number;
}

export async function runCleanerAttribution(): Promise<{
  attributed: number;
  errors: number;
}> {
  console.warn("[CleanerAttribution] runCleanerAttribution is a stub — re-export from Manus");
  return { attributed: 0, errors: 0 };
}

export async function getCleanerScorecards(): Promise<CleanerScorecard[]> {
  console.warn("[CleanerAttribution] getCleanerScorecards is a stub — re-export from Manus");
  return [];
}

export async function getAttributionStats(): Promise<AttributionStats> {
  console.warn("[CleanerAttribution] getAttributionStats is a stub — re-export from Manus");
  return { totalCleans: 0, attributedCleans: 0, unattributedCleans: 0 };
}
