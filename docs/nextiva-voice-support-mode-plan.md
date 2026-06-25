# Nextiva voice integration — Support page "Calls & Voicemail" modes

**Status:** Proposed · **Owner:** TBD · **Created:** 2026-06-25 · **Last grounded:** 2026-06-25

Integrate Nextiva (REST APIs + webhooks for calls, call logs, voicemails) into the `/support` page as
**new sidebar modes** for (a) working a **voicemail / call-back follow-up to-do list**, (b) observing a
**live call log**, and (c) linking each call/voicemail to a customer + case (Zendesk ticket, repair, order).

This plan is grounded in the repo's existing patterns — every file path, type, and function signature below
was verified against the current tree (2026-06-25). It deliberately defers exact Nextiva endpoint
names/auth to an implementation spike (§9): the Nextiva developer API surface must be verified against
current docs before any client code is written — do **not** code the provider client from memory.

> **Convention key.** ✅ = verified to exist today (reuse it). 🆕 = new code this plan introduces.
> ⚠️ = a known gap / correction surfaced while grounding the plan.

---

## 1. Why this shape

The `/support` page today is a single-purpose Zendesk console, **not yet mode-based**:

- ✅ Route: `src/app/support/page.tsx` → `SupportWorkspace` (`src/components/support/zendesk/SupportWorkspace.tsx`).
  Selection is `?ticket=<id>` (`const selectedId = Number(searchParams.get('ticket')) || null;`), cleared
  with `router.push('/support')`.
- ✅ Contextual sidebar: `SupportSidebarPanel` (`src/components/sidebar/SupportSidebarPanel.tsx`), wired in
  `src/components/sidebar/SidebarContextPanel.tsx` line ~44 via `if (routeKey === 'support') return <SupportSidebarPanel />;`.
- ⚠️ `SupportSidebarPanel` **does not use `SidebarShell` and has no mode switcher today** — it simply renders
  `<SupportTicketQueue />` and listens for a `window` `'support-refresh'` event to
  `queryClient.invalidateQueries({ queryKey: ['zendesk'] })`. It is permission-gated on `integrations.zendesk`.

We add Nextiva **as modes on this same page** (per the `sidebar-mode` house rule), reusing the exact `?mode=`
switcher pattern proven on Operations:

- ✅ `src/components/sidebar/operations/operations-sidebar-shared.ts` — `OperationsMode` union,
  `OPERATIONS_MODE_ITEMS: HorizontalSliderItem[]`, `DEFAULT_OPERATIONS_MODE`, `parseOperationsMode`,
  `OPERATIONS_MODE_SCOPED_PARAMS`.
- ✅ `src/components/sidebar/operations/useOperationsMode.ts` — `useOperationsMode(): { mode; updateMode }`.
  `updateMode` writes `?mode=` with `router.replace`, **deletes all mode-scoped params**, and the **default
  mode drops the param entirely** (stays on the bare path).
- ✅ `src/components/sidebar/OperationsSidebarPanel.tsx` — the mode rail is a
  `HorizontalButtonSlider variant="nav" dense className="w-full"` passed as `headerAbove` to each mode's
  `SidebarShell`.

### Mode set (run the display-archetype decision per region — `.claude/rules/contextual-display.md`)

| Mode | `?mode=` | Archetype | Job |
|---|---|---|---|
| **Tickets** (existing) | *(default, bare `/support`)* | Workbench | Zendesk ticket queue → conversation (unchanged) |
| **Voicemail** | `?mode=voicemail` | **Workbench** | Pick a voicemail/missed call from a follow-up to-do list → detail + linked case → act (call back, mark done, snooze, assign, create/link ticket) |
| **Call Log** | `?mode=calls` | **Monitor** | Observe the org's call stream (inbound/outbound/missed), newest-first, filter-only, no durable selection |

**Why these archetypes** (Q1→Q4 of the decision algorithm, per region):
- **Voicemail** — Q1 no scanner; Q2 *not* observe-only (the user edits follow-up state); Q4 fallthrough →
  **Workbench**. Durable, URL-addressable selection (`?vm=<id>`) + CRUD (mark done, snooze, assign, link).
- **Call Log** — Q1 no scanner; Q2 observe-only, append-only stream, ephemeral filters, no durable selection,
  nothing persists → **Monitor**.
- Click-to-call is an **action inside the Workbench detail**, never a Station (no scanner, hands not busy).
- They are **two regions**; never blend them. A Call Log row that needs action **deep-links** into Voicemail
  or Tickets mode rather than growing a selection.

---

## 2. Architecture overview

