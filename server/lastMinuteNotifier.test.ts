import { describe, it, expect } from "vitest";
import {
  classifyChange,
  computeChangeHash,
  formatSlackMessage,
  isCancelledStatus,
  withinWindow,
  type CurrentReservation,
  type LastMinuteChange,
  type SnapshotRow,
} from "./lastMinuteNotifier";

// Fix "now" to 2026-04-13T12:00:00Z for stable window math.
const NOW = new Date("2026-04-13T12:00:00Z");
const WINDOW = 72;

// helpers
const snap = (o: Partial<SnapshotRow> & Pick<SnapshotRow, "breezewayReservationId" | "homeId">): SnapshotRow => ({
  checkIn: null,
  checkOut: null,
  status: "active",
  lastChangeHash: null,
  ...o,
});
const curr = (o: Partial<CurrentReservation> & Pick<CurrentReservation, "breezewayReservationId" | "homeId">): CurrentReservation => ({
  checkIn: null,
  checkOut: null,
  status: "active",
  guestName: null,
  ...o,
});

describe("withinWindow", () => {
  it("returns true for today", () => {
    expect(withinWindow("2026-04-13", WINDOW, NOW)).toBe(true);
  });
  it("returns true for 72h from now", () => {
    expect(withinWindow("2026-04-16", WINDOW, NOW)).toBe(true);
  });
  it("returns false for dates outside 72h", () => {
    expect(withinWindow("2026-04-20", WINDOW, NOW)).toBe(false);
  });
  it("returns false for null", () => {
    expect(withinWindow(null, WINDOW, NOW)).toBe(false);
  });
  it("accepts yesterday (within -24h grace)", () => {
    expect(withinWindow("2026-04-12", WINDOW, NOW)).toBe(true);
  });
});

describe("isCancelledStatus", () => {
  it("detects variants", () => {
    expect(isCancelledStatus("cancelled")).toBe(true);
    expect(isCancelledStatus("Cancelled")).toBe(true);
    expect(isCancelledStatus("canceled")).toBe(true);
    expect(isCancelledStatus("active")).toBe(false);
    expect(isCancelledStatus(null)).toBe(false);
  });
});

