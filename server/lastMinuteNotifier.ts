/**
 * Last-Minute Reservation Change Notifier
 *
 * Polls Breezeway for upcoming reservations, diffs against a snapshot of
 * the previously-seen state, and posts a consolidated Slack message for
 * any change whose *resulting* check-in or check-out falls within the
 * next 72 hours.
 *
 * Change types detected (mapped to the user's 1-4 requirements):
 *   1. shortened   — check-out moved earlier (possible surprise same-day turn)
 *   2. extended    — check-out moved later (scheduled clean no longer needed that day)
 *   3. new         — booking first seen while check-in is within 72h
 *   4. cancelled   — previously-known reservation missing from feed while
 *                    prior check-in is within 72h
 * (Bonus) checkin_shifted — check-in date changed while still within 72h.
 *
 * Dedup: a hash of each reservation's key fields is stored on the snapshot
 * row. A change only fires once per unique hash transition.
 */
import crypto from "crypto";
import { and, eq, gte, inArray } from "drizzle-orm";
import { createBreezewayClient } from "./breezeway";
import { getBreezewayProperties, getDb } from "./db";
import {
  fetchReservations,
  sendSlackNotification,
} from "./sdtNotifier";
import { reservationSnapshots } from "../drizzle/schema";

// ── Types ──────────────────────────────────────────────────────────────

export type ChangeType =
  | "new"
  | "shortened"
  | "extended"
  | "checkin_shifted"
  | "cancelled";

export interface CurrentReservation {
  breezewayReservationId: string;
  homeId: number;
  checkIn: string | null; // YYYY-MM-DD
  checkOut: string | null;
  status: string | null;
  guestName?: string | null;
}

export interface SnapshotRow {
  breezewayReservationId: string;
  homeId: number;
  checkIn: string | null;
  checkOut: string | null;
  status: string | null;
  lastChangeHash: string | null;
}

export interface LastMinuteChange {
  type: ChangeType;
  breezewayReservationId: string;
  homeId: number;
  propertyName?: string;
  previousCheckIn: string | null;
  previousCheckOut: string | null;
  newCheckIn: string | null;
  newCheckOut: string | null;
  guestName?: string | null;
  /** hash of the post-change state; stored on the snapshot to prevent re-firing */
  changeHash: string;
}

// ── Pure helpers ────────────────────────────────────────────────────────

/**
 * Return true if `date` (YYYY-MM-DD) is within `windowHours` hours from `now`.
 * Comparison is inclusive on both ends and date-only (time of day ignored).
 */
export function withinWindow(
  date: string | null,
  windowHours: number,
  now: Date = new Date()
): boolean {
  if (!date) return false;
  // Parse date as UTC midnight so results are timezone-stable.
  const target = new Date(`${date}T00:00:00Z`).getTime();
  if (isNaN(target)) return false;
  const nowMs = now.getTime();
  const cutoffEnd = nowMs + windowHours * 3600 * 1000;
  // Also accept "already started" reservations whose check-in is today or yesterday;
  // the relevant thing is whether the affected date is in the near-term window.
  // 48h back-grace covers yesterday regardless of time-of-day.
  const cutoffStart = nowMs - 48 * 3600 * 1000;
  return target >= cutoffStart && target <= cutoffEnd;
}

/** Deterministic hash of the post-change state. */
export function computeChangeHash(r: {
  checkIn: string | null;
  checkOut: string | null;
  status: string | null;
}): string {
  const s = `${r.checkIn ?? ""}|${r.checkOut ?? ""}|${r.status ?? ""}`;
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 20);
}

/** Lowercased status check for cancellations. */
export function isCancelledStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s.includes("cancel");
}

// ── Classifier ─────────────────────────────────────────────────────────

/**
 * Pure classifier — given the previously-seen snapshot (or null for unseen)
 * and the current state (or null for "disappeared from feed"), return a
 * LastMinuteChange if one should fire, else null.
 */
