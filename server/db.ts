import { eq, desc, asc, sql, isNull, isNotNull, and, inArray, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2";
import {
  InsertUser,
  InsertListing,
  InsertReview,
  InsertBreezewayProperty,
  InsertBreezewayTeamMember,
  InsertTeamInvitation,
  users,
  listings,
  tasks,
  reviews,
  integrations,
  breezewayTokens,
  breezewayAuditLogs,
  breezewayProperties,
  breezewayTeam,
  guestMessages,
  teamInvitations,
  pods,
  podVendors,
  propertyVendors,
  InsertPodVendor,
  InsertPropertyVendor,
  taskComments,
  InsertTaskComment,
  taskAttachments,
  InsertTaskAttachment,
  cleanerPods,
  CleanerPod,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

/**
 * Use a connection pool instead of a single connection so that after sandbox
 * hibernation (ECONNRESET / ECONNREFUSED) mysql2 automatically acquires a
 * fresh connection rather than reusing the stale one.
 */
let _pool: mysql.Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
      });
      _db = drizzle(_pool);
      console.log("[Database] Connection pool created");

      // Run safe schema migrations (idempotent ALTER TABLE statements)
      try {
        await _pool.promise().query(
          `ALTER TABLE reviews ADD COLUMN cleanlinessRating int DEFAULT NULL`
        );
        console.log("[Database] Added cleanlinessRating column to reviews");
      } catch (e: any) {
        // Column already exists — expected after first run
        if (!e.message?.includes("Duplicate column")) {
          console.warn("[Database] Migration note:", e.message);
        }
      }

      // Add aiTaskTitle column to reviews
      try {
        await _pool.promise().query(
          `ALTER TABLE reviews ADD COLUMN aiTaskTitle VARCHAR(256) DEFAULT NULL`
        );
        console.log("[Database] Added aiTaskTitle column to reviews");
      } catch (e: any) {
        if (!e.message?.includes("Duplicate column")) {
          console.warn("[Database] Migration note:", e.message);
        }
      }

      // Add aiActionTitle column to guestMessages
      try {
        await _pool.promise().query(
          `ALTER TABLE guestMessages ADD COLUMN aiActionTitle VARCHAR(256) DEFAULT NULL`
        );
        console.log("[Database] Added aiActionTitle column to guestMessages");
      } catch (e: any) {
        if (!e.message?.includes("Duplicate column")) {
          console.warn("[Database] Migration note:", e.message);
        }
      }

      // Create cleaning report tables if they don't exist
      try {
        await _pool.promise().query(`
          CREATE TABLE IF NOT EXISTS cleaningReportRecipients (
            id INT AUTO_INCREMENT PRIMARY KEY,
            listingId INT NOT NULL,
            phoneNumber VARCHAR(20) NOT NULL,
            name VARCHAR(256),
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
          )
        `);
        await _pool.promise().query(`
          CREATE TABLE IF NOT EXISTS cleaningReportsSent (
            id INT AUTO_INCREMENT PRIMARY KEY,
            completedCleanId INT NOT NULL,
            breezewayTaskId VARCHAR(128) NOT NULL,
            recipientPhoneNumbers TEXT NOT NULL,
            reportStatus ENUM('sent', 'failed', 'no_recipients') DEFAULT 'sent' NOT NULL,
            errorMessage TEXT,
            sentAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
          )
        `);
        console.log("[Database] Cleaning report tables ensured");
      } catch (e: any) {
        console.warn("[Database] Cleaning report tables migration:", e.message);
      }

      // ── Wand AI Agents (Phase 1) ─────────────────────────────────────
      try {
        await _pool.promise().query(`
          CREATE TABLE IF NOT EXISTS agentSuggestions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            agentName VARCHAR(64) NOT NULL,
            kind VARCHAR(64) NOT NULL,
            title TEXT NOT NULL,
            summary TEXT,
            reasoning TEXT,
            proposedAction JSON,
            confidence DECIMAL(3,2),
            agentSuggestionStatus ENUM('pending','approved','dismissed','edited','snoozed','executed','failed') NOT NULL DEFAULT 'pending',
            relatedListingId INT,
            relatedCleanerId INT,
            relatedTaskId INT,
            relatedReviewId INT,
            relatedPodId INT,
            reviewedBy INT,
            reviewedAt TIMESTAMP NULL,
            reviewNotes TEXT,
            executedAt TIMESTAMP NULL,
            executionResult TEXT,
            snoozedUntil TIMESTAMP NULL,
            createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_agent_suggestions_status (agentSuggestionStatus),
            INDEX idx_agent_suggestions_agent (agentName),
            INDEX idx_agent_suggestions_listing (relatedListingId),
            INDEX idx_agent_suggestions_created (createdAt)
          )
        `);
        await _pool.promise().query(`
          CREATE TABLE IF NOT EXISTS agentActions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            agentName VARCHAR(64) NOT NULL,
            runId VARCHAR(64),
            toolName VARCHAR(128) NOT NULL,
            input JSON,
            output JSON,
            success BOOLEAN NOT NULL DEFAULT TRUE,
            errorMessage TEXT,
            durationMs INT,
            userId INT,
            triggeredBy VARCHAR(64),
            suggestionId INT,
            createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_agent_actions_run (runId),
            INDEX idx_agent_actions_agent (agentName),
            INDEX idx_agent_actions_tool (toolName),
            INDEX idx_agent_actions_created (createdAt)
          )
        `);
        await _pool.promise().query(`
          CREATE TABLE IF NOT EXISTS propertyPlaybooks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            listingId INT NOT NULL UNIQUE,
            quirks JSON,
            frequentIssues JSON,
            preferredVendors JSON,
            guestFeedbackThemes JSON,
            manualNotes TEXT,
            agentSummary TEXT,
            lastAgentUpdateAt TIMESTAMP NULL,
            lastManualUpdateAt TIMESTAMP NULL,
            createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          )
        `);
        console.log("[Database] Wand Agent tables ensured");
      } catch (e: any) {
        console.warn("[Database] Agent tables migration:", e.message);
      }

      // ── Backfill: any tasks without a board → Leisr Ops ──────────────
      // Phase 2 introduced board filtering; tasks created via paths that
      // don't set boardId default to NULL and disappear from per-board
      // views. Idempotent — safe to run on every boot.
      try {
        const [r] = await _pool
          .promise()
          .query(
            `UPDATE tasks
                SET boardId = (SELECT id FROM boards WHERE slug = 'leisr_ops')
              WHERE boardId IS NULL`
          );
        const affected = (r as any)?.affectedRows ?? 0;
        if (affected > 0) {
          console.log(`[Database] Backfilled boardId for ${affected} task(s) → leisr_ops`);
        }
      } catch (e: any) {
        // boards table not present yet (first boot before Phase 1 migration)
        if (!e.message?.includes("doesn't exist")) {
          console.warn("[Database] Board backfill skipped:", e.message);
        }
      }

      // ── Backfill: reviews with cleanlinessRating → source = "airbnb" ─
      // cleanlinessRating is Airbnb-exclusive; any review that has one
      // but was tagged "direct"/"vrbo"/"booking" was misclassified by the
      // earlier channelId-only logic. Idempotent — safe on every boot.
      try {
        const [r] = await _pool
          .promise()
          .query(
            `UPDATE reviews
                SET source = 'airbnb'
              WHERE cleanlinessRating IS NOT NULL AND source <> 'airbnb'`
          );
        const affected = (r as any)?.affectedRows ?? 0;
        if (affected > 0) {
          console.log(`[Database] Backfilled source=airbnb for ${affected} review(s)`);
        }
      } catch (e: any) {
        console.warn("[Database] Review source backfill skipped:", e.message);
      }

      // ── Backfill: re-map historical reviews by channelId ──────────────
      // Reviews synced under older sync code that didn't recognize all
      // channel IDs got stuck with source='direct'. Re-apply the current
      // channelId → source mapping to any row whose source no longer
      // matches its channelId. 2002 intentionally excluded — meaning
      // unclear (could be direct or a legacy variant). Idempotent.
      try {
        const channelMappings: Array<{ source: string; channelIds: number[] }> = [
          { source: "airbnb",  channelIds: [2005, 2018] },
          { source: "vrbo",    channelIds: [2004] },
          { source: "booking", channelIds: [2003] },
        ];
        for (const { source, channelIds } of channelMappings) {
          const placeholders = channelIds.map(() => "?").join(",");
          const [r] = await _pool
            .promise()
            .query(
              `UPDATE reviews
                  SET source = ?
                WHERE channelId IN (${placeholders}) AND source <> ?`,
              [source, ...channelIds, source],
            );
          const affected = (r as any)?.affectedRows ?? 0;
          if (affected > 0) {
            console.log(
              `[Database] Backfilled source=${source} for ${affected} review(s) (channelId in ${channelIds.join(",")})`,
            );
          }
        }
      } catch (e: any) {
        console.warn("[Database] Review channelId backfill skipped:", e.message);
      }

      // ── Migration: drop listings.bedroomTier ───────────────────────────
      // Replaced by the fee-based pay formula (10% of cleaningFeeCharge,
      // rounded up to $10) in April 2026. Historical weekly pay snapshots
      // retain their own numbers so no data needs to be preserved.
      // Idempotent via the Unknown-column guard.
      try {
        await _pool
          .promise()
          .query(`ALTER TABLE listings DROP COLUMN bedroomTier`);
        console.log("[Database] Dropped listings.bedroomTier column");
      } catch (e: any) {
        const msg = e.message ?? "";
        if (!msg.includes("check that column/key exists") && !msg.includes("doesn't exist") && !msg.includes("Unknown column")) {
          console.warn("[Database] bedroomTier drop skipped:", msg);
        }
      }

      // ── Migration + backfill: listings.onboardingStatus ────────────────
      // New properties from the Hostaway sync land in "pending" so they
      // show up in the Onboarding queue until an admin assigns pod +
      // cleaning fee + bedroom tier. Existing properties are already
      // configured, so mark them all "onboarded" the first time this
      // column appears. Idempotent via Duplicate-column guard.
      try {
        await _pool
          .promise()
          .query(
            `ALTER TABLE listings
               ADD COLUMN onboardingStatus ENUM('pending','onboarded') NOT NULL DEFAULT 'pending'`,
          );
        console.log("[Database] Added listings.onboardingStatus column");
        // Column was just created → backfill every existing row to "onboarded"
        const [r] = await _pool
          .promise()
          .query(`UPDATE listings SET onboardingStatus = 'onboarded'`);
        const affected = (r as any)?.affectedRows ?? 0;
        console.log(
          `[Database] Backfilled ${affected} existing listings to onboardingStatus='onboarded'`,
        );
      } catch (e: any) {
        if (!e.message?.includes("Duplicate column") && !e.message?.includes("already exists")) {
          console.warn("[Database] onboardingStatus migration skipped:", e.message);
        }
      }
    } catch (error) {
      console.warn("[Database] Failed to create pool:", error);
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

/**
 * Default board id for newly-created tasks (Leisr Ops).
 *
 * Memoized after first lookup. Used by every task-insert path to ensure
 * tasks never land with boardId=NULL (which makes them invisible in
 * per-board kanban views).
 */
let _defaultBoardId: number | null = null;
export async function getDefaultBoardId(): Promise<number | null> {
  if (_defaultBoardId !== null) return _defaultBoardId;
  const db = await getDb();
  if (!db) return null;
  try {
    const { boards } = await import("../drizzle/schema");
    const rows = await db
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.slug, "leisr_ops"))
      .limit(1);
    if (rows.length > 0) {
      _defaultBoardId = rows[0].id;
      return _defaultBoardId;
    }
  } catch (err: any) {
    console.warn("[Database] getDefaultBoardId failed:", err.message);
  }
  return null;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod", "avatarUrl"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Listings queries
