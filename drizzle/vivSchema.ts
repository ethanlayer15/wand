/**
 * Viv-specific database tables for email triage cache, snooze, and labels.
 * These supplement the live IMAP data with AI-generated metadata.
 */
import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
} from "drizzle-orm/mysql-core";

/**
 * Cached AI triage results for emails.
 * Keyed by messageId so we don't re-triage the same email.
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
  needsReply: int("needsReply").default(0).notNull(), // 1 = needs reply, 0 = informational
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VivTriageCache = typeof vivTriageCache.$inferSelect;

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

export type VivSnooze = typeof vivSnooze.$inferSelect;

/**
 * User-applied labels on emails (beyond Gmail's built-in labels).
 */
export const vivLabels = mysqlTable("vivLabels", {
  id: int("id").autoincrement().primaryKey(),
  messageId: varchar("messageId", { length: 512 }).notNull(),
  label: varchar("label", { length: 128 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VivLabel = typeof vivLabels.$inferSelect;

/**
 * Archived emails tracking (since Gmail archive is just removing from inbox).
 */
export const vivArchived = mysqlTable("vivArchived", {
  id: int("id").autoincrement().primaryKey(),
  messageId: varchar("messageId", { length: 512 }).notNull().unique(),
  uid: int("uid").notNull(),
  archivedAt: timestamp("archivedAt").defaultNow().notNull(),
});

export type VivArchived = typeof vivArchived.$inferSelect;