export function classifyChange(
  prev: SnapshotRow | null,
  curr: CurrentReservation | null,
  windowHours: number,
  now: Date = new Date()
): Omit<LastMinuteChange, "propertyName"> | null {
  // Case: cancellation (disappeared from feed OR status says cancelled)
  if (curr === null || isCancelledStatus(curr.status)) {
    if (!prev) return null; // never seen, nothing to cancel
    // Only fire if the prior check_in was within the window.
    if (!withinWindow(prev.checkIn, windowHours, now)) return null;
    const changeHash = computeChangeHash({
      checkIn: prev.checkIn,
      checkOut: prev.checkOut,
      status: "cancelled",
    });
    if (prev.lastChangeHash === changeHash) return null;
    return {
      type: "cancelled",
      breezewayReservationId: prev.breezewayReservationId,
      homeId: prev.homeId,
      previousCheckIn: prev.checkIn,
      previousCheckOut: prev.checkOut,
      newCheckIn: null,
      newCheckOut: null,
      changeHash,
    };
  }

  const currHash = computeChangeHash({
    checkIn: curr.checkIn,
    checkOut: curr.checkOut,
    status: curr.status,
  });

  // Case: brand new reservation
  if (!prev) {
    if (!withinWindow(curr.checkIn, windowHours, now)) return null;
    return {
      type: "new",
      breezewayReservationId: curr.breezewayReservationId,
      homeId: curr.homeId,
      previousCheckIn: null,
      previousCheckOut: null,
      newCheckIn: curr.checkIn,
      newCheckOut: curr.checkOut,
      guestName: curr.guestName,
      changeHash: currHash,
    };
  }

  // Already notified this exact state
  if (prev.lastChangeHash === currHash) return null;

  // Case: check-out shifted
  if (prev.checkOut && curr.checkOut && prev.checkOut !== curr.checkOut) {
    const affectedDate = curr.checkOut < prev.checkOut ? curr.checkOut : prev.checkOut;
    if (!withinWindow(affectedDate, windowHours, now)) {
      // Shift exists but both dates are beyond window — suppress
      return null;
    }
    return {
      type: curr.checkOut < prev.checkOut ? "shortened" : "extended",
      breezewayReservationId: curr.breezewayReservationId,
      homeId: curr.homeId,
      previousCheckIn: prev.checkIn,
      previousCheckOut: prev.checkOut,
      newCheckIn: curr.checkIn,
      newCheckOut: curr.checkOut,
      guestName: curr.guestName,
      changeHash: currHash,
    };
  }

  // Case: check-in shifted
  if (prev.checkIn && curr.checkIn && prev.checkIn !== curr.checkIn) {
    const affectedDate = curr.checkIn < prev.checkIn ? curr.checkIn : prev.checkIn;
    if (!withinWindow(affectedDate, windowHours, now)) return null;
    return {
      type: "checkin_shifted",
      breezewayReservationId: curr.breezewayReservationId,
      homeId: curr.homeId,
      previousCheckIn: prev.checkIn,
      previousCheckOut: prev.checkOut,
      newCheckIn: curr.checkIn,
      newCheckOut: curr.checkOut,
      guestName: curr.guestName,
      changeHash: currHash,
    };
  }

  return null;
}

// ── Slack formatter ────────────────────────────────────────────────────

const EMOJI: Record<ChangeType, string> = {
  new: "🆕",
  shortened: "⏪",
  extended: "⏩",
  checkin_shifted: "📆",
  cancelled: "❌",
};

const LABEL: Record<ChangeType, string> = {
  new: "New booking",
  shortened: "Shortened stay",
  extended: "Extended stay",
  checkin_shifted: "Check-in shifted",
  cancelled: "Cancelled",
};

export function formatSlackMessage(changes: LastMinuteChange[]): string {
  if (changes.length === 0) return "";

  const lines = changes.map((c) => {
    const name = c.propertyName || `Property #${c.homeId}`;
    const guest = c.guestName ? ` (${c.guestName})` : "";
    let detail = "";
    switch (c.type) {
      case "new":
        detail = `check-in ${c.newCheckIn ?? "?"} → check-out ${c.newCheckOut ?? "?"}`;
        break;
      case "shortened":
      case "extended":
        detail = `check-out ${c.previousCheckOut ?? "?"} → ${c.newCheckOut ?? "?"}`;
        break;
      case "checkin_shifted":
        detail = `check-in ${c.previousCheckIn ?? "?"} → ${c.newCheckIn ?? "?"}`;
        break;
      case "cancelled":
        detail = `was check-in ${c.previousCheckIn ?? "?"} → ${c.previousCheckOut ?? "?"}`;
        break;
    }
    return `${EMOJI[c.type]} *${LABEL[c.type]}* — ${name}${guest}: ${detail}`;
  });

  return [
    "⚠️ *Last-Minute Reservation Changes (next 72 hours)*",
    "",
    ...lines,
    "",
    "Review in Breezeway and adjust cleaning assignments as needed.",
  ].join("\n");
}

// ── Orchestration ──────────────────────────────────────────────────────

const FETCH_WINDOW_DAYS = 14; // fetch 14 days out so we see future changes early
const LAST_MINUTE_WINDOW_HOURS = 72;

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Normalize a Breezeway reservation object to our CurrentReservation shape. */
function toCurrent(r: any): CurrentReservation | null {
  if (!r || r.id == null || r.home_id == null) return null;
  const id = String(r.id);
  const normalize = (v: string | undefined | null): string | null => {
    if (!v) return null;
    if (v.includes("T")) return v.split("T")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : formatDate(d);
  };
  return {
    breezewayReservationId: id,
    homeId: Number(r.home_id),
    checkIn: normalize(r.check_in || r.start_date),
    checkOut: normalize(r.check_out || r.end_date),
    status: r.status ?? null,
    guestName: r.guest_name ?? null,
  };
}

export interface LastMinuteCheckResult {
  reservationsFetched: number;
  changesDetected: number;
  notified: boolean;
  changes: LastMinuteChange[];
}