export async function getListings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(listings).orderBy(desc(listings.createdAt));
}

export async function getListingById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(listings)
    .where(eq(listings.id, id))
    .limit(1);
  return result[0];
}

// Tasks queries
export async function getTasks() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: tasks.id,
      externalId: tasks.externalId,
      externalSource: tasks.externalSource,
      listingId: tasks.listingId,
      title: tasks.title,
      description: tasks.description,
      priority: tasks.priority,
      status: tasks.status,
      category: tasks.category,
      source: tasks.source,
      taskType: tasks.taskType,
      syncStatus: tasks.syncStatus,
      lastSyncedAt: tasks.lastSyncedAt,
      breezewayUpdatedAt: tasks.breezewayUpdatedAt,
      hiddenFromBoard: tasks.hiddenFromBoard,
      dueDate: tasks.dueDate,
      assignedTo: tasks.assignedTo,
      breezewayTaskId: tasks.breezewayTaskId,
      breezewayPushedAt: tasks.breezewayPushedAt,
      breezewayHomeId: tasks.breezewayHomeId,
      breezewayCreatorName: tasks.breezewayCreatorName,
      hostawayReservationId: tasks.hostawayReservationId,
      arrivalDate: tasks.arrivalDate,
      departureDate: tasks.departureDate,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      listingName: sql<string>`COALESCE(${listings.internalName}, ${listings.name})`.as("listingName"),
      isUrgent: tasks.isUrgent,
      resolutionStatus: tasks.resolutionStatus,
      resolutionConfidence: tasks.resolutionConfidence,
      resolutionReason: tasks.resolutionReason,
      resolvedAt: tasks.resolvedAt,
      resolutionMessageId: tasks.resolutionMessageId,
      monitoringExpiresAt: tasks.monitoringExpiresAt,
      // Phase 1 board / visibility columns
      boardId: tasks.boardId,
      visibility: tasks.visibility,
      ownerUserId: tasks.ownerUserId,
      ownerAgent: tasks.ownerAgent,
    })
    .from(tasks)
    .leftJoin(listings, eq(tasks.listingId, listings.id))
    .orderBy(desc(tasks.createdAt));
  return rows;
}

