# Wanda + Starry — AI Agents Build Plan

Two Slack-resident agents that interact with Wand and our other systems
(Hostaway, Breezeway, Openphone, Gmail, Slack) and extend the Wand task
kanban with department boards + private tasks.

- **Wanda** — Leisr Stays "chief of staff"
- **Starry** — 5STR Cleaning & Maintenance "chief of staff"

Department boards: **Leisr Ops**, **Leisr Mgmt**, **5STR Ops**.

---

## Locked design decisions

| # | Decision |
|---|---|
| 1 | Two **separate Slack apps** (separate bot users, separate DM inboxes) |
| 2 | On-call schedule lives in **Wand admin page** (single source of truth) |
| 3 | Cleaner escalations open a **private group DM** (cleaner + on-call + agent) |
| 4 | Private tasks are visible to the user **+ their agent only** (Wanda for Leisr employees, Starry for 5STR employees) |
| 5 | New agent-created tasks reuse the existing **monitoring / auto-resolution** pattern (72h window, AI re-checks) |
| 6 | When the 10-min sweep finds a task is already done → **auto-close**, surfaced in an Activity feed |
| 7 | Short term: bot triggers are **@-mention or `:wand:` reaction**. Long term: AI decides autonomously, learning from every confirm/reject |
| 8 | Wanda + Starry **share the task store**; separation is by board / department / permissions |
| 9 | v1 mobile experience = **Slack DM**. Long-term: native / PWA Wand mobile |
| 10 | First fully-autonomous workflow = **late-checkout outreach** (cleaner pings Starry → Wanda drafts + sends guest message) |
| 11 | Budget ceiling: **~$1,000 / month** AI spend (realistic ~$600–800) |
| 12 | Quo = **Openphone** (`server/quo.ts` already integrated) |

---

## Phase 1 — Foundation ✅ shipped

- [x] Schema: `boards`, `onCallSchedule`, `slackBots`, `slackUserLinks` tables
- [x] Schema: add `boardId`, `visibility`, `ownerUserId`, `ownerAgent` to `tasks`
- [x] Migration + backfill applied to TiDB; all 278 legacy tasks → Leisr Ops
- [x] tRPC routers: `boards.*`, `onCall.*`
- [x] Admin UI: `/on-call` page (shifts + current-shift summary cards)
- [x] `server/agents/` runner wraps Anthropic Messages with tool-use loop + `agentActions` audit logging
- [x] Two Slack apps live (Wanda, Starry) with signing-secret verification, env vars in Railway, `/api/slack/{wanda,starry}/events` mounted

Deferred: a dedicated **Boards settings page** (rename, source toggles, per-board Slack channel routing) — not blocking anything; add when first needed.

---

## Phase 2 — Reactive ✅ shipped

