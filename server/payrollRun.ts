/**
 * Payroll Run Engine — QuickBooks Payroll Elite export
 *
 * Workflow:
 *   1. Wednesday 9 AM ET cron (or manual trigger) calls generatePayrollRun(weekOf)
 *      with the prior week's Monday. This calculates pay for every active
 *      cleaner, writes a `payrollRuns` row (status=draft) + one
 *      `payrollRunLines` row per cleaner.
 *   2. Admin reviews in the Payroll UI, edits if needed, clicks Approve →
 *      approveRun() flips status to 'approved' and freezes totals.
 *   3. Admin exports CSV via buildCsv() and uploads to QBO Payroll Elite.
 *      markSubmitted() flips status to 'submitted'.
 *
 * Commission is split by listing state (listings.state) so a cleaner
 * who worked in VA + NC has two commission dollar amounts on their line,
 * enabling correct multi-state tax allocation.
 *
 * The last payroll run of each month flips `includesMonthlyReceipts=true`
 * and populates each eligible cleaner's cell-phone + vehicle reimbursement
 * (already gated by approved receipt records in cleanerReceipts).
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  cleaners,
  completedCleans,
  listings,
  payrollRuns,
  payrollRunLines,
  weeklyPaySnapshots,
  type PayrollRun,
  type PayrollRunLine,
} from "../drizzle/schema";
import { calculateAllWeeklyPay, saveWeeklyPaySnapshot, type WeeklyPayBreakdown } from "./payCalculation";

// ── Date helpers ────────────────────────────────────────────────────────

/**
 * Return the Monday (YYYY-MM-DD) of the week prior to `today`.
 * Payroll covers the completed week, generated on Wednesday.
 */
