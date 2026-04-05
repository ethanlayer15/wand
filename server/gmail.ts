/**
 * Gmail integration — IMAP (receive) and SMTP (send).
 *
 * NOTE: This file was truncated during Manus zip export.
 * IMAP fetch functions are stubs — re-export from Manus to restore full functionality.
 */

import Imap from "imap";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { ENV } from "./_core/env";

// ── IMAP helpers ────────────────────────────────────────────────────────

function createImapConnection(): Imap {
  return new Imap({
    user: ENV.gmailUser,
    password: ENV.gmailAppPassword,
    host: "imap.gmail.com",
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
  });
}

function imapConnect(imap: Imap): Promise<void> {
  return new Promise((resolve, reject) => {
    imap.once("ready", resolve);
    imap.once("error", reject);
    imap.connect();
  });
}

function imapEnd(imap: Imap): void {
  try {
    imap.end();
  } catch {
    // ignore
  }
}

export interface EmailItem {
  uid: number;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  labels: string[];
}

/**
 * Fetch emails from Gmail inbox.
 * TODO: Re-export full implementation from Manus.
 */
export async function fetchEmails(options?: {
  folder?: string;
  limit?: number;
  since?: Date;
}): Promise<EmailItem[]> {
  const imap = createImapConnection();
  try {
    await imapConnect(imap);
    // Stub — full IMAP search/fetch logic was truncated
    console.warn("[Gmail] fetchEmails is a stub — re-export from Manus for full functionality");
    return [];
  } finally {
    imapEnd(imap);
  }
}

/**
 * Fetch a single email by UID.
 */
export async function fetchEmailByUid(uid: number, folder = "INBOX"): Promise<any | null> {
  const imap = createImapConnection();
  try {
    await imapConnect(imap);
    console.warn("[Gmail] fetchEmailByUid is a stub — re-export from Manus");
    return null;
  } finally {
    imapEnd(imap);
  }
}

// ── SMTP (Send) ────────────────────────────────────────────────────────

function createSmtpTransport() {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: ENV.gmailUser,
      pass: ENV.gmailAppPassword,
    },
  });
}

export interface SendEmailOptions {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  originalDate?: string;
  originalFrom?: string;
  originalBody?: string;
}

function normalizeReplySubject(subject: string): string {
  const stripped = subject.replace(/^(Re:\s*|Fwd:\s*)+/i, "").trim();
  return `Re: ${stripped}`;
}

function buildQuotedBody(replyText: string, opts: {
  originalDate?: string;
  originalFrom?: string;
  originalBody?: string;
}): string {
  if (!opts.originalBody) return replyText;
  const dateStr = opts.originalDate
    ? new Date(opts.originalDate).toLocaleString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const fromStr = opts.originalFrom || "";
  const quotedLines = opts.originalBody.split("\n").map(l => `> ${l}`).join("\n");
  return `${replyText}\n\nOn ${dateStr}, ${fromStr} wrote:\n${quotedLines}`;
}

export async function sendEmail(opts: SendEmailOptions): Promise<{ messageId: string }> {
  const transport = createSmtpTransport();

  const subject = opts.inReplyTo ? normalizeReplySubject(opts.subject) : opts.subject;

  let referencesHeader: string | undefined;
  if (opts.inReplyTo) {
    const chain = [...(opts.references || []), opts.inReplyTo]
      .filter(Boolean)
      .map(r => r.startsWith("<") ? r : `<${r}>`);
    referencesHeader = [...new Set(chain)].join(" ");
  } else if (opts.references?.length) {
    referencesHeader = opts.references.map(r => r.startsWith("<") ? r : `<${r}>`).join(" ");
  }

  const textBody = opts.inReplyTo && opts.originalBody
    ? buildQuotedBody(opts.text || "", { originalDate: opts.originalDate, originalFrom: opts.originalFrom, originalBody: opts.originalBody })
    : opts.text;

  const info = await transport.sendMail({
    from: `"Ethan Layer" <${ENV.gmailUser}>`,
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject,
    text: textBody,
    html: opts.html,
    inReplyTo: opts.inReplyTo ? (opts.inReplyTo.startsWith("<") ? opts.inReplyTo : `<${opts.inReplyTo}>`) : undefined,
    references: referencesHeader,
  });

  return { messageId: info.messageId?.replace(/[<>]/g, "") || "" };
}

// ── Additional IMAP functions (stubs — truncated during export) ─────

export interface EmailListItem {
  uid: number;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  flags: string[];
}

export async function fetchEmailList(options?: {
  folder?: string;
  limit?: number;
  since?: Date;
  search?: string;
}): Promise<EmailListItem[]> {
  console.warn("[Gmail] fetchEmailList is a stub — re-export from Manus");
  return [];
}

export async function fetchEmail(uid: number, folder?: string): Promise<{
  uid: number;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  html: string;
  flags: string[];
} | null> {
  console.warn("[Gmail] fetchEmail is a stub — re-export from Manus");
  return null;
}

export async function archiveMessage(uid: number, folder?: string): Promise<void> {
  console.warn("[Gmail] archiveMessage is a stub — re-export from Manus");
}

export async function setFlags(uid: number, flags: string[], folder?: string): Promise<void> {
  console.warn("[Gmail] setFlags is a stub — re-export from Manus");
}

export async function searchEmails(query: string, options?: {
  folder?: string;
  limit?: number;
}): Promise<EmailListItem[]> {
  console.warn("[Gmail] searchEmails is a stub — re-export from Manus");
  return [];
}

export async function searchEmailsByFrom(from: string, options?: {
  folder?: string;
  limit?: number;
  since?: Date;
}): Promise<EmailListItem[]> {
  console.warn("[Gmail] searchEmailsByFrom is a stub — re-export from Manus");
  return [];
}

export async function testGmailConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const imap = createImapConnection();
    await imapConnect(imap);
    imapEnd(imap);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Unknown error" };
  }
}
