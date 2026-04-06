import { Router } from "express";
import Stripe from "stripe";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { billingRecord } from "../drizzle/schema";
import { eq } from "drizzle-orm";

export const stripeWebhookRouter = Router();

/**
 * Update billing records when a payment intent status changes.
 */
async function updateBillingRecordsByPaymentIntent(
  paymentIntentId: string,
  status: "charged" | "failed"
) {
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .update(billingRecord)
      .set({ status })
      .where(eq(billingRecord.stripePaymentIntentId, paymentIntentId));
    console.log(`[Stripe Webhook] Updated billing records for PI ${paymentIntentId} → ${status}`);
  } catch (err: any) {
    console.error(`[Stripe Webhook] Failed to update billing records for PI ${paymentIntentId}:`, err.message);
  }
}

/**
 * Update billing records when an invoice status changes.
 */
async function updateBillingRecordsByInvoice(
  invoiceId: string,
  status: "charged" | "failed"
) {
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .update(billingRecord)
      .set({ status })
      .where(eq(billingRecord.stripeInvoiceId, invoiceId));
    console.log(`[Stripe Webhook] Updated billing records for invoice ${invoiceId} → ${status}`);
  } catch (err: any) {
    console.error(`[Stripe Webhook] Failed to update billing records for invoice ${invoiceId}:`, err.message);
  }
}

stripeWebhookRouter.post("/webhook", async (req, res) => {
  let event: Stripe.Event;

  try {
    const stripe = new Stripe(ENV.stripeSecretKey);
    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // Fallback for testing without webhook secret
      event = JSON.parse(req.body.toString());
    }
  } catch (err: any) {
    console.error("[Stripe Webhook] Signature verification failed:", err.message);
    return res.status(400).json({ error: "Webhook signature verification failed" });
  }

  // Handle test events
  if (event.id.startsWith("evt_test_")) {
    console.log("[Stripe Webhook] Test event detected, returning verification response");
    return res.json({ verified: true });
  }

  console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`);

  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      console.log(`[Stripe Webhook] Payment succeeded: ${pi.id} ($${(pi.amount / 100).toFixed(2)})`);
      await updateBillingRecordsByPaymentIntent(pi.id, "charged");
      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      console.log(`[Stripe Webhook] Payment failed: ${pi.id}`);
      await updateBillingRecordsByPaymentIntent(pi.id, "failed");
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      console.log(`[Stripe Webhook] Invoice paid: ${invoice.id}`);
      await updateBillingRecordsByInvoice(invoice.id, "charged");
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      console.log(`[Stripe Webhook] Invoice payment failed: ${invoice.id}`);
      await updateBillingRecordsByInvoice(invoice.id, "failed");
      break;
    }

    default:
      console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});
