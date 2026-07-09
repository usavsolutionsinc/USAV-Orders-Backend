# WS0 — Platform Foundations + Secrets Vault · Execution-Ready Spec

> Parent: [gap-closure-plan.md](./gap-closure-plan.md) · Team: 2–4 devs ·
> Duration: ~6–8 weeks (2 parallel tracks) · Status: ready to ticket.
>
> **Why first:** every outbound feature (listing, repricing, channel breadth)
> depends on (a) a safe credential store, (b) one channel-connector contract,
> (c) a durable job queue. Shipping these first prevents N bespoke integrations
> and fixes the **plaintext-token / unset-`INTEGRATION_KMS_KEY`** security gap.

## Definition of Done (whole workstream)
- All channel/integration credentials stored **encrypted** via the vault; no
  plaintext tokens in DB. `INTEGRATION_KMS_KEY` required in all envs.
- `eBay order sync` runs **through the new `ChannelConnector` contract** (proof
  the abstraction works) with zero behavior regression.
- Every outbound mutation goes through `channel_jobs` (idempotent, retryable,
  observable). Admin surface shows account token health + job status.
- New permissions registered + covered by the route-permission manifest test;
  `audit-route-auth` passes. New tables in Drizzle + one migration each.
- Feature-flagged rollout; DRAGON/MEKONG eBay accounts reauthed onto the vault.

## Team allocation (2 tracks; works for 2–4 devs)
| Track | Focus | Epics |
|---|---|---|
| **T1 — Security/Platform** | vault, jobs queue, admin/observability | A → D → E |
| **T2 — Connector/Data** | data model, connector contract, eBay refactor | B → C → F |
Tracks run in parallel after a shared kickoff on the contract types (C1, B1).
Converge at **F** (eBay sync on the contract) + **E** (admin surface).

---

## EPIC A — Secrets / Credential Vault  *(T1, security must-fix)*

Envelope encryption (AES-256-GCM) keyed by `INTEGRATION_KMS_KEY`. Subsumes the
tolerant `readEbayToken/writeEbayToken` shim; extends to every channel account.

### A1 · Migration: `integration_secrets` *(0.5d)*
`src/lib/migrations/2026-06-01_integration_secrets.sql`
```sql
BEGIN;
CREATE TABLE IF NOT EXISTS integration_secrets (
  id              BIGSERIAL PRIMARY KEY,
  organization_id INTEGER,                       -- matches orgIdCol() convention
  scope           TEXT NOT NULL,                 -- 'channel_account' | 'webhook' | ...
  ref_id          INTEGER NOT NULL,              -- FK-by-convention to the owning row
  name            TEXT NOT NULL,                 -- 'access_token' | 'refresh_token' | 'api_key'
  ciphertext      BYTEA NOT NULL,                -- AES-256-GCM
  iv              BYTEA NOT NULL,
  auth_tag        BYTEA NOT NULL,
  key_version     INTEGER NOT NULL DEFAULT 1,    -- supports key rotation
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope, ref_id, name)
);
CREATE INDEX IF NOT EXISTS idx_integration_secrets_lookup
  ON integration_secrets (scope, ref_id);
COMMENT ON TABLE integration_secrets IS
  'Envelope-encrypted integration credentials (AES-256-GCM, keyed by INTEGRATION_KMS_KEY). No plaintext tokens elsewhere.';
COMMIT;
```
**AC:** table exists; Drizzle `integrationSecrets` added + type exports.

### A2 · Vault module *(2d)*
`src/lib/secrets/vault.ts`
```ts
// AES-256-GCM envelope encryption. Key from process.env.INTEGRATION_KMS_KEY
// (32-byte base64). Throws on missing key in prod; allows a dev fallback only
// when NODE_ENV !== 'production' (logged loudly).
export async function writeSecret(p: {
  scope: string; refId: number; name: string; value: string;
  organizationId?: number | null; expiresAt?: Date | null;
}): Promise<void>;
export async function readSecret(p: {
  scope: string; refId: number; name: string;
}): Promise<string | null>;
export async function deleteSecret(p: { scope: string; refId: number; name?: string }): Promise<void>;
export async function rotateKey(/* old→new */): Promise<{ rotated: number }>;
```
- Use node `crypto.createCipheriv('aes-256-gcm', key, iv)`; store iv+authTag.
- `key_version` lets `rotateKey` re-encrypt without downtime.
**AC:** unit tests cover round-trip, wrong-key failure, missing-key guard,
rotation. No secret value ever logged.