```
Nextiva Cloud
  │  webhooks: call.started / call.ended / call.missed / voicemail.created  (HMAC-signed)
  │  REST: call logs, voicemail metadata + recording URL, click-to-call (originate)
  ▼
POST /api/integrations/nextiva/webhook/[token]   (unauthenticated, signature-verified, idempotent)
  │  1. resolve org O(1) from [token]            (mirror resolveOrgByWebhookToken)
  │  2. verifyNextivaWebhookSignature(raw, hdrs, { secret })  (mirror verifyZohoWebhookSignature)
  │  3. upsert call_events / voicemails under withTenantTransaction(orgId, …)  (idempotent on external id)
  │  4. return 2xx fast
  │  5. after():  matchCustomer(phone) → link case → auto-create open follow-up → publishVoiceEvent + bell
  ▼
Postgres (tenant-from-birth):  call_events · voicemails · voicemail_followups   (+ reuse ticket_links)
  ▲
  │  React Query (poll + staleTime, Ably invalidate)
  ▼
/support   ?mode=voicemail | ?mode=calls
  SupportSidebarPanel → mode rail → SupportTicketQueue | VoicemailQueue | CallLogList
  Right pane → SupportTicketDetail | VoicemailDetail (Workbench) | CallLogView (Monitor)
```

- ✅ **Tokens live ONLY in the vault** (`organization_integrations`) via `getIntegrationCredentials` /
  `upsertIntegrationCredentials` (`src/lib/integrations/credentials.ts`). Payloads are encrypted at rest with
  **AES-256-GCM** under `INTEGRATION_KMS_KEY` (`src/lib/integrations/crypto.ts`,
  `encryptIntegrationPayload` / `decryptIntegrationPayload`). **Never `.env`** (CLAUDE.md safety rule — the
  real `.env` holds ~113 live secrets incl. `INTEGRATION_KMS_KEY` itself).
- 🆕 **Connector registered** in `src/lib/integrations/connectors/registry.ts` so the settings UI, refresh
  sweep, and health treat Nextiva uniformly.
- ✅ **Real-time** via Ably (`src/lib/realtime/publish.ts` → `publishEvent`); follow-up notifications reuse
  `publishStaffMessage` (the same `inbox:{recipientId}` bell path `support_ticket_assignments` already uses).

---

## 3. Data model (new migrations — `src/lib/migrations/`)

Follow the canonical **tenant-from-birth** shape verified in
`src/lib/migrations/2026-06-24_support_ticket_assignments.sql`: `organization_id UUID NOT NULL` defaulted from
the `app.current_org` GUC, per-org uniqueness, idempotent `CREATE TABLE IF NOT EXISTS`, `organization_id`-first
indexes, wrapped in `BEGIN; … COMMIT;`. One dated file, immutable. **Author with `/db-migration-author`; apply
with `/db-migrate`.** Naming: `YYYY-MM-DD[_letter]_snake_case.sql`.

The exact default expression to copy verbatim into every table:

```sql
organization_id UUID NOT NULL DEFAULT (
  COALESCE(
    NULLIF(current_setting('app.current_org', true), '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  )
)
```

> Because `withTenantTransaction` does `SET LOCAL app.current_org`, inserts auto-stamp `organization_id` — do
> not pass it in the INSERT column list. Add an `enforce_tenant_isolation()` guard trigger consistent with
> recent migrations (see `2026-06-23b_enforce_tenant_isolation_kpi_photos.sql`) if these tables become
> RLS-subject in the tenant-pool phase.

### `YYYY-MM-DD_nextiva_call_events.sql`
```sql
CREATE TABLE IF NOT EXISTS call_events (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL DEFAULT (…app.current_org default…),
  provider          TEXT NOT NULL DEFAULT 'nextiva',
  external_call_id  TEXT NOT NULL,                 -- Nextiva call id (idempotency anchor)
  direction         TEXT NOT NULL,                 -- 'inbound' | 'outbound' | 'missed'
  from_number       TEXT,
  to_number         TEXT,
  counterparty_e164 TEXT,                          -- normalized customer number for matching
  agent_staff_id    INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  status            TEXT,                          -- ringing | answered | ended | no_answer | busy
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  duration_seconds  INTEGER,
  -- denormalized linkage (best-effort, recomputed on match; canonical links live in ticket_links — see §7)
  matched_customer  JSONB,                         -- { name, email, phone, source }
  linked_order_id   BIGINT,
  linked_ticket_id  BIGINT,                        -- zendesk ticket id (cache; ticket_links is SoT)
  raw               JSONB,                         -- original webhook payload
  client_event_id   TEXT,                          -- idempotency for retries (mirror inventory_events)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, provider, external_call_id)
);
CREATE INDEX IF NOT EXISTS idx_call_events_org_started ON call_events (organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_events_counterparty ON call_events (organization_id, counterparty_e164);
```

### `YYYY-MM-DD_nextiva_voicemails.sql`
```sql
CREATE TABLE IF NOT EXISTS voicemails (
  id                 BIGSERIAL PRIMARY KEY,
  organization_id    UUID NOT NULL DEFAULT (…app.current_org default…),
  provider           TEXT NOT NULL DEFAULT 'nextiva',
  external_vm_id     TEXT NOT NULL,                -- idempotency anchor
  call_event_id      BIGINT REFERENCES call_events(id) ON DELETE SET NULL,
  from_number        TEXT,
  counterparty_e164  TEXT,
  mailbox            TEXT,                         -- which Nextiva mailbox/extension
  left_at            TIMESTAMPTZ,
  duration_seconds   INTEGER,
  recording_url      TEXT,                         -- Nextiva-hosted; fetched via proxy (see §6)
  recording_blob_key TEXT,                         -- optional: copied to Vercel Blob (private)
  transcript         TEXT,                         -- if Nextiva or our STT provides one
  is_read            BOOLEAN NOT NULL DEFAULT FALSE,
  matched_customer   JSONB,
  linked_order_id    BIGINT,
  linked_ticket_id   BIGINT,
  raw                JSONB,
  client_event_id    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, provider, external_vm_id)
);
CREATE INDEX IF NOT EXISTS idx_voicemails_org_left ON voicemails (organization_id, left_at DESC);
CREATE INDEX IF NOT EXISTS idx_voicemails_counterparty ON voicemails (organization_id, counterparty_e164);
```

