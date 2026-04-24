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
  source: mysqlEnum("source", ["hostaway", "manual"]).default("hostaway").notNull(),
  breezewayPropertyId: varchar("breezewayPropertyId", { length: 64 }), // direct link to breezeway property for manual listings
  airbnbListingUrl: text("airbnbListingUrl"), // future: pull reviews directly from Airbnb
  status: mysqlEnum("status", ["active", "inactive", "archived"])
    .default("active")
    .notNull(),
  photoUrl: text("photoUrl"),
  avgRating: decimal("avgRating", { precision: 3, scale: 2 }),
  reviewCount: int("reviewCount").default(0),
  // ── Compensation fields ──
  // Replaced the old bedroomTier field in 2026-04. Base pay per clean is
  // now 10% of cleaningFeeCharge rounded up to the nearest $10.
  distanceFromStorage: decimal("distanceFromStorage", { precision: 6, scale: 2 }), // one-way miles
  cleaningFeeCharge: decimal("cleaningFeeCharge", { precision: 10, scale: 2 }), // what 5STR charges the customer
  podId: int("podId"), // FK to pods.id — which geographic pod this property belongs to
  cleaningReportsEnabled: boolean("cleaningReportsEnabled").default(false), // toggle SMS/Slack cleaning reports per property
  cleaningReportSlackWebhook: text("cleaningReportSlackWebhook"), // per-property Slack incoming webhook for cleaning reports
  // New properties land in "pending" until an admin assigns pod + cleaning fee
  // + bedroom tier, then flips to "onboarded". Existing properties are
  // backfilled to "onboarded" on the deploy that adds this column.
  onboardingStatus: mysqlEnum("onboardingStatus", ["pending", "onboarded"])
    .default("pending")
    .notNull(),
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
  cleanlinessRating: int("cleanlinessRating"), // Airbnb cleaning sub-score (1-5)
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
  aiTaskTitle: varchar("aiTaskTitle", { length: 256 }),
  aiIssues: json("aiIssues").$type<Array<{
    type: string;
    description: string;
    severity: "low" | "medium" | "high" | "critical";
    quote: string;
    confidence: "high" | "medium" | "low";
  }>>(),
  // Unified analyzer enrichment (populated alongside aiIssues/aiSummary by
  // the unified review analyzer; mirrored into reviewAnalysis for legacy
  // consumers, see analyzeReviewUnified in server/reviewAnalyzer.ts).
  aiSentimentScore: int("aiSentimentScore"),              // -100 to 100
  aiCategories: json("aiCategories").$type<string[]>(),   // ["cleaning", "maintenance", …]
  aiHighlights: json("aiHighlights").$type<string[]>(),   // positive mentions
  aiCleanerMentioned: varchar("aiCleanerMentioned", { length: 256 }),
  taskId: int("taskId"),               // FK → tasks.id, links review to auto-created task
  arrivalDate: timestamp("arrivalDate"),
  departureDate: timestamp("departureDate"),
  channelId: int("channelId"),
  // Host response lifecycle. `hostResponse`/`hostResponseSubmittedAt` are read
  // from Hostaway on every sync and represent the live reply-on-record.
  // `hostResponseDraft` + `hostResponseStatus` are owned by Wand — a user or
  // the Wanda agent can draft a reply here, and a future Phase 2 mutation
  // will publish drafts back to Hostaway.
  hostResponse: text("hostResponse"),
  hostResponseSubmittedAt: timestamp("hostResponseSubmittedAt"),
  hostResponseDraft: text("hostResponseDraft"),
  hostResponseStatus: mysqlEnum("hostResponseStatus", ["none", "draft", "submitted", "failed"])
    .default("none"),
  hostResponseError: text("hostResponseError"),           // last submit error message, if status=failed
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
  // Board + visibility (Phase 1: department kanbans + private tasks)
  boardId: int("boardId"), // FK → boards.id; nullable for legacy rows (default board applied via backfill)
  visibility: mysqlEnum("visibility", ["board", "private"]).default("board").notNull(),
  ownerUserId: int("ownerUserId"), // FK → users.id; required when visibility="private"
  ownerAgent: mysqlEnum("ownerAgent", ["wanda", "starry"]), // which agent owns the private task surface
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
  // Owner-level Slack webhook for cleaning reports. Used as a fallback when
  // listings.cleaningReportSlackWebhook is null so an owner with multiple
  // properties only needs to configure the channel once.
  cleaningReportSlackWebhook: text("cleaningReportSlackWebhook"),
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
  aiActionTitle: varchar("aiActionTitle", { length: 256 }),
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
  taskTitle: varchar("taskTitle", { length: 256 }),
  reportUrl: text("reportUrl"), // Breezeway portal report link    // Breezeway task name, e.g. "Turnover Clean"
  scheduledDate: timestamp("scheduledDate"), // when the clean was scheduled
  completedDate: timestamp("completedDate"), // when the clean was actually completed
  cleaningFee: decimal("cleaningFee", { precision: 10, scale: 2 }), // the property's cleaning fee at time of clean
  distanceMiles: decimal("distanceMiles", { precision: 6, scale: 2 }), // one-way distance from POD storage
  weekOf: varchar("weekOf", { length: 10 }), // YYYY-MM-DD of the Wednesday that starts the Wed→Tue pay period
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
  weekOf: varchar("weekOf", { length: 10 }).notNull(), // YYYY-MM-DD of the Wednesday that starts the Wed→Tue pay period
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

