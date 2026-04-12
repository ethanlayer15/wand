/**
 * Quo (OpenPhone) SMS client — sends text messages via the Quo API.
 */
import { ENV } from "./_core/env";

export interface SendSmsOptions {
  to: string; // E.164 phone number, e.g. "+15551234567"
  content: string; // plain text, max 1600 chars
}

export async function sendSms(opts: SendSmsOptions): Promise<void> {
  if (!ENV.quoApiKey) {
    throw new Error("QUO_API_KEY is not configured");
  }

  const res = await fetch("https://api.openphone.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: ENV.quoApiKey,
    },
    body: JSON.stringify({
      content: opts.content,
      from: ENV.quoPhoneNumber,
      to: [opts.to],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Quo SMS failed (${res.status}): ${body.slice(0, 500)}`);
  }
}