### A3 · Migrate eBay tokens onto the vault *(1.5d)*
- Backfill: read `ebay_accounts.access_token/refresh_token` → `writeSecret`,
  then null the columns (keep columns one release for rollback, then drop).
- Replace `readEbayToken/writeEbayToken` (in `src/lib/ebay/token-refresh.ts`)
  to delegate to the vault; keep the same signature (no caller changes).
- Script: `scripts/backfill-integration-secrets.mjs` (dry-run + apply).
**AC:** eBay sync works with tokens read from vault; DB has no plaintext token;
DRAGON/MEKONG flagged `reauth_required` (A4) until re-OAuthed.

### A4 · Token-health surface *(1d)*
- `GET /api/integrations/accounts` → per-account `{ channel, name, status,
  tokenExpiresAt, refreshExpiresAt, reauthRequired, lastSyncAt }`.
- `reauthRequired` true when refresh token expired/invalid (covers DRAGON/MEKONG).
**AC:** admin can see which accounts need reauth.

---

## EPIC B — Channel data model  *(T2)*

### B1 · Migration: `channel_accounts` + `channel_jobs` *(1d)*
`src/lib/migrations/2026-06-01_channel_framework.sql`
```sql
BEGIN;
-- Canonical, channel-agnostic connected-account registry. Existing
-- ebay_accounts/ecwid/square rows are backfilled in; adapters map to these.
CREATE TABLE IF NOT EXISTS channel_accounts (
  id              BIGSERIAL PRIMARY KEY,
  organization_id INTEGER,
  channel_key     TEXT NOT NULL,                 -- 'ebay' | 'amazon' | 'ecwid' | 'square' | 'walmart' | ...
  account_name    TEXT NOT NULL,
  external_account_id TEXT,                       -- marketplace user/seller id
  marketplace     TEXT,                           -- 'EBAY_US' | 'US' | ...
  capabilities    TEXT[] NOT NULL DEFAULT '{}',   -- 'list','reprice','orders','inventory'
  status          TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | REAUTH_REQUIRED | DISABLED
  legacy_table    TEXT,                           -- 'ebay_accounts' during migration
  legacy_id       INTEGER,
  last_sync_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_key, account_name, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_accounts_channel ON channel_accounts (channel_key, status);

-- Durable outbound-mutation queue. Every publish/reprice/end/setQty is a job.
CREATE TABLE IF NOT EXISTS channel_jobs (
  id              BIGSERIAL PRIMARY KEY,
  organization_id INTEGER,
  channel_key     TEXT NOT NULL,
  channel_account_id BIGINT REFERENCES channel_accounts(id) ON DELETE SET NULL,
  job_type        TEXT NOT NULL,                  -- 'pull_orders' | 'publish_offer' | 'set_price' | 'set_qty' | 'end_offer'
  client_event_id TEXT NOT NULL,                  -- idempotency key (unique)
  payload         JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | RUNNING | DONE | FAILED | DEAD
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  last_error      TEXT,
  run_after       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_event_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_jobs_due ON channel_jobs (status, run_after);
CREATE INDEX IF NOT EXISTS idx_channel_jobs_account ON channel_jobs (channel_account_id, created_at DESC);
COMMENT ON TABLE channel_jobs IS 'Idempotent, retryable outbound channel mutations. One row per attempted side effect.';
COMMIT;
```
**AC:** tables + Drizzle models + types; backfill script maps `ebay_accounts` →
`channel_accounts` (legacy_table/id set).