export function getPayPeriodMondayFor(today: Date = new Date()): string {
  const d = new Date(today);
  // Go back to the most recent Monday...
  const day = d.getUTCDay(); // 0=Sun
  const mondayOffset = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  // ...then back one more week (we pay for the *prior* completed week)
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

/**
 * True if adding 7 days to the given Wednesday lands in a different calendar
 * month — meaning this is the last weekly run of the month, and monthly
 * reimbursements should be included.
 */
export function isLastRunOfMonth(wednesday: Date): boolean {
  const next = new Date(wednesday);
  next.setUTCDate(next.getUTCDate() + 7);
  return next.getUTCMonth() !== wednesday.getUTCMonth();
}

// ── State categorization ────────────────────────────────────────────────

/**
 * Normalize listings.state values into VA | NC | OTHER. Accepts both
 * abbreviations ("VA") and full names ("Virginia").
 */
export function stateBucket(state: string | null | undefined): "VA" | "NC" | "OTHER" {
  if (!state) return "OTHER";
  const s = state.trim().toLowerCase();
  if (s === "va" || s === "virginia") return "VA";
  if (s === "nc" || s === "north carolina") return "NC";
  return "OTHER";
}

// ── Generation ──────────────────────────────────────────────────────────

export interface GenerateResult {
  runId: number;
  weekOf: string;
  status: "created" | "already_exists" | "replaced_draft";
  cleanerCount: number;
  totalGrossPay: number;
}

/**
 * Generate a draft payroll run for the given week.
 *
 * If a run already exists for this week:
 *   - status=draft  → regenerate (overwrite lines)
 *   - status=approved/submitted → refuse and return status=already_exists
 */
export async function generatePayrollRun(
  weekOf: string,
  opts: { includeMonthlyReceipts?: boolean; generatedAt?: Date } = {}
): Promise<GenerateResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const generatedAt = opts.generatedAt ?? new Date();
  const includeMonthlyReceipts =
    opts.includeMonthlyReceipts ?? isLastRunOfMonth(generatedAt);

  // Check for existing run
  const [existing] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.weekOf, weekOf));

  if (existing && existing.status !== "draft") {
    return {
      runId: existing.id,
      weekOf,
      status: "already_exists",
      cleanerCount: existing.cleanerCount,
      totalGrossPay: Number(existing.totalGrossPay),
    };
  }

  // 1. Calculate pay for every active cleaner, persist snapshots
  const breakdowns = await calculateAllWeeklyPay(weekOf);
  for (const b of breakdowns) {
    await saveWeeklyPaySnapshot(b);
  }

  // 2. Load state-bucketed completed cleans for each cleaner this week
  //    (join completedCleans → listings to get state)
  const cleansByCleaner = await loadCleansByState(weekOf);

  // 3. Load saved snapshots so we can link each line back to its source
  const snapshots = await db
    .select()
    .from(weeklyPaySnapshots)
    .where(eq(weeklyPaySnapshots.weekOf, weekOf));
  const snapshotByCleaner = new Map(snapshots.map((s) => [s.cleanerId, s]));

  // 4. Load active cleaners (for quickbooksEmployeeId)
  const allCleaners = await db.select().from(cleaners);
  const cleanerById = new Map(allCleaners.map((c) => [c.id, c]));

  // 5. Upsert the run header (keep ID if replacing a draft)
  let runId: number;
  let genStatus: "created" | "replaced_draft";
  if (existing) {
    // Clear prior lines
    await db.delete(payrollRunLines).where(eq(payrollRunLines.payrollRunId, existing.id));
    runId = existing.id;
    genStatus = "replaced_draft";
  } else {
    const [inserted] = await db
      .insert(payrollRuns)
      .values({
        weekOf,
        status: "draft",
        includesMonthlyReceipts: includeMonthlyReceipts,
        cleanerCount: 0,
        totalGrossPay: "0",
        totalMileage: "0",
        totalReimbursements: "0",
        generatedAt,
      })
      .$returningId();
    runId = inserted.id;
    genStatus = "created";
  }

  // 6. Build one line per cleaner
  let totalGross = 0;
  let totalMileage = 0;
  let totalReimbursements = 0;
  let cleanerCount = 0;

  for (const b of breakdowns) {
    // Skip cleaners with zero cleans AND zero reimbursements (no pay to issue)
    if (b.totalCleans === 0 && b.cellPhoneReimbursement === 0 && b.vehicleReimbursement === 0) {
      continue;
    }

    const stateSplit = cleansByCleaner.get(b.cleanerId) ?? { VA: 0, NC: 0, OTHER: 0 };
    // Scale from raw cleaning-fee dollars to the actual commission paid
    // (after quality + volume multipliers). Distribute proportionally across states.
    const rawTotal = stateSplit.VA + stateSplit.NC + stateSplit.OTHER;
    const adjustedCommission =
      b.basePay * b.qualityMultiplier * b.volumeMultiplier;

    let commissionVA = 0;
    let commissionNC = 0;
    let commissionOther = 0;
    if (rawTotal > 0) {
      commissionVA = round2((adjustedCommission * stateSplit.VA) / rawTotal);
      commissionNC = round2((adjustedCommission * stateSplit.NC) / rawTotal);
      commissionOther = round2(adjustedCommission - commissionVA - commissionNC);
    }

    // Monthly reimbursements are only on the last run of the month
    const cellPhone = includeMonthlyReceipts ? monthlyFromWeekly(b.cellPhoneReimbursement) : 0;
    const vehicle = includeMonthlyReceipts ? monthlyFromWeekly(b.vehicleReimbursement) : 0;

    const totalCommission = round2(commissionVA + commissionNC + commissionOther);
    const totalPay = round2(totalCommission + b.mileagePay + cellPhone + vehicle);

    const cleaner = cleanerById.get(b.cleanerId);
    const qbId = cleaner?.quickbooksEmployeeId ?? null;

    await db.insert(payrollRunLines).values({
      payrollRunId: runId,
      cleanerId: b.cleanerId,
      cleanerName: b.cleanerName,
      quickbooksEmployeeId: qbId,
      weeklyPaySnapshotId: snapshotByCleaner.get(b.cleanerId)?.id ?? null,
      commissionVA: String(commissionVA),
      commissionNC: String(commissionNC),
      commissionOther: String(commissionOther),
      totalCommission: String(totalCommission),
      mileageMiles: String(b.totalMileage),
      mileageReimbursement: String(b.mileagePay),
      cellPhoneReimbursement: String(cellPhone),
      vehicleReimbursement: String(vehicle),
      totalPay: String(totalPay),
      missingQbId: !qbId,
    });

    totalGross += totalCommission;
    totalMileage += b.mileagePay;
    totalReimbursements += cellPhone + vehicle;
    cleanerCount++;
  }

  // 7. Update run header totals
  await db
    .update(payrollRuns)
    .set({
      cleanerCount,
      totalGrossPay: String(round2(totalGross)),
      totalMileage: String(round2(totalMileage)),
      totalReimbursements: String(round2(totalReimbursements)),
      includesMonthlyReceipts: includeMonthlyReceipts,
    })
    .where(eq(payrollRuns.id, runId));

  console.log(
    `[Payroll] Run ${runId} ${genStatus}: week ${weekOf}, ${cleanerCount} cleaners, $${round2(totalGross)} gross`
  );

  return {
    runId,
    weekOf,
    status: genStatus,
    cleanerCount,
    totalGrossPay: round2(totalGross),
  };
}