export async function getTaskDetail(taskId: number) {
  const db = await getDb();
  if (!db) return null;

  // Get the task with listing info
  const [task] = await db
    .select({
      id: tasks.id,
      externalId: tasks.externalId,
      externalSource: tasks.externalSource,
      listingId: tasks.listingId,
      title: tasks.title,
      description: tasks.description,
      priority: tasks.priority,
      status: tasks.status,
      category: tasks.category,
      source: tasks.source,
      taskType: tasks.taskType,
      syncStatus: tasks.syncStatus,
      lastSyncedAt: tasks.lastSyncedAt,
      breezewayUpdatedAt: tasks.breezewayUpdatedAt,
      hiddenFromBoard: tasks.hiddenFromBoard,
      dueDate: tasks.dueDate,
      assignedTo: tasks.assignedTo,
      breezewayTaskId: tasks.breezewayTaskId,
      breezewayPushedAt: tasks.breezewayPushedAt,
      breezewayHomeId: tasks.breezewayHomeId,
      breezewayCreatorName: tasks.breezewayCreatorName,
      hostawayReservationId: tasks.hostawayReservationId,
      arrivalDate: tasks.arrivalDate,
      departureDate: tasks.departureDate,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      listingName: sql<string>`COALESCE(${listings.internalName}, ${listings.name})`.as("listingName"),
      listingAddress: listings.address,
      listingPhotoUrl: listings.photoUrl,
      isUrgent: tasks.isUrgent,
      resolutionStatus: tasks.resolutionStatus,
      resolutionConfidence: tasks.resolutionConfidence,
      resolutionReason: tasks.resolutionReason,
      resolvedAt: tasks.resolvedAt,
      resolutionMessageId: tasks.resolutionMessageId,
      monitoringExpiresAt: tasks.monitoringExpiresAt,
    })
    .from(tasks)
    .leftJoin(listings, eq(tasks.listingId, listings.id))
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!task) return null;

  // Get messages directly linked to this task
  const linkedMessages = await db
    .select()
    .from(guestMessages)
    .where(eq(guestMessages.taskId, taskId))
    .orderBy(guestMessages.sentAt);

  // Also get the full conversation thread if we have an externalId (conversationId)
  let conversationMessages: typeof linkedMessages = [];
  if (task.externalId) {
    conversationMessages = await db
      .select()
      .from(guestMessages)
      .where(eq(guestMessages.hostawayConversationId, task.externalId))
      .orderBy(guestMessages.sentAt);
  }

  // Merge and deduplicate (conversation may include linked messages)
  const seenIds = new Set<number>();
  const allMessages = [...conversationMessages, ...linkedMessages].filter((m) => {
    if (seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    return true;
  });

  // Sort by sentAt
  allMessages.sort((a, b) => {
    const aTime = a.sentAt ? new Date(a.sentAt).getTime() : 0;
    const bTime = b.sentAt ? new Date(b.sentAt).getTime() : 0;
    return aTime - bTime;
  });

  // Get internal team comments
  const comments = await db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt));

  return {
    task,
    messages: allMessages,
    linkedMessageIds: linkedMessages.map((m) => m.id),
    comments,
  };
}

export async function getTasksByStatus(status: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.status, status as any))
    .orderBy(desc(tasks.createdAt));
}

export async function updateTaskStatus(
  taskId: number,
  status: "created" | "needs_review" | "up_next" | "in_progress" | "completed" | "ignored" | "ideas_for_later",
  options?: { overrideSync?: boolean }
): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) return { success: false };
  // When a user manually moves a task (drag-and-drop or status change),
  // set statusOverridden=true so the Breezeway sync never resets it.
  const updatePayload: Record<string, any> = { status };
  if (options?.overrideSync !== false) {
    updatePayload.statusOverridden = true;
  }
  await db
    .update(tasks)
    .set(updatePayload)
    .where(eq(tasks.id, taskId));
  return { success: true };
}