describe("classifyChange", () => {
  it("fires 'new' for unseen reservation with check-in in window", () => {
    const c = classifyChange(
      null,
      curr({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-04-14", checkOut: "2026-04-17" }),
      WINDOW,
      NOW
    );
    expect(c?.type).toBe("new");
    expect(c?.newCheckIn).toBe("2026-04-14");
  });

  it("does NOT fire 'new' when check-in is beyond 72h", () => {
    const c = classifyChange(
      null,
      curr({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-04-30", checkOut: "2026-05-03" }),
      WINDOW,
      NOW
    );
    expect(c).toBeNull();
  });

  it("fires 'shortened' when check-out moves earlier into window", () => {
    const c = classifyChange(
      snap({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-04-10", checkOut: "2026-04-20" }),
      curr({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-04-10", checkOut: "2026-04-14" }),
      WINDOW,
      NOW
    );
    expect(c?.type).toBe("shortened");
    expect(c?.previousCheckOut).toBe("2026-04-20");
    expect(c?.newCheckOut).toBe("2026-04-14");
  });

  it("fires 'extended' when check-out moves later from within window", () => {
    const c = classifyChange(
      snap({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-04-10", checkOut: "2026-04-14" }),
      curr({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-04-10", checkOut: "2026-04-20" }),
      WINDOW,
      NOW
    );
    expect(c?.type).toBe("extended");
  });

  it("suppresses extended/shortened when both dates are outside window", () => {
    const c = classifyChange(
      snap({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-05-01", checkOut: "2026-05-10" }),
      curr({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-05-01", checkOut: "2026-05-15" }),
      WINDOW,
      NOW
    );
    expect(c).toBeNull();
  });

  it("fires 'checkin_shifted' when check-in changes within window", () => {
    const c = classifyChange(
      snap({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-04-16", checkOut: "2026-04-20" }),
      curr({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-04-14", checkOut: "2026-04-20" }),
      WINDOW,
      NOW
    );
    expect(c?.type).toBe("checkin_shifted");
  });

  it("fires 'cancelled' when reservation disappears from feed", () => {
    const c = classifyChange(
      snap({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-04-14", checkOut: "2026-04-17" }),
      null,
      WINDOW,
      NOW
    );
    expect(c?.type).toBe("cancelled");
    expect(c?.previousCheckIn).toBe("2026-04-14");
  });

  it("fires 'cancelled' when status becomes cancelled", () => {
    const c = classifyChange(
      snap({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-04-14", checkOut: "2026-04-17" }),
      curr({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-04-14", checkOut: "2026-04-17", status: "cancelled" }),
      WINDOW,
      NOW
    );
    expect(c?.type).toBe("cancelled");
  });

  it("does NOT fire cancellation when prior check-in is outside window", () => {
    const c = classifyChange(
      snap({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-05-01", checkOut: "2026-05-05" }),
      null,
      WINDOW,
      NOW
    );
    expect(c).toBeNull();
  });

  it("dedups: does not re-fire when lastChangeHash matches current state", () => {
    const currentState = curr({
      breezewayReservationId: "r1",
      homeId: 100,
      checkIn: "2026-04-10",
      checkOut: "2026-04-14",
    });
    const hash = computeChangeHash({
      checkIn: currentState.checkIn,
      checkOut: currentState.checkOut,
      status: currentState.status,
    });
    const c = classifyChange(
      snap({
        breezewayReservationId: "r1",
        homeId: 100,
        checkIn: "2026-04-10",
        checkOut: "2026-04-20",
        lastChangeHash: hash,
      }),
      currentState,
      WINDOW,
      NOW
    );
    expect(c).toBeNull();
  });

  it("no change when curr == prev", () => {
    const c = classifyChange(
      snap({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-04-14", checkOut: "2026-04-17" }),
      curr({ breezewayReservationId: "r1", homeId: 100, checkIn: "2026-04-14", checkOut: "2026-04-17" }),
      WINDOW,
      NOW
    );
    // Either null (no diff), or a change whose lastChangeHash would block re-fire;
    // classifier only returns changes when something diffed, so expect null.
    expect(c).toBeNull();
  });
});

describe("formatSlackMessage", () => {
  it("renders a 'new' booking line", () => {
    const changes: LastMinuteChange[] = [
      {
        type: "new",
        breezewayReservationId: "r1",
        homeId: 100,
        propertyName: "Skyland",
        previousCheckIn: null,
        previousCheckOut: null,
        newCheckIn: "2026-04-14",
        newCheckOut: "2026-04-17",
        guestName: "Alice",
        changeHash: "abc",
      },
    ];
    const msg = formatSlackMessage(changes);
    expect(msg).toContain("New booking");
    expect(msg).toContain("Skyland");
    expect(msg).toContain("Alice");
    expect(msg).toContain("2026-04-14");
  });

  it("renders shortened stays with old → new check-out", () => {
    const changes: LastMinuteChange[] = [
      {
        type: "shortened",
        breezewayReservationId: "r1",
        homeId: 100,
        propertyName: "Skyland",
        previousCheckIn: "2026-04-10",
        previousCheckOut: "2026-04-20",
        newCheckIn: "2026-04-10",
        newCheckOut: "2026-04-14",
        changeHash: "abc",
      },
    ];
    const msg = formatSlackMessage(changes);
    expect(msg).toContain("Shortened stay");
    expect(msg).toContain("2026-04-20 → 2026-04-14");
  });

  it("renders empty for no changes", () => {
    expect(formatSlackMessage([])).toBe("");
  });

  it("renders multiple change types in one consolidated message", () => {
    const changes: LastMinuteChange[] = [
      {
        type: "new",
        breezewayReservationId: "r1",
        homeId: 100,
        propertyName: "Skyland",
        previousCheckIn: null,
        previousCheckOut: null,
        newCheckIn: "2026-04-14",
        newCheckOut: "2026-04-17",
        changeHash: "a",
      },
      {
        type: "cancelled",
        breezewayReservationId: "r2",
        homeId: 200,
        propertyName: "The Twig",
        previousCheckIn: "2026-04-14",
        previousCheckOut: "2026-04-16",
        newCheckIn: null,
        newCheckOut: null,
        changeHash: "b",
      },
    ];
    const msg = formatSlackMessage(changes);
    expect(msg.match(/Last-Minute Reservation Changes/g)?.length).toBe(1);
    expect(msg).toContain("Skyland");
    expect(msg).toContain("The Twig");
    expect(msg).toContain("Cancelled");
  });
});
