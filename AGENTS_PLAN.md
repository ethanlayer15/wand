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

## Phase 1 — Foundation (1–2 weeks)

Plumbing everything depends on. **In progress.**

- [x] Schema: `boards`, `onCallSchedule`, `slackBots`, `slackUserLinks` tables
- [x] Schema: add `boardId`, `visibility`, `ownerUserId`, `ownerAgent` to `tasks`
- [ ] Migration + backfill: every existing task → "Leisr Ops" board, visibility="board"
- [ ] tRPC routers:
  - `boards.list` / `create` / `update`
  - `onCall.list` / `upsertShift` / `deleteShift` / `getCurrent({ department, role? })`
- [ ] Admin UI: **On-Call Schedule** page (one screen — table of shifts + add/edit dialog with recurring expansion)
- [ ] Admin UI: **Boards** settings page (rename, source toggles, slack channel routing)
- [ ] `server/agents/` runner module — shared wrapper around Anthropic Messages with tool-use loop, prompt caching, and `agentActions` audit logging
- [ ] Two Slack app shells (Wanda, Starry) — env vars wired, signing-secret verification, `app_mention` + `message.im` event endpoints that ack within 3s and dispatch to the agent runner

**Exit criteria:** I can DM Wanda "hello" in Slack and get a response routed through the agent runner; the on-call admin page lets you add a shift and `getCurrent` returns the right user.

---

## Phase 2 — Reactive (1 week)

Make the bots useful before making them autonomous.

- [ ] @-mention + DM handling (read thread context, call Wand tools, respond)
- [ ] "What's on my list?" — task list over Slack, filtered by assignee + visibility
- [ ] Reaction-to-task: `:wand:` on a Slack message → bot proposes a task in thread → 👍 confirms → task created. Every confirm/reject logged for the learning loop (Phase 6).
- [ ] Voice messages: Slack `file_share` audio → Whisper → bot replies with cleaned text + bullet action items + "Create task?" prompt
- [ ] Push personal task → board: a tRPC mutation + Slack command (`/push-task`) that flips visibility from `private` → `board` and assigns a `boardId`

**Exit criteria:** I can voice-message Starry on the go and get a clean task draft back in <30s.

---

## Phase 3 — Proactive sweep (1 week)

- [ ] **10-min cron per agent** that pulls: new Slack mentions in watched channels, new Gmail in shared inboxes, new Openphone SMS, open Wand tasks
- [ ] Agent prompt produces structured `{ create: [...], close: [...], escalate: [...] }`
- [ ] Auto-close logic checks against linked context (just like guest-message auto-resolution) before closing
- [ ] **Activity feed** page in Wand showing the last 24h of agent actions, each with an "undo" button (for the trust-building period)

**Exit criteria:** Two days of running with zero auto-closes the team disagrees with.

---

## Phase 4 — Routing (3–4 days)

- [ ] Cleaner DMs Starry → Starry classifies (Leisr property issue / 5STR ops / general) → looks up on-call → opens private group DM (cleaner + on-call + Starry)
- [ ] Starry posts a one-line summary in the group DM
- [ ] If Leisr-property-related, Starry tags Wanda + the right Leisr Ops on-call into the group DM
- [ ] Loop guard: same cleaner / same property / same intent within 60 min → reuse existing group DM, don't open a new one

**Exit criteria:** A cleaner DM about a guest issue lands in front of exactly the right person, with full context, within 30 seconds.

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