export async function updateTaskTitle(
  taskId: number,
  title: string
): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) return { success: false };
  await db
    .update(tasks)
    .set({ title })
    .where(eq(tasks.id, taskId));
  return { success: true };
}

export async function reopenAutoResolvedTask(
  taskId: number
): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) return { success: false };
  await db
    .update(tasks)
    .set({
      resolutionStatus: "reopened",
      status: "created",
      resolvedAt: null,
    })
    .where(eq(tasks.id, taskId));
  return { success: true };
}

export async function confirmResolution(
  taskId: number
): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) return { success: false };
  await db
    .update(tasks)
    .set({
      resolutionStatus: "auto_resolved",
      status: "completed",
      resolvedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));
  return { success: true };
}

export async function toggleTaskUrgent(
  taskId: number,
  isUrgent: boolean
): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) return { success: false };
  await db
    .update(tasks)
    .set({ isUrgent })
    .where(eq(tasks.id, taskId));
  return { success: true };
}

export async function createTask(data: {
  title: string;
  description?: string;
  priority: "low" | "medium" | "high" | "urgent";
  taskType?: "maintenance" | "housekeeping" | "inspection" | "safety" | "other";
  listingId?: number;
  assignedTo?: string;
  status?: "created" | "needs_review" | "up_next" | "in_progress" | "completed" | "ignored" | "ideas_for_later";
}): Promise<{ success: boolean; id?: number }> {
  const db = await getDb();
  if (!db) return { success: false };
  const isUrgent = data.priority === "urgent";
  const boardId = await getDefaultBoardId();
  const result = await db.insert(tasks).values({
    title: data.title,
    description: data.description,
    priority: data.priority === "urgent" ? "high" : data.priority,
    isUrgent,
    taskType: data.taskType,
    listingId: data.listingId,
    assignedTo: data.assignedTo,
    status: data.status || "created",
    source: "wand_manual",
    category: "maintenance",
    boardId: boardId ?? undefined,
  });
  const insertId = (result as any)[0]?.insertId;
  return { success: true, id: insertId };
}

export async function getUrgentTasks(): Promise<Array<{
  id: number;
  title: string;
  status: string;
  priority: string;
  assignedTo: string | null;
  listingName: string | null;
  listingId: number | null;
  createdAt: Date;
  isUrgent: boolean;
}>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      assignedTo: tasks.assignedTo,
      listingId: tasks.listingId,
      arrivalDate: tasks.arrivalDate,
      departureDate: tasks.departureDate,
      createdAt: tasks.createdAt,
      isUrgent: tasks.isUrgent,
      listingName: sql<string>`COALESCE(${listings.internalName}, ${listings.name})`.as("listingName"),
    })
    .from(tasks)
    .leftJoin(listings, eq(tasks.listingId, listings.id))
    .where(and(eq(tasks.isUrgent, true), eq(tasks.hiddenFromBoard, false)))
    .orderBy(desc(tasks.createdAt));
  return rows;
}

export async function updateTaskAssignee(
  taskId: number,
  assignedTo: string | null
): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) return { success: false };
  await db
    .update(tasks)
    .set({ assignedTo })
    .where(eq(tasks.id, taskId));
  return { success: true };
}

export async function getTeamMembersForAssignment(): Promise<Array<{ id: number; name: string }>> {
  const db = await getDb();
  if (!db) return [];
  const wandUsers = await db
    .select()
    .from(users)
    .orderBy(users.name);
  return wandUsers.map((u) => ({
    id: u.id,
    name: u.name || u.email || `User #${u.id}`,
  }));
}

// Reviews queries
export async function getReviews() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reviews).orderBy(desc(reviews.createdAt));
}

export async function getFlaggedReviews() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(reviews)
    .where(eq(reviews.flagged, true))
    .orderBy(desc(reviews.createdAt));
}

// Integration queries
export async function getIntegration(name: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(integrations)
    .where(eq(integrations.name, name as any))
    .limit(1);
  return result[0];
}

export async function getIntegrations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(integrations);
}

// Breezeway token queries
export async function getLatestBreezewayToken() {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(breezewayTokens)
    .orderBy(desc(breezewayTokens.createdAt))
    .limit(1);
  return result[0];
}

// Breezeway properties queries
export async function getBreezewayProperties() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(breezewayProperties)
    .orderBy(desc(breezewayProperties.createdAt));
}

// Breezeway team queries
export async function getBreezewayTeam() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(breezewayTeam)
    .orderBy(breezewayTeam.firstName);
}

// Sync helpers
export async function upsertListing(listing: InsertListing): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(listings)
    .values(listing)
    .onDuplicateKeyUpdate({
      set: {
        name: listing.name,
        internalName: listing.internalName,
        address: listing.address,
        city: listing.city,
        state: listing.state,
        country: listing.country,
        guestCapacity: listing.guestCapacity,
        status: listing.status,
        photoUrl: listing.photoUrl,
        avgRating: listing.avgRating,
        reviewCount: listing.reviewCount,
      },
    });
}

export async function upsertReview(review: InsertReview): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(reviews)
    .values(review)
    .onDuplicateKeyUpdate({
      set: {
        rating: review.rating,
        text: review.text,
        guestName: review.guestName,
        source: review.source,
        flagged: review.flagged,
        flagReason: review.flagReason,
        sentiment: review.sentiment,
        reviewStatus: review.reviewStatus,
        reviewType: review.reviewType,
        submittedAt: review.submittedAt,
      },
    });
}

export async function getListingByHostawayId(hostawayId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(listings)
    .where(eq(listings.hostawayId, hostawayId))
    .limit(1);
  return result[0];
}

