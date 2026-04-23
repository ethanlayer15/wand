/**
 * Cron scheduler — runs periodic background jobs.
 *
 * Jobs:
 * 1. Daily rolling score recalculation for cleaners (every 24h)
 * 2. Daily SDT (Same-Day Turnover) Slack notification (7 AM daily)
 * 3. 5× daily guest message sync + AI analysis + task creation
 *    (7 AM, 11 AM, 2 PM, 5 PM, 8 PM)
 * 4. Breezeway task sync — every 5 minutes (when enabled)
 * 5. Weekly pay reports — Friday 8 AM ET
 * 6. Monthly receipt reminder — 1st of each month 8 AM ET
 */
import { recalculateAllRollingScores } from "./compensation";
import { checkAndNotifyUnassignedSdts } from "./sdtNotifier";
import { checkAndNotifyLastMinuteChanges } from "./lastMinuteNotifier";
import { generatePayrollRun, getPriorPayWeekStartFor } from "./payrollRun";
import { startGuestMessagePipelineJob } from "./taskCreator";
import { startReviewPipelineJob } from "./reviewPipeline";
import { pollBreezewayTasks } from "./breezewayTaskSync";
import { syncCompletedCleans } from "./breezewayCleanSync";
import { getBreezewaySyncConfig } from "./db";
import { sendAllWeeklyPayReports, sendReceiptReminders } from "./emailReports";
import { runReviewDrafter } from "./agent/reviewDrafter";
import { syncBreezewayTeam, syncHostawayListings } from "./sync";
import { runUrgentTaskDigest } from "./agents/urgentDigest";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

const timers: NodeJS.Timeout[] = [];

// ── Scheduling Helpers ──────────────────────────────────────────────────

/**
 * Calculate milliseconds until the next occurrence of a given hour (local time).
 * If the hour has already passed today, returns ms until that hour tomorrow.
 */
function msUntilHour(hour: number): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

/**
 * Calculate ms until the next occurrence of a specific day-of-week + hour (ET timezone).
 * dayOfWeek: 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
 * hour: hour in ET (Eastern Time)
 */
function msUntilDayHourET(dayOfWeek: number, hour: number): number {
  const now = new Date();
  // EDT (UTC-4) from March to November, EST (UTC-5) otherwise
  const month = now.getUTCMonth(); // 0-indexed
  const utcOffset = (month >= 2 && month <= 10) ? 4 : 5;
  const utcHour = (hour + utcOffset) % 24;

  const target = new Date(now);
  target.setUTCHours(utcHour, 0, 0, 0);

  // Find the next occurrence of the target day
  const currentDay = target.getUTCDay();
  let daysUntil = dayOfWeek - currentDay;
  if (daysUntil < 0) daysUntil += 7;
  if (daysUntil === 0 && target.getTime() <= now.getTime()) daysUntil = 7;
  target.setUTCDate(target.getUTCDate() + daysUntil);

  return target.getTime() - now.getTime();
}

/**
 * Calculate ms until the next occurrence of a specific hour (ET timezone).
 * If the hour has already passed today (ET), returns ms until that hour
 * tomorrow (ET).
 */
