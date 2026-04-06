import Stripe from "stripe";
import { ENV } from "./_core/env";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!ENV.stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    _stripe = new Stripe(ENV.stripeSecretKey, {
      apiVersion: "2025-04-30.basil" as any,
      timeout: 30000, // 30 second timeout per request
    });
  }
  return _stripe;
}

// In-memory cache for Stripe customers (refreshed every 5 minutes)
let _customerCache: { customers: Stripe.Customer[]; ts: number } | null = null;
const CUSTOMER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * List all Stripe customers (paginated)
 */
export async function listStripeCustomers(limit = 100): Promise<Stripe.Customer[]> {
  // Return cached customers if still fresh
  if (_customerCache && Date.now() - _customerCache.ts < CUSTOMER_CACHE_TTL) {
    return _customerCache.customers;
  }

  const stripe = getStripe();
  const customers: Stripe.Customer[] = [];
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore && customers.length < 500) {
    const params: Stripe.CustomerListParams = { limit };
    if (startingAfter) params.starting_after = startingAfter;

    const result = await stripe.customers.list(params);
    const active = result.data.filter((c) => !c.deleted);
    customers.push(...active);
    hasMore = result.has_more;
    if (result.data.length > 0) {
      startingAfter = result.data[result.data.length - 1].id;
    }
  }

  // Update cache
  _customerCache = { customers, ts: Date.now() };
  return customers;
}

/**
 * Get a single Stripe customer
 */
export async function getStripeCustomer(customerId: string): Promise<Stripe.Customer | null> {
  try {
    const stripe = getStripe();
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return null;
    return customer as Stripe.Customer;
  } catch {
    return null;
  }
}

/**
 * Check if a customer has a default payment method (card on file)
 */
export async function customerHasPaymentMethod(customerId: string): Promise<boolean> {
  try {
    const stripe = getStripe();
    const methods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
      limit: 1,
    });
    return methods.data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Charge a customer's card on file via PaymentIntent
 */
export async function chargeCardOnFile(params: {
  customerId: string;
  amountCents: number;
  description: string;
  metadata?: Record<string, string>;
}): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();

  // Get the customer's default payment method
  const methods = await stripe.paymentMethods.list({
    customer: params.customerId,
    type: "card",
    limit: 1,
  });

  if (methods.data.length === 0) {
    throw new Error(`Customer ${params.customerId} has no card on file`);
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: params.amountCents,
    currency: "usd",
    customer: params.customerId,
    payment_method: methods.data[0].id,
    off_session: true,
    confirm: true,
    description: params.description,
    metadata: params.metadata || {},
  });

  return paymentIntent;
}

/**
 * Create and send a Stripe Invoice with line items
 */
export async function createAndSendInvoice(params: {
  customerId: string;
  lineItems: Array<{
    description: string;
    amountCents: number;
  }>;
  description?: string;
  metadata?: Record<string, string>;
}): Promise<Stripe.Invoice> {
  const stripe = getStripe();

  // Create invoice
  const invoice = await stripe.invoices.create({
    customer: params.customerId,
    collection_method: "send_invoice",
    days_until_due: 30,
    description: params.description || undefined,
    metadata: params.metadata || {},
    auto_advance: true,
  });

  // Add line items
  for (const item of params.lineItems) {
    await stripe.invoiceItems.create({
      customer: params.customerId,
      invoice: invoice.id,
      amount: item.amountCents,
      currency: "usd",
      description: item.description,
    });
  }

  // Finalize and send
  const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.sendInvoice(finalizedInvoice.id);

  return finalizedInvoice;
}

/**
 * Create a DRAFT Stripe Invoice (not finalized, not sent).
 * Returns the draft invoice — user can preview/edit in Stripe Dashboard before sending.
 */
export async function createDraftInvoice(params: {
  customerId: string;
  lineItems: Array<{
    description: string;
    amountCents: number;
  }>;
  description?: string;
  metadata?: Record<string, string>;
}): Promise<Stripe.Invoice> {
  const stripe = getStripe();

  // Create invoice as draft (auto_advance: false keeps it as draft)
  const invoice = await stripe.invoices.create({
    customer: params.customerId,
    collection_method: "send_invoice",
    days_until_due: 30,
    description: params.description || undefined,
    metadata: params.metadata || {},
    auto_advance: false,
  });

  // Add line items
  for (const item of params.lineItems) {
    await stripe.invoiceItems.create({
      customer: params.customerId,
      invoice: invoice.id,
      amount: item.amountCents,
      currency: "usd",
      description: item.description,
    });
  }

  return invoice;
}
