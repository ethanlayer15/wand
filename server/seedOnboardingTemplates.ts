/**
 * Onboarding template seed.
 *
 * Run after the 0005_onboarding migration to populate the 4 starting
 * templates. Idempotent: re-running upserts by `slug` so you can edit
 * a template here and re-seed without duplicates.
 *
 *   tsx server/seedOnboardingTemplates.ts
 *
 * The checklists below are first-pass placeholders pulled from the
 * existing Notion checklists + the April 1 kickoff email. Refine in
 * collaboration with the team — every item here is just JSON.
 */
import "dotenv/config";
import { eq, notInArray } from "drizzle-orm";
import { onboardingTemplates } from "../drizzle/schema";
import { getDb } from "./db";

type FieldDef = {
  key: string;
  label: string;
  type: "text" | "longtext" | "number" | "money" | "url" | "boolean" | "date";
  placeholder?: string;
};

type ChecklistItem = { id: string; label: string; hint?: string };

type StageDef = {
  key: string;
  label: string;
  ownerRole?: "ethan" | "seth" | "yosimar" | "chloe" | string;
  defaultChecklist: ChecklistItem[];
  defaultFields: FieldDef[];
};

type TemplateSeed = {
  slug: string;
  name: string;
  description: string;
  kickoffFieldSchema: FieldDef[];
  stagesConfig: StageDef[];
};

// Kickoff fields shared by every template — drawn from Ethan's example email.
const COMMON_KICKOFF_FIELDS: FieldDef[] = [
  { key: "property_name", label: "Property name", type: "text", placeholder: "e.g. Laurel Cove" },
  { key: "address", label: "Property address", type: "text", placeholder: "123 Main St, City, ST 12345" },
  { key: "photos_link", label: "Photos link", type: "url", placeholder: "Drive / Dropbox URL" },
  { key: "cleaning_fee", label: "Cleaning fee", type: "money" },
  { key: "pets_allowed", label: "Pets allowed?", type: "boolean" },
  { key: "pet_fee", label: "Pet fee", type: "money" },
  { key: "onboarding_form_complete", label: "Onboarding form completed?", type: "boolean" },
  { key: "extra_notes", label: "Notes for the team", type: "longtext" },
];

// Reusable stage scaffolds so we only encode per-template *differences*.
function ethanKickoffStage(): StageDef {
  return {
    key: "kickoff",
    label: "Property Info",
    ownerRole: "ethan",
    defaultChecklist: [
      { id: "kickoff_form_complete", label: "Owner onboarding form complete" },
      { id: "kickoff_photos_received", label: "Photos received from owner" },
      { id: "kickoff_rental_agreement_sent", label: "Rental agreement sent + signed" },
      { id: "kickoff_team_notified", label: "Team notified that we're starting" },
    ],
    defaultFields: [],
  };
}

function chloeStage(extra: ChecklistItem[] = []): StageDef {
  return {
    key: "chloe_guidebook",
    label: "Guidebook + Finishing Touches",
    ownerRole: "chloe",
    defaultChecklist: [
      { id: "chloe_guidebook_built", label: "Guidebook built from template" },
      { id: "chloe_fridge_one_pager", label: "Fridge one-pager designed (Canva)" },
      { id: "chloe_internal_property_doc", label: "Internal property doc filled out" },
      { id: "chloe_house_rules", label: "House rules confirmed + posted" },
      ...extra,
    ],
    defaultFields: [
      { key: "guidebook_url", label: "Guidebook URL", type: "url" },
      { key: "fridge_one_pager_url", label: "Fridge one-pager URL", type: "url" },
    ],
  };
}

function ethanQAStage(): StageDef {
  return {
    key: "ethan_qa",
    label: "Final QA",
    ownerRole: "ethan",
    defaultChecklist: [
      { id: "qa_listing_review", label: "Listing reviewed end-to-end" },
      { id: "qa_pricing_review", label: "Pricing + min-stays reviewed" },
      { id: "qa_hostbuddy_check", label: "Hostbuddy responses spot-checked" },
      { id: "qa_guidebook_review", label: "Guidebook reviewed" },
      { id: "qa_owner_handoff_sent", label: "Owner notified that property is live" },
    ],
    defaultFields: [
      { key: "qa_notes", label: "QA notes", type: "longtext" },
    ],
  };
}

function yosimarStage(extra: ChecklistItem[] = []): StageDef {
  return {
    key: "yosimar_optimize",
    label: "Optimization, Hostbuddy & Pricing",
    ownerRole: "yosimar",
    defaultChecklist: [
      { id: "yos_listing_optimized", label: "Listing copy + photos optimized" },
      { id: "yos_hostbuddy_setup", label: "Hostbuddy configured" },
      { id: "yos_pricing_setup", label: "Pricing strategy + min-stays set" },
      { id: "yos_calendar_synced", label: "Calendar synced (Hostaway / Airbnb)" },
      ...extra,
    ],
    defaultFields: [
      { key: "hostbuddy_link", label: "Hostbuddy link", type: "url" },
      { key: "pricing_strategy", label: "Pricing strategy notes", type: "longtext" },
    ],
  };
}