### `YYYY-MM-DD_nextiva_voicemail_followups.sql`
The **to-do** spine — mirrors `support_ticket_assignments` (in-app ownership + status, independent of Nextiva):
```sql
CREATE TABLE IF NOT EXISTS voicemail_followups (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL DEFAULT (…app.current_org default…),
  voicemail_id      BIGINT NOT NULL REFERENCES voicemails(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'snoozed' | 'done' | 'no_action'
  assigned_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  assigned_by       INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  snooze_until      TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  resolved_by       INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, voicemail_id)
);
CREATE INDEX IF NOT EXISTS idx_vm_followups_open
  ON voicemail_followups (organization_id, status, assigned_staff_id);
```

> **The to-do list** = `voicemail_followups f JOIN voicemails v ON v.id = f.voicemail_id`, filtered
> `f.status IN ('open','snoozed')` and `(f.snooze_until IS NULL OR f.snooze_until <= NOW())`, ordered by
> `v.left_at DESC`. A new voicemail auto-creates an `open` follow-up row in the webhook `after()`.

### Reuse `ticket_links` for case linkage (do not reinvent) — ✅
The repo already has a generic **`ticket_links`** table `(organization_id, zendesk_ticket_id, entity_type, entity_id)`
queried by `listTicketLinkCandidates` (`src/lib/zendesk-link-candidates.ts`). Link a voicemail/call to a Zendesk
ticket by inserting `entity_type = 'voicemail' | 'call_event'`, `entity_id = <id>`. This gets the existing
candidate-listing, "already linked" hiding, and `external_id` parsing **for free**. The `linked_ticket_id` column
above is a denormalized read-cache; `ticket_links` is the source of truth.

---

## 4. Connector + credentials wiring

✅ Verified current shapes:
- `IntegrationProvider` (credentials.ts) already = `ebay | amazon | zoho | ecwid | square | ups | fedex | usps |
  zendesk | google_sheets | ably | ollama | stripe`. **🆕 add `'nextiva'`.**
- `AuthKind` (connectors/types.ts) = `'oauth' | 'nango' | 'vault'`.
- `Capability` (connectors/types.ts) = `'orders' | 'inventory' | 'tracking' | 'payments'`. **🆕 add `'voice'`** —
  voice is a new capability class.
- `IntegrationConnector` = `{ provider; authKind; capabilities; authorizeStartPath?; healthPath?; refresh?;
  validate?; sync?; pushInventory?; reconcile? }`.
- `SyncOutcome` = `{ ok; imported?; updated?; error?; cursor? }`.
- Registry is a `Record<IntegrationProvider, IntegrationConnector>` → **the compiler forces you to add a
  `nextiva` entry** once the provider union grows. Sync impls are **lazy-imported**.

### Steps
1. **🆕 Provider + credentials payload** in `src/lib/integrations/credentials.ts`:
   ```ts
   // add to the union
   | 'nextiva'

   // payload shape — CONFIRM exact fields in §9 (auth model decides apiKey vs OAuth refresh token)
   export interface NextivaCredentials {
     // vault/API-key model:
     apiKey?: string;
     // OR oauth model:
     refreshToken?: string;
     accessToken?: string;
     expiresAt?: number;
     // identity + webhook
     accountId?: string;        // Nextiva account / location ref (used to resolve org on webhooks)
     locationId?: string;
     webhookToken?: string;     // our per-tenant URL token (minted, mirror Zoho)
     webhookSigningSecret?: string; // our per-tenant HMAC secret (minted, mirror Zoho)
   }
   ```
   Read/write with the existing `getIntegrationCredentials<NextivaCredentials>(orgId, 'nextiva')` /
   `upsertIntegrationCredentials({ orgId, provider: 'nextiva', payload })`. Call `invalidateCredentialCache(orgId,
   'nextiva')` after writes (5-min in-process TTL).
2. **🆕 Capability** — add `'voice'` to `Capability` in `src/lib/integrations/connectors/types.ts`.
3. **🆕 Register the connector** in `src/lib/integrations/connectors/registry.ts`:
   ```ts
   nextiva: {
     provider: 'nextiva',
     authKind: 'vault',                 // or 'oauth' — confirm in §9
     capabilities: ['voice'],
     healthPath: '/api/integrations/nextiva/health',
     sync: (orgId) => import('./nextiva').then((m) => m.nextivaSync(orgId)), // backfill call log / vm poll
     // refresh: only if Nextiva is OAuth (drives the token-refresh sweep)
   },
   ```