export async function upsertBreezewayProperty(
  property: InsertBreezewayProperty
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(breezewayProperties)
    .values(property)
    .onDuplicateKeyUpdate({
      set: {
        name: property.name,
        referencePropertyId: property.referencePropertyId,
        address: property.address,
        city: property.city,
        state: property.state,
        status: property.status,
        photoUrl: property.photoUrl,
        tags: property.tags,
        syncedAt: new Date(),
      },
    });
}

export async function upsertBreezewayTeamMember(
  member: InsertBreezewayTeamMember
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(breezewayTeam)
    .values(member)
    .onDuplicateKeyUpdate({
      set: {
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        role: member.role,
        active: member.active,
        syncedAt: new Date(),
      },
    });
}

export async function updateIntegrationStatus(
  name: "hostaway" | "breezeway" | "amazon" | "slack",
  status: "not_connected" | "connected" | "error" | "ready",
  lastSyncAt?: Date,
  errorMessage?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(integrations)
    .values({
      name,
      connected: status === "connected",
      status,
      lastSyncAt: lastSyncAt ?? null,
      errorMessage: errorMessage ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        connected: status === "connected",
        status,
        lastSyncAt: lastSyncAt ?? sql`lastSyncAt`,
        errorMessage: errorMessage ?? null,
      },
    });
}

// Audit log
export async function logBreezewayAudit(
  userId: number | undefined,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  endpoint: string,
  requestPayload: any,
  responseStatus: number,
  responseTime: number,
  error?: string
) {
  const db = await getDb();
  if (!db) return;

  try {
    await db.insert(breezewayAuditLogs).values({
      userId,
      httpMethod: method,
      endpoint,
      requestPayload,
      responseStatus,
      responseTime,
      error,
    });
  } catch (err) {
    console.error("[Audit] Failed to log Breezeway API call:", err);
  }
}

// ── Guest Messages ───────────────────────────────────────────────────

import {
  InsertGuestMessage,
  reviewAnalysis,
  InsertReviewAnalysis,
} from "../drizzle/schema";

export async function upsertGuestMessage(msg: InsertGuestMessage): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // If we have a hostawayMessageId, check for existing record first to avoid duplicates
  if (msg.hostawayMessageId) {
    const existing = await db
      .select({ id: guestMessages.id })
      .from(guestMessages)
      .where(eq(guestMessages.hostawayMessageId, msg.hostawayMessageId))
      .limit(1);

    if (existing.length > 0) {
      // Update existing record
      await db
        .update(guestMessages)
        .set({
          body: msg.body,
          guestName: msg.guestName,
          isIncoming: msg.isIncoming,
          sentAt: msg.sentAt,
          channelName: msg.channelName,
        })
        .where(eq(guestMessages.hostawayMessageId, msg.hostawayMessageId));
      return;
    }
  }

  // Insert new record
  await db.insert(guestMessages).values(msg);
}

export async function getGuestMessages(opts?: { listingId?: number; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  let query = db.select().from(guestMessages).orderBy(desc(guestMessages.sentAt));
  if (opts?.listingId) {
    query = query.where(eq(guestMessages.listingId, opts.listingId)) as any;
  }
  if (opts?.limit) {
    query = query.limit(opts.limit) as any;
  }
  return query;
}

// Reservation statuses that represent confirmed bookings (not inquiries)
const CONFIRMED_RESERVATION_STATUSES = [
  "new", "modified", "pending", "awaitingPayment", "unconfirmed", "ownerStay",
];

export async function getUnanalyzedGuestMessages(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(guestMessages)
    .where(
      and(
        eq(guestMessages.aiAnalyzed, false),
        eq(guestMessages.isIncoming, true), // Only analyze incoming guest messages, not host-sent messages
        // Only analyze messages from confirmed bookings (not inquiries)
        inArray(guestMessages.reservationStatus, CONFIRMED_RESERVATION_STATUSES)
      )
    )
    .orderBy(desc(guestMessages.sentAt))
    .limit(limit);
}

export async function updateGuestMessageAnalysis(
  id: number,
  analysis: {
    aiCategory: InsertGuestMessage["aiCategory"];
    aiSentiment: InsertGuestMessage["aiSentiment"];
    aiUrgency: InsertGuestMessage["aiUrgency"];
    aiSummary: string | null;
    aiActionTitle?: string | null;
    aiIssues: string[] | null;
    aiActionItems?: string[] | null;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(guestMessages)
    .set({
      aiAnalyzed: true,
      aiCategory: analysis.aiCategory,
      aiSentiment: analysis.aiSentiment,
      aiUrgency: analysis.aiUrgency,
      aiSummary: analysis.aiSummary,
      aiActionTitle: analysis.aiActionTitle ?? null,
      aiIssues: analysis.aiIssues,
      aiActionItems: analysis.aiActionItems ?? null,
    })
    .where(eq(guestMessages.id, id));
}

// ── Review Analysis ──────────────────────────────────────────────────

export async function upsertReviewAnalysis(analysis: InsertReviewAnalysis): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(reviewAnalysis)
    .values(analysis)
    .onDuplicateKeyUpdate({
      set: {
        categories: analysis.categories,
        sentimentScore: analysis.sentimentScore,
        issues: analysis.issues,
        highlights: analysis.highlights,
        cleanerMentioned: analysis.cleanerMentioned,
        summary: analysis.summary,
        analyzedAt: new Date(),
      },
    });
}

export async function getReviewAnalyses(opts?: { listingId?: number }) {
  const db = await getDb();
  if (!db) return [];
  if (opts?.listingId) {
    return db
      .select()
      .from(reviewAnalysis)
      .where(eq(reviewAnalysis.listingId, opts.listingId))
      .orderBy(desc(reviewAnalysis.analyzedAt));
  }
  return db.select().from(reviewAnalysis).orderBy(desc(reviewAnalysis.analyzedAt));
}

/**
 * Cutoff for AI analysis. Reviews submitted BEFORE this date are never AI-analyzed
 * (raw rating/cleanlinessRating data still flows through for all-time scores).
 * Kept in sync with server/reviewPipeline.ts ANALYSIS_CUTOFF_DATE.
 */
const ANALYSIS_CUTOFF_DATE = new Date("2026-03-20T00:00:00Z");

export async function getUnanalyzedReviewIds(limit = 100): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  // Use SQL LEFT JOIN to efficiently find reviews without analysis across ALL reviews.
  // Only return reviews submitted on/after the cutoff — older reviews are intentionally skipped.
  const result = await db
    .select({ id: reviews.id })
    .from(reviews)
    .leftJoin(reviewAnalysis, eq(reviews.id, reviewAnalysis.reviewId))
    .where(
      and(
        isNull(reviewAnalysis.reviewId),
        gte(reviews.submittedAt, ANALYSIS_CUTOFF_DATE)
      )
    )
    .orderBy(asc(reviews.id))
    .limit(limit);
  return result.map((r) => r.id);
}