### B2 · Migration: offer/pricing model (schema only; populated by WS1/WS2) *(0.5d)*
`src/lib/migrations/2026-06-01_channel_offer_pricing.sql` — the
`channel_listings`, `pricing_rules`, `price_events` tables from the master plan
(§0.3). Created now so the contract types compile; no writers until WS1/WS2.
**AC:** tables exist + Drizzle models; flagged "no active writer yet" in the doc.

### B3 · Drizzle models + type exports *(0.5d)*
Add `channelAccounts`, `channelJobs`, `channelListings`, `pricingRules`,
`priceEvents`, `integrationSecrets` to a new `src/lib/drizzle/schema/channels.ts`
(first slice of the WS6 modular-schema split) re-exported from the index.
**AC:** `tsc` clean; `$inferSelect/$inferInsert` exported.

---

## EPIC C — Channel Connector framework  *(T2)*

### C1 · Contract + types *(1.5d, shared kickoff)*
`src/lib/channels/types.ts` — the `ChannelConnector`, `ChannelKey`,
`ChannelCapability`, `InternalOffer/Order`, `ChannelOfferRef`, `Money` types
(see master plan §0.1). Pure types + a `registerConnector`/`getConnector`
registry. No I/O.
**AC:** types compile; registry returns adapters by key; unit test for registry.

### C2 · Connector base + helpers *(1d)*
`src/lib/channels/base.ts` — shared retry/backoff, rate-limit token bucket per
channel, error normalization (`ChannelError` with `retryable` flag), and a
`runConnectorCall()` wrapper used by the jobs worker.
**AC:** rate-limit + retry covered by tests (fake timers).

### C3 · eBay adapter (orders capability only, in WS0) *(2d)*
`src/lib/channels/ebay/index.ts` implementing `ChannelConnector` with
`capabilities: ['orders']` and `pullOrders()` delegating to the **existing**
`syncAccountOrders` logic (moved, not rewritten). `publishOffer` etc. throw
`NotImplemented` (lands in WS1).
**AC:** `getConnector('ebay').pullOrders(account, since)` returns the same
orders the current sync produces (golden-file diff).

---

## EPIC D — Channel Jobs queue + worker  *(T1)*

### D1 · Enqueue API + repository *(1.5d)*
`src/lib/channels/jobs.ts` — `enqueueChannelJob({channelKey, accountId, jobType,
clientEventId, payload})` inserts a `channel_jobs` row (idempotent on
`client_event_id`) and publishes to QStash (`src/lib/qstash.ts`).
**AC:** duplicate `client_event_id` is a no-op (returns existing job).

### D2 · Worker route *(2d)*
`src/app/api/qstash/channels/run/route.ts` — QStash-signed POST; loads the job,
sets RUNNING, resolves the connector + account (+ vault creds), runs the call
via `runConnectorCall`, writes DONE/FAILED, increments attempts, schedules
retry with backoff (`run_after`), moves to DEAD past `max_attempts`.
**AC:** happy path + retryable failure + permanent failure (DEAD) covered;
signature verification enforced; no secret in logs.

### D3 · Reaper / DLQ sweep *(0.5d)*
Cron `/api/cron/channels/reaper` requeues stuck RUNNING jobs and surfaces DEAD
ones. Reuses existing idempotency-cleanup conventions.
**AC:** stuck-job requeue tested.

---

## EPIC E — Permissions + Admin surface  *(T1)*

### E1 · Register permissions *(0.5d)*
Add to `src/lib/auth/permission-registry.ts` (category `integrations`):
- `integrations.manage` — connect/reauth accounts, manage secrets (**step-up**).
- `channels.view` — read accounts/jobs.
- `channels.manage` — enqueue/retry jobs (used by WS1/WS2 too).
Mark `integrations.manage` step-up (and destructive for secret deletion).
**AC:** `route-permission-manifest.test.ts` updated for new routes;
`audit-route-auth` passes. (Per ops note: each role needs a `staff_roles` row to
receive these — document in the rollout.)

### E2 · Admin: accounts + jobs *(2d)*
- `GET /api/integrations/accounts` (A4), `GET /api/channels/jobs?status=`,
  `POST /api/channels/jobs/{id}/retry`.