4. **🆕 Display catalog** — add a `ProviderDef` to `src/app/settings/integrations/registry.ts` (the DISPLAY SoT)
   under **`category: 'Support'`** so it shows on `settings/integrations` with a Connect flow:
   ```ts
   {
     key: 'nextiva',
     label: 'Nextiva',
     description: 'Business phone — call log, voicemail follow-ups, click-to-call.',
     category: 'Support',
     connect: 'vault',                  // or 'oauth' — must match authKind
     healthPath: '/api/integrations/nextiva/health',
     docsUrl: 'https://developer.nextiva.com/…',  // confirm in §9
     badge: 'bg-violet-100 text-violet-700',
   }
   ```
5. **🆕 Sync adapter** `src/lib/integrations/connectors/nextiva.ts` — `nextivaSync(orgId): Promise<SyncOutcome>`
   reads creds from the vault, polls Nextiva REST for call logs + new voicemails since the stored `cursor`,
   upserts under `withTenantTransaction(orgId, …)`, and returns `{ ok, imported, updated, cursor }`. This is the
   **catch-up / reconciliation** path; webhooks are the realtime path (same idempotent upsert helper, so a
   webhook + a later sync of the same event collapse to a no-op).
6. **🆕 Cron registration** — wire `nextivaSync` into the per-org sweep. ✅ `src/lib/cron/for-each-org.ts`
   exposes `forEachOrgWithProvider('nextiva', (orgId) => nextivaSync(orgId))`; the orchestrator
   (`connectors/orchestrator.ts`, hit by `/api/cron/integrations/sync?providers=…`) already iterates connectors
   with a wired `sync()`. Confirm `'voice'`-capability connectors are picked up by the sweep (the current sweep
   is orders-focused — may need to include voice-capable connectors).

---

## 5. Backend routes (canonical skeleton — `.claude/rules/backend-patterns.md`)

All operator/mutation routes: `withAuth(handler, { permission }) → validate (Zod) → domain helper →
map 404/409/200 → recordAudit() → after() side-effects`. `orgId` from `ctx.organizationId`, **never the body**.
Scaffold each with the **`/new-route` skill** so `permission-registry.ts` + `route-permission-manifest.test.ts`
stay in sync (the `permission-registry-guard` agent enforces this).