export async function countUnanalyzedReviews(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  // Only count reviews on/after the cutoff as "unanalyzed" — pre-cutoff reviews
  // are intentionally excluded from AI analysis and should not count as backlog.
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(reviews)
    .leftJoin(reviewAnalysis, eq(reviews.id, reviewAnalysis.reviewId))
    .where(
      and(
        isNull(reviewAnalysis.reviewId),
        gte(reviews.submittedAt, ANALYSIS_CUTOFF_DATE)
      )
    );
  return Number(result[0]?.count ?? 0);
}

export async function getReviewById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
  return result[0];
}

export async function getReviewsWithAnalysis(opts?: { listingId?: number; flaggedOnly?: boolean; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  // Join reviews with their analysis
  const allReviews = await db.select().from(reviews).orderBy(desc(reviews.createdAt));
  const allAnalyses = await db.select().from(reviewAnalysis);
  const analysisMap = new Map(allAnalyses.map((a) => [a.reviewId, a]));

  let result = allReviews.map((r) => ({
    ...r,
    analysis: analysisMap.get(r.id) || null,
  }));

  if (opts?.listingId) {
    result = result.filter((r) => r.listingId === opts.listingId);
  }
  if (opts?.flaggedOnly) {
    result = result.filter((r) => r.flagged || (r.analysis?.issues && (r.analysis.issues as any[]).length > 0));
  }
  if (opts?.limit) {
    result = result.slice(0, opts.limit);
  }

  return result;
}

// ── Google Auth & Team Management ────────────────────────────────────

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return result[0] ?? undefined;
}

export async function getValidInvitationByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(teamInvitations)
    .where(
      and(
        eq(teamInvitations.email, email),
        eq(teamInvitations.status, "pending")
      )
    )
    .limit(1);
  const inv = result[0];
  if (!inv) return undefined;
  // Check expiry
  if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) return undefined;
  return inv;
}

export async function acceptInvitation(invitationId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(teamInvitations)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(eq(teamInvitations.id, invitationId));
}

export async function createInvitation(data: {
  email: string;
  role: "manager" | "member";
  invitedBy: number;
  token: string;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(teamInvitations).values({
    email: data.email,
    role: data.role,
    invitedBy: data.invitedBy,
    token: data.token,
    expiresAt: data.expiresAt,
    status: "pending",
  });
}

export async function revokeInvitation(invitationId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(teamInvitations)
    .set({ status: "revoked" })
    .where(eq(teamInvitations.id, invitationId));
}

export async function listInvitations() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(teamInvitations)
    .orderBy(desc(teamInvitations.createdAt));
}

export async function listTeamMembers() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: users.id,
      openId: users.openId,
      name: users.name,
      email: users.email,
      role: users.role,
      avatarUrl: users.avatarUrl,
      lastSignedIn: users.lastSignedIn,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));
}

export async function changeUserRole(userId: number, role: "admin" | "manager" | "member") {
  const db = await getDb();
  if (!db) return;
  await db
    .update(users)
    .set({ role })
    .where(eq(users.id, userId));
}

export async function removeTeamMember(userId: number) {
  const db = await getDb();
  if (!db) return;
  // Don't actually delete — just mark as member and clear their data
  // Or we could delete them. For now, delete the user row.
  await db.delete(users).where(eq(users.id, userId));
}

// ── Breezeway Task Sync ─────────────────────────────────────────────

export async function getTaskByBreezewayId(breezewayTaskId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(tasks)
    .where(eq(tasks.breezewayTaskId, breezewayTaskId))
    .limit(1);
  return result[0] ?? undefined;
}

export async function upsertBreezewayTask(data: {
  breezewayTaskId: string;
  breezewayHomeId: number;
  title: string;
  description?: string;
  priority: "low" | "medium" | "high";
  status: "created" | "in_progress" | "completed" | "ignored";
  category: "maintenance" | "cleaning" | "improvements";
  taskType: "maintenance" | "housekeeping" | "inspection" | "safety" | "other";
  source: "breezeway";
  syncStatus: "synced";
  listingId?: number;
  dueDate?: Date;
  breezewayUpdatedAt?: Date;
  breezewayCreatedAt?: Date;
  breezewayCreatorName?: string;
}) {
  const db = await getDb();
  if (!db) return undefined;

  // Check if task already exists
  const existing = await getTaskByBreezewayId(data.breezewayTaskId);
  if (existing) {
    // Update existing task — only set breezewayCreatedAt if not already stored
    const updatePayload: Record<string, any> = {
      title: data.title,
      description: data.description,
      priority: data.priority,
      category: data.category,
      taskType: data.taskType,
      syncStatus: "synced",
      lastSyncedAt: new Date(),
      breezewayUpdatedAt: data.breezewayUpdatedAt,
      breezewayHomeId: data.breezewayHomeId,
      listingId: data.listingId,
      dueDate: data.dueDate,
      breezewayCreatorName: data.breezewayCreatorName,
    };
    // Only sync the BW status if the user has NOT manually overridden it in Wand.
    // If statusOverridden = true, the user intentionally moved this task to a
    // different column — respect that and never let BW reset it.
    if (!existing.statusOverridden) {
      updatePayload.status = data.status;
    }
    // Only backfill breezewayCreatedAt if the row doesn't have it yet
    if (data.breezewayCreatedAt && !existing.breezewayCreatedAt) {
      updatePayload.breezewayCreatedAt = data.breezewayCreatedAt;
    }
    await db
      .update(tasks)
      .set(updatePayload)
      .where(eq(tasks.id, existing.id));
    return { id: existing.id, action: "updated" as const };
  }

  // Insert new task
  const boardId = await getDefaultBoardId();
  const result = await db.insert(tasks).values({
    breezewayTaskId: data.breezewayTaskId,
    breezewayHomeId: data.breezewayHomeId,
    title: data.title,
    description: data.description,
    priority: data.priority,
    status: data.status,
    category: data.category,
    taskType: data.taskType,
    source: "breezeway",
    syncStatus: "synced",
    lastSyncedAt: new Date(),
    breezewayUpdatedAt: data.breezewayUpdatedAt,
    breezewayCreatedAt: data.breezewayCreatedAt,
    listingId: data.listingId,
    dueDate: data.dueDate,
    hiddenFromBoard: false,
    breezewayCreatorName: data.breezewayCreatorName,
    boardId: boardId ?? undefined,
  });
  return { id: result[0].insertId, action: "created" as const };
}