- Minimal admin UI panel: account token-health table (reauth CTA) + jobs table
  (status, attempts, last_error, retry). Follows existing admin/connections
  surface styling.
**AC:** an admin can see reauth-needed accounts and retry a failed job.

---

## EPIC F — Cut eBay order sync over to the contract  *(T1+T2 converge)*

### F1 · Route sync through jobs + connector *(2d)*
- `syncAllAccounts` enqueues a `pull_orders` `channel_job` per active
  `channel_account` instead of calling eBay directly.
- The worker (D2) invokes `getConnector('ebay').pullOrders` (C3) with
  vault creds (A3).
**AC:** scheduled eBay sync produces identical results via the new path;
old direct-call path removed behind a flag after one green cycle.

### F2 · Rollout + reauth *(1d)*
- Feature flag `channels_framework_enabled`; enable per-org.
- Reauth DRAGON/MEKONG through the existing eBay OAuth (`/api/ebay/connect`),
  now writing tokens to the vault.
**AC:** both accounts ACTIVE on the vault; sync green; flag on in prod.

---

## Route stubs (contracts)
All `withAuth(handler, { permission })`, Zod-validated bodies, `NextResponse`.

| Route | Method | Permission | Purpose |
|---|---|---|---|
| `/api/integrations/accounts` | GET | `channels.view` | account list + token health |
| `/api/integrations/accounts/{id}/reauth` | POST | `integrations.manage` (step-up) | start OAuth reconnect |
| `/api/channels/jobs` | GET | `channels.view` | job list (filter status) |
| `/api/channels/jobs/{id}/retry` | POST | `channels.manage` | requeue a job |
| `/api/qstash/channels/run` | POST | QStash-signed | job worker |
| `/api/cron/channels/reaper` | POST | cron-signed | stuck/DLQ sweep |

```ts
// Example stub — src/app/api/channels/jobs/route.ts
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { listChannelJobs } from '@/lib/channels/jobs';
import { z } from 'zod';

const Query = z.object({ status: z.enum(['PENDING','RUNNING','DONE','FAILED','DEAD']).optional(), limit: z.coerce.number().max(200).default(50) });

export const GET = withAuth(async (req) => {
  const { searchParams } = new URL(req.url);
  const q = Query.parse(Object.fromEntries(searchParams));
  return NextResponse.json({ ok: true, jobs: await listChannelJobs(q) });
}, { permission: 'channels.view' });
```

## Test plan
- **Unit:** vault round-trip/rotation; jobs idempotency; connector registry;
  rate-limit/backoff; eBay `pullOrders` golden-file diff.
- **Integration:** worker happy/retry/dead paths against a mock eBay adapter.
- **Manifest:** `route-permission-manifest.test.ts` covers all new routes;
  `audit-route-auth` green.
- **Migration:** `npm run db:migrate:dry` clean; backfill scripts dry-run first.
- **Regression:** scheduled eBay sync output unchanged (the F1 acceptance gate).

## Rollout & safety
1. Ship vault (A) + backfill behind no flag (additive). Keep token columns one
   release for rollback, then a follow-up migration drops them.
2. Ship framework (B–E) behind `channels_framework_enabled` (off).
3. Enable for one org; verify F1 golden diff; enable prod; reauth DRAGON/MEKONG.
4. Only then build WS1 (listing) on top — `publishOffer` slots into C3.

## Estimate roll-up
| Epic | Days | Track |
|---|---|---|
| A Vault | 6 | T1 |
| B Data model | 2.5 | T2 |
| C Connector framework | 4.5 | T2 |
| D Jobs queue | 4 | T1 |
| E Permissions/admin | 4.5 | T1 |
| F eBay cutover | 3 | T1+T2 |
| **Total** | **~24.5 dev-days** | ~6–7 wks for 2 devs incl. review/QA |

## Definition of "ready for WS1"
Vault live, `channel_accounts`/`channel_jobs` populated, eBay sync on the
contract, admin surface green, permissions registered. WS1 then implements
`publishOffer/updateOffer/endOffer/setPrice/setQuantity` in the eBay adapter and
the `channel_listings` writers — no new plumbing required.