// ── Cleaning Report Recipients ──────────────────────────────────────

/**
 * Per-property SMS recipients for automated cleaning reports via Quo.
 * Supports multiple phone numbers per property (e.g., owner + property manager).
 */
export const cleaningReportRecipients = mysqlTable("cleaningReportRecipients", {
  id: int("id").autoincrement().primaryKey(),
  listingId: int("listingId").notNull(),
  phoneNumber: varchar("phoneNumber", { length: 20 }).notNull(),
  name: varchar("name", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CleaningReportRecipient = typeof cleaningReportRecipients.$inferSelect;
export type InsertCleaningReportRecipient = typeof cleaningReportRecipients.$inferInsert;

// ── Cleaning Reports Sent ───────────────────────────────────────────

/**
 * Tracks which completed cleans have had report SMS sent via Quo.
 * Prevents duplicate sends and provides an audit trail.
 */
export const cleaningReportsSent = mysqlTable("cleaningReportsSent", {
  id: int("id").autoincrement().primaryKey(),
  completedCleanId: int("completedCleanId").notNull(),
  breezewayTaskId: varchar("breezewayTaskId", { length: 128 }).notNull(),
  recipientPhoneNumbers: text("recipientPhoneNumbers").notNull(),
  status: mysqlEnum("reportStatus", ["sent", "failed", "no_recipients"]).default("sent").notNull(),
  errorMessage: text("errorMessage"),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
});

export type CleaningReportSent = typeof cleaningReportsSent.$inferSelect;
export type InsertCleaningReportSent = typeof cleaningReportsSent.$inferInsert;

// ── Reservation Snapshots (for last-minute change detection) ────────

/**
 * Snapshot of reservation state fetched from Breezeway so the last-minute
 * change notifier can diff against prior state and detect:
 *   - new bookings within the 72h window
 *   - shortened stays (check-out moved earlier)
 *   - extended stays (check-out moved later)
 *   - check-in date shifts
 *   - cancellations (disappeared from feed while check_in still upcoming)
 *
 * `lastChangeHash` stores a deterministic hash of the most recent change we
 * already notified about so repeat cron runs don't re-fire the same alert.
 */
export const reservationSnapshots = mysqlTable("reservationSnapshots", {
  id: int("id").autoincrement().primaryKey(),
  breezewayReservationId: varchar("breezewayReservationId", { length: 64 }).notNull().unique(),
  homeId: int("homeId").notNull(),
  checkIn: varchar("checkIn", { length: 32 }), // YYYY-MM-DD
  checkOut: varchar("checkOut", { length: 32 }), // YYYY-MM-DD
  status: varchar("status", { length: 64 }), // Breezeway reservation status string
  guestName: text("guestName"),
  lastChangeHash: varchar("lastChangeHash", { length: 128 }),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReservationSnapshot = typeof reservationSnapshots.$inferSelect;
export type InsertReservationSnapshot = typeof reservationSnapshots.$inferInsert;

// ── Payroll Runs (QuickBooks Payroll Elite export) ──────────────────

/**
 * A weekly payroll run. Generated every Wednesday 9 AM ET covering the
 * prior week (Mon → Sun). Admin reviews the draft, approves it, and
 * exports a CSV that the accountant imports into QBO Payroll Elite.
 *
 * Statuses:
 *   - draft:     generated but not yet approved
 *   - approved:  admin has reviewed and locked the run (numbers frozen)
 *   - submitted: CSV was exported and sent to accountant / QB
 *
 * `includesMonthlyReceipts` flags the last-Friday-of-month pay cycle
 * which adds cell-phone + vehicle reimbursement to each eligible line.
 */
export const payrollRuns = mysqlTable("payrollRuns", {
  id: int("id").autoincrement().primaryKey(),
  weekOf: varchar("weekOf", { length: 10 }).notNull(), // YYYY-MM-DD of the Wednesday that starts the Wed→Tue pay period
  status: mysqlEnum("payrollRunStatus", ["draft", "approved", "submitted"]).default("draft").notNull(),
  includesMonthlyReceipts: boolean("includesMonthlyReceipts").default(false).notNull(),
  cleanerCount: int("cleanerCount").default(0).notNull(),
  totalGrossPay: decimal("totalGrossPay", { precision: 12, scale: 2 }).default("0").notNull(),
  totalMileage: decimal("totalMileage", { precision: 10, scale: 2 }).default("0").notNull(),
  totalReimbursements: decimal("totalReimbursements", { precision: 10, scale: 2 }).default("0").notNull(),
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
  approvedBy: int("approvedBy"), // users.id
  approvedAt: timestamp("approvedAt"),
  submittedAt: timestamp("submittedAt"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  weekOfUnique: uniqueIndex("payrollRuns_weekOf_unique").on(t.weekOf),
}));

export type PayrollRun = typeof payrollRuns.$inferSelect;
export type InsertPayrollRun = typeof payrollRuns.$inferInsert;

/**
 * One line per cleaner per run. Commission is split by listing state so
 * multi-state W2s allocate correctly (Virginia + North Carolina).
 * `weeklyPaySnapshotId` links back to the immutable source row used to
 * generate this line so we can always show "what was this based on?".
 */
export const payrollRunLines = mysqlTable("payrollRunLines", {
  id: int("id").autoincrement().primaryKey(),
  payrollRunId: int("payrollRunId").notNull(), // FK payrollRuns.id
  cleanerId: int("cleanerId").notNull(),
  cleanerName: text("cleanerName").notNull(),
  quickbooksEmployeeId: varchar("quickbooksEmployeeId", { length: 128 }),
  weeklyPaySnapshotId: int("weeklyPaySnapshotId"), // FK weeklyPaySnapshots.id
  // Commission split by listing state
  commissionVA: decimal("commissionVA", { precision: 10, scale: 2 }).default("0").notNull(),
  commissionNC: decimal("commissionNC", { precision: 10, scale: 2 }).default("0").notNull(),
  commissionOther: decimal("commissionOther", { precision: 10, scale: 2 }).default("0").notNull(),
  totalCommission: decimal("totalCommission", { precision: 10, scale: 2 }).default("0").notNull(),
  // Mileage — non-taxable, tracked separately (business expense reimbursement)
  mileageMiles: decimal("mileageMiles", { precision: 8, scale: 2 }).default("0").notNull(),
  mileageReimbursement: decimal("mileageReimbursement", { precision: 10, scale: 2 }).default("0").notNull(),
  // Monthly reimbursements — only populated on last-Fri-of-month runs
  cellPhoneReimbursement: decimal("cellPhoneReimbursement", { precision: 10, scale: 2 }).default("0").notNull(),
  vehicleReimbursement: decimal("vehicleReimbursement", { precision: 10, scale: 2 }).default("0").notNull(),
  // Total
  totalPay: decimal("totalPay", { precision: 10, scale: 2 }).default("0").notNull(),
  // Flags for UI review
  missingQbId: boolean("missingQbId").default(false).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PayrollRunLine = typeof payrollRunLines.$inferSelect;
export type InsertPayrollRunLine = typeof payrollRunLines.$inferInsert;

// ── Wand AI Agents (Phase 1 foundation) ─────────────────────────────

/**
 * Agent Suggestions — the universal human-in-loop queue.
 *
 * Every agent (Task Triage, Review Drafter, Performance Coach, Schedule
 * Optimizer, Pay Report QA, etc.) writes its proposed actions here. The
 * Ops Inbox UI renders them grouped by agent/kind and lets ops approve,
 * edit, dismiss, or snooze.
 *
 * `proposedAction` is an opaque JSON payload that the corresponding
 * executor reads when the suggestion is approved (e.g. a draft review
 * reply, a task reassignment, a vendor dispatch message).
 */
export const agentSuggestions = mysqlTable("agentSuggestions", {
  id: int("id").autoincrement().primaryKey(),
  agentName: varchar("agentName", { length: 64 }).notNull(), // e.g. "review_drafter", "task_triage", "schedule_optimizer"
  kind: varchar("kind", { length: 64 }).notNull(), // e.g. "review_reply", "task_reassign", "coaching_draft"
  title: text("title").notNull(), // short human-readable headline
  summary: text("summary"), // short description shown in the list view
  reasoning: text("reasoning"), // Claude's chain-of-thought / why it's suggesting this
  proposedAction: json("proposedAction"), // opaque payload for the executor
  confidence: decimal("confidence", { precision: 3, scale: 2 }), // 0.00-1.00
  status: mysqlEnum("agentSuggestionStatus", [
    "pending",
    "approved",
    "dismissed",
    "edited",
    "snoozed",
    "executed",
    "failed",
  ]).default("pending").notNull(),
  // Related entities (nullable — not every suggestion targets all of these)
  relatedListingId: int("relatedListingId"),
  relatedCleanerId: int("relatedCleanerId"),
  relatedTaskId: int("relatedTaskId"),
  relatedReviewId: int("relatedReviewId"),
  relatedPodId: int("relatedPodId"),
  // Review/execution metadata
  reviewedBy: int("reviewedBy"), // FK → users.id
  reviewedAt: timestamp("reviewedAt"),
  reviewNotes: text("reviewNotes"),
  executedAt: timestamp("executedAt"),
  executionResult: text("executionResult"),
  snoozedUntil: timestamp("snoozedUntil"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AgentSuggestion = typeof agentSuggestions.$inferSelect;
export type InsertAgentSuggestion = typeof agentSuggestions.$inferInsert;

/**
 * Agent Actions Audit Log — the full trail of every tool call Claude makes.
 *
 * Required for graduating individual agent workflows from "suggest" mode to
 * autonomous mode later: we can ask "of all the suggestions this agent
 * produced last month, how often did ops approve without edits?" and use
 * that to decide whether to auto-execute.
 */
export const agentActions = mysqlTable("agentActions", {
  id: int("id").autoincrement().primaryKey(),
  agentName: varchar("agentName", { length: 64 }).notNull(),
  runId: varchar("runId", { length: 64 }), // groups multiple tool calls from one agent run
  toolName: varchar("toolName", { length: 128 }).notNull(),
  input: json("input"), // tool call args
  output: json("output"), // tool result (may be truncated)
  success: boolean("success").default(true).notNull(),
  errorMessage: text("errorMessage"),
  durationMs: int("durationMs"),
  // Who triggered the run — either a user (for interactive chat) or a cron job
  userId: int("userId"), // FK → users.id, nullable for cron-triggered runs
  triggeredBy: varchar("triggeredBy", { length: 64 }), // "chat", "cron", "webhook"
  suggestionId: int("suggestionId"), // optional link to the suggestion this action produced
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AgentAction = typeof agentActions.$inferSelect;
export type InsertAgentAction = typeof agentActions.$inferInsert;

/**
 * Property Playbooks — Claude-maintained knowledge document per listing.
 *
 * Updated in the background (Phase 3) from reviews, tasks, guest messages,
 * and manual ops notes. Injected as context into every agent run that
 * touches a listing. This is the single most valuable context document
 * in the system — it's what a new ops hire would read, except it's
 * maintained automatically.
 */
export const propertyPlaybooks = mysqlTable("propertyPlaybooks", {
  id: int("id").autoincrement().primaryKey(),
  listingId: int("listingId").notNull().unique(), // FK → listings.id
  // Structured fields so UI can render sections
  quirks: json("quirks").$type<Array<{ note: string; source?: string; addedAt?: string }>>(),
  frequentIssues: json("frequentIssues").$type<Array<{ issue: string; count: number; lastSeen?: string }>>(),
  preferredVendors: json("preferredVendors").$type<Array<{ vendorId?: number; name: string; specialty: string; reason?: string }>>(),
  guestFeedbackThemes: json("guestFeedbackThemes").$type<Array<{ theme: string; sentiment: "positive" | "negative"; count: number }>>(),
  // Freeform ops-written notes (never overwritten by the agent)
  manualNotes: text("manualNotes"),
  // Agent-written freeform summary
  agentSummary: text("agentSummary"),
  lastAgentUpdateAt: timestamp("lastAgentUpdateAt"),
  lastManualUpdateAt: timestamp("lastManualUpdateAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PropertyPlaybook = typeof propertyPlaybooks.$inferSelect;
export type InsertPropertyPlaybook = typeof propertyPlaybooks.$inferInsert;

/**
 * Boards — department kanbans.
 *
 * Each board has its own column config and source filters. Tasks belong to
 * exactly one board (when visibility="board"). Private tasks have no board
 * but do carry an ownerUserId + ownerAgent.
 *
 * Seeded with three rows:
 *   - "Leisr Ops"  (slug: leisr_ops)   — current default for all legacy tasks
 *   - "Leisr Mgmt" (slug: leisr_mgmt)
 *   - "5STR Ops"   (slug: fivestr_ops)
 */
export const boards = mysqlTable("boards", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  department: mysqlEnum("department", ["leisr_ops", "leisr_mgmt", "fivestr_ops"]).notNull(),
  agent: mysqlEnum("agent", ["wanda", "starry"]).notNull(), // which agent feeds this board
  // Source toggles — agents check these before auto-creating tasks for this board
  sourcesEnabled: json("sourcesEnabled").$type<{
    guestMessages?: boolean;
    reviews?: boolean;
    breezeway?: boolean;
    slack?: boolean;
    gmail?: boolean;
    openphone?: boolean;
  }>(),
  // Column ordering (statuses to display + order). Falls back to default task statuses if null.
  columnConfig: json("columnConfig").$type<Array<{ status: string; label: string }>>(),
  // Channel routing (for Slack agent posts about this board)
  slackChannelId: varchar("slackChannelId", { length: 64 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Board = typeof boards.$inferSelect;
export type InsertBoard = typeof boards.$inferInsert;

/**
 * On-Call Schedule — who is responsible for a department/role at a given time.
 *
 * Read by Starry (and Wanda) when routing escalations. The simplest workable
 * shape: discrete shift rows with a start/end timestamp. Recurring shifts are
 * expanded into rows by the admin UI when scheduled.
 *
 * Lookup: getOnCall({ department, role?, at? }) returns the user whose shift
 * contains `at` (default: now). If multiple match, the most recently created
 * shift wins.
 */
export const onCallSchedule = mysqlTable("onCallSchedule", {
  id: int("id").autoincrement().primaryKey(),
  department: mysqlEnum("department", ["leisr_ops", "leisr_mgmt", "fivestr_ops"]).notNull(),
  role: varchar("role", { length: 64 }).default("primary").notNull(), // "primary", "backup", "guest_relations", etc.
  userId: int("userId").notNull(), // FK → users.id
  startsAt: timestamp("startsAt").notNull(),
  endsAt: timestamp("endsAt").notNull(),
  notes: text("notes"),
  // Slack DM target — usually derived from users.openId, but explicit override allowed
  slackUserId: varchar("slackUserId", { length: 64 }),
  createdBy: int("createdBy"), // FK → users.id
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OnCallShift = typeof onCallSchedule.$inferSelect;
export type InsertOnCallShift = typeof onCallSchedule.$inferInsert;

/**
 * Slack agent identity + per-user mapping.
 *
 * `slackBots` holds one row per Slack app we install (Wanda, Starry) with the
 * bot token + signing secret refs. `slackUserLinks` connects a Wand user to
 * their Slack user_id so agents can DM them about their tasks.
 */
export const slackBots = mysqlTable("slackBots", {
  id: int("id").autoincrement().primaryKey(),
  agent: mysqlEnum("agent", ["wanda", "starry"]).notNull().unique(),
  workspaceId: varchar("workspaceId", { length: 64 }).notNull(),
  botUserId: varchar("botUserId", { length: 64 }).notNull(),
  // Tokens stored as env-var refs (e.g. "SLACK_WANDA_BOT_TOKEN") — actual secrets in Railway env.
  botTokenRef: varchar("botTokenRef", { length: 128 }).notNull(),
  signingSecretRef: varchar("signingSecretRef", { length: 128 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SlackBot = typeof slackBots.$inferSelect;
export type InsertSlackBot = typeof slackBots.$inferInsert;

export const slackUserLinks = mysqlTable("slackUserLinks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // FK → users.id
  workspaceId: varchar("workspaceId", { length: 64 }).notNull(),
  slackUserId: varchar("slackUserId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SlackUserLink = typeof slackUserLinks.$inferSelect;
export type InsertSlackUserLink = typeof slackUserLinks.$inferInsert;

/**
 * Phase 4 — escalation group DMs.
 *
 * One row per private group DM that Wanda/Starry opens when routing a
 * cleaner's message to an on-call manager. Used both for audit and for the
 * 60-min loop guard that reuses an existing DM for same-issue follow-ups
 * instead of spawning a fresh one.
 *
 * Dedupe key: (agent, triggerSlackUserId, intent, breezewayTaskId | listingId)
 * within the `expiresAt` window. A cleaner with a clean AND a maintenance
 * ticket at the same property should still get two separate DMs — that's why
 * we dedupe on `breezewayTaskId` when available rather than `listingId`.
 *
 * `fallbackTier` records which on-call tier actually handled this escalation:
 *   "primary"    → normal path
 *   "backup"     → primary was unstaffed, backup role covered it
 *   "leadership" → both primary + backup empty, fell through to env-var leadership list
 *   "none"       → nobody reachable; Starry DM'd the cleaner with an apology
 */
export const escalationGroupDms = mysqlTable("escalationGroupDms", {
  id: int("id").autoincrement().primaryKey(),
  agent: mysqlEnum("agent", ["wanda", "starry"]).notNull(),
  triggerSlackUserId: varchar("triggerSlackUserId", { length: 64 }).notNull(),
  intent: varchar("intent", { length: 64 }).notNull(),
  listingId: int("listingId"),
  breezewayTaskId: varchar("breezewayTaskId", { length: 128 }),
  groupDmChannelId: varchar("groupDmChannelId", { length: 64 }).notNull(),
  onCallUserIds: json("onCallUserIds").$type<string[]>(),
  fallbackTier: varchar("fallbackTier", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
});

export type EscalationGroupDm = typeof escalationGroupDms.$inferSelect;
export type InsertEscalationGroupDm = typeof escalationGroupDms.$inferInsert;

/**
 * Onboarding — property-onboarding projects that flow through staged handoffs
 * (Ethan kickoff → Seth → Yosimar → Chloe → Ethan QA). Lives in a dedicated
 * "Onboarding" section in the UI, separate from the maintenance task board.
 *
 * Four templates (Airbnb-existing, Airbnb-new, rental arbitrage, combo
 * listings) declare per-stage default checklists + fields; per-project
 * stage instances hold the actual checklist state and any ad-hoc additions
 * (every property is unique, so each owner can extend their own stage).
 *
 * Stages can run in parallel — "notify next" hands off to the next owner
 * without closing the current stage (often we're waiting on photos / cleaner
 * / etc. while the next person can start their part).
 */

/**
 * Onboarding templates. v1 ships with 4 rows seeded by migration; future
 * UI authoring can mutate these. `stagesConfig` declares the ordered stages
 * with their default checklists + fields; per-project additions are stored
 * on `onboardingStageInstances` (no schema migration needed).
 */
type OnboardingFieldDef = {
  key: string;
  label: string;
  type: "text" | "longtext" | "number" | "money" | "url" | "boolean" | "date";
  placeholder?: string;
};

type OnboardingChecklistItemDef = {
  id: string;
  label: string;
  hint?: string;
};

type OnboardingStageDef = {
  key: string; // stable identifier, e.g. "kickoff", "seth_listing"
  label: string; // display label, e.g. "Seth — Listing setup"
  ownerRole?: "ethan" | "seth" | "yosimar" | "chloe" | string;
  defaultChecklist: OnboardingChecklistItemDef[];
  defaultFields: OnboardingFieldDef[];
};

export const onboardingTemplates = mysqlTable("onboardingTemplates", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  // Fields prompted at project creation (Ethan's kickoff fields)
  kickoffFieldSchema: json("kickoffFieldSchema").$type<OnboardingFieldDef[]>().notNull(),
  // Ordered stages with default checklist + fields per stage
  stagesConfig: json("stagesConfig").$type<OnboardingStageDef[]>().notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OnboardingTemplate = typeof onboardingTemplates.$inferSelect;
export type InsertOnboardingTemplate = typeof onboardingTemplates.$inferInsert;

/**
 * One onboarding project = one property being onboarded.
 *
 * `currentStageIndex` is the *latest active* stage (used for board column
 * placement). With concurrent stages allowed, the actual per-stage state
 * lives on onboardingStageInstances.
 */
export const onboardingProjects = mysqlTable("onboardingProjects", {
  id: int("id").autoincrement().primaryKey(),
  templateId: int("templateId").notNull(), // FK → onboardingTemplates.id
  propertyName: varchar("propertyName", { length: 256 }).notNull(),
  address: text("address"),
  listingId: int("listingId"), // FK → listings.id (nullable until Seth links it)
  currentStageIndex: int("currentStageIndex").default(0).notNull(),
  status: mysqlEnum("status", ["active", "blocked", "done", "cancelled"])
    .default("active")
    .notNull(),
  // Ethan's kickoff input (matches templates.kickoffFieldSchema by `key`)
  kickoffData: json("kickoffData").$type<Record<string, unknown>>(),
  createdBy: int("createdBy").notNull(), // FK → users.id
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OnboardingProject = typeof onboardingProjects.$inferSelect;
export type InsertOnboardingProject = typeof onboardingProjects.$inferInsert;

/**
 * Per-stage instance for a project. Created upfront (one row per stage in
 * the template's stagesConfig) when the project is created. `state` advances
 * as owners work; multiple instances can be `in_progress` at once.
 *
 * `checklistState` shape:
 *   {
 *     "<itemId>": { done: boolean, by?: number, at?: string, note?: string },
 *     "<customItemId>": { ...above, custom: true, label: string, addedBy: number }
 *   }
 *
 * `stageData` shape:
 *   {
 *     "<fieldKey>": <value>,
 *     "_custom": [ { key, label, type, value, addedBy } ]
 *   }
 */
export const onboardingStageInstances = mysqlTable(
  "onboardingStageInstances",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(), // FK → onboardingProjects.id
    stageIndex: int("stageIndex").notNull(),
    stageKey: varchar("stageKey", { length: 64 }).notNull(),
    ownerUserId: int("ownerUserId"), // FK → users.id; null until assigned
    state: mysqlEnum("state", ["not_started", "in_progress", "done"])
      .default("not_started")
      .notNull(),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    checklistState: json("checklistState").$type<Record<string, unknown>>(),
    stageData: json("stageData").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    uniqProjectStage: uniqueIndex("uniq_onboarding_project_stage").on(
      t.projectId,
      t.stageIndex,
    ),
  }),
);

export type OnboardingStageInstance = typeof onboardingStageInstances.$inferSelect;
export type InsertOnboardingStageInstance = typeof onboardingStageInstances.$inferInsert;

/**
 * Audit trail for an onboarding project. Drives the activity panel + the
 * agent learning loop later. Every meaningful action writes one row.
 */
export const onboardingEvents = mysqlTable("onboardingEvents", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(), // FK → onboardingProjects.id
  stageInstanceId: int("stageInstanceId"), // FK → onboardingStageInstances.id (nullable)
  eventType: mysqlEnum("eventType", [
    "project_created",
    "stage_started",
    "stage_completed",
    "stage_reopened",
    "notify_next",
    "reminder_sent",
    "comment_added",
    "field_updated",
    "checklist_item_added",
    "checklist_item_toggled",
    "owner_reassigned",
    "status_changed",
  ]).notNull(),
  actorUserId: int("actorUserId"), // FK → users.id; null for system actions (cron, agent)
  data: json("data").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OnboardingEvent = typeof onboardingEvents.$inferSelect;
export type InsertOnboardingEvent = typeof onboardingEvents.$inferInsert;