export async function checkAndNotifyLastMinuteChanges(): Promise<LastMinuteCheckResult> {
  console.log("[LastMinute] Starting last-minute change check...");

  const now = new Date();
  const startDate = formatDate(new Date(now.getTime() - 24 * 3600 * 1000));
  const endDate = formatDate(
    new Date(now.getTime() + FETCH_WINDOW_DAYS * 24 * 3600 * 1000)
  );

  // 1. Fetch current state from Breezeway
  const raw = await fetchReservations(startDate, endDate);
  const currentList: CurrentReservation[] = raw
    .map(toCurrent)
    .filter((c): c is CurrentReservation => c !== null);

  console.log(
    `[LastMinute] Fetched ${currentList.length} reservations (window ${startDate} → ${endDate})`
  );

  const currentById = new Map<string, CurrentReservation>();
  for (const c of currentList) currentById.set(c.breezewayReservationId, c);

  // 2. Load snapshots we already know about
  const db = getDb();
  const currentIds = Array.from(currentById.keys());
  const cutoff = new Date(now.getTime() - 30 * 24 * 3600 * 1000); // 30-day lookback for cancellations

  const snapshotRows = await db
    .select()
    .from(reservationSnapshots)
    .where(
      currentIds.length > 0
        ? // Load current-feed reservations OR any snapshot still within lookback window
          // (used to detect cancellations of reservations missing from the feed)
          undefined
        : undefined
    );

  const snapById = new Map<string, SnapshotRow>();
  for (const s of snapshotRows) {
    snapById.set(s.breezewayReservationId, {
      breezewayReservationId: s.breezewayReservationId,
      homeId: s.homeId,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      status: s.status,
      lastChangeHash: s.lastChangeHash,
    });
  }

  // 3. Classify every current reservation
  const changes: LastMinuteChange[] = [];

  for (const curr of currentList) {
    const prev = snapById.get(curr.breezewayReservationId) ?? null;
    const c = classifyChange(prev, curr, LAST_MINUTE_WINDOW_HOURS, now);
    if (c) changes.push({ ...c });
  }

  // 4. Classify reservations that disappeared from the feed (cancellations).
  //    Only consider snapshots whose prior checkIn is still within the window
  //    AND we haven't already marked them cancelled.
  for (const [id, prev] of snapById) {
    if (currentById.has(id)) continue;
    const c = classifyChange(prev, null, LAST_MINUTE_WINDOW_HOURS, now);
    if (c) changes.push({ ...c });
  }

  console.log(`[LastMinute] Classified ${changes.length} changes`);

  // 5. Decorate with property names
  if (changes.length > 0) {
    const properties = await getBreezewayProperties();
    const nameById = new Map(
      properties.map((p) => [Number(p.breezewayId), p.name])
    );
    for (const c of changes) {
      c.propertyName = nameById.get(c.homeId) || `Property #${c.homeId}`;
    }
  }

  // 6. Send Slack notification
  let notified = false;
  if (changes.length > 0) {
    const msg = formatSlackMessage(changes);
    notified = await sendSlackNotification(msg);
    console.log(`[LastMinute] Slack notification ${notified ? "sent" : "failed"}`);
  }

  // 7. Upsert snapshots for everything we saw this cycle, stamp changeHash
  for (const curr of currentList) {
    const matchingChange = changes.find(
      (c) => c.breezewayReservationId === curr.breezewayReservationId
    );
    const prev = snapById.get(curr.breezewayReservationId) ?? null;
    const hashToStore =
      matchingChange?.changeHash ??
      prev?.lastChangeHash ??
      computeChangeHash({
        checkIn: curr.checkIn,
        checkOut: curr.checkOut,
        status: curr.status,
      });

    if (prev) {
      await db
        .update(reservationSnapshots)
        .set({
          homeId: curr.homeId,
          checkIn: curr.checkIn,
          checkOut: curr.checkOut,
          status: curr.status,
          guestName: curr.guestName ?? null,
          lastChangeHash: hashToStore,
          lastSeenAt: now,
        })
        .where(
          eq(reservationSnapshots.breezewayReservationId, curr.breezewayReservationId)
        );
    } else {
      await db.insert(reservationSnapshots).values({
        breezewayReservationId: curr.breezewayReservationId,
        homeId: curr.homeId,
        checkIn: curr.checkIn,
        checkOut: curr.checkOut,
        status: curr.status,
        guestName: curr.guestName ?? null,
        lastChangeHash: hashToStore,
        lastSeenAt: now,
      });
    }
  }

  // 8. Mark cancelled reservations so we don't re-notify
  for (const c of changes) {
    if (c.type !== "cancelled") continue;
    await db
      .update(reservationSnapshots)
      .set({ status: "cancelled", lastChangeHash: c.changeHash })
      .where(
        eq(reservationSnapshots.breezewayReservationId, c.breezewayReservationId)
      );
  }

  return {
    reservationsFetched: currentList.length,
    changesDetected: changes.length,
    notified,
    changes,
  };
}