const TEMPLATES: TemplateSeed[] = [
  // ── 1. New listing from scratch (8-stage flow) ────────────────────────
  {
    slug: "airbnb_new",
    name: "New Listing from Scratch",
    description:
      "Owner does not yet have an Airbnb account / listing — we create everything from scratch on the main Leisr account.",
    kickoffFieldSchema: [
      ...COMMON_KICKOFF_FIELDS,
      { key: "use_main_leisr_account", label: "List on main Leisr Airbnb account?", type: "boolean" },
    ],
    stagesConfig: [
      ethanKickoffStage(),
      {
        key: "intake_documentation",
        label: "Intake & Documentation",
        defaultChecklist: [
          { id: "s1_owner_form_sent", label: "Send the \"Property Owner\" form to the owner" },
          { id: "s1_local_recs_sent", label: "Send the \"Local Recs\" form to the owner" },
          { id: "s1_dates_blocked", label: "Block all future dates (stays blocked until Stage 7)" },
          { id: "s1_internal_doc", label: "Once owner form returned: finish internal doc in Notion" },
          { id: "s1_breezeway_tasks", label: "Once owner form returned: add routine maintenance tasks to Breezeway" },
          { id: "s1_guidebook_notion", label: "Once local recs form returned: draft guest-facing guidebook in Notion" },
        ],
        defaultFields: [],
      },
      {
        key: "listing_build",
        label: "Listing Build",
        defaultChecklist: [
          { id: "s2_listing_created", label: "Create the Airbnb listing on the LS account" },
          { id: "s2_payout_routing", label: "Set up payout routing (ping Ethan for taxpayer info and bank details)" },
          { id: "s2_listing_categories", label: "Fill out all listing categories" },
          { id: "s2_backup_key", label: "Confirm the backup key (ping Ethan or Chloe if none available)" },
          { id: "s2_amenities", label: "Add amenities" },
          { id: "s2_cleaning_fee", label: "Set the cleaning fee" },
          { id: "s2_pet_fee", label: "Set the pet fee (if pet-friendly)" },
          { id: "s2_good_track_record", label: "Under booking settings, select \"Good Track Record\"" },
          { id: "s2_cancellation_policy", label: "Set cancellation policy: 1–2 BR = moderate, 3–4 BR = limited, 4+ BR = firm" },
          { id: "s2_checkin_checkout_times", label: "Set check-in to 4pm and check-out to 10am" },
          { id: "s2_hostaway_connect", label: "Connect listing to Hostaway and set booking window to 6 months" },
        ],
        defaultFields: [
          { key: "airbnb_listing_url", label: "Airbnb listing URL", type: "url" },
          { key: "hostaway_listing_id", label: "Hostaway listing ID", type: "text" },
        ],
      },
      {
        key: "channel_distribution",
        label: "Channel Distribution",
        defaultChecklist: [
          { id: "s3_vrbo_export", label: "Export the listing to Vrbo from Hostaway" },
          { id: "s3_vrbo_pet_fee", label: "Add the pet fee to the VRBO column in Hostaway" },
          { id: "s3_google_export", label: "Export the listing to Google from Hostaway" },
          { id: "s3_direct_booking_category", label: "Confirm correct category on the LS direct booking site" },
          { id: "s3_hostaway_import_sheet", label: "Fill out the Hostaway import sheet" },
          { id: "s3_email_tyler", label: "Email Tyler Grachan (accountant) to notify him of the new listing" },
          { id: "s3_maintenance_spreadsheet", label: "Add property to the maintenance tasks spreadsheet" },
          { id: "s3_stripe_chloe", label: "Slack Chloe to connect listing to Stripe (NC h9bE, SC fWzH, VA al4F)" },
        ],
        defaultFields: [],
      },
      {
        key: "automation_fees_policies",
        label: "Automation, Fees & Policies",
        defaultChecklist: [
          { id: "s4_early_late_fees", label: "Add early check-in and late check-out fees" },
          { id: "s4_checkin_instructions", label: "Write custom check-in and check-out instructions" },
          { id: "s4_automate_messages", label: "Automate messaging: booking confirmations, check-in/out instructions, guidebook, trash day" },
          { id: "s4_fireplace_chloe", label: "If wood-burning fireplace or firepit: ping Chloe to coordinate wood delivery" },
          { id: "s4_upcharge_fees", label: "Set up charge fees in Listing Mapping: 18% Airbnb, 5% Vrbo" },
          { id: "s4_rental_agreement", label: "Enable the rental agreement and ping Ethan to review it" },
        ],
        defaultFields: [],
      },
      {
        key: "pricing_hostbuddy_optimization",
        label: "Pricing, HostBuddy & Optimization",
        defaultChecklist: [
          { id: "s5_listing_optimized", label: "Optimize the Airbnb listing and reimport to Hostaway" },
          { id: "s5_pricelabs", label: "Connect to PriceLabs and configure pricing strategy" },
          { id: "s5_los_discounts", label: "Set up LOS discounts in Hostaway" },
          { id: "s5_zapier_workflow", label: "Add listing to the Zapier-to-Slack workflow" },
          { id: "s5_breezeway_contact", label: "Select default maintenance contact in Breezeway" },
          { id: "s5_hostbuddy", label: "Set up the listing in HostBuddy" },
          { id: "s5_booking_com", label: "List on Booking.com and apply 18% markup in Hostaway" },
          { id: "s5_early_bird", label: "Set up Early Bird discounts" },
          { id: "s5_hostaway_review", label: "Final Hostaway settings review" },
        ],
        defaultFields: [
          { key: "pricelabs_url", label: "PriceLabs URL", type: "url" },
          { key: "hostbuddy_link", label: "HostBuddy link", type: "url" },
        ],
      },
      {
        key: "physical_property_prep",
        label: "Physical Property Prep",
        defaultChecklist: [
          { id: "s6_photos_scheduled", label: "Schedule photos (appliances, kitchen, hot tub, etc.)" },
          { id: "s6_fridge_one_pager", label: "Slack Chloe to create the Canva fridge one-pager" },
          { id: "s6_code_compliance", label: "Complete code compliance check (fire alarms, etc.)" },
          { id: "s6_turnoverbnb_breezeway", label: "Add property to TurnoverBnB and Breezeway" },
          { id: "s6_deep_clean", label: "Coordinate initial onboarding, deep clean, and setup with cleaners" },
          { id: "s6_cleaner_onboarded", label: "Onboard the cleaner to our processes" },
          { id: "s6_handyman", label: "Line up a handyman and electrician" },
          { id: "s6_landscaping", label: "Line up a landscaping company" },
        ],
        defaultFields: [],
      },
      {
        key: "handoff_go_live",
        label: "Handoff & Go-live",
        defaultChecklist: [
          { id: "s7_quo_owners_line", label: "Add the owner to the Quo Owners Line" },
          { id: "s7_hostaway_user", label: "Add the owner as a user in Hostaway (limited to their property only)" },
          { id: "s7_insurance", label: "Get added to the owner's insurance policy as a secondary insured" },
          { id: "s7_vrtrust", label: "Ask Ethan to onboard the property to VRTrust" },
          { id: "s7_backup_key_list", label: "If no backup key: add property to the \"no backup key\" list" },
          { id: "s7_open_dates", label: "Ethan opens future dates once pricing is finalized" },
        ],
        defaultFields: [],
      },
    ],
  },

  // ── 2. Owner keeping their existing listing ──────────────────────────
  {
    slug: "airbnb_existing",
    name: "Keeping Existing Listing",
    description:
      "Owner already has an Airbnb account with active listings; we take over management of those listings.",
    kickoffFieldSchema: [
      ...COMMON_KICKOFF_FIELDS,
      { key: "existing_listing_url", label: "Existing listing URL", type: "url" },
    ],
    stagesConfig: [
      ethanKickoffStage(),
      {
        key: "seth_listing",
        label: "Listing Import + Co-host Setup",
        ownerRole: "seth",
        defaultChecklist: [
          { id: "seth_cohost_invite_accepted", label: "Co-host invite accepted on owner's Airbnb" },
          { id: "seth_listing_imported_hostaway", label: "Listing imported into Hostaway" },
          { id: "seth_breezeway_property_added", label: "Property added to Breezeway" },
          { id: "seth_cleaning_fee_set", label: "Cleaning fee set in Hostaway" },
          { id: "seth_pet_fee_set", label: "Pet fee set (if applicable)" },
        ],
        defaultFields: [
          { key: "hostaway_listing_id", label: "Hostaway listing ID", type: "text" },
          { key: "breezeway_property_id", label: "Breezeway property ID", type: "text" },
        ],
      },
      yosimarStage(),
      chloeStage(),
      ethanQAStage(),
    ],
  },

];