export async function hideBreezewayTask(breezewayTaskId: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(tasks)
    .set({ hiddenFromBoard: true, syncStatus: "synced", lastSyncedAt: new Date() })
    .where(eq(tasks.breezewayTaskId, breezewayTaskId));
}

export async function updateTaskSyncStatus(
  taskId: number,
  syncStatus: "synced" | "pending_push" | "sync_error"
) {
  const db = await getDb();
  if (!db) return;
  const updates: Record<string, any> = { syncStatus };
  if (syncStatus === "synced") {
    updates.lastSyncedAt = new Date();
  }
  await db
    .update(tasks)
    .set(updates)
    .where(eq(tasks.id, taskId));
}

export async function getLastBreezewaySyncTimestamp(): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select({ lastSynced: sql<Date>`MAX(${tasks.lastSyncedAt})` })
    .from(tasks)
    .where(eq(tasks.source, "breezeway"));
  return result[0]?.lastSynced ?? null;
}

export async function getBreezewaySyncConfig(): Promise<{
  enabled: boolean;
  leisrStaysAssigneeId: number | null;
  syncActivatedAt: Date | null;
  lastPollAt: Date | null;
}> {
  const db = await getDb();
  if (!db) return { enabled: false, leisrStaysAssigneeId: null, syncActivatedAt: null, lastPollAt: null };
  const integration = await db
    .select()
    .from(integrations)
    .where(eq(integrations.name, "breezeway"))
    .limit(1);
  const config = integration[0]?.config as any;
  return {
    enabled: config?.taskSyncEnabled ?? false,
    leisrStaysAssigneeId: config?.leisrStaysAssigneeId ?? null,
    syncActivatedAt: config?.syncActivatedAt ? new Date(config.syncActivatedAt) : null,
    lastPollAt: config?.lastPollAt ? new Date(config.lastPollAt) : null,
  };
}

export async function updateBreezewaySyncConfig(updates: {
  taskSyncEnabled?: boolean;
  leisrStaysAssigneeId?: number;
  syncActivatedAt?: string;
  lastPollAt?: string;
}) {
  const db = await getDb();
  if (!db) return;
  const integration = await db
    .select()
    .from(integrations)
    .where(eq(integrations.name, "breezeway"))
    .limit(1);
  if (!integration[0]) return;
  const existingConfig = (integration[0].config as any) || {};
  const newConfig = { ...existingConfig, ...updates };
  await db
    .update(integrations)
    .set({ config: newConfig })
    .where(eq(integrations.name, "breezeway"));
}


// ── Pod System DB Helpers ───────────────────────────────────────────────

/** List all pods with property counts */
export async function listPods() {
  const db = (await getDb())!;
  const allPods = await db.select().from(pods).orderBy(pods.name);
  // Get property counts per pod
  const propertyCounts = await db
    .select({
      podId: listings.podId,
      count: sql<number>`COUNT(*)`,
    })
    .from(listings)
    .where(isNotNull(listings.podId))
    .groupBy(listings.podId);

  const countMap = new Map(propertyCounts.map((r) => [r.podId, r.count]));
  return allPods.map((p) => ({
    ...p,
    propertyCount: countMap.get(p.id) || 0,
  }));
}

/** Get a single pod by ID */
export async function getPod(podId: number) {
  const db = (await getDb())!;
  const [pod] = await db.select().from(pods).where(eq(pods.id, podId)).limit(1);
  return pod || null;
}

/** Create a new pod */
export async function createPod(data: { name: string; region?: string; storageAddress?: string }) {
  const db = (await getDb())!;
  const result = await db.insert(pods).values(data);
  const insertId = (result as any)[0]?.insertId;
  return { id: insertId, ...data };
}

/** Update a pod */
export async function updatePod(podId: number, data: { name?: string; region?: string; storageAddress?: string }) {
  const db = (await getDb())!;
  await db.update(pods).set(data).where(eq(pods.id, podId));
}

/** Delete a pod (unassigns all properties first) */
export async function deletePod(podId: number) {
  const db = (await getDb())!;
  // Unassign properties from this pod
  await db.update(listings).set({ podId: null }).where(eq(listings.podId, podId));
  // Delete pod vendors
  await db.delete(podVendors).where(eq(podVendors.podId, podId));
  // Delete the pod
  await db.delete(pods).where(eq(pods.id, podId));
}

/** Assign properties to a pod (bulk) */
export async function assignPropertiesToPod(podId: number, listingIds: number[]) {
  const db = (await getDb())!;
  if (listingIds.length === 0) return;
  await db
    .update(listings)
    .set({ podId })
    .where(inArray(listings.id, listingIds));
}

