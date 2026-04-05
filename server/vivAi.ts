/**
 * Viv AI — email triage, task extraction, and draft replies using OpenAI.
 *
 * NOTE: This file was truncated during Manus zip export.
 * Functions are stubs — re-export from Manus to restore full AI functionality.
 */

export interface TriageResult {
  category: string;
  priority: "urgent" | "important" | "fyi" | "noise";
  summary: string;
  suggestedAction?: string;
}

export interface BookingDetails {
  propertyName?: string;
  checkIn?: string;
  checkOut?: string;
  nights?: number;
  nightlyRate?: string;
  guestName?: string;
  confirmationCode?: string;
}

export interface ReviewDetails {
  propertyName?: string;
  rating?: number;
  highlights?: string;
  improvements?: string;
}

export async function triageEmail(email: {
  subject: string;
  from: string;
  snippet: string;
  body?: string;
}): Promise<TriageResult> {
  return { category: "unknown", priority: "fyi", summary: "Stub — re-export from Manus" };
}

export async function triageBatch(emails: Array<{
  subject: string;
  from: string;
  snippet: string;
}>): Promise<TriageResult[]> {
  return emails.map(() => ({ category: "unknown", priority: "fyi" as const, summary: "Stub" }));
}

export async function draftReply(email: {
  subject: string;
  from: string;
  body: string;
  instructions?: string;
}): Promise<{ draft: string }> {
  return { draft: "" };
}

export async function extractTaskFromEmail(email: {
  subject: string;
  body: string;
}): Promise<{ title: string; description: string; department?: string } | null> {
  return null;
}

export async function extractBookingDetails(data: {
  type: string;
  subject: string;
  snippet: string;
  body?: string;
}): Promise<BookingDetails | null> {
  return null;
}

export async function extractReviewDetails(data: {
  type: string;
  subject: string;
  snippet: string;
  body?: string;
}): Promise<ReviewDetails | null> {
  return null;
}