export async function seedOnboardingTemplates() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  for (const tpl of TEMPLATES) {
    const [existing] = await db
      .select()
      .from(onboardingTemplates)
      .where(eq(onboardingTemplates.slug, tpl.slug))
      .limit(1);
    if (existing) {
      await db
        .update(onboardingTemplates)
        .set({
          name: tpl.name,
          description: tpl.description,
          kickoffFieldSchema: tpl.kickoffFieldSchema as any,
          stagesConfig: tpl.stagesConfig as any,
          isActive: true,
        })
        .where(eq(onboardingTemplates.id, existing.id));
      console.log(`  ↻ updated ${tpl.slug}`);
    } else {
      await db.insert(onboardingTemplates).values({
        slug: tpl.slug,
        name: tpl.name,
        description: tpl.description,
        kickoffFieldSchema: tpl.kickoffFieldSchema as any,
        stagesConfig: tpl.stagesConfig as any,
        isActive: true,
      });
      console.log(`  ＋ inserted ${tpl.slug}`);
    }
  }
  // Deactivate any templates no longer in the seed list
  const activeSlugs = TEMPLATES.map((t) => t.slug);
  await db
    .update(onboardingTemplates)
    .set({ isActive: false })
    .where(notInArray(onboardingTemplates.slug, activeSlugs));

  console.log(`✅ Seeded ${TEMPLATES.length} onboarding templates.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedOnboardingTemplates()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