function msUntilHourET(hour: number): number {
  const now = new Date();
  const month = now.getUTCMonth();
  const utcOffset = (month >= 2 && month <= 10) ? 4 : 5; // EDT vs EST
  const utcHour = (hour + utcOffset) % 24;
  const target = new Date(now);
  target.setUTCHours(utcHour, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

/**
 * Schedule a job to run at specific ET hours every day. Fires at each hour
 * ET, repeating daily. Use this for user-facing times (so 9 AM ET stays
 * 9 AM ET regardless of server TZ or DST).
 */
function scheduleAtHoursET(
  name: string,
  hours: number[],
  callback: () => Promise<void>,
): void {
  for (const hour of hours) {
    const delay = msUntilHourET(hour);
    const delayMin = Math.round(delay / 60_000);
    console.log(`[Cron] Scheduling "${name}" at ${hour}:00 ET (in ~${delayMin} min)`);

    const firstTimer = setTimeout(() => {
      callback().catch((err) =>
        console.error(`[Cron] "${name}" @${hour}:00 ET failed:`, err.message),
      );
      const dailyTimer = setInterval(() => {
        callback().catch((err) =>
          console.error(`[Cron] "${name}" @${hour}:00 ET failed:`, err.message),
        );
      }, ONE_DAY_MS);
      timers.push(dailyTimer);
    }, delay);
    timers.push(firstTimer);
  }
}

/**
 * Schedule a job to run at specific hours every day.
 * Fires the callback at each specified hour (local time), repeating daily.
 */
function scheduleAtHours(
  name: string,
  hours: number[],
  callback: () => Promise<void>
): void {
  for (const hour of hours) {
    const delay = msUntilHour(hour);
    const delayMin = Math.round(delay / 60_000);
    console.log(`[Cron] Scheduling "${name}" at ${hour}:00 (in ~${delayMin} min)`);

    const firstTimer = setTimeout(() => {
      callback().catch((err) =>
        console.error(`[Cron] "${name}" @${hour}:00 failed:`, err.message)
      );

      // Repeat every 24 hours after the first run
      const dailyTimer = setInterval(() => {
        callback().catch((err) =>
          console.error(`[Cron] "${name}" @${hour}:00 failed:`, err.message)
        );
      }, ONE_DAY_MS);
      timers.push(dailyTimer);
    }, delay);
    timers.push(firstTimer);
  }
}

// ── Job Definitions ─────────────────────────────────────────────────────

async function runCompensationRecalc(): Promise<void> {
  console.log("[Cron] Running daily rolling score recalculation...");
  const result = await recalculateAllRollingScores();
  console.log(
    `[Cron] Recalculation: ${result.updated}/${result.processed} cleaners updated`
  );
}

async function runWeeklyPayrollGeneration(): Promise<void> {
  try {
    const weekOf = getPriorPayWeekStartFor();
    console.log(`[Cron] Generating weekly payroll draft for week ${weekOf}...`);
    const result = await generatePayrollRun(weekOf);
    console.log(
      `[Cron] Payroll run ${result.runId} (${result.status}): ${result.cleanerCount} cleaners, $${result.totalGrossPay} gross`
    );
  } catch (err: any) {
    console.error("[Cron] Weekly payroll generation failed:", err.message);
  }
}

async function runLastMinuteCheck(): Promise<void> {
  try {
    console.log("[Cron] Running last-minute reservation change check...");
    const result = await checkAndNotifyLastMinuteChanges();
    console.log(
      `[Cron] Last-minute check: ${result.reservationsFetched} fetched, ${result.changesDetected} changes, notified=${result.notified}`
    );
  } catch (err: any) {
    console.error("[Cron] Last-minute check failed:", err.message);
  }
}

async function runSdtCheck(): Promise<void> {
  console.log("[Cron] Running SDT (Same-Day Turnover) check...");
  const result = await checkAndNotifyUnassignedSdts();
  console.log(
    `[Cron] SDT check: ${result.sdtsFound} SDTs found, ${result.unassigned} unassigned, notified=${result.notified}`
  );
}

async function runGuestMessages(): Promise<void> {
  console.log("[Cron] Running guest message pipeline (sync → analyze → tasks)...");
  const { started, message } = startGuestMessagePipelineJob();
  console.log(`[Cron] Guest messages: ${message} (started=${started})`);
}

async function runReviewPipeline(): Promise<void> {
  console.log("[Cron] Running review pipeline (sync → analyze → tasks)...");
  const { started, message } = startReviewPipelineJob();
  console.log(`[Cron] Review pipeline: ${message} (started=${started})`);
}

async function runBreezewayTaskSync(): Promise<void> {
  try {
    // Only poll if sync is enabled
    const config = await getBreezewaySyncConfig();
    if (!config.enabled) return;

    console.log("[Cron] Running Breezeway task sync poll...");
    const result = await pollBreezewayTasks();
    console.log(
      `[Cron] Breezeway sync: ${result.created} created, ${result.updated} updated, ${result.hidden} hidden, ${result.errors} errors (${result.total} fetched)`
    );
  } catch (err: any) {
    console.error("[Cron] Breezeway task sync failed:", err.message);
  }
}

async function runCompletedCleansSync(): Promise<void> {
  try {
    const config = await getBreezewaySyncConfig();
    if (!config.enabled) return;

    console.log("[Cron] Running completed cleans sync...");
    const result = await syncCompletedCleans();
    console.log(
      `[Cron] Completed cleans sync: ${result.created} created, ${result.skipped} skipped, ${result.errors} errors (${result.total} total)`
    );
  } catch (err: any) {
    console.error("[Cron] Completed cleans sync failed:", err.message);
  }
}

async function runWeeklyPayReports(): Promise<void> {
  console.log("[Cron] Running weekly pay reports (Friday 8 AM ET)...");
  const result = await sendAllWeeklyPayReports();
  console.log(
    `[Cron] Weekly pay reports: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed`
  );
}

async function runReceiptReminders(): Promise<void> {
  console.log("[Cron] Running monthly receipt reminders...");
  const result = await sendReceiptReminders();
  console.log(
    `[Cron] Receipt reminders: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed`
  );
}

/**
 * Schedule the monthly receipt reminder for the 1st of each month at 8 AM ET.
 * Uses daily check approach to avoid setTimeout overflow (max ~24.8 days for 32-bit int).
 */
function scheduleMonthlyReminder(): void {
  // Check once per day whether it's the 1st of the month
  const checkInterval = setInterval(async () => {
    const now = new Date();
    // Convert to ET
    const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const et = new Date(etStr);
    const day = et.getDate();
    const hour = et.getHours();

    // Fire on the 1st of the month between 8:00-8:59 AM ET
    if (day === 1 && hour === 8) {
      console.log("[Cron] Monthly receipt reminder triggered (1st of month, 8 AM ET)");
      try {
        await runReceiptReminders();
      } catch (err: any) {
        console.error("[Cron] Receipt reminder failed:", err.message);
      }
    }
  }, ONE_HOUR_MS); // Check every hour
  timers.push(checkInterval);
  console.log("[Cron] Monthly receipt reminder scheduled (checks hourly for 1st of month 8 AM ET)");
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Start all cron jobs.
 */
export function startCronJobs(): void {
  console.log("[Cron] Starting cron scheduler");

  // 1. Compensation recalculation — run once on startup, then every 24h
  const startupTimer = setTimeout(async () => {
    try {
      console.log("[Cron] Running initial rolling score recalculation...");
      const result = await recalculateAllRollingScores();
      console.log(
        `[Cron] Initial recalculation: ${result.updated}/${result.processed} cleaners updated`
      );
    } catch (err: any) {
      console.error("[Cron] Initial recalculation failed:", err.message);
    }
  }, 10_000);
  timers.push(startupTimer);

  const dailyTimer = setInterval(() => {
    runCompensationRecalc().catch((err) =>
      console.error("[Cron] Compensation recalc failed:", err.message)
    );
  }, ONE_DAY_MS);
  timers.push(dailyTimer);

  // 2. SDT Slack notification — daily at 7 AM
  scheduleAtHours("SDT Check", [7], runSdtCheck);

  // 3. Guest message pipeline — every 15 minutes
  const guestMsgTimer = setInterval(() => {
    runGuestMessages().catch((err) =>
      console.error("[Cron] Guest message pipeline interval failed:", err.message)
    );
  }, FIFTEEN_MINUTES_MS);
  timers.push(guestMsgTimer);
  console.log("[Cron] Guest message pipeline scheduled (every 15 min)");

  // 5. Review pipeline — 5× daily on same schedule as guest messages
  scheduleAtHours("Review Pipeline", [7, 11, 14, 17, 20], runReviewPipeline);

  // Urgent-task digest — Wanda posts to #Leisr Ops at 9 AM + 2 PM ET
  // listing urgent tasks with no activity in the last 24h. Module
  // handles its own dedupe via agentActions.
  scheduleAtHoursET("Urgent Task Digest", [9, 14], async () => {
    const outcome = await runUrgentTaskDigest();
    console.log(`[Cron] Urgent digest:`, outcome);
  });

  // 6. Review Reply Drafter — 2× daily after review pipeline
  scheduleAtHours("Review Drafter", [9, 15], async () => {
    try {
      const result = await runReviewDrafter(10);
      console.log(`[Cron] Review Drafter: ${result.drafted} drafted, ${result.skipped} skipped, ${result.errors} errors`);
    } catch (err: any) {
      console.error("[Cron] Review Drafter failed:", err.message);
    }
  });

  // 4. Breezeway task sync — every 15 minutes (reduced from 5 min to avoid rate limiting)
  const syncTimer = setInterval(() => {
    runBreezewayTaskSync().catch((err) =>
      console.error("[Cron] Breezeway task sync interval failed:", err.message)
    );
  }, FIFTEEN_MINUTES_MS);
  timers.push(syncTimer);
  console.log("[Cron] Breezeway task sync scheduled (every 15 min, if enabled)");

  // 4b. Completed cleans sync — initial run on startup + every 30 minutes
  const cleanSyncStartup = setTimeout(() => {
    runCompletedCleansSync().catch((err) =>
      console.error("[Cron] Initial completed cleans sync failed:", err.message)
    );
  }, 15_000); // 15s after boot
  timers.push(cleanSyncStartup);
  const cleanSyncTimer = setInterval(() => {
    runCompletedCleansSync().catch((err) =>
      console.error("[Cron] Completed cleans sync interval failed:", err.message)
    );
  }, 30 * 60 * 1000); // 30 minutes
  timers.push(cleanSyncTimer);
  console.log("[Cron] Completed cleans sync scheduled (startup + every 30 min, if enabled)");

  // 4c. Breezeway team sync — once on startup and then daily
  const teamSyncStartup = setTimeout(async () => {
    try {
      const config = await getBreezewaySyncConfig();
      if (config.enabled) {
        console.log("[Cron] Running initial Breezeway team sync...");
        const result = await syncBreezewayTeam();
        console.log(`[Cron] Breezeway team sync: ${result.synced} synced, ${result.errors} errors`);
      }
    } catch (err: any) {
      console.error("[Cron] Breezeway team sync failed:", err.message);
    }
  }, 15_000); // 15s after startup
  timers.push(teamSyncStartup);

  const teamSyncDaily = setInterval(async () => {
    try {
      const config = await getBreezewaySyncConfig();
      if (config.enabled) {
        const result = await syncBreezewayTeam();
        console.log(`[Cron] Daily Breezeway team sync: ${result.synced} synced, ${result.errors} errors`);
      }
    } catch (err: any) {
      console.error("[Cron] Daily Breezeway team sync failed:", err.message);
    }
  }, ONE_DAY_MS);
  timers.push(teamSyncDaily);
  console.log("[Cron] Breezeway team sync scheduled (daily, if enabled)");

  // 4d. Hostaway listings sync — once on startup and then every 6 hours.
  // New vacation rentals get added weekly, so 6h is plenty of freshness
  // without wasting API calls.
  const listingsSyncStartup = setTimeout(async () => {
    try {
      console.log("[Cron] Running initial Hostaway listings sync...");
      const result = await syncHostawayListings();
      console.log(
        `[Cron] Hostaway listings sync: ${result.synced} synced, ${result.errors} errors`
      );
    } catch (err: any) {
      console.error("[Cron] Hostaway listings sync failed:", err.message);
    }
  }, 20_000); // 20s after startup (after team sync)
  timers.push(listingsSyncStartup);

  const listingsSyncInterval = setInterval(async () => {
    try {
      const result = await syncHostawayListings();
      console.log(
        `[Cron] Periodic Hostaway listings sync: ${result.synced} synced, ${result.errors} errors`
      );
    } catch (err: any) {
      console.error("[Cron] Periodic Hostaway listings sync failed:", err.message);
    }
  }, 6 * ONE_HOUR_MS);
  timers.push(listingsSyncInterval);
  console.log("[Cron] Hostaway listings sync scheduled (every 6 hours)");

  // 6. Weekly pay reports — Friday 8 AM ET
  const fridayDelay = msUntilDayHourET(5, 8); // 5 = Friday, 8 = 8 AM ET
  const fridayDelayMin = Math.round(fridayDelay / 60_000);
  console.log(`[Cron] Scheduling "Weekly Pay Reports" for Friday 8 AM ET (in ~${fridayDelayMin} min)`);
  const fridayTimer = setTimeout(() => {
    runWeeklyPayReports().catch((err) =>
      console.error("[Cron] Weekly pay reports failed:", err.message)
    );
    // Repeat every 7 days
    const weeklyTimer = setInterval(() => {
      runWeeklyPayReports().catch((err) =>
        console.error("[Cron] Weekly pay reports failed:", err.message)
      );
    }, ONE_WEEK_MS);
    timers.push(weeklyTimer);
  }, fridayDelay);
  timers.push(fridayTimer);

  // 7. Monthly receipt reminder — 1st of each month at 8 AM ET
  scheduleMonthlyReminder();

  // 9. Weekly payroll generation — Wednesday 9 AM ET
  const wedDelay = msUntilDayHourET(3, 9); // 3 = Wednesday, 9 = 9 AM ET
  const wedDelayMin = Math.round(wedDelay / 60_000);
  console.log(`[Cron] Scheduling "Weekly Payroll Generation" for Wednesday 9 AM ET (in ~${wedDelayMin} min)`);
  const wedTimer = setTimeout(() => {
    runWeeklyPayrollGeneration().catch((err) =>
      console.error("[Cron] Weekly payroll generation failed:", err.message)
    );
    // Repeat every 7 days
    const weeklyPayrollTimer = setInterval(() => {
      runWeeklyPayrollGeneration().catch((err) =>
        console.error("[Cron] Weekly payroll generation failed:", err.message)
      );
    }, ONE_WEEK_MS);
    timers.push(weeklyPayrollTimer);
  }, wedDelay);
  timers.push(wedTimer);

  // 8. Last-minute reservation change check — initial run on startup + every 30 minutes
  const lastMinStartup = setTimeout(() => {
    runLastMinuteCheck().catch((err) =>
      console.error("[Cron] Initial last-minute check failed:", err.message)
    );
  }, 25_000); // 25s after boot (after team/listings syncs)
  timers.push(lastMinStartup);
  const lastMinInterval = setInterval(() => {
    runLastMinuteCheck().catch((err) =>
      console.error("[Cron] Last-minute check interval failed:", err.message)
    );
  }, 30 * 60 * 1000); // every 30 min
  timers.push(lastMinInterval);
  console.log("[Cron] Last-minute reservation change check scheduled (startup + every 30 min)");
}

/**
 * Stop all cron jobs.
 */
export function stopCronJobs(): void {
  for (const t of timers) {
    clearTimeout(t);
    clearInterval(t);
  }
  timers.length = 0;
  console.log("[Cron] Cron scheduler stopped");
}