✅ `recordAudit` signature to call: `recordAudit(db, ctx, req, { source, action, entityType, entityId, before?,
after?, note?, method?, … })`.

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/integrations/nextiva/webhook/[token]` | POST | **unauthenticated, signature-verified** | Ingest `call.*` / `voicemail.created`. Resolve org O(1) from `[token]`, verify HMAC, idempotent upsert, thin + `after()`. |
| `/api/integrations/nextiva/health` | GET | `withAuth` | Connector health probe for the settings card (`HealthResult`). |
| `/api/integrations/nextiva/connect` | POST | `withAuth` perm `support.voice.manage` | Save vault creds (or start OAuth) + **mint** `{ webhookToken, webhookSigningSecret }` and register the webhook with Nextiva. |
| `/api/integrations/nextiva/call` | POST | `withAuth` perm `support.voice.call` | Click-to-call: originate from the agent's Nextiva extension to a customer number. `recordAudit('voice.call.originated')`. |
| `/api/voicemails` | GET | `withAuth` perm `support.voice.view` | Voicemail to-do list (paginated; filter status/assignee/q). |
| `/api/voicemails/[id]` | GET | `withAuth` perm `support.voice.view` | Single voicemail + linked context (matched customer, ticket candidates). |
| `/api/voicemails/[id]/recording` | GET | `withAuth` perm `support.voice.view` | **Proxy** the recording (see §6) — never expose the Nextiva URL/creds to the browser. |
| `/api/voicemails/[id]/followup` | PATCH | `withAuth` perm `support.voice.followup` | Update follow-up: status (done/snooze/no_action), assignee, note. Optimistic client; thread `clientEventId`; `recordAudit`. |
| `/api/voicemails/[id]/link` | POST | `withAuth` perm `support.voice.followup` | Link/unlink to a Zendesk ticket / order / repair via `ticket_links` (+ refresh `linked_*` cache). |
| `/api/voicemails/[id]/create-ticket` | POST | `withAuth` perm `support.voice.followup` | Create a Zendesk ticket pre-filled from the voicemail + matched customer; store the link. |

### Webhook security + org resolution (mirror Zoho, verified)
- ✅ **Per-tenant token path.** Mint `{ webhookToken, webhookSigningSecret }` per org and persist on the vault row
  (mirror `ensureZohoWebhookIdentity` / `resolveOrgByWebhookToken` in `src/lib/zoho/webhooks/`). The webhook URL
  embeds the token: `/api/integrations/nextiva/webhook/<token>`; resolve org O(1) via a unique index — no
  ambiguity, fully multi-tenant. Single-tenant fallback: a tokenless route attributed to `USAV_ORG_ID`.
- ✅ **Signature verify before any DB work.** Mirror `verifyZohoWebhookSignature` (`src/lib/zoho/webhooks/verify.ts`):
  read the **raw** body, `createHmac('sha256', secret).update(rawBody).digest()`, `timingSafeEqual` against the
  Nextiva signature header. 🆕 `src/lib/voice/nextiva/verify.ts` `verifyNextivaWebhookSignature(rawBody, headers,
  { secret })` (header name from §9).
- **Return 2xx fast**; do matching/notifications in `after()` so Nextiva isn't blocked and won't retry on our
  slow downstream. Best-effort / fail-open on infra (locks are race-narrowing; **idempotency carries
  correctness** — `UNIQUE(org, provider, external_*_id)` + `client_event_id`).
- ✅ **Audit:** add `AUDIT_ACTION` (`VOICE_CALL_ORIGINATED: 'voice.call.originated'`,
  `VOICEMAIL_FOLLOWUP_RESOLVED: 'voicemail.followup.resolved'`, `VOICEMAIL_LINKED: 'voicemail.linked'`,
  `VOICEMAIL_TICKET_CREATED: 'voicemail.ticket.created'`) + `AUDIT_ENTITY` (`VOICEMAIL: 'voicemail'`,
  `CALL_EVENT: 'call_event'`) constants in `src/lib/audit-logs.ts`. **Never rename existing values** (dashboards
  key off them). Always via `recordAudit()`.

---

## 6. Voicemail audio playback

Nextiva voicemail audio is provider-hosted (auth-gated URL) and/or delivered by vmail-to-email. Two options:

- **Proxy-on-demand (default):** `/api/voicemails/[id]/recording` fetches from Nextiva server-side using vault
  creds and streams bytes to the browser. Simple, no storage; each play hits Nextiva. Gate on `support.voice.view`
  and scope by org (the row must belong to `ctx.organizationId`).
- **Copy to private Vercel Blob:** in the webhook `after()`, fetch the recording once and store it in **private**
  Vercel Blob (Blob now supports private storage), persisting `recording_blob_key`. Durable (survives Nextiva
  retention windows), faster replay. **Recommended if Nextiva expires recordings or rate-limits** (decide in §9).

Player UI: a small inline `<audio>` control in `VoicemailDetail` (no custom waveform unless asked). If a
transcript exists, render it below the player. Audio + transcripts are customer **PII** — keep recordings in
**private** Blob, audit access, scope reads by org.

---

## 7. Customer & case linkage (the "link to different cases" ask)

⚠️ There is **no unified customers identity table with a phone index** today — identity is reconstructed by
phone/email match across sources (verified):
- ✅ `square_transactions.customer_phone` — **indexed** (`idx_sq_tx_customer_phone … WHERE customer_phone IS NOT NULL`).
- ✅ `customers.phone` / `customers.mobile` (repair source, via `repair_service.customer_id`) —
  **no index** ⚠️ (add one if match volume is high: `CREATE INDEX … ON customers (phone)`, `(mobile)`).
- ✅ Zendesk requester / users cache (`src/lib/zendesk-users-cache.ts`: `getCachedUsers`, `CachedZendeskUser`
  `{ id, name, email, photo, role }`).
- Order buyer data.

⚠️ **No E.164 / libphonenumber helper exists** — only `src/utils/phone.ts` `formatPhoneNumber()` (10-digit US
display) and a duplicate in `repair-intake-logic.ts`. 🆕 add a real normalizer
`src/lib/voice/normalize-phone.ts` (`toE164(raw, defaultRegion='US'): string | null`) — consider adding
`libphonenumber-js` (small, well-maintained) for correctness, or a US-only 10/11-digit normalizer if we stay
domestic. This is the matching key written to `counterparty_e164`.

**Matching strategy** — 🆕 pure helper `src/lib/voice/match-customer.ts`, **Deps-injected** (real impls default,
fakes in tests; mirror `src/lib/studio/definitions.ts` `copyDefinitionToDraft(args, deps = defaultDeps)`):
```ts
export interface MatchCustomerDeps {
  findSquareByPhone: (orgId: OrgId, e164: string) => Promise<CustomerHit[]>;
  findCustomersByPhone: (orgId: OrgId, e164: string) => Promise<CustomerHit[]>;   // customers.phone/mobile
  findOrdersByPhone: (orgId: OrgId, e164: string) => Promise<CustomerHit[]>;
  // candidate tickets for the matched customer:
  listTicketCandidates: typeof listTicketLinkCandidates;
}
export async function matchCustomer(
  args: { orgId: OrgId; e164: string; email?: string | null },
  deps: MatchCustomerDeps = defaultMatchDeps,
): Promise<MatchResult>   // { customer?: {...}, orderId?, ticketCandidates: [...] }
```
1. Normalize `counterparty_e164` (E.164).
2. Look up candidates by phone (then email if known) across `square_transactions` / `customers` / `orders`.
3. ✅ Reuse `listTicketLinkCandidates({ orgId, entityType:'voicemail', entityId, query })`
   (`src/lib/zendesk-link-candidates.ts`) to surface likely tickets.
4. Write best-effort `matched_customer` / `linked_order_id` / `linked_ticket_id` (cache) **and** allow manual
   override via `/api/voicemails/[id]/link` (writes `ticket_links` — the SoT).

**Create-ticket-from-voicemail** — ✅ reuse the Zendesk creation path:
- `createZendeskTicket(data: RepairTicketData, { idempotencyKey })` / `createTicket(input, opts)` in
  `src/lib/zendesk.ts`. `customerName` + `customerPhone` are required; `customerEmail` optional.
- 🆕 build a voicemail-flavored description (mirror `zendesk-claim-template.ts`'s structured body: subject +
  Issue/Customer/Phone/Voicemail-transcript/Link-back). Store the returned ticket id in `ticket_links` +
  `linked_ticket_id`. **Confirm-then-commit (never optimistic)** — and never auto-create without a user click.

**Follow-up notifications** — ✅ when a voicemail is assigned to a staffer (or auto-assigned on a confident
match), mirror the verified ticket-assignment flow in `src/app/api/zendesk/tickets/[id]/assign/route.ts`:
`createStaffMessage({ …, kind: 'voicemail_followup', context: { voicemailId } })` → `publishStaffMessage({ … })`,
which lands on `inbox:{recipientId}` and rings the inbox bell. The row also persists in `staff_messages`.

---

## 8. Frontend (house style — `.claude/rules/ui-design-system.md` + display archetypes)

### Mode switcher (mirror Operations — verified pattern)
- 🆕 `src/components/sidebar/support/support-sidebar-shared.ts`:
  ```ts
  export type SupportMode = 'tickets' | 'voicemail' | 'calls';
  export const DEFAULT_SUPPORT_MODE: SupportMode = 'tickets';
  export const SUPPORT_MODE_ITEMS: HorizontalSliderItem[] = [
    { id: 'tickets',   label: 'Tickets',   icon: Inbox },
    { id: 'voicemail', label: 'Voicemail', icon: Voicemail, badge: 'dot' /* when open follow-ups > 0 */ },
    { id: 'calls',     label: 'Calls',     icon: Phone },
  ];
  export function parseSupportMode(raw: string | null | undefined): SupportMode {
    return raw === 'voicemail' || raw === 'calls' ? raw : 'tickets';
  }
  export const SUPPORT_MODE_SCOPED_PARAMS = ['vm', 'q', 'status', 'assignee', 'direction', 'range'] as const;
  ```
- 🆕 `src/components/sidebar/support/useSupportMode.ts` — copy `useOperationsMode.ts` verbatim, swapping the
  base path to `/support`, the default to `tickets` (drops `?mode=`), and the scoped-params list. Icons import
  from `@/components/Icons`.
- 🆕 `SupportSidebarPanel` gains the `HorizontalButtonSlider variant="nav" dense className="w-full"` rail in
  `headerAbove`, then branches by mode:
  - `tickets` → existing `SupportTicketQueue` (unchanged) — but now composed inside `SidebarShell`.
  - `voicemail` → `VoicemailQueue` (the to-do picker).
  - `calls` → `CallLogList`.
  `mode` from `useSupportMode()`; selection writes via `router.replace`. Keep the existing `'support-refresh'`
  invalidation listener and add `['voicemails']` / `['call-events']` keys.

✅ `SidebarShell` props to compose (don't fork): `{ search?, filter?, searchGroup?, headerAbove?, headerRows?,
headerBelow?, children, bodyClassName?, footer?, as?, … }`. The shell owns the
`flex-1 overflow-y-auto` scroll body and renders `<SidebarSearchBar {...search} />` itself.

### Voicemail mode — Workbench (`display/workbench.md`)
- **Sidebar = the to-do picker.** Compose `SidebarShell`; rows follow one-row anatomy (title = matched customer
  name / formatted number → meta eyebrow = time-ago + mailbox → chips = status / linked-ticket). Selection
  writes `?vm=<id>` (durable, deep-linkable); selection style is `bg-blue-50 ring-1 ring-inset ring-blue-400`
  only (no size shift). Status filter chips in a `headerRows` band: Open / Snoozed / Done / Unassigned.
- **Right pane = `VoicemailDetail`.** Audio player + transcript, matched-customer card, linked-case panel
  (reuse the `SupportLinkedContext`/`ticket_links` candidate UI), and the action row: **Call back**
  (click-to-call), **Mark done**, **Snooze**, **Assign**, **Create/Link Zendesk ticket**. Crossfade the right
  pane keyed on `?vm` via `useMotionPresence(framerPresence.workbenchPane)` + `useMotionTransition(
  framerTransition.workbenchPaneMount)`; keep the list mounted and still.
- **Empty/typed states.** No-selection teaching prompt; no-results vs no-data distinction; retryable error (rose
  dashed box). Each sub-resource (recording, transcript, linked case) fetches in its own try/catch and **degrades
  to empty — never 500 the pane**.
- **Optimistic CRUD.** Follow-up status/assign are optimistic (`onMutate → rollback → onSettled invalidate`);
  thread a `clientEventId`. Linking / creating a ticket is **confirm-then-commit**.

### Call Log mode — Monitor (`display/monitor-and-canvas.md`)
- Full-page read-only newest-first stream of `call_events` via `EventTimeline`
  (`src/components/ui/EventTimeline.tsx`) — 🆕 write a `callEventsToTimeline` adapter under
  `src/lib/timeline/call-events.ts` (mirror `inventoryEventsToTimeline` / `stationActivityToTimeline`: an
  `ACTIVITY_MAP`-style `{ direction/status → { title, tone } }`, `ref` = `{ value: counterparty, kind:
  'tracking' }`-style chip, `actor` = agent name). Export it from `src/lib/timeline/index.ts`. **Never fork a
  timeline** (reference-timeline rules). Render through `TimelineSection`, not `EventTimeline` bare.
- Ephemeral filters in the URL (`?direction=`, `?q=`, `?range=`), applied client-side in a `useMemo`. **No
  durable selection, no edit.** A row needing action deep-links into Voicemail/Tickets mode (split regions).
- Org-scoped only (this tenant's `call_events`); poll with `staleTime` (≈30s), Ably-invalidate on new events.

### Realtime
- 🆕 `publishVoiceEvent` in `src/lib/realtime/publish.ts` — mirror `publishStaffMessage` /
  `publishRepairChanged`: validate ids, `publishEvent(<org/support channel>, 'voice_event', { type, kind:
  'call'|'voicemail', voicemailId?, callEventId?, timestamp: formatPSTTimestamp() })`. The sidebar/list
  subscribe and `invalidateQueries(['voicemails'])` / `['call-events']`. Assignment notifications continue to
  ride `publishStaffMessage` (inbox bell). A `'support-refresh'` window event can also reuse the existing
  invalidation hook in `SupportSidebarPanel`.

---

## 9. Implementation spike (do FIRST — verify against current Nextiva docs)

**Do not write the Nextiva client from memory.** Prefer the **Context7 docs lookup** / official Nextiva developer
docs. Before Phase 1, confirm and record here:
1. **Auth model** — OAuth 2.0 vs API key/token; required scopes; account/location identifiers. Decides
   `authKind` (`oauth` vs `vault`), the `connect` method, and the `NextivaCredentials` payload shape.
2. **Webhooks** — available event types (call start/end/missed, voicemail created), the subscription/registration
   mechanism (can we register a per-tenant URL with our `[token]`?), the **signature header + HMAC scheme**, and
   retry behavior.
3. **REST** — call-log + voicemail list endpoints (for `nextivaSync` backfill), pagination/cursor, and the
   **voicemail recording** retrieval (URL auth + retention window → decides §6 proxy vs Blob).
4. **Click-to-call / originate** — the call-control endpoint and how an agent's extension is identified
   (map `staff.id` → Nextiva extension; where is that stored?).
5. **Transcription** — whether Nextiva returns transcripts, or we add our own STT.
6. **Number normalization** — the format of `from`/`to` numbers (decides the §7 E.164 normalizer).

---

## 10. Phasing

- **Phase 0 — Spike (§9):** verify Nextiva API/auth/webhooks; record decisions inline above. *(No prod code.)*
- **Phase 1 — Ingestion:** migrations (§3); `nextiva` provider + capability + connector + settings card (§4);
  `connect` route that mints the per-tenant webhook token/secret + registers with Nextiva; webhook
  `[token]` route + signature verify + idempotent upsert + org resolve (§5); `nextivaSync` backfill on the org
  cron; E.164 normalizer (§7).
  *Acceptance:* a test call/voicemail webhook lands a row idempotently under the right org; a re-delivered
  webhook is a no-op; the settings health card is green.
- **Phase 2 — Voicemail Workbench mode:** mode switcher (§8); `VoicemailQueue` + `VoicemailDetail`; follow-up
  CRUD routes + optimistic UI; audio playback (§6); `voicemail_followups` auto-create + bell notifications.
  *Acceptance:* a voicemail appears in the to-do list, plays, and can be marked done / snoozed / assigned.
- **Phase 3 — Linkage & case actions (§7):** phone/email customer match (Deps-injected helper + unit tests);
  linked-case panel via `ticket_links`; create/link Zendesk ticket from a voicemail; `linked_*` cache populated
  + manual override.
  *Acceptance:* an inbound voicemail auto-surfaces the matched customer and their open tickets; one click
  creates a pre-filled ticket linked back to the voicemail.
- **Phase 4 — Call Log Monitor mode + click-to-call:** `callEventsToTimeline` + Monitor stream; click-to-call
  action + audit; realtime push polish.
  *Acceptance:* live calls stream newest-first; an agent can click-to-call from a row's deep-linked detail.
- **Phase 5 — Hardening:** private-Blob recording archival if Nextiva expires recordings; transcription;
  analytics (missed-call rate, follow-up SLA); permission/role tuning; `customers.phone/mobile` index if match
  volume warrants.

---

## 11. Testing

- **Domain units (DB-free).** Use the `/domain-unit-test` skill (node:test + tsx, `fakes()` factory) for
  `match-customer.ts` (assert candidate ranking + that `listTicketCandidates` was called with the right args),
  `normalize-phone.ts` (E.164 edge cases), and the idempotent upsert helper (same `external_*_id` → no-op).
- **Webhook signature.** Unit-test `verifyNextivaWebhookSignature` with a known secret + payload (valid /
  tampered / missing-header), mirroring the Zoho verify tests.
- **Route auth/idempotency.** The `api-route-reviewer` + `permission-registry-guard` agents run on the new
  routes; ensure each mutation has perm + Zod + `clientEventId` idempotency + `recordAudit`.
- **E2E (optional, Phase 2+).** A Playwright spec under `tests/e2e` (use `e2e-spec-writer`) that seeds a
  voicemail row, opens `?mode=voicemail&vm=<id>`, plays the proxied recording, and marks it done.

---

## 12. Permissions

🆕 Introduce a `support.voice.*` family rather than overloading `integrations.zendesk` (recommended). Add via
`/new-route` so `src/lib/auth/permission-registry.ts` and `route-permission-manifest.test.ts` stay in lockstep
(the `permission-registry-guard` agent enforces the pairing, and `audit-route-auth` must still pass):
- `support.voice.view` — see the call log + voicemail list/detail + play recordings.
- `support.voice.followup` — mark done / snooze / assign / link / create ticket.
- `support.voice.call` — originate click-to-call.
- `support.voice.manage` — connect/disconnect the Nextiva integration + mint webhook identity.

Perms resolve only from `staff_roles × roles` (`project_permissions_staff_roles`); grant the new perms to the
support/admin roles. Gate the sidebar modes on `support.voice.view` (mirror how the Tickets mode checks
`integrations.zendesk`).

---

## 13. Risks / open questions

- **Nextiva API uncertainty** — the whole client depends on Phase 0; the auth kind may flip `authKind`/payload
  and the `connect` method.
- **Org resolution on webhooks** — multi-tenant requires mapping a Nextiva account/location → `organization_id`.
  The per-tenant `[token]` path (mirror `resolveOrgByWebhookToken`) is the clean solution; single-tenant (USAV)
  can fall back to `USAV_ORG_ID`. Confirm Nextiva lets us register a per-tenant callback URL.
- **Recording retention** — if Nextiva expires recordings, default to **private Blob** archival (§6).
- **Customer match precision** — phone match is fuzzy (shared/spoofed/blocked numbers); always allow manual link;
  never auto-create tickets without a confirm. Surface a confidence indicator.
- **Phone normalization** — no E.164 helper exists today; the matcher is only as good as the normalizer. Decide
  US-only vs `libphonenumber-js`.
- **Cron sweep scope** — the orders-sync orchestrator is orders-capability-focused; ensure `'voice'`-capability
  connectors are included (or add a dedicated voice sweep).
- **PII / audio** — voicemail audio + transcripts are customer PII; keep recordings in **private** Blob, audit
  access, and scope reads by org (`withTenantTransaction`).

---

## 14. Key files to touch (quick index)

| Area | Files | Skill / agent |
|---|---|---|
| Migrations | `src/lib/migrations/YYYY-MM-DD_nextiva_{call_events,voicemails,voicemail_followups}.sql` | `/db-migration-author` → `/db-migrate` |
| Credentials | `src/lib/integrations/credentials.ts` (+ `nextiva` provider, `NextivaCredentials`) | `integration-connector` |
| Connector | `src/lib/integrations/connectors/{registry.ts,types.ts (+'voice'),nextiva.ts}` | `integration-connector` |
| Settings card | `src/app/settings/integrations/registry.ts` (`category:'Support'`) | — |
| Webhook verify/resolve | `src/lib/voice/nextiva/{verify.ts,resolve-org.ts,webhook-identity.ts}` (mirror `src/lib/zoho/webhooks/*`) | — |
| Routes | `src/app/api/integrations/nextiva/{webhook/[token],health,connect,call}/route.ts`, `src/app/api/voicemails/**` | `/new-route` |
| Domain | `src/lib/voice/{match-customer.ts,normalize-phone.ts,recordVoicemail.ts,recordCallEvent.ts,followups.ts}` (Deps-injected) | `/domain-unit-test` |
| Realtime | `src/lib/realtime/publish.ts` (`publishVoiceEvent`) | — |
| Timeline adapter | `src/lib/timeline/call-events.ts` (+ export in `index.ts`) | — |
| Sidebar/modes | `src/components/sidebar/support/{support-sidebar-shared.ts,useSupportMode.ts}`, `src/components/sidebar/SupportSidebarPanel.tsx` | `sidebar-mode` |
| UI | `src/components/support/voice/{VoicemailQueue,VoicemailDetail,CallLogList,CallLogView}.tsx` | — |
| Audit constants | `src/lib/audit-logs.ts` (`AUDIT_ACTION`/`AUDIT_ENTITY` additions) | — |
| Permissions | `src/lib/auth/permission-registry.ts` (+ `route-permission-manifest.test.ts`) | `/new-route`, `permission-registry-guard` |
