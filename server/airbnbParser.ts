/**
 * Airbnb email parser — extracts booking and review details from Airbnb notification emails.
 *
 * NOTE: This file was truncated during Manus zip export.
 * Functions are stubs that return null — re-export from Manus to restore.
 */

export interface ParsedBooking {
  propertyName?: string;
  guestName?: string;
  checkIn?: string;
  checkOut?: string;
  nights?: number;
  nightlyRate?: string;
  confirmationCode?: string;
  numGuests?: number;
}

export interface ParsedReview {
  propertyName?: string;
  guestName?: string;
  rating?: number;
  highlights?: string;
  improvements?: string;
}

export function parseBookingFromBody(body: string): ParsedBooking | null {
  return null;
}

export function parseBookingFromSnippet(snippet: string): ParsedBooking | null {
  return null;
}

export function parseBookingFromSubject(subject: string): ParsedBooking | null {
  return null;
}

export function parseBookingFromHtml(html: string): ParsedBooking | null {
  return null;
}

export function parseReviewFromBody(body: string): ParsedReview | null {
  return null;
}

export function parseReviewFromSnippet(snippet: string): ParsedReview | null {
  return null;
}

export function parseReviewFromSubject(subject: string): ParsedReview | null {
  return null;
}