// ── Approval / state transitions ────────────────────────────────────────

export async function approveRun(runId: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) throw new Error(`Payroll run ${runId} not found`);
  if (run.status !== "draft") {
    throw new Error(`Run is already ${run.status}; cannot approve`);
  }

  await db
    .update(payrollRuns)
    .set({ status: "approved", approvedBy: userId, approvedAt: new Date() })
    .where(eq(payrollRuns.id, runId));
}

export async function markSubmitted(runId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) throw new Error(`Payroll run ${runId} not found`);
  if (run.status !== "approved") {
    throw new Error(`Run must be approved before marking submitted (currently ${run.status})`);
  }

  await db
    .update(payrollRuns)
    .set({ status: "submitted", submittedAt: new Date() })
    .where(eq(payrollRuns.id, runId));
}

// ── CSV export ──────────────────────────────────────────────────────────

/**
 * Build a QBO Payroll Elite-compatible CSV.
 *
 * Columns:
 *   Employee ID, Employee Name, Work State, Commission VA, Commission NC,
 *   Commission Other, Mileage Reimbursement, Cell Phone Reimbursement,
 *   Vehicle Reimbursement, Total Pay
 *
 * Accountant imports as a "paycheck import" — commission flows as
 * regular wages (not supplemental 22% withholding), reimbursements
 * flow as non-taxable.
 */
export async function buildCsv(runId: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const lines = await db
    .select()
    .from(payrollRunLines)
    .where(eq(payrollRunLines.payrollRunId, runId));

  const header = [
    "Employee ID",
    "Employee Name",
    "Commission VA",
    "Commission NC",
    "Commission Other",
    "Mileage Reimbursement",
    "Cell Phone Reimbursement",
    "Vehicle Reimbursement",
    "Total Pay",
  ];

  const rows = lines.map((l) => [
    l.quickbooksEmployeeId ?? "",
    l.cleanerName,
    fmt(l.commissionVA),
    fmt(l.commissionNC),
    fmt(l.commissionOther),
    fmt(l.mileageReimbursement),
    fmt(l.cellPhoneReimbursement),
    fmt(l.vehicleReimbursement),
    fmt(l.totalPay),
  ]);

  const all = [header, ...rows];
  return all.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

function csvCell(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function fmt(v: string | number | null): string {
  if (v === null || v === undefined) return "0.00";
  return Number(v).toFixed(2);
}

// ── Listing helpers ─────────────────────────────────────────────────────

async function loadCleansByState(
  weekOf: string
): Promise<Map<number, { VA: number; NC: number; OTHER: number }>> {
  const db = await getDb();
  if (!db) return new Map();

  const rows = await db
    .select({
      cleanerId: completedCleans.cleanerId,
      cleaningFee: completedCleans.cleaningFee,
      splitRatio: completedCleans.splitRatio,
      state: listings.state,
    })
    .from(completedCleans)
    .leftJoin(listings, eq(listings.id, completedCleans.listingId))
    .where(eq(completedCleans.weekOf, weekOf));

  const byCleaner = new Map<number, { VA: number; NC: number; OTHER: number }>();
  for (const r of rows) {
    if (r.cleanerId == null) continue;
    const bucket = stateBucket(r.state);
    const effective = Number(r.cleaningFee ?? 0) * Number(r.splitRatio ?? 1);
    const cur = byCleaner.get(r.cleanerId) ?? { VA: 0, NC: 0, OTHER: 0 };
    cur[bucket] += effective;
    byCleaner.set(r.cleanerId, cur);
  }
  return byCleaner;
}

// ── Misc ────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * `calculateWeeklyPay` stores reimbursements already prorated to weekly
 * (monthly ÷ 4.33). The monthly payout on the last run of the month
 * reverses that so the cleaner receives the full monthly amount once.
 */
function monthlyFromWeekly(weekly: number): number {
  if (!weekly || weekly <= 0) return 0;
  return round2(weekly * 4.33);
}