- [x] DM + @-mention handling via the agent runner
- [x] "What's on my list?" works once the user is linked via `slackUserLinks`
- [x] Reaction-to-task: `:wand:`, `:memo:`, `:white_check_mark:`, `:ballot_box_with_check:` trigger the propose-a-task flow in-thread
- [x] Department-board tabs on `/` with per-board task counts + filter
- [x] "Move to board" + "Property" selects in task detail sheet
- [x] Slack user linking via `/team` (auto-match by email + manual row)
- [x] "Send to Wanda/Starry" **message shortcut** works anywhere including private DMs (bypasses the bot-can't-read-DMs constraint)

Deferred:
- **Voice messages** — Slack audio → Whisper → cleaned transcript + bullets. Build this after Phase 4 since it's most valuable when cleaners are already DM'ing Starry.
- **`/push-task` slash command** — depends on a "Private Tasks" page we haven't built. Skip until someone actually uses private tasks.

---

## Phase 3 — Proactive sweep (1 week)

- [ ] **10-min cron per agent** that pulls: new Slack mentions in watched channels, new Gmail in shared inboxes, new Openphone SMS, open Wand tasks
- [ ] Agent prompt produces structured `{ create: [...], close: [...], escalate: [...] }`
- [ ] Auto-close logic checks against linked context (just like guest-message auto-resolution) before closing
- [ ] **Activity feed** page in Wand showing the last 24h of agent actions, each with an "undo" button (for the trust-building period)

**Exit criteria:** Two days of running with zero auto-closes the team disagrees with.

---

## Phase 4 — Routing (3–4 days) — **NEXT**

The goal: a cleaner DMs Starry about an issue → Starry classifies it, looks up on-call, and opens a private group DM with the cleaner + the right on-call manager + Starry. If it's Leisr-guest-related, Wanda + the Leisr Ops on-call get pulled in too. The cleaner's original DM thread with Starry gets a short "I looped in Alice, she'll pick it up" reply so they know it's handled.

### What to build

- [ ] **Classification step.** When Starry receives a DM, decide: (a) general chat (reply conversationally, do nothing else), (b) 5STR ops issue (maintenance/clean logistics — route to 5STR Ops on-call), (c) Leisr property/guest issue (route to Leisr Ops on-call + Wanda).
- [ ] **Group DM open + summary.** Use Slack `conversations.open` with a `users` list (cleaner user id + on-call slack user id + Starry's bot). Post a one-line summary: *"From <cleaner>: <one-line paraphrase>. Context: <property + reservation link if applicable>. Cleaner's original message quoted below."*
- [ ] **Loop guard.** If Starry already opened a group DM for (cleanerUserId, listingId, intent) in the last 60 min, reuse that DM instead of opening a new one. Need a new table for this — see schema below.
- [ ] **Cross-tagging.** When the issue is Leisr-guest-related, Wanda joins the group DM (needs a companion `conversations.open` against Wanda's bot token) and Leisr Ops on-call is pulled in. Add a second message tagging the on-call person so they get the notification.
- [ ] **Agent tools.** Three new tools on the runner: `classifyCleanerMessage(text)`, `routeEscalation({ department, context })` that performs the group-DM open + summary, and `openGroupDm({ userIds, agentToken })` as a lower-level helper.
- [ ] **Audit.** Each escalation writes an `agentActions` row (+ maybe an `agentSuggestions` row if we want approval before opening) with `{cleanerUserId, department, onCallUserId, groupDmChannelId, intent}`.

### Schema additions needed

```ts
export const escalationGroupDms = mysqlTable("escalationGroupDms", {
  id: int("id").autoincrement().primaryKey(),
  agent: mysqlEnum("agent", ["wanda", "starry"]).notNull(),
  // The person who triggered it (usually a cleaner)
  triggerSlackUserId: varchar("triggerSlackUserId", { length: 64 }).notNull(),
  // Inferred intent so the loop guard can match same-issue follow-ups
  intent: varchar("intent", { length: 64 }).notNull(), // "maintenance", "guest_checkout", etc.
  listingId: int("listingId"), // FK → listings.id, nullable for generic
  // Slack group DM channel id the escalation lives in
  groupDmChannelId: varchar("groupDmChannelId", { length: 64 }).notNull(),
  // Who got pulled in (for audit + dedupe)
  onCallUserIds: json("onCallUserIds").$type<string[]>(), // Slack user ids
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  // When loop-guard window expires (createdAt + 60 min)
  expiresAt: timestamp("expiresAt").notNull(),
});
```

Query this table before opening a new group DM; reuse the existing channel if a non-expired row matches on agent + triggerSlackUserId + intent + listingId.

### Slack scopes needed (add to both apps, then reinstall)

- `mpim:write` — create group DMs
- `mpim:history` — read group DM messages (for follow-ups inside the escalation DM)
- Starry already has `im:write`, `im:history`, `chat:write`, `users:read.email` from Phase 2 — those still apply

### Open items to resolve BEFORE coding Phase 4

1. **On-call data — is the `/on-call` admin page actually populated with real shifts?** If not, populate it first. Without real shifts, `getOnCall` returns null and Phase 4 has nothing to route to. Same test: open `/on-call` and confirm the "Leisr Ops — Primary" and "5STR Ops — Primary" cards at the top both show real people.
2. **What's the intent taxonomy?** Start narrow: `guest_issue`, `maintenance`, `clean_blocked`, `other`. The classifier picks one. We can widen it after a week of real traffic.
3. **Does the cleaner's Slack user need to be linked to a Wand user row?** For Phase 4 probably not — the cleaner might not even have a Wand account. Starry can work off the Slack user alone. But confirm.
4. **What happens if nobody is on-call right now?** Either (a) fall back to Leisr/5STR ops leadership (hardcode as a secondary on-call), or (b) post into a shared escalations channel. Pick one before building.

### Exit criteria

A cleaner (real person) DMs Starry something like *"guest is still at Kimble and it's past checkout"* → within 30 seconds, a private group DM appears containing the cleaner, the Leisr Ops on-call manager, Wanda, and Starry — with a one-line summary and the original message quoted. Starry's original DM thread with the cleaner gets a short "looped in Alice" reply.

---

## Phase 5 — First autonomous workflow (1 week)

**Late-checkout outreach.**

- **Trigger:** cleaner messages Starry — "guest is still at [property]"
- **Flow:**
  1. Starry resolves the property → looks up the active reservation in Hostaway
  2. Wanda reads the last 20 messages with the guest
  3. Wanda drafts:
     > *"Hope you had a great stay! Our cleaner is close and hoping to get started soon. We had you down for a 10 am check out — I hope we didn't miss something!"*
  4. **Send decision:**
     - High confidence (clean conversation, no open complaint, no prior late-checkout grant) → Wanda **auto-sends** via Hostaway
     - Otherwise → Wanda pings the on-call Leisr Ops person in Slack with the draft + "approve to send"
  5. Starry replies in the cleaner's thread: "messaged the guest, will let you know when they're out"
- **Confidence signals:** guest replied to a previous host message in this stay; no prior `aiUrgency >= high`; no late-checkout grant earlier in the thread; reservation source isn't a high-touch channel
- **Loop guard:** if Starry has already triggered this for the same reservation in the last 60 min → skip
- **Audit:** every auto-send writes an `agentActions` row with `{agent, action, reservationId, confidence, draftText, autoSent}`

---

## Phase 6 — Learning loop (ongoing)

- [ ] `agentFeedback` table — every reaction-to-task confirm/reject + every auto-close undo
- [ ] Weekly job: feed a sample to Claude with "based on these decisions, what rule should we add to the system prompts?" → produces proposed system-prompt diffs for review
- [ ] Long-term: graduate workflows from "suggest" to "auto" based on approval-without-edit rate

---

## Tech stack notes

- **Slack apps:** Bolt JS in the existing Wand server, mounted under `/slack/wanda/*` and `/slack/starry/*`. Tokens in Railway env, refs stored in the `slackBots` table.
- **Agent runner:** Anthropic Messages API with tool use. Prompt caching on system prompt + Wand state snapshot (task list, on-call, board config). Sonnet 4.5 by default; escalate to Opus on long-context drafts only.
- **Tools the agents can call (v1):** Wand internal procedures (tasks CRUD, listings, reservations, on-call lookup), Hostaway (read messages, send message, read reservation), Breezeway (read tasks, comment), Openphone (read SMS), Slack (post message, open DM, get thread).
- **Audit:** every tool call logged to `agentActions`; every drafted action that needs approval logged to `agentSuggestions` (both tables already exist).

---

## Open items to revisit before Phase 3

- Watched-channels list per agent (which Slack channels Wanda / Starry read passively for the proactive sweep)
- Gmail inboxes per agent (shared `ops@` style or per-person delegated)
- Confidence threshold for Phase 5 auto-send (start strict, loosen after 2 weeks of clean drafts)

---

## Decoupling from Manus (target: between Phase 1 and Phase 2, OR between Phase 4 and Phase 5)

Wand was originally built on Manus and still has two real Manus dependencies:
the **TiDB database** (provisioned by Manus, no direct admin access — can't even
rotate the password without filing a support ticket) and the **legacy OAuth
callback handler** at `/api/oauth/callback` (`server/_core/oauth.ts`). Hosting
moved to Railway long ago; AI, storage, Hostaway, Breezeway, Stripe, Quo are
all on our own accounts. So the migration is smaller than it looks.

### Why move

- Can't rotate the TiDB password ourselves (Manus owns the cluster credentials)
- Manus pricing / availability is outside our control
- One less vendor in the critical path before Phase 5 graduates agents to
  autonomous send-on-behalf-of workflows — fewer surprise outages

### What's already done

- **Google OAuth is live** as the primary login. `server/googleAuth.ts` runs
  the full flow, restricted to `@leisrstays.com`. The Login page only shows
  "Sign in with Google" — nobody is using the Manus path interactively.
- All non-Manus integrations (Hostaway, Breezeway, AWS S3, Anthropic,
  OpenAI, Stripe, Openphone, Slack, Gmail) are on our own credentials in
  Railway env vars.

### What remains (estimate: 2–3 focused days)

1. **Provision a non-Manus MySQL** — either Railway's MySQL plugin (~$5/mo,
   simplest) or PlanetScale (free tier, more reliable, branchable). Pick
   one and create the empty DB.
2. **Cutover the data**:
   - Take a brief write freeze (~10 min — disable cron + agent triggers)
   - `mysqldump` the entire TiDB DB → restore to the new DB
   - Update `DATABASE_URL` in Railway env → redeploy
   - Smoke-test: load Tasks board, run a manual sync, confirm task counts
     match
   - Re-enable cron + agents
3. **Remove the Manus OAuth handler**:
   - Delete `server/_core/oauth.ts` and the `registerOAuthRoutes(app)` call
     in `server/_core/index.ts`
   - Drop `OAUTH_SERVER_URL` and `OWNER_OPEN_ID` from `server/_core/env.ts`
     and Railway env vars
   - Audit `server/db.ts` and any other module that references those env
     vars or the legacy openId convention
4. **Sanity check `users.openId`**:
   - Most rows should already be Google `sub` IDs from existing logins
   - If any rows are still legacy Manus IDs, ask those team members to log
     out and back in once with Google — `googleAuth.ts` should match by
     email and update the `openId`
5. **Decommission Manus**:
   - Cancel the Manus subscription / project
   - Save a `mysqldump` snapshot of the TiDB DB to S3 as a one-time backup
     before the Manus project is deleted

### Risk + rollback

- The DB cutover is the only step with real downtime. Have the old
  `DATABASE_URL` ready to paste back into Railway as instant rollback if
  anything looks off after the switch.
- Auth removal is reversible — just don't delete the Manus account until
  you've run a week with the legacy OAuth handler removed and nobody has
  reported being locked out.

### Why "between Phase 1 and Phase 2" is appealing

Doing the migration before the agents start writing autonomously means
Phases 5+ run on infra we fully control — no surprise Manus outage takes
down a guest-facing auto-send flow. The downside is a 2–3 day delay before
starting Phase 2.

### Why "between Phase 4 and Phase 5" is also reasonable

By that point we have ~2 months more code on the platform, we know exactly
which modules touch Manus, and the autonomous workflows are the first real
business risk that justifies the cutover effort. Choose based on appetite
for delay vs appetite for vendor risk.
