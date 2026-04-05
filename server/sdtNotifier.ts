/**
 * SDT (Same-Day Turnover) Notifier
 *
 * Checks Breezeway for the next 5 days, identifies same-day turnovers
 * (check-out + check-in on the same date), and verifies whether a
 * cleaning task with an assigned cleaner exists. If not, sends a
 * Slack notification.
 */
import { createBreezewayClient } from "./breezeway";
import { getBreezewayProperties } from "./db";
import { ENV } from "./_core/env";

// ── Types ──────────────────────────────────────────────────────────────

interface BreezewayReservation {
  id: number;
  home_id: number;
  guest_name?: string;
  check_in?: string;   // ISO date or "YYYY-MM-DD"
  check_out?: string;  // ISO date or "YYYY-MM-DD"
  start_date?: string; // alternative field name
  end_date?: string;   // alternative field name
  status?: string;
}

interface BreezewayTask {
  id: number;
  name: string;
  home_id: number;
  type_department?: string;
  scheduled_date?: string;
  type_task_status?: { code: string; name: string; stage: string };
  assignments?: Array<{
    assignee_id: number;
    name: string;
    type_task_user_status: string;
  }>;
}

export interface SdtAlert {
  propertyName: string;
  propertyId: number;
  date: string; // YYYY-MM-DD
  hasCheckOut: boolean;
  hasCheckIn: boolean;
  hasAssignedCleaner: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getNextNDays(n: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    dates.push(formatDate(d));
  }
  return dates;
}

/**
 * Normalize a date value from the Breezeway reservation API.
 * Returns YYYY-MM-DD or null.
 */
function normalizeDate(val: string | undefined | null): string | null {
  if (!val) return null;
  // Handle ISO datetime strings
  if (val.includes("T")) return val.split("T")[0];
  // Handle YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  // Try parsing
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return formatDate(d);
  } catch { /* ignore */ }
  return null;
}

// ── Core Logic ──────────────────────────────────────────────────────────

/**
 * Fetch reservations from Breezeway for a date window.
 * Tries multiple endpoint patterns since the Breezeway reservation
 * API shape may vary.
 */
export async function fetchReservations(
  startDate: string,
  endDate: string
): Promise<BreezewayReservation[]> {
  const client = createBreezewayClient();
  const allReservations: BreezewayReservation[] = [];

  // Try fetching reservations across all properties
  try {
    const response = await client.get<{
      results?: BreezewayReservation[];
      total_results?: number;
      total_pages?: number;
    }>("/reservation", {
      date_start: startDate,
      date_end: endDate,
      limit: 500,
      page: 1,
    });

    if (response.results && response.results.length > 0) {
      allReservations.push(...response.results);

      // Paginate if needed
      const totalPages = response.total_pages || 1;
      for (let page = 2; page <= totalPages; page++) {
        try {
          const pageResp = await client.get<{
            results?: BreezewayReservation[];
          }>("/reservation", {
            date_start: startDate,
            date_end: endDate,
            limit: 500,
            page,
          });
          if (pageResp.results) allReservations.push(...pageResp.results);
        } catch { break; }
      }
    }
  } catch (err: any) {
    console.warn("[SDT] Failed to fetch reservations from /reservation endpoint:", err.message);

    // Fallback: try per-property reservation fetch
    try {
      const properties = await getBreezewayProperties();
      const BATCH = 10;
      for (let i = 0; i < properties.length; i += BATCH) {
        const batch = properties.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map((p) =>
            client.get<{ results?: BreezewayReservation[] }>(
              `/property/${p.breezewayId}/reservation`,
              { date_start: startDate, date_end: endDate, limit: 200 }
            )
          )
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value.results) {
            allReservations.push(...r.value.results);
          }
        }
        if (i + BATCH < properties.length) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    } catch (fallbackErr: any) {
      console.error("[SDT] Fallback per-property reservation fetch also failed:", fallbackErr.message);
    }
  }

  return allReservations;
}

/**
 * Detect same-day turnovers from a list of reservations.
 * An SDT exists when a property has both a check-out and check-in on the same date.
 */
export function detectSdts(
  reservations: BreezewayReservation[],
  dates: string[]
): Map<string, { propertyId: number; date: string }> {
  // Build lookup: propertyId+date → { hasCheckIn, hasCheckOut }
  const lookup = new Map<string, { checkIns: number; checkOuts: number }>();

  for (const res of reservations) {
    const checkIn = normalizeDate(res.check_in || res.start_date);
    const checkOut = normalizeDate(res.check_out || res.end_date);

    if (checkOut && dates.includes(checkOut)) {
      const key = `${res.home_id}:${checkOut}`;
      const entry = lookup.get(key) || { checkIns: 0, checkOuts: 0 };
      entry.checkOuts++;
      lookup.set(key, entry);
    }

    if (checkIn && dates.includes(checkIn)) {
      const key = `${res.home_id}:${checkIn}`;
      const entry = lookup.get(key) || { checkIns: 0, checkOuts: 0 };
      entry.checkIns++;
      lookup.set(key, entry);
    }
  }

  // SDT = both checkIn and checkOut on the same property+date
  const sdts = new Map<string, { propertyId: number; date: string }>();
  for (const [key, val] of lookup) {
    if (val.checkIns > 0 && val.checkOuts > 0) {
      const [propId, date] = key.split(":");
      sdts.set(key, { propertyId: Number(propId), date });
    }
  }

  return sdts;
}