/** Unassign properties from any pod */
export async function unassignProperties(listingIds: number[]) {
  const db = (await getDb())!;
  if (listingIds.length === 0) return;
  await db
    .update(listings)
    .set({ podId: null })
    .where(inArray(listings.id, listingIds));
}

/** Get all properties with their pod assignment */
export async function listPropertiesWithPods() {
  const db = (await getDb())!;
  return db
    .select({
      id: listings.id,
      name: listings.name,
      internalName: listings.internalName,
      address: listings.address,
      city: listings.city,
      state: listings.state,
      podId: listings.podId,
      status: listings.status,
      distanceFromStorage: listings.distanceFromStorage,
    })
    .from(listings)
    .where(eq(listings.status, "active"))
    .orderBy(sql`COALESCE(${listings.internalName}, ${listings.name})`);
}

// ── Pod Vendor Helpers ──────────────────────────────────────────────────

/** List vendors for a pod, grouped by specialty */
export async function listPodVendors(podId: number) {
  const db = (await getDb())!;
  return db
    .select()
    .from(podVendors)
    .where(eq(podVendors.podId, podId))
    .orderBy(podVendors.specialty, podVendors.name);
}

/** Create a pod vendor */
export async function createPodVendor(data: InsertPodVendor) {
  const db = (await getDb())!;
  const result = await db.insert(podVendors).values(data);
  const insertId = (result as any)[0]?.insertId;
  return { id: insertId, ...data };
}

/** Update a pod vendor */
export async function updatePodVendor(
  vendorId: number,
  data: Partial<Omit<InsertPodVendor, "id" | "podId">>
) {
  const db = (await getDb())!;
  await db.update(podVendors).set(data).where(eq(podVendors.id, vendorId));
}

/** Delete a pod vendor */
export async function deletePodVendor(vendorId: number) {
  const db = (await getDb())!;
  await db.delete(podVendors).where(eq(podVendors.id, vendorId));
}

// ── Property Vendor Override Helpers ────────────────────────────────────

/** List vendor overrides for a property */
export async function listPropertyVendors(listingId: number) {
  const db = (await getDb())!;
  return db
    .select()
    .from(propertyVendors)
    .where(eq(propertyVendors.listingId, listingId))
    .orderBy(propertyVendors.specialty, propertyVendors.name);
}

/** Create a property vendor override */
export async function createPropertyVendor(data: InsertPropertyVendor) {
  const db = (await getDb())!;
  const result = await db.insert(propertyVendors).values(data);
  const insertId = (result as any)[0]?.insertId;
  return { id: insertId, ...data };
}

/** Update a property vendor override */
export async function updatePropertyVendor(
  vendorId: number,
  data: Partial<Omit<InsertPropertyVendor, "id" | "listingId">>
) {
  const db = (await getDb())!;
  await db.update(propertyVendors).set(data).where(eq(propertyVendors.id, vendorId));
}

/** Delete a property vendor override */
export async function deletePropertyVendor(vendorId: number) {
  const db = (await getDb())!;
  await db.delete(propertyVendors).where(eq(propertyVendors.id, vendorId));
}

/**
 * Get effective vendors for a property (property overrides take priority over pod defaults).
 * For each specialty, if the property has overrides, use those; otherwise fall back to pod vendors.
 */
export async function getEffectiveVendors(listingId: number) {
  const db = (await getDb())!;

  // Get the property's pod
  const [listing] = await db
    .select({ podId: listings.podId })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);

  const propVendors = await listPropertyVendors(listingId);
  const podVendorList = listing?.podId
    ? await listPodVendors(listing.podId)
    : [];

  // Group by specialty
  const specialties = [
    "plumber",
    "electrician",
    "hvac",
    "handyman",
    "pest_control",
    "landscaper",
    "appliance_repair",
  ] as const;

  const result: Record<
    string,
    { vendors: any[]; source: "property" | "pod" }
  > = {};

  for (const spec of specialties) {
    const propOverrides = propVendors.filter((v) => v.specialty === spec);
    if (propOverrides.length > 0) {
      result[spec] = { vendors: propOverrides, source: "property" };
    } else {
      const podDefaults = podVendorList.filter((v) => v.specialty === spec);
      result[spec] = { vendors: podDefaults, source: "pod" };
    }
  }

  return result;
}


// ── Task Comments ──────────────────────────────────────────────────────

export async function getTaskComments(taskId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt));
}

export async function addTaskComment(
  data: Omit<InsertTaskComment, "id" | "createdAt">
): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db
    .insert(taskComments)
    .values(data)
    .$returningId();
  return { id: result.id };
}

// ── Task Attachments ─────────────────────────────────────────────────

export async function addTaskAttachment(data: {
  taskId: number;
  url: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedBy?: number;
  uploadedByName?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db
    .insert(taskAttachments)
    .values(data)
    .$returningId();
  return result;
}

export async function getTaskAttachments(taskId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(taskAttachments)
    .where(eq(taskAttachments.taskId, taskId))
    .orderBy(taskAttachments.createdAt);
}

export async function deleteTaskAttachment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(taskAttachments).where(eq(taskAttachments.id, id));
}

// ── Cleaner Pod Assignments ──────────────────────────────────────────

export async function getCleanerPodIds(cleanerId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .select({ podId: cleaners.podId })
    .from(cleaners)
    .where(eq(cleaners.id, cleanerId));
  return result.filter((r) => r.podId != null).map((r) => r.podId!);
}

export async function setCleanerPods(cleanerId: number, podIds: number[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Simple: set the first podId on the cleaner (schema supports single pod)
  const podId = podIds.length > 0 ? podIds[0] : null;
  await db.update(cleaners).set({ podId }).where(eq(cleaners.id, cleanerId));
}

export async function getAllCleanerPodAssignments(): Promise<Array<{ cleanerId: number; podId: number }>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .select({ cleanerId: cleaners.id, podId: cleaners.podId })
    .from(cleaners);
  return result.filter((r): r is { cleanerId: number; podId: number } => r.podId != null);
}
