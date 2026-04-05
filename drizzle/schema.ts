import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  boolean,
  json,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["admin", "manager", "member"]).default("member").notNull(),
  avatarUrl: text("avatarUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Listings from Hostaway integration
 */
export const listings = mysqlTable("listings", {
  id: int("id").autoincrement().primaryKey(),
  hostawayId: varchar("hostawayId", { length: 64 }).notNull().unique(),
  name: text("name").notNull(),
  internalName: text("internalName"),
  address: text("address"),
  city: varchar("city", { length: 128 }),
  state: varchar("state", { length: 64 }),
  country: varchar("country", { length: 64 }),
  guestCapacity: int("guestCapacity"),
  status: mysqlEnum("status", ["active", "inactive", "archived"])
    .default("active")
    .notNull(),
  photoUrl: text("photoUrl"),
  avgRating: decimal("avgRating", { precision: 3, scale: 2 }),
  reviewCount: int("reviewCount").default(0),
  // ── Compensation fields ──
  bedroomTier: int("bedroomTier"), // 1-5 mapping to 1BR through 5BR+
  distanceFromStorage: decimal("distanceFromStorage", { precision: 6, scale: 2 }), // one-way miles
  cleaningFeeCharge: decimal("cleaningFeeCharge", { precision: 10, scale: 2 }), // what 5STR charges the customer
  podId: int("podId"), // FK to pods.id — which geographic pod this property belongs to
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Listing = typeof listings.$inferSelect;
export type InsertListing = typeof listings.$inferInsert;

/**
 * Reviews from Hostaway
 */
export const reviews = mysqlTable("reviews", {
  id: int("id").autoincrement().primaryKey(),
  hostawayReviewId: varchar("hostawayReviewId", { length: 64 }).notNull().unique(),
  listingId: int("listingId").notNull(),
  hostawayReservationId: varchar("hostawayReservationId", { length: 128 }),
  rating: int("rating"),
  text: text("text"),                  // publicReview content
  privateFeedback: text("privateFeedback"), // private feedback from guest
  guestName: varchar("guestName", { length: 256 }),
  source: mysqlEnum("source", ["airbnb", "vrbo", "booking", "direct"])
    .default("airbnb")
    .notNull(),
  flagged: boolean("flagged").default(false),
  flagReason: text("flagReason"),
  sentiment: mysqlEnum("sentiment", ["positive", "neutral", "negative"]),
  // Hostaway review lifecycle fields
  reviewStatus: varchar("reviewStatus", { length: 32 }), // "published" | "expired" | "pending"
  reviewType: varchar("reviewType", { length: 32 }),    // "guest-to-host" | "host-to-guest"
  submittedAt: timestamp("submittedAt"),                // actual review submission date from Hostaway
  // AI pipeline fields
  isAnalyzed: boolean("isAnalyzed").default(false),
  aiActionable: boolean("aiActionable").default(false), // whether AI found actionable items
  aiConfidence: varchar("aiConfidence", { length: 16 }), // "high" | "medium" | "low"
  aiSummary: text("aiSummary"),
  aiIssues: json("aiIssues").$type<Array<{
    type: string;
    description: string;
    severity: "low" | "medium" | "high" | "critical";
    quote: string;
    confidence: "high" | "medium" | "low";
  }>>(),
  taskId: int("taskId"),               // FK → tasks.id, links review to auto-created task
  arrivalDate: timestamp("arrivalDate"),
  departureDate: timestamp("departureDate"),
  channelId: int("channelId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Review = typeof reviews.$inferSelect;
export type InsertReview = typeof reviews.$inferInsert;

/**
 * Tasks (from Hostaway or Breezeway)
 */
export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  externalId: varchar("externalId", { length: 128 }),
  externalSource: mysqlEnum("externalSource", ["hostaway", "breezeway"]),
  listingId: int("listingId"),
  title: text("title").notNull(),
  description: text("description"),
  priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"])
    .default("medium")
    .notNull(),
  isUrgent: boolean("isUrgent").default(false).notNull(),
  status: mysqlEnum("status", ["created", "needs_review", "up_next", "in_progress", "completed", "ignored", "ideas_for_later"])
    .default("created")
    .notNull(),
  category: mysqlEnum("category", ["maintenance", "cleaning", "improvements"])
    .default("maintenance")
    .notNull(),
  source: mysqlEnum("source", ["airbnb_review", "guest_message", "manual", "breezeway", "wand_manual", "review"])
    .default("wand_manual")
    .notNull(),
  taskType: mysqlEnum("taskType", ["maintenance", "housekeeping", "inspection", "safety", "improvements", "other"]),
  syncStatus: mysqlEnum("syncStatus", ["synced", "pending_push", "sync_error"]),
  lastSyncedAt: timestamp("lastSyncedAt"),
  breezewayUpdatedAt: timestamp("breezewayUpdatedAt"),
  breezewayCreatedAt: timestamp("breezewayCreatedAt"),
  hiddenFromBoard: boolean("hiddenFromBoard").default(false),
  statusOverridden: boolean("statusOverridden").default(false),
  dueDate: timestamp("dueDate"),
  assignedTo: varchar("assignedTo", { length: 256 }),
  breezewayTaskId: varchar("breezewayTaskId", { length: 128 }),
  breezewayPushedAt: timestamp("breezewayPushedAt"),
  breezewayHomeId: int("breezewayHomeId"),
  breezewayCreatorName: varchar("breezewayCreatorName", { length: 256 }),
  hostawayReservationId: varchar("hostawayReservationId", { length: 128 }),
  arrivalDate: timestamp("arrivalDate"),
  departureDate: timestamp("departureDate"),
  // Auto-resolution detection fields
  resolutionStatus: mysqlEnum("resolutionStatus", ["monitoring", "likely_resolved", "auto_resolved", "reopened"])
    .default("monitoring"),
  resolutionConfidence: int("resolutionConfidence"), // 0-100 percentage
  resolutionReason: text("resolutionReason"),
  resolvedAt: timestamp("resolvedAt"),
  resolutionMessageId: int("resolutionMessageId"), // FK → guestMessages.id that triggered resolution
  monitoringExpiresAt: timestamp("monitoringExpiresAt"), // 72h after task creation
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

/**
 * Integration settings and status
 */
export const integrations = mysqlTable("integrations", {
  id: int("id").autoincrement().primaryKey(),
  name: mysqlEnum("name", ["hostaway", "breezeway", "amazon", "slack"])
    .notNull()
    .unique(),
  connected: boolean("connected").default(false),
  status: mysqlEnum("status", ["not_connected", "connected", "error", "ready"])
    .default("not_connected")
    .notNull(),
  lastSyncAt: timestamp("lastSyncAt"),
  errorMessage: text("errorMessage"),
  config: json("config"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Integration = typeof integrations.$inferSelect;
export type InsertIntegration = typeof integrations.$inferInsert;

/**
 * Breezeway tokens (for JWT refresh)
 */
export const breezewayTokens = mysqlTable("breezewayTokens", {
  id: int("id").autoincrement().primaryKey(),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BreezewayToken = typeof breezewayTokens.$inferSelect;
export type InsertBreezewayToken = typeof breezewayTokens.$inferInsert;

/**
 * Audit log for all Breezeway API calls
 */
export const breezewayAuditLogs = mysqlTable("breezewayAuditLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  httpMethod: mysqlEnum("httpMethod", ["GET", "POST", "PATCH", "DELETE"])
    .notNull(),
  endpoint: varchar("endpoint", { length: 512 }).notNull(),
  requestPayload: json("requestPayload"),
  responseStatus: int("responseStatus"),
  responseTime: int("responseTime"),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BreezewayAuditLog = typeof breezewayAuditLogs.$inferSelect;
export type InsertBreezewayAuditLog = typeof breezewayAuditLogs.$inferInsert;

/**
 * Breezeway properties synced
 */
export const breezewayProperties = mysqlTable("breezewayProperties", {
  id: int("id").autoincrement().primaryKey(),
  breezewayId: varchar("breezewayId", { length: 64 }).notNull().unique(),
  // The external/Hostaway property ID used by the /task/ endpoint (reference_property_id)
  referencePropertyId: varchar("referencePropertyId", { length: 64 }),
  name: text("name").notNull(),
  address: text("address"),
  city: varchar("city", { length: 128 }),
  state: varchar("state", { length: 64 }),
  status: mysqlEnum("status", ["active", "inactive"])
    .default("active")
    .notNull(),
  photoUrl: text("photoUrl"),
  // JSON array of tag names stored as text e.g. '["Mountain", "Pet Friendly"]'
  tags: text("tags"),
  syncedAt: timestamp("syncedAt").defaultNow(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BreezewayProperty = typeof breezewayProperties.$inferSelect;
export type InsertBreezewayProperty = typeof breezewayProperties.$inferInsert;

/**
 * Breezeway team members
 */
export const breezewayTeam = mysqlTable("breezewayTeam", {
  id: int("id").autoincrement().primaryKey(),
  breezewayId: varchar("breezewayId", { length: 64 }).notNull().unique(),
  firstName: varchar("firstName", { length: 128 }),
  lastName: varchar("lastName", { length: 128 }),
  email: varchar("email", { length: 320 }),
  role: varchar("role", { length: 64 }),
  active: boolean("active").default(true),
  syncedAt: timestamp("syncedAt").defaultNow(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BreezewayTeamMember = typeof breezewayTeam.$inferSelect;
export type InsertBreezewayTeamMember = typeof breezewayTeam.$inferInsert;

/**
 * Customer mapping: Breezeway property owner → Stripe customer
 */
export const customerMapping = mysqlTable("customerMapping", {
  id: int("id").autoincrement().primaryKey(),
  breezewayOwnerId: varchar("breezewayOwnerId", { length: 128 }).notNull().unique(),
  breezewayOwnerName: varchar("breezewayOwnerName", { length: 256 }),
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }),
  preferredBillingMethod: mysqlEnum("preferredBillingMethod", ["card_on_file", "invoice", "ask_each_time"])
    .default("ask_each_time")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CustomerMapping = typeof customerMapping.$inferSelect;
export type InsertCustomerMapping = typeof customerMapping.$inferInsert;

/**
 * Rate card: per-property task type pricing (no global defaults)
 */
export const rateCard = mysqlTable("rateCard", {
  id: int("id").autoincrement().primaryKey(),
  propertyId: varchar("propertyId", { length: 128 }).notNull(),
  propertyName: varchar("propertyName", { length: 256 }),
  csvName: varchar("csvName", { length: 256 }),
  matchConfidence: varchar("matchConfidence", { length: 32 }), // 'high', 'possible', 'unmatched', 'confirmed', 'manual'
  matchScore: int("matchScore"), // 0-100 percentage
  taskType: varchar("taskType", { length: 128 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RateCard = typeof rateCard.$inferSelect;
export type InsertRateCard = typeof rateCard.$inferInsert;

/**
 * Billing records: tracks which Breezeway tasks have been billed
 */
export const billingRecord = mysqlTable("billingRecord", {
  id: int("id").autoincrement().primaryKey(),
  breezewayTaskId: varchar("breezewayTaskId", { length: 128 }).notNull(),
  breezewayTaskName: varchar("breezewayTaskName", { length: 256 }),
  propertyId: varchar("propertyId", { length: 128 }),
  propertyName: varchar("propertyName", { length: 256 }),
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 128 }),
  stripeInvoiceId: varchar("stripeInvoiceId", { length: 128 }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  billingMethod: mysqlEnum("billingMethod", ["card_on_file", "invoice"]).notNull(),
  status: mysqlEnum("billingStatus", ["pending", "charged", "invoiced", "failed"])
    .default("pending")
    .notNull(),
  billedAt: timestamp("billedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BillingRecord = typeof billingRecord.$inferSelect;
export type InsertBillingRecord = typeof billingRecord.$inferInsert;

/**
 * Billing action audit log
 */
export const billingAuditLog = mysqlTable("billingAuditLog", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  action: varchar("action", { length: 64 }).notNull(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 128 }),
  stripeInvoiceId: varchar("stripeInvoiceId", { length: 128 }),
  amount: decimal("amount", { precision: 10, scale: 2 }),
  details: json("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BillingAuditLog = typeof billingAuditLog.$inferSelect;
export type InsertBillingAuditLog = typeof billingAuditLog.$inferInsert;

// ── Viv (AI Email Concierge) ───────────────────────────────────────────

/**
 * Cached AI triage results for emails.
 */
export const vivTriageCache = mysqlTable("vivTriageCache", {
  id: int("id").autoincrement().primaryKey(),
  messageId: varchar("messageId", { length: 512 }).notNull().unique(),
  uid: int("uid").notNull(),
  priority: mysqlEnum("priority", ["urgent", "important", "fyi", "noise", "high", "low"])
    .default("low")
    .notNull(),
  category: mysqlEnum("category", [
    "owner_comms",
    "guest_messages",
    "vendor_maintenance",
    "booking_platforms",
    "financial_invoices",
    "marketing_newsletters",
    "team_internal",
    "other",
  ])
    .default("other")
    .notNull(),
  summary: text("summary"),
  suggestedAction: text("suggestedAction"),
  needsReply: int("needsReply").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Snoozed emails — hidden until snoozeUntil time.
 */
export const vivSnooze = mysqlTable("vivSnooze", {
  id: int("id").autoincrement().primaryKey(),
  messageId: varchar("messageId", { length: 512 }).notNull().unique(),
  uid: int("uid").notNull(),
  snoozeUntil: timestamp("snoozeUntil").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * User-applied labels on emails.
 */
export const vivLabels = mysqlTable("vivLabels", {
  id: int("id").autoincrement().primaryKey(),
  messageId: varchar("messageId", { length: 512 }).notNull(),
  label: varchar("label", { length: 128 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Archived emails tracking.
 */
export const vivArchived = mysqlTable("vivArchived", {
  id: int("id").autoincrement().primaryKey(),
  messageId: varchar("messageId", { length: 512 }).notNull().unique(),
  uid: int("uid").notNull(),
  archivedAt: timestamp("archivedAt").defaultNow().notNull(),
});

// ── Viv Voice Profile ──────────────────────────────────────────────────

/**
 * Viv Voice Profile — AI-extracted writing style from sent emails.
 */
export const vivVoiceProfile = mysqlTable("vivVoiceProfile", {
  id: int("id").autoincrement().primaryKey(),
  profile: json("profile").$type<{
    greetingStyle: string;
    tone: string;
    signOffStyle: string;
    commonPhrases: string[];
    topicPatterns: Record<string, string>;
    levelOfDetail: string;
    personalityTraits: string[];
    systemPrompt: string; // Ready-to-use system prompt for draft replies
  }>().notNull(),
  sampleCount: int("sampleCount").default(0),
  lastUpdated: timestamp("lastUpdated").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Viv Draft Corrections — user edits to AI drafts, used to refine voice profile.
 */
export const vivDraftCorrections = mysqlTable("vivDraftCorrections", {
  id: int("id").autoincrement().primaryKey(),
  originalDraft: text("originalDraft").notNull(),
  editedDraft: text("editedDraft").notNull(),
  emailSubject: text("emailSubject"),
  emailFrom: varchar("emailFrom", { length: 512 }),
  emailSnippet: text("emailSnippet"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VivVoiceProfile = typeof vivVoiceProfile.$inferSelect;
export type VivDraftCorrection = typeof vivDraftCorrections.$inferSelect;

// ── Viv Airbnb Feed ────────────────────────────────────────────────────

/**
 * Extracted Airbnb booking confirmations — structured log.
 */
export const vivAirbnbBookings = mysqlTable("vivAirbnbBookings", {
  id: int("id").autoincrement().primaryKey(),
  messageId: varchar("messageId", { length: 512 }).notNull().unique(),
  uid: int("uid").notNull(),
  confirmationCode: varchar("confirmationCode", { length: 64 }),
  propertyName: varchar("propertyName", { length: 512 }),
  guestName: varchar("guestName", { length: 256 }),
  checkIn: varchar("checkIn", { length: 32 }),
  checkOut: varchar("checkOut", { length: 32 }),
  numGuests: int("numGuests"),
  status: varchar("status", { length: 64 }).default("confirmed"),
  nightlyRate: varchar("nightlyRate", { length: 64 }),   // e.g. "$150"
  numNights: int("numNights"),                            // number of nights
  autoArchived: boolean("autoArchived").default(false),
  rawSubject: text("rawSubject"),
  rawSnippet: text("rawSnippet"),
  emailDate: timestamp("emailDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Extracted Airbnb reviews — kept visible for potential response.
 */
export const vivAirbnbReviews = mysqlTable("vivAirbnbReviews", {
  id: int("id").autoincrement().primaryKey(),
  messageId: varchar("messageId", { length: 512 }).notNull().unique(),
  uid: int("uid").notNull(),
  propertyName: varchar("propertyName", { length: 512 }),
  guestName: varchar("guestName", { length: 256 }),
  rating: int("rating"),
  reviewSnippet: text("reviewSnippet"),
  highlights: json("highlights").$type<string[]>(),          // AI-extracted positive phrases
  improvements: json("improvements").$type<string[]>(),      // AI-extracted criticism phrases
  aiProcessed: boolean("aiProcessed").default(false),        // whether AI extraction ran
  rawSubject: text("rawSubject"),
  rawSnippet: text("rawSnippet"),
  emailDate: timestamp("emailDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ── Hostaway Guest Messages ──────────────────────────────────────────

/**
 * Guest messages synced from Hostaway conversations
 */
export const guestMessages = mysqlTable("guestMessages", {
  id: int("id").autoincrement().primaryKey(),
  hostawayMessageId: varchar("hostawayMessageId", { length: 128 }),
  hostawayConversationId: varchar("hostawayConversationId", { length: 128 }).notNull(),
  hostawayReservationId: varchar("hostawayReservationId", { length: 128 }),
  listingId: int("listingId"),
  guestName: varchar("guestName", { length: 256 }),
  body: text("body"),
  isIncoming: boolean("isIncoming").default(true),
  sentAt: timestamp("sentAt"),
  channelName: varchar("channelName", { length: 64 }),
  reservationStatus: varchar("reservationStatus", { length: 64 }), // e.g. "new", "inquiry", "modified", etc.
  // AI analysis fields
  aiAnalyzed: boolean("aiAnalyzed").default(false),
  aiCategory: mysqlEnum("aiCategory", ["cleaning", "maintenance", "improvement", "compliment", "question", "complaint", "other"]),
  aiSentiment: mysqlEnum("aiSentiment", ["positive", "neutral", "negative"]),
  aiUrgency: mysqlEnum("aiUrgency", ["low", "medium", "high", "critical"]),
  aiSummary: text("aiSummary"),
  aiIssues: json("aiIssues").$type<string[]>(),
  aiActionItems: json("aiActionItems").$type<string[]>(),
  taskId: int("taskId"), // FK → tasks.id, nullable — links message to auto-created task
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ([
  uniqueIndex("uniq_hostaway_msg").on(table.hostawayMessageId),
]));

export type GuestMessage = typeof guestMessages.$inferSelect;
export type InsertGuestMessage = typeof guestMessages.$inferInsert;

// ── Review AI Analysis ───────────────────────────────────────────────

/**
 * AI analysis results for reviews — stored separately to avoid re-analyzing
 */
export const reviewAnalysis = mysqlTable("reviewAnalysis", {
  id: int("id").autoincrement().primaryKey(),
  reviewId: int("reviewId").notNull().unique(),
  listingId: int("listingId").notNull(),
  // AI-detected categories (can have multiple)
  categories: json("categories").$type<string[]>(), // ["cleaning", "maintenance", "amenities", "location", "communication"]
  // Detailed sentiment beyond simple pos/neg/neutral
  sentimentScore: int("sentimentScore"), // -100 to 100
  // Issues detected
  issues: json("issues").$type<Array<{
    type: string; // "cleaning", "maintenance", "safety", "noise", "amenity", "pest", "temperature"
    description: string;
    severity: "low" | "medium" | "high" | "critical";
    quote: string; // exact text from review
  }>>(),
  // Positive highlights
  highlights: json("highlights").$type<string[]>(),
  // Cleaner attribution (if mentioned)
  cleanerMentioned: varchar("cleanerMentioned", { length: 256 }),
  // Overall AI summary
  summary: text("summary"),
  analyzedAt: timestamp("analyzedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ReviewAnalysis = typeof reviewAnalysis.$inferSelect;
export type InsertReviewAnalysis = typeof reviewAnalysis.$inferInsert;

// ── Cleaners (Compensation) ─────────────────────────────────────────

/**
 * Cleaners table — links Breezeway team members to compensation data.
 * Tracks rolling Wand score and active multiplier for the tiered hybrid pay model.
 */
export const cleaners = mysqlTable("cleaners", {
  id: int("id").autoincrement().primaryKey(),
  breezewayTeamId: int("breezewayTeamId"), // FK to breezewayTeam.id
  name: varchar("name", { length: 256 }).notNull(),
  email: varchar("email", { length: 320 }),
  quickbooksEmployeeId: varchar("quickbooksEmployeeId", { length: 128 }),
  podId: int("podId"), // FK to pods.id — which pod this cleaner is assigned to
  currentRollingScore: decimal("currentRollingScore", { precision: 4, scale: 2 }), // 30-day avg (e.g. 4.85)
  currentMultiplier: decimal("currentMultiplier", { precision: 3, scale: 1 }), // 1.5, 1.1, 1.0, or 0.0
  scoreLastCalculatedAt: timestamp("scoreLastCalculatedAt"),
  dashboardToken: varchar("dashboardToken", { length: 64 }).unique(), // unique token for public dashboard URL
  active: boolean("active").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Cleaner = typeof cleaners.$inferSelect;
export type InsertCleaner = typeof cleaners.$inferInsert;

/**
 * Rolling score history — audit trail of daily score recalculations.
 */
export const cleanerScoreHistory = mysqlTable("cleanerScoreHistory", {
  id: int("id").autoincrement().primaryKey(),
  cleanerId: int("cleanerId").notNull(),
  rollingScore: decimal("rollingScore", { precision: 4, scale: 2 }).notNull(),
  multiplier: decimal("multiplier", { precision: 3, scale: 1 }).notNull(),
  reviewCount: int("reviewCount").default(0), // number of reviews in the 30-day window
  calculatedAt: timestamp("calculatedAt").defaultNow().notNull(),
});

/**
 * Cleaner-Review Attributions: links a Hostaway review to the Breezeway cleaner
 * who cleaned the property before the guest's check-in.
 */
export const cleanerReviewAttributions = mysqlTable("cleanerReviewAttributions", {
  id: int("id").autoincrement().primaryKey(),
  reviewId: int("reviewId").notNull(),              // FK to reviews.id
  cleanerId: int("cleanerId").notNull(),            // FK to cleaners.id
  breezewayTaskId: varchar("breezewayTaskId", { length: 128 }), // Breezeway task ID used for attribution
  listingId: int("listingId").notNull(),            // FK to listings.id
  reviewRating: int("reviewRating"),                // cached rating (1-5 normalized)
  reviewSubmittedAt: timestamp("reviewSubmittedAt"), // when the review was submitted
  taskCompletedAt: timestamp("taskCompletedAt"),     // when the cleaning task was completed
  attributionConfidence: varchar("attributionConfidence", { length: 32 }).default("high"), // high | medium | low
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CleanerReviewAttribution = typeof cleanerReviewAttributions.$inferSelect;
export type InsertCleanerReviewAttribution = typeof cleanerReviewAttributions.$inferInsert;

// ── Team Invitations ──────────────────────────────────────────────────

/**
 * Team invitations — admin invites team members by email.
 * Invitation-gated: users must have a valid invitation to sign in via Google OAuth.
 */
export const teamInvitations = mysqlTable("teamInvitations", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  role: mysqlEnum("inviteRole", ["manager", "member"]).default("member").notNull(),
  invitedBy: int("invitedBy").notNull(), // FK to users.id
  status: mysqlEnum("inviteStatus", ["pending", "accepted", "revoked"]).default("pending").notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  acceptedAt: timestamp("acceptedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TeamInvitation = typeof teamInvitations.$inferSelect;
export type InsertTeamInvitation = typeof teamInvitations.$inferInsert;

// ── Pod System ──────────────────────────────────────────────────────────

/**
 * Geographic clusters of properties.
 */
export const pods = mysqlTable("pods", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull().unique(),
  region: text("region"), // description / geographic area
  storageAddress: text("storageAddress"), // physical address of storage unit for mileage calculation
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Pod = typeof pods.$inferSelect;
export type InsertPod = typeof pods.$inferInsert;

/**
 * Vendor contacts assigned to a pod (pod-level defaults).
 * Up to 5 contacts per specialty per pod.
 */
export const podVendors = mysqlTable("podVendors", {
  id: int("id").autoincrement().primaryKey(),
  podId: int("podId").notNull(), // FK to pods.id
  name: varchar("name", { length: 256 }).notNull(),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 320 }),
  company: varchar("company", { length: 256 }),
  specialty: mysqlEnum("specialty", [
    "plumber",
    "electrician",
    "hvac",
    "handyman",
    "pest_control",
    "landscaper",
    "appliance_repair",
  ]).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PodVendor = typeof podVendors.$inferSelect;
export type InsertPodVendor = typeof podVendors.$inferInsert;

/**
 * Property-level vendor overrides.
 * These take priority over pod-level defaults when suggesting vendors for a task.
 */
export const propertyVendors = mysqlTable("propertyVendors", {
  id: int("id").autoincrement().primaryKey(),
  listingId: int("listingId").notNull(), // FK to listings.id
  name: varchar("name", { length: 256 }).notNull(),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 320 }),
  company: varchar("company", { length: 256 }),
  specialty: mysqlEnum("propertyVendorSpecialty", [
    "plumber",
    "electrician",
    "hvac",
    "handyman",
    "pest_control",
    "landscaper",
    "appliance_repair",
  ]).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PropertyVendor = typeof propertyVendors.$inferSelect;
export type InsertPropertyVendor = typeof propertyVendors.$inferInsert;

// ── Task Comments ──────────────────────────────────────────────────────

/**
 * Internal team comments / status notes on tasks.
 * Managers and team members can post updates about what's been done, what's pending, etc.
 */
export const taskComments = mysqlTable("taskComments", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(), // FK to tasks.id
  userId: int("userId").notNull(), // FK to users.id
  userName: varchar("userName", { length: 256 }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TaskComment = typeof taskComments.$inferSelect;
export type InsertTaskComment = typeof taskComments.$inferInsert;

// ── Task Attachments (photos/videos) ─────────────────────────────────

/**
 * File attachments (photos, videos) uploaded to tasks.
 * Files are stored in S3; this table holds metadata + CDN URL.
 */
export const taskAttachments = mysqlTable("taskAttachments", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(), // FK to tasks.id
  url: text("url").notNull(), // S3 CDN URL
  fileKey: varchar("fileKey", { length: 512 }).notNull(), // S3 object key
  fileName: varchar("fileName", { length: 512 }).notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  size: int("size").notNull(), // bytes
  uploadedBy: int("uploadedBy"), // FK to users.id (nullable for system uploads)
  uploadedByName: varchar("uploadedByName", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TaskAttachment = typeof taskAttachments.$inferSelect;
export type InsertTaskAttachment = typeof taskAttachments.$inferInsert;

// ── Cleaner Receipts (Reimbursement) ─────────────────────────────────

/**
 * Monthly receipt submissions from cleaners for reimbursement.
 * Cell phone bill and vehicle maintenance receipts.
 * Deadline: 5th of each month — no receipt = no reimbursement.
 */
export const cleanerReceipts = mysqlTable("cleanerReceipts", {
  id: int("id").autoincrement().primaryKey(),
  cleanerId: int("cleanerId").notNull(), // FK to cleaners.id
  month: varchar("month", { length: 7 }).notNull(), // YYYY-MM format
  type: mysqlEnum("receiptType", ["cell_phone", "vehicle_maintenance"]).notNull(),
  fileUrl: text("fileUrl").notNull(), // S3 CDN URL
  fileKey: varchar("fileKey", { length: 512 }).notNull(), // S3 object key
  fileName: varchar("fileName", { length: 512 }),
  status: mysqlEnum("receiptStatus", ["pending", "approved", "rejected"]).default("pending").notNull(),
  reviewedBy: int("reviewedBy"), // FK to users.id
  reviewedAt: timestamp("reviewedAt"),
  notes: text("notes"),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
});

export type CleanerReceipt = typeof cleanerReceipts.$inferSelect;
export type InsertCleanerReceipt = typeof cleanerReceipts.$inferInsert;

// ── Completed Cleans (Breezeway) ─────────────────────────────────────

/**
 * Completed cleaning tasks pulled from Breezeway.
 * Used for pay calculation: each completed clean = one unit of base pay.
 */
export const completedCleans = mysqlTable("completedCleans", {
  id: int("id").autoincrement().primaryKey(),
  breezewayTaskId: varchar("breezewayTaskId", { length: 128 }).notNull().unique(),
  cleanerId: int("cleanerId"), // FK to cleaners.id (matched by assignee)
  listingId: int("listingId"), // FK to listings.id (matched by property)
  propertyName: varchar("propertyName", { length: 256 }),
  scheduledDate: timestamp("scheduledDate"), // when the clean was scheduled
  completedDate: timestamp("completedDate"), // when the clean was actually completed
  cleaningFee: decimal("cleaningFee", { precision: 10, scale: 2 }), // the property's cleaning fee at time of clean
  distanceMiles: decimal("distanceMiles", { precision: 6, scale: 2 }), // one-way distance from POD storage
  weekOf: varchar("weekOf", { length: 10 }), // YYYY-MM-DD of the Monday of the week (for weekly grouping)
  pairedCleanerId: int("pairedCleanerId"), // FK to cleaners.id — if set, this clean was a paired/split clean
  splitRatio: decimal("splitRatio", { precision: 3, scale: 2 }).default("1.00"), // 0.50 for paired, 1.00 for solo
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CompletedClean = typeof completedCleans.$inferSelect;
export type InsertCompletedClean = typeof completedCleans.$inferInsert;

// ── Weekly Pay Snapshots ─────────────────────────────────────────────

/**
 * Weekly pay calculation snapshots.
 * Captures the full pay breakdown for each cleaner per week.
 * Used for dashboard display and email reports.
 */
export const weeklyPaySnapshots = mysqlTable("weeklyPaySnapshots", {
  id: int("id").autoincrement().primaryKey(),
  cleanerId: int("cleanerId").notNull(), // FK to cleaners.id
  weekOf: varchar("weekOf", { length: 10 }).notNull(), // YYYY-MM-DD of Monday
  // Base pay
  totalCleans: int("totalCleans").default(0),
  totalCleaningFees: decimal("totalCleaningFees", { precision: 10, scale: 2 }).default("0"), // sum of cleaning fees (hidden from cleaner)
  basePay: decimal("basePay", { precision: 10, scale: 2 }).default("0"), // = totalCleaningFees (shown as "base pay per clean" to cleaner)
  // Quality multiplier
  qualityScore: decimal("qualityScore", { precision: 4, scale: 2 }), // trailing 30-day avg
  qualityMultiplier: decimal("qualityMultiplier", { precision: 3, scale: 2 }).default("1.00"),
  qualityTierLabel: varchar("qualityTierLabel", { length: 64 }),
  // Volume multiplier
  weeklyRevenue: decimal("weeklyRevenue", { precision: 10, scale: 2 }).default("0"), // weekly cleaning fee revenue (hidden from cleaner)
  volumeMultiplier: decimal("volumeMultiplier", { precision: 3, scale: 2 }).default("1.00"),
  volumeTierLabel: varchar("volumeTierLabel", { length: 32 }), // Gold / Silver / Standard
  // Mileage
  totalMileage: decimal("totalMileage", { precision: 8, scale: 2 }).default("0"), // total round-trip miles
  mileageRate: decimal("mileageRate", { precision: 4, scale: 3 }).default("0.700"), // IRS rate used
  mileagePay: decimal("mileagePay", { precision: 10, scale: 2 }).default("0"),
  // Reimbursements (monthly, prorated to week)
  cellPhoneReimbursement: decimal("cellPhoneReimbursement", { precision: 10, scale: 2 }).default("0"),
  vehicleReimbursement: decimal("vehicleReimbursement", { precision: 10, scale: 2 }).default("0"),
  // Totals
  totalPay: decimal("totalPay", { precision: 10, scale: 2 }).default("0"),
  // Metadata
  calculatedAt: timestamp("calculatedAt").defaultNow().notNull(),
  emailSentAt: timestamp("emailSentAt"), // when the weekly report email was sent
});

export type WeeklyPaySnapshot = typeof weeklyPaySnapshots.$inferSelect;
export type InsertWeeklyPaySnapshot = typeof weeklyPaySnapshots.$inferInsert;
