import { z } from "zod";
import { eq, and, inArray, desc } from "drizzle-orm";
import { protectedProcedure, managerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  customerMapping,
  rateCard,
  billingRecord,
  billingAuditLog,
  breezewayProperties as breezewayPropertiesTable,
  listings,
} from "../drizzle/schema";
import {
  listStripeCustomers,
  getStripeCustomer,
  customerHasPaymentMethod,
  chargeCardOnFile,
  createAndSendInvoice,
  createDraftInvoice,
} from "./stripe";
import { getBreezewayProperties } from "./db";
import { autoMapSuggestions } from "./fuzzyMatch";

export const billingRouter = router({
  // ── Customer Mapping ──────────────────────────────────────────────────

  customerMappings: router({
    list: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(customerMapping)
        .orderBy(customerMapping.breezewayOwnerName);
    }),

    upsert: managerProcedure
      .input(
        z.object({
          breezewayOwnerId: z.string(),
          breezewayOwnerName: z.string().optional(),
          stripeCustomerId: z.string().optional(),
          preferredBillingMethod: z
            .enum(["card_on_file", "invoice", "ask_each_time"])
            .default("ask_each_time"),
        })
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        await db
          .insert(customerMapping)
          .values({
            breezewayOwnerId: input.breezewayOwnerId,
            breezewayOwnerName: input.breezewayOwnerName ?? null,
            stripeCustomerId: input.stripeCustomerId ?? null,
            preferredBillingMethod: input.preferredBillingMethod,
          })
          .onDuplicateKeyUpdate({
            set: {
              breezewayOwnerName: input.breezewayOwnerName ?? undefined,
              stripeCustomerId: input.stripeCustomerId ?? undefined,
              preferredBillingMethod: input.preferredBillingMethod,
            },
          });

        return { success: true };
      }),

    delete: managerProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db.delete(customerMapping).where(eq(customerMapping.id, input.id));
        return { success: true };
      }),
  }),

  // ── Breezeway Properties (for owner dropdown) ───────────────────────

  breezewayProperties: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    // Join breezewayProperties with listings on referencePropertyId = hostawayId
    // so we can use the Hostaway internalName as the canonical display name
    const props = await db
      .select({
        breezewayId: breezewayPropertiesTable.breezewayId,
        bwName: breezewayPropertiesTable.name,
        internalName: listings.internalName,
        listingName: listings.name,
        address: breezewayPropertiesTable.address,
        city: breezewayPropertiesTable.city,
        state: breezewayPropertiesTable.state,
        tags: breezewayPropertiesTable.tags,
      })
      .from(breezewayPropertiesTable)
      .leftJoin(
        listings,
        eq(breezewayPropertiesTable.referencePropertyId, listings.hostawayId)
      )
      .orderBy(breezewayPropertiesTable.name);

    return props.map((p) => ({
      id: p.breezewayId,
      // Prefer Hostaway internalName > Hostaway name > Breezeway name
      name: p.internalName || p.listingName || p.bwName,
      address: [p.city, p.state].filter(Boolean).join(", ") || p.address || "",
      tags: (() => {
        try { return JSON.parse(p.tags || "[]") as string[]; } catch { return [] as string[]; }
      })(),
    }));
  }),

  // ── Property Tags (distinct list for filter dropdown) ─────────────────

  propertyTags: protectedProcedure.query(async () => {
    const props = await getBreezewayProperties();
    const tagSet = new Set<string>();
    for (const p of props) {
      try {
        const tags = JSON.parse(p.tags || "[]") as string[];
        tags.forEach((t) => t && tagSet.add(t));
      } catch {
        // ignore malformed
      }
    }
    return Array.from(tagSet).sort();
  }),

  // ── Stripe Customers ──────────────────────────────────────────────────

  stripeCustomers: router({
    list: protectedProcedure.query(async () => {
      try {
        const customers = await listStripeCustomers();
        return customers.map((c) => ({
          id: c.id,
          name: c.name || c.email || c.id,
          email: c.email,
          hasPaymentMethod: false, // filled lazily
        }));
      } catch (err) {
        console.error("[Stripe] Failed to list customers:", err);
        return [];
      }
    }),

    checkPaymentMethod: protectedProcedure
      .input(z.object({ customerId: z.string() }))
      .query(async ({ input }) => {
        return { hasPaymentMethod: await customerHasPaymentMethod(input.customerId) };
      }),
  }),

  // ── Rate Card ─────────────────────────────────────────────────────────

  rateCards: router({
    list: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(rateCard).orderBy(rateCard.propertyId, rateCard.taskType);
    }),

    byProperty: protectedProcedure
      .input(z.object({ propertyId: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(rateCard)
          .where(eq(rateCard.propertyId, input.propertyId));
      }),

    upsert: managerProcedure
      .input(
        z.object({
          id: z.number().optional(), // if provided, update by ID
          propertyId: z.string(),
          propertyName: z.string().optional(),
          csvName: z.string().optional(),
          matchConfidence: z.string().optional(),
          matchScore: z.number().optional(),
          taskType: z.string(),
          amount: z.string(), // decimal as string
        })
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        if (input.id) {
          // Update by ID (for editing existing entries)
          await db
            .update(rateCard)
            .set({
              propertyId: input.propertyId,
              propertyName: input.propertyName ?? undefined,
              csvName: input.csvName ?? undefined,
              matchConfidence: input.matchConfidence ?? undefined,
              matchScore: input.matchScore ?? undefined,
              amount: input.amount,
              taskType: input.taskType,
            })
            .where(eq(rateCard.id, input.id));
        } else {
          // Check if exists by propertyId + taskType
          const existing = await db
            .select()
            .from(rateCard)
            .where(
              and(
                eq(rateCard.propertyId, input.propertyId),
                eq(rateCard.taskType, input.taskType)
              )
            )
            .limit(1);

          if (existing.length > 0) {
            await db
              .update(rateCard)
              .set({
                amount: input.amount,
                propertyName: input.propertyName ?? undefined,
                csvName: input.csvName ?? undefined,
                matchConfidence: input.matchConfidence ?? undefined,
                matchScore: input.matchScore ?? undefined,
              })
              .where(eq(rateCard.id, existing[0].id));
          } else {
            await db.insert(rateCard).values({
              propertyId: input.propertyId,
              propertyName: input.propertyName ?? null,
              csvName: input.csvName ?? null,
              matchConfidence: input.matchConfidence ?? null,
              matchScore: input.matchScore ?? null,
              taskType: input.taskType,
              amount: input.amount,
            });
          }
        }

        return { success: true };
      }),

    delete: managerProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db.delete(rateCard).where(eq(rateCard.id, input.id));
        return { success: true };
      }),
  }),

  // ── Auto-Map (fuzzy match Breezeway properties → Stripe customers) ──

  autoMap: protectedProcedure.query(async () => {
    // 1. Fetch Breezeway properties from DB
    const props = await getBreezewayProperties();
    const breezewayProps = props.map((p) => ({
      id: p.breezewayId,
      name: p.name,
    }));

    // 2. Fetch Stripe customers from live API
    let stripeCustomers: Array<{ id: string; name: string | null; email: string | null }> = [];
    try {
      const customers = await listStripeCustomers();
      stripeCustomers = customers.map((c) => ({
        id: c.id,
        name: c.name || null,
        email: c.email || null,
      }));
    } catch (err) {
      console.error("[AutoMap] Failed to list Stripe customers:", err);
    }

    // 3. Get existing mappings to exclude
    const db = await getDb();
    const existingMappedIds = new Set<string>();
    if (db) {
      const mappings = await db.select().from(customerMapping);
      mappings.forEach((m) => existingMappedIds.add(m.breezewayOwnerId));
    }

    // 4. Run fuzzy matching
    const suggestions = autoMapSuggestions(breezewayProps, stripeCustomers, existingMappedIds);

    return {
      suggestions,
      totalProperties: breezewayProps.length,
      totalCustomers: stripeCustomers.length,
      alreadyMapped: existingMappedIds.size,
    };
  }),

  // ── Billing Records ───────────────────────────────────────────────────

  records: router({
    list: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(billingRecord)
        .orderBy(desc(billingRecord.billedAt));
    }),

    byTaskIds: protectedProcedure
      .input(z.object({ taskIds: z.array(z.string()) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        if (input.taskIds.length === 0) return [];
        return db
          .select()
          .from(billingRecord)
          .where(inArray(billingRecord.breezewayTaskId, input.taskIds));
      }),
  }),

  // ── Billing Actions ───────────────────────────────────────────────────

  chargeCard: managerProcedure
    .input(
      z.object({
        stripeCustomerId: z.string(),
        lineItems: z.array(
          z.object({
            breezewayTaskId: z.string(),
            breezewayTaskName: z.string(),
            propertyId: z.string(),
            propertyName: z.string(),
            description: z.string(),
            amount: z.string(), // decimal string e.g. "150.00"
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const totalCents = input.lineItems.reduce(
        (sum, item) => sum + Math.round(parseFloat(item.amount) * 100),
        0
      );

      if (totalCents < 50) {
        throw new Error("Total amount must be at least $0.50");
      }

      const description = input.lineItems
        .map((i) => `${i.propertyName}: ${i.description}`)
        .join("; ");

      // Charge the card
      const paymentIntent = await chargeCardOnFile({
        customerId: input.stripeCustomerId,
        amountCents: totalCents,
        description: description.slice(0, 500),
        metadata: {
          source: "wand_billing",
          task_count: String(input.lineItems.length),
        },
      });

      // Record each task as billed
      for (const item of input.lineItems) {
        await db.insert(billingRecord).values({
          breezewayTaskId: item.breezewayTaskId,
          breezewayTaskName: item.breezewayTaskName,
          propertyId: item.propertyId,
          propertyName: item.propertyName,
          stripeCustomerId: input.stripeCustomerId,
          stripePaymentIntentId: paymentIntent.id,
          amount: item.amount,
          billingMethod: "card_on_file",
          status: paymentIntent.status === "succeeded" ? "charged" : "pending",
        });
      }

      // Audit log
      await db.insert(billingAuditLog).values({
        action: "charge_card",
        stripeCustomerId: input.stripeCustomerId,
        stripePaymentIntentId: paymentIntent.id,
        amount: (totalCents / 100).toFixed(2),
        details: {
          taskCount: input.lineItems.length,
          tasks: input.lineItems.map((i) => ({
            id: i.breezewayTaskId,
            name: i.breezewayTaskName,
            amount: i.amount,
          })),
        },
      });

      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        amount: (totalCents / 100).toFixed(2),
      };
    }),

  // ── Leisr Billing: Consolidated Invoice ───────────────────────────────

  sendLeisrInvoice: managerProcedure
    .input(
      z.object({
        lineItems: z.array(
          z.object({
            propertyName: z.string(),
            description: z.string().optional(), // custom Stripe line description
            quantity: z.number(),
            unitPrice: z.string(), // decimal string e.g. "150.00"
            amount: z.string(),    // total = qty × unitPrice
            taskIds: z.array(z.string()), // all Breezeway task IDs for this property
            taskNames: z.array(z.string()),
          })
        ),
        invoiceDescription: z.string(), // e.g. "March 2026 5STR Invoice"
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // 1. Find "Leisr Stays" customer in Stripe
      const customers = await listStripeCustomers();
      const leisrCustomer = customers.find(
        (c) => c.name && c.name.toLowerCase().includes("leisr")
      );
      if (!leisrCustomer) {
        throw new Error(
          'Could not find a Stripe customer matching "Leisr Stays". Please create one in Stripe first.'
        );
      }

      // 2. Build Stripe line items
      const stripeLineItems = input.lineItems.map((item) => ({
        description:
          item.description ||
          (item.quantity > 1
            ? `${item.propertyName} × ${item.quantity} cleans`
            : `${item.propertyName} — ${item.taskNames[0] || "Service"}`),
        amountCents: Math.round(parseFloat(item.amount) * 100),
      }));

      const totalCents = stripeLineItems.reduce((s, i) => s + i.amountCents, 0);
      if (totalCents < 50) {
        throw new Error("Total amount must be at least $0.50");
      }

      // 3. Create and send invoice with description and Leisr Billing tag
      const invoice = await createAndSendInvoice({
        customerId: leisrCustomer.id,
        lineItems: stripeLineItems,
        description: input.invoiceDescription,
        metadata: {
          source: "wand_leisr_billing",
          tag: "Leisr Billing",
          property_count: String(input.lineItems.length),
          task_count: String(
            input.lineItems.reduce((s, i) => s + i.taskIds.length, 0)
          ),
        },
      });

      // 4. Record each task as billed
      for (const item of input.lineItems) {
        for (let i = 0; i < item.taskIds.length; i++) {
          await db.insert(billingRecord).values({
            breezewayTaskId: item.taskIds[i],
            breezewayTaskName: item.taskNames[i] || item.propertyName,
            propertyId: "", // Leisr billing groups by property name
            propertyName: item.propertyName,
            stripeCustomerId: leisrCustomer.id,
            stripeInvoiceId: invoice.id,
            amount: item.unitPrice,
            billingMethod: "invoice",
            status: "invoiced",
          });
        }
      }

      // 5. Audit log
      await db.insert(billingAuditLog).values({
        action: "leisr_invoice",
        stripeCustomerId: leisrCustomer.id,
        stripeInvoiceId: invoice.id,
        amount: (totalCents / 100).toFixed(2),
        details: {
          invoiceDescription: input.invoiceDescription,
          propertyCount: input.lineItems.length,
          taskCount: input.lineItems.reduce((s, i) => s + i.taskIds.length, 0),
          lineItems: input.lineItems.map((i) => ({
            property: i.propertyName,
            qty: i.quantity,
            unitPrice: i.unitPrice,
            total: i.amount,
          })),
          invoiceUrl: invoice.hosted_invoice_url,
        },
      });

      return {
        success: true,
        invoiceId: invoice.id,
        invoiceUrl: invoice.hosted_invoice_url,
        amount: (totalCents / 100).toFixed(2),
        customerName: leisrCustomer.name || "Leisr Stays",
        customerId: leisrCustomer.id,
      };
    }),

  // ── Leisr Billing: Preview (Draft) Invoice ─────────────────────────────

  previewLeisrInvoice: managerProcedure
    .input(
      z.object({
        lineItems: z.array(
          z.object({
            propertyName: z.string(),
            description: z.string().optional(),
            quantity: z.number(),
            unitPrice: z.string(),
            amount: z.string(),
            taskIds: z.array(z.string()),
            taskNames: z.array(z.string()),
          })
        ),
        invoiceDescription: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // 1. Find Leisr customer
      const customers = await listStripeCustomers();
      const leisrCustomer = customers.find(
        (c) => c.name && c.name.toLowerCase().includes("leisr")
      );
      if (!leisrCustomer) {
        throw new Error(
          'Could not find a Stripe customer matching "Leisr Stays". Please create one in Stripe first.'
        );
      }

      // 2. Build Stripe line items
      const stripeLineItems = input.lineItems.map((item) => ({
        description:
          item.description ||
          (item.quantity > 1
            ? `${item.propertyName} × ${item.quantity} cleans`
            : `${item.propertyName} — ${item.taskNames[0] || "Service"}`),
        amountCents: Math.round(parseFloat(item.amount) * 100),
      }));

      const totalCents = stripeLineItems.reduce((s, i) => s + i.amountCents, 0);
      if (totalCents < 50) {
        throw new Error("Total amount must be at least $0.50");
      }

      // 3. Create DRAFT invoice (not finalized, not sent)
      const invoice = await createDraftInvoice({
        customerId: leisrCustomer.id,
        lineItems: stripeLineItems,
        description: input.invoiceDescription,
        metadata: {
          source: "wand_leisr_billing",
          tag: "Leisr Billing",
          status: "draft_preview",
          property_count: String(input.lineItems.length),
          task_count: String(
            input.lineItems.reduce((s, i) => s + i.taskIds.length, 0)
          ),
        },
      });

      // 4. Record each task as billed (status: "draft")
      for (const item of input.lineItems) {
        for (let i = 0; i < item.taskIds.length; i++) {
          await db.insert(billingRecord).values({
            breezewayTaskId: item.taskIds[i],
            breezewayTaskName: item.taskNames[i] || item.propertyName,
            propertyId: "",
            propertyName: item.propertyName,
            stripeCustomerId: leisrCustomer.id,
            stripeInvoiceId: invoice.id,
            amount: item.unitPrice,
            billingMethod: "invoice",
            status: "pending",
          });
        }
      }

      // 5. Audit log
      await db.insert(billingAuditLog).values({
        action: "leisr_invoice_draft",
        stripeCustomerId: leisrCustomer.id,
        stripeInvoiceId: invoice.id,
        amount: (totalCents / 100).toFixed(2),
        details: {
          invoiceDescription: input.invoiceDescription,
          propertyCount: input.lineItems.length,
          taskCount: input.lineItems.reduce((s, i) => s + i.taskIds.length, 0),
          lineItems: input.lineItems.map((i) => ({
            property: i.propertyName,
            qty: i.quantity,
            unitPrice: i.unitPrice,
            total: i.amount,
          })),
        },
      });

      // Dashboard URL for the draft invoice
      const dashboardUrl = `https://dashboard.stripe.com/invoices/${invoice.id}`;

      return {
        success: true,
        invoiceId: invoice.id,
        dashboardUrl,
        amount: (totalCents / 100).toFixed(2),
        customerName: leisrCustomer.name || "Leisr Stays",
      };
    }),

  sendInvoice: managerProcedure
    .input(
      z.object({
        stripeCustomerId: z.string(),
        lineItems: z.array(
          z.object({
            breezewayTaskId: z.string(),
            breezewayTaskName: z.string(),
            propertyId: z.string(),
            propertyName: z.string(),
            description: z.string(),
            amount: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const stripeLineItems = input.lineItems.map((item) => ({
        description: `${item.propertyName} - ${item.description}`,
        amountCents: Math.round(parseFloat(item.amount) * 100),
      }));

      const totalCents = stripeLineItems.reduce((s, i) => s + i.amountCents, 0);
      if (totalCents < 50) {
        throw new Error("Total amount must be at least $0.50");
      }

      // Create and send invoice
      const invoice = await createAndSendInvoice({
        customerId: input.stripeCustomerId,
        lineItems: stripeLineItems,
        metadata: {
          source: "wand_billing",
          task_count: String(input.lineItems.length),
        },
      });

      // Record each task as billed
      for (const item of input.lineItems) {
        await db.insert(billingRecord).values({
          breezewayTaskId: item.breezewayTaskId,
          breezewayTaskName: item.breezewayTaskName,
          propertyId: item.propertyId,
          propertyName: item.propertyName,
          stripeCustomerId: input.stripeCustomerId,
          stripeInvoiceId: invoice.id,
          amount: item.amount,
          billingMethod: "invoice",
          status: "invoiced",
        });
      }

      // Audit log
      await db.insert(billingAuditLog).values({
        action: "send_invoice",
        stripeCustomerId: input.stripeCustomerId,
        stripeInvoiceId: invoice.id,
        amount: (totalCents / 100).toFixed(2),
        details: {
          taskCount: input.lineItems.length,
          tasks: input.lineItems.map((i) => ({
            id: i.breezewayTaskId,
            name: i.breezewayTaskName,
            amount: i.amount,
          })),
          invoiceUrl: invoice.hosted_invoice_url,
        },
      });

      return {
        success: true,
        invoiceId: invoice.id,
        invoiceUrl: invoice.hosted_invoice_url,
        amount: (totalCents / 100).toFixed(2),
      };
    }),
});