/**
 * Check if a property has an assigned cleaning task on a given date.
 */
export async function hasAssignedCleaningTask(
  propertyId: number,
  date: string
): Promise<boolean> {
  try {
    const client = createBreezewayClient();
    const response = await client.get<{
      results?: BreezewayTask[];
    }>("/task/", {
      home_id: propertyId,
      limit: 100,
      page: 1,
    });

    const tasks = response.results || [];

    // Find housekeeping tasks scheduled for this date with an assignment
    return tasks.some((task) => {
      const isHousekeeping = task.type_department === "housekeeping";
      const taskDate = normalizeDate(task.scheduled_date);
      const matchesDate = taskDate === date;
      const hasAssignment =
        task.assignments &&
        task.assignments.length > 0 &&
        task.assignments.some((a) => a.assignee_id > 0);

      return isHousekeeping && matchesDate && hasAssignment;
    });
  } catch (err: any) {
    console.warn(`[SDT] Failed to check tasks for property ${propertyId} on ${date}:`, err.message);
    return false; // Assume unassigned if we can't check
  }
}

// ── Slack Notification ──────────────────────────────────────────────────

/**
 * Send a Slack notification via incoming webhook.
 */
export async function sendSlackNotification(message: string): Promise<boolean> {
  const webhookUrl = ENV.slackWebhookUrl;
  if (!webhookUrl) {
    console.warn("[SDT] SLACK_WEBHOOK_URL not configured — skipping notification");
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[SDT] Slack notification failed: ${response.status} ${error}`);
      return false;
    }

    return true;
  } catch (err: any) {
    console.error("[SDT] Slack notification error:", err.message);
    return false;
  }
}

/**
 * Format a consolidated Slack message for multiple unassigned SDTs.
 */
export function formatSlackMessage(
  alerts: SdtAlert[]
): string {
  if (alerts.length === 0) return "";

  const lines = alerts.map(
    (a) => `• *${a.propertyName}* on ${a.date}`
  );

  return [
    "🚨 *Possible Unassigned Same-Day Turnovers*",
    "",
    ...lines,
    "",
    "Please review in Breezeway and assign cleaners.",
  ].join("\n");
}

// ── Main Check ──────────────────────────────────────────────────────────

/**
 * Run the full SDT check: fetch reservations, detect SDTs, check tasks,
 * send Slack notification for any unassigned SDTs.
 */
export async function checkAndNotifyUnassignedSdts(): Promise<{
  sdtsFound: number;
  unassigned: number;
  notified: boolean;
}> {
  console.log("[SDT] Starting same-day turnover check...");

  const dates = getNextNDays(5);
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  console.log(`[SDT] Checking dates: ${startDate} to ${endDate}`);

  // 1. Fetch reservations
  const reservations = await fetchReservations(startDate, endDate);
  console.log(`[SDT] Found ${reservations.length} reservations in date window`);

  if (reservations.length === 0) {
    console.log("[SDT] No reservations found — nothing to check");
    return { sdtsFound: 0, unassigned: 0, notified: false };
  }

  // 2. Detect SDTs
  const sdts = detectSdts(reservations, dates);
  console.log(`[SDT] Detected ${sdts.size} same-day turnovers`);

  if (sdts.size === 0) {
    console.log("[SDT] No same-day turnovers detected");
    return { sdtsFound: 0, unassigned: 0, notified: false };
  }

  // 3. Build property name lookup
  const properties = await getBreezewayProperties();
  const propNameMap = new Map(
    properties.map((p) => [Number(p.breezewayId), p.name])
  );

  // 4. Check each SDT for assigned cleaning task
  const alerts: SdtAlert[] = [];

  for (const [, sdt] of sdts) {
    const hasAssigned = await hasAssignedCleaningTask(sdt.propertyId, sdt.date);

    if (!hasAssigned) {
      alerts.push({
        propertyName: propNameMap.get(sdt.propertyId) || `Property #${sdt.propertyId}`,
        propertyId: sdt.propertyId,
        date: sdt.date,
        hasCheckOut: true,
        hasCheckIn: true,
        hasAssignedCleaner: false,
      });
    }

    // Small delay between task checks to avoid rate limiting
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[SDT] ${alerts.length} unassigned SDTs found out of ${sdts.size} total`);

  // 5. Send consolidated Slack notification
  let notified = false;
  if (alerts.length > 0) {
    const message = formatSlackMessage(alerts);
    notified = await sendSlackNotification(message);
    console.log(`[SDT] Slack notification ${notified ? "sent" : "failed"}`);
  }

  return {
    sdtsFound: sdts.size,
    unassigned: alerts.length,
    notified,
  };
}
