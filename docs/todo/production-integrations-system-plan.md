# Production Integrations System — 2026 Master Plan

> **Status:** PLAN (2026-07-01). Deep-scan of live code + sibling docs.
>
> **Audience:** implementers, ops, and Studio builders. This is the **single execution
> umbrella** for shipping a multi-tenant, connection-driven integrations platform —
> consolidating and sequencing work already specced in sibling docs without
> re-litigating their core decisions.
>
> **Goal:** Every external system a tenant connects becomes a **first-class
> connection** that (1) stores credentials safely, (2) syncs automatically, (3)
> surfaces in Settings with honest health, (4) composes into Operations Studio, and
> (5) respects plan entitlements — with operator QoL that makes reconnect, diagnose,
> and recover routine in production.

**Supersedes as execution index:** treat this doc as the **build order + exit criteria**
layer on top of (not a replacement for) the detailed provider docs in
`docs/integrations/` and the architectural deep-dives below.

**Related docs (read before building a workstream)**

| Doc | Role |
|---|---|
| [studio-integrations-master-plan.md](./studio-integrations-master-plan.md) | Studio wiring checklist, diagnostics rules, P0–P5 phasing |
| [integrations-oauth-connection-plan.md](./integrations-oauth-connection-plan.md) | Connector contract origin, entitlement model |
| [token-sot-consolidation-plan.md](../integrations/token-sot-consolidation-plan.md) | Vault as sole token home; Zoho cutover log |
| [platform-account-type-catalog-plan.md](./platform-account-type-catalog-plan.md) | `platforms` → `platform_accounts` → `types` chain |
| [../partial/platform-account-type-catalog-STATUS.md](../partial/platform-account-type-catalog-STATUS.md) | What's shipped vs remaining on catalog |
| [../incoming-universal-purchase-orders-plan.md](../incoming-universal-purchase-orders-plan.md) | Polymorphic Incoming + eBay buyer role |
| [nango-additive-integration-plan.md](./nango-additive-integration-plan.md) | Nango sidecar deployment recipe |
| [../integrations/README.md](../integrations/README.md) | Per-provider status index |
| `.claude/skills/integration-connector/SKILL.md` | Canonical connector implementation steps |
| `.claude/skills/ops-studio/SKILL.md` | Studio layer laws |
| `.claude/rules/polymorphic-tables.md` | DDL contract for new link/fact tables |

---

## 0. Executive summary

### 0.1 What exists today (honest audit)

The repo is **past prototype, pre-production-unified**. Phase 0 of the connection
framework shipped; ingestion is still fragmented.

| Layer | Location | Maturity |
|---|---|---|
| Encrypted vault | `organization_integrations` + `credentials.ts` + `crypto.ts` | ✅ Live |
| Connector registry | `src/lib/integrations/connectors/registry.ts` | ✅ 16 providers compile-checked |
| Connection reader | `connectors/connections.ts` + `integrationLimitStatus` | ✅ Live (vault-only count) |
| Sync orchestrator | `connectors/orchestrator.ts` + `/api/cron/integrations/sync` | 🟡 eBay + Square wired; Amazon has own cron |
| Reconcile cron | `/api/cron/integrations/reconcile` | 🟡 Scheduled; **zero providers implement `reconcile()`** |
| Credential scope | `credential-scope.ts` + `credential-allowlist.ts` | 🟡 Infra live; **only Zoho on allowlist** |
| Settings UI | `src/app/settings/integrations/*` | ✅ Live; dual registries |
| Catalog accounts | `platform_accounts` + `catalog-queries.ts` | 🟡 ~80% shipped; **not wired on every connect** |
| Studio feeds | `src/lib/stations/{data-sources,actions}.ts` | 🔴 3 sources, 4 actions — no integration cluster |
| Legacy token homes | `ebay_accounts`, env fallback, `ZOHO_MAIN` row | 🔴 Production risk |
| Manual sync UI | `OrdersSyncPopover`, connections panel backfill | 🔴 Competes with connection-driven sync |

### 0.2 Target end state (2026 production)

```
Tenant connects (OAuth / Nango / vault)
        ↓
Secrets → organization_integrations (scoped, encrypted)
Identity → platform_accounts (label, role, health, external id)
Facts   → integration_connection_facts (sync cursors, marketplace metadata)
        ↓
Connector.sync() / reconcile() / pushInventory()
        ↓
Domain tables (orders, receiving_lines + polymorphic links, tracking, …)
        ↓
Studio data sources + actions + workflow diagnostics
```

**North-star operator experience:**

- Connect once → account label appears everywhere (Settings card, catalog, Incoming chip).
- Tokens refresh silently; expiring connections show **actionable** reconnect CTA.
- "Sync now" and cron run the **same code path**; no sidebar backfill buttons.
- Studio stations bind feeds by `platform_account_id`, not hardcoded provider strings.
- Plan limits enforced at **every** connect path (OAuth callback, Nango, vault upsert).
- Integration failures surface in **Gaps lens** before operators hit a dead button.

### 0.3 Build order (do not reorder without cause)

| Phase | Theme | Est. | Unblocks |
|---|---|---|---|
| **P0** | Foundation — token SoT, account identity, connect hardening | 2–3 wk | Safe multi-tenant + honest Settings UI |
| **P1** | Connection ops — refresh sweep, health unify, entitlements, observability | 2 wk | Production operability |
| **P2** | Ingestion unify — cron consolidation, retire manual sync, credential allowlist | 2 wk | Connection-driven ingestion |
| **P3** | Universal Incoming + marketplace buyer roles | 2–3 wk | eBay/Amazon purchase visibility |
| **P4** | ShipStation + carrier label engine | 1–2 wk | Fulfill station labels |
| **P5** | Studio-native integrations layer | 2 wk | Tenant-composable floor UI |
| **P6** | Nango sidecar + Shopify/Square GA | 1 wk + 1 wk/provider | Multi-channel SaaS tenants |
| **P7** | QoL + enterprise — webhooks hub, outbound webhooks, admin diagnostics | ongoing | Scale + support load reduction |

---

## 1. Architecture — three layers + two registries

### 1.1 Credential / identity / facts (DB)

**Do not** collapse these into one polymorphic `integration_accounts` table. The
repo's catalog chain is the correct long-term account model.

| Layer | Table | Owns |
|---|---|---|
| **Secrets** | `organization_integrations` | Encrypted payload; UNIQUE `(org, provider, scope)` |
| **Identity** | `platform_accounts` (+ `platforms`) | Operator label, slug, `connection_role`, health, `integration_scope` → vault |
| **Facts** | `integration_connection_facts` *(new)* | Provider-specific non-secret metadata (`fact_kind` + Zod registry) |
| **Purchase identity** | `inbound_purchase_order_links` *(in flight)* | Polymorphic source lines on `receiving_lines` |

**Scope convention** (standardize in P0):

```
{account_slug}                 → ebay seller "USAV"
{buyer|seller}:{account_slug}  → same platform, different OAuth consent
seller:{amazon_seller_id}      → Amazon SP-API (already close)
```

**Post-connect invariant (P0 — every connect/callback must do all three):**

1. `upsertIntegrationCredentials({ provider, scope, payload, displayLabel })`
2. Upsert `platform_accounts` via `syncEbayAccountsToPlatformAccounts` (generalize → `syncPlatformAccountForConnection`)
3. `invalidateCatalogCache(orgId)` + audit `integrations.*.connected`

### 1.2 Behavior vs display (code)

| SoT | Path | Owns |
|---|---|---|
| Display | `src/app/settings/integrations/registry.ts` | `PROVIDER_CATALOG`, categories, `connect` method, OAuth paths |
| Behavior | `src/lib/integrations/connectors/registry.ts` | `authKind`, `capabilities`, lazy `sync`/`refresh`/`validate`/`reconcile` |

**Phase 2 tech debt:** merge display bits derived from connector (`authKind`,
`capabilities`, `healthPath`) so new providers are **one PR, two registry entries max**.

### 1.3 Connector contract (extend, don't replace)

Current: `src/lib/integrations/connectors/types.ts`

**Add in P1** (columns + interface fields):

```sql
-- organization_integrations (additive)
ALTER TABLE organization_integrations
  ADD COLUMN IF NOT EXISTS last_synced_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capabilities    TEXT[] DEFAULT '{}';
```

```ts
// platform_accounts (additive) — operator-facing health
connection_role   TEXT CHECK (seller|buyer|storefront|pos|warehouse)
connection_status TEXT CHECK (active|error|expiring|revoked|disconnected)
external_account_id TEXT
token_expires_at TIMESTAMPTZ
last_sync_at TIMESTAMPTZ
last_error TEXT
UNIQUE (organization_id, platform_id, slug, connection_role)
```

```ts
// IntegrationConnector extensions (P1)
defaultSyncIntervalMinutes?: number;
reconcileSlaHours?: number;
stationFeeds?: string[];   // data-source ids auto-registered
webhookKinds?: string[];   // inbound webhook types handled
```

---

## 2. Provider maturity matrix (live code scan)

Legend: ✅ production-ready · 🟡 partial · 🔴 gap/plan · ⬜ not in catalog

| Provider | Auth | Token home | Account identity | Sync | Health | Cron | Studio | Notes |
|---|---|---|---|---|---|---|---|---|
| **eBay** | OAuth ✅ | 🔴 `ebay_accounts` plaintext | 🟡 `platform_accounts` sync on callback (recent) | ✅ orchestrator + `ebay.ts` | ✅ `/api/ebay/health` | ✅ refresh 6h + sync 15m | ⬜ | Seller only; buyer role planned |
| **Amazon** | OAuth ✅ | 🟡 vault + `amazon_accounts` | 🟡 auto-named account | ✅ own cron | ✅ `/api/amazon/health` | ✅ `/api/cron/amazon/orders-sync` | ⬜ | Not in unified orchestrator yet |
| **Zoho** | OAuth ✅ | 🟡 vault (+ legacy bridge) | vault row only | ✅ 5 dedicated crons | ✅ `/api/zoho/health` | ✅ heavy Zoho stack | ⬜ | **Global `zoho_po_mirror` tenancy hole** |
| **Square** | Nango 🟡 | vault marker | ⬜ | ✅ `square.ts` | ⬜ | 🟡 in orchestrator cron | ⬜ | Sidecar not deployed |
| **Ecwid** | vault 🔴 | env/USAV | ⬜ | 🔴 manual transfer | ⬜ | ⬜ | ⬜ | Needs OAuth or per-tenant vault |
| **Google Sheets** | vault ✅ | vault/env | ⬜ | 🟡 cron transfer | ⬜ | ✅ `google-sheets/transfer-orders` | ⬜ | Import lane, not connection-driven |
| **Google Drive** | OAuth ✅ | vault ✅ | ⬜ | ✅ photos mirror cron | ✅ health route | ✅ drive-mirror | ⬜ | Not in PROVIDER_CATALOG count |
| **ShipStation** | vault 🟡 | vault | ⬜ | ✅ `shipstation.ts` | ⬜ | ⬜ not in vercel cron | ⬜ | **No Settings card**; v2 labels + v1 orders |
| **UPS/FedEx/USPS** | vault ✅ | vault | ⬜ | tracking crons | ⬜ | ✅ shipping stack | ⬜ | Tracking only; webhooks dormant |
| **Zendesk** | vault ✅ | vault | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Support console reads vault |
| **Nextiva** | vault 🟡 | vault | ⬜ | 🔴 stub `nextiva.ts` | 🟡 mis-gated permission | ⬜ | ⬜ | Webhook route exists |
| **Stripe** | vault ✅ | vault | ⬜ | N/A billing | ⬜ | ⬜ | ⬜ | Billing, not operator card |
| **Ollama/Ably** | vault/env | global | ⬜ | N/A | ⬜ | ⬜ | ⬜ | Ably card removed (env global) |
| **Shopify** | plan | — | — | — | — | — | — | Doc only |

---

## 3. Critical production gaps (prioritized)

### 3.1 P0 blockers — security & tenancy

| ID | Gap | Evidence | Fix |
|---|---|---|---|
| **INT-001** | eBay tokens in `ebay_accounts` plaintext / KMS envelope inconsistent | `ebay/callback` vs `token-refresh.ts` | Migrate to vault scoped by account; `ebay_accounts` → metadata only → drop |
| **INT-002** | `ZOHO_MAIN` lives in `ebay_accounts` | `credentials.ts` legacy bridge | Complete vault migration; delete row |
| **INT-003** | USAV env fallback can mask missing vault rows | `getIntegrationCredentials` | Gate new tenants; metric when fallback used |
| **INT-004** | `zoho_po_mirror` lacks `organization_id` | token-sot plan Phase 1 tail | Migration + scope all Zoho sync writes |
| **INT-005** | Entitlements only on vault upsert | OAuth connect routes skip `wouldExceedIntegrationLimit` | Shared `assertCanConnectProvider()` on all connect paths |
| **INT-006** | Integration count ignores eBay/Amazon account tables | `countConnectedProviders` vault-only | Count distinct `(provider, scope)` + active platform_accounts with `integration_scope` |
| **INT-007** | `platform_accounts` stale without live tokens | DB audit: catalog labels without `ebay_accounts` | Reconnect UX + status `disconnected`; prune or mark inactive |
| **INT-008** | Credential allowlist only declares Zoho | `credential-allowlist.ts` | Declare ebay/amazon/zoho/shipstation ops as code paths adopt `withCredentialScope` |

### 3.2 P1 blockers — operability

| ID | Gap | Evidence | Fix |
|---|---|---|---|
| **INT-010** | No unified token refresh sweep | eBay has own cron; others ad hoc | `connectors/refresh-sweep.ts` + `/api/cron/integrations/refresh` |
| **INT-011** | Health checks are per-route, not connector `validate()` | Only Drive uses `validate` in registry | Wire `validate` for ebay/amazon/zoho; Settings "Check" calls connector |
| **INT-012** | `reconcile()` unimplemented everywhere | reconcile cron returns `[]` | Implement for eBay + Zoho first (exception drift) |
| **INT-013** | `integration_credential_audit` table referenced but may not exist | `credential-scope.ts` swallows insert fail | Ship migration + Studio/Ops viewer |
| **INT-014** | `last_synced_at` not written after sync | ConnectionStatus type comments "Phase 1" | Orchestrator writes sync timestamp per provider/org |
| **INT-015** | OAuth success banner without account row | eBay callback didn't sync catalog | ✅ `syncEbayAccountsToPlatformAccounts` — generalize to all providers |

### 3.3 P2 blockers — ingestion fragmentation

| ID | Gap | Evidence | Fix |
|---|---|---|---|
| **INT-020** | Manual sync UI still primary for some flows | `OrdersSyncPopover`, `useConnectionsPanel` backfill | Deprecate; route to `POST /api/integrations/{provider}/sync` |
| **INT-021** | Dual cron paths | Amazon own cron + orchestrator | Consolidate under `/api/cron/integrations/sync?providers=` |
| **INT-022** | Ecwid/Square not entitlement-safe at Nango connect | `/api/integrations/nango/connected` | Limit check + platform_accounts seed |
| **INT-023** | ShipStation not in Settings catalog | `registry.ts` missing card | Add card + vault upsert + cron entry |
| **INT-024** | `connectedOrgsForProvider` duplicates logic | orchestrator vs `for-each-org.ts` | Single `listOrgsWithProvider` export |

---

## 4. QoL features — 2026 production operator experience

### 4.1 Settings → Integrations card upgrades

| Feature | Description | Files |
|---|---|---|
| **Account health chips** | Per-account status: active / expiring (<1h) / error / needs-reauth | `IntegrationCard.tsx`, `platform_accounts.connection_status` |
| **Last sync + cursor** | "Synced 12m ago · 47 imported" under each account | `connections.ts`, orchestrator writeback |
| **Reconnect deep-link** | Error state CTA preserves account slug/role | `ebayConnect` prompt prefill |
| **Capability badges** | Orders · Inventory · Tracking from connector | derive from `getConnector(key).capabilities` |
| **Plan limit UX** | Header shows `2/3 integrations`; at-limit cards show upgrade CTA | already partial in `page.tsx` — extend to OAuth |
| **Disconnect safety** | Step-up on token destruction (eBay ✅); unify copy | all DELETE paths |
| **Connection timeline** | Link to filtered audit: connect/disconnect/sync/error | `audit-logs` entity `integration` |
| **Copy scope id** | Support debug: show `integration_scope` for multi-account | admin-only expander |

### 4.2 Admin / support diagnostics (new surface)

**Route:** `/settings/integrations/diagnostics` (or Studio Gaps lens feed)

| Panel | Data source |
|---|---|
| Connection grid | `listConnections(orgId)` + `platform_accounts` health |
| Credential usage | `integration_credential_audit` last 24h |
| Sync run log | `cron_run_log` filter `integrations.*` |
| Webhook deliveries | per-provider webhook tables (P7) |
| Stale sync alerts | `last_synced_at` > SLA |
| Env fallback warning | USAV-only banner if `envFallback` path taken |

### 4.3 Developer QoL

| Feature | Description |
|---|---|
| **Connector scaffolder** | Extend `integration-connector` skill: CLI `scripts/scaffold-connector.ts` |
| **E2E connect smoke** | Expand `tests/e2e/ebay-connect.spec.ts` pattern per provider |
| **Contract tests** | `registry.ts` ↔ `PROVIDER_CATALOG` parity test |
| **Sandbox banners** | eBay SANDBOX / Amazon sandbox env → visible pill on card |
| **Idempotent connect** | Re-OAuth same slug upgrades tokens, never duplicates rows |

### 4.4 Rate limits & resilience

| Feature | Implementation |
|---|---|
| Per-provider concurrency cap | Orchestrator: max 1 sync/org/provider parallel |
| Exponential backoff | Shared `integration-retry.ts` for 429/5xx |
| Cursor safety | Never advance watermark on partial page failure (ShipStation pattern) |
| Dead letter | `integration_sync_failures` table or `cron_run_log` detail JSON |
| Circuit breaker | `markIntegrationError` + pause sync until manual "Retry" |

### 4.5 Webhooks (inbound)

| Provider | Status | Target |
|---|---|---|
| Zoho | ✅ per-tenant token route | Extend to more event types |
| Nextiva | ✅ `/api/integrations/nextiva/webhook/[token]` | Finish client + sync |
| ShipStation | 🟡 verify helper exists | `SHIPSTATION_WEBHOOK_SECRET` + store route |
| UPS/FedEx/USPS | dormant in carriers doc | Enable per org when vault configured |
| eBay | ⬜ | Platform notifications (deferred — polling OK for v1) |

### 4.6 Outbound webhooks (enterprise, P7)

`plans.ts` already gates `webhooksOut` on Pro+. Design:

- `organization_webhook_subscriptions` (url, secret, event types, active)
- Emit on: order.imported, receiving.incoming, integration.error, sync.completed
- HMAC signing + retry queue

---

## 5. Studio integration (P5 detail)

### 5.1 Registration layout (new)

```
src/lib/stations/integrations/
  index.ts           — registerIntegrationStationFeeds()
  ebay.ts            — seller orders, buyer purchases, exceptions
  zoho.ts            — incoming POs, awaiting tracking
  amazon.ts
  shipstation.ts     — label queue, rates
  receiving.ts       — cross-source incoming (uses polymorphic links)
```

Called from `src/lib/stations/index.ts` on boot.

### 5.2 Data source conventions

| Rule | Example |
|---|---|
| Id pattern | `{integration}.{feed_name}` |
| Filter: account | `platform_account_id` select from catalog |
| Filter: role | `connection_role` when provider has buyer/seller |
| `integration` field | Matches connector key |
| `permission` | Same as underlying GET route |
| `buildUrl` | Never embed secret; server resolves creds |

**New feeds to register (minimum viable Studio integrations):**

| id | Endpoint | Phase |
|---|---|---|
| `ebay.seller_orders_exceptions` | `/api/orders-exceptions` | P5 |
| `ebay.buyer_purchases_incoming` | `/api/receiving-lines?view=incoming&inbound_source=ebay` | P3+P5 |
| `zoho.incoming_pos` | `/api/receiving-lines?view=incoming` | P5 |
| `zoho.awaiting_tracking` | existing `receiving.awaiting_tracking_pos` | ✅ exists |
| `amazon.seller_orders` | orders queue filter | P5 |
| `shipstation.awaiting_label` | orders `account_source=shipstation` | P4+P5 |
| `integrations.unhealthy_connections` | new diagnostics API | P5 |

### 5.3 Actions to add

| id | Wraps | Phase |
|---|---|---|
| `integrations.sync_provider` | `POST /api/integrations/:provider/sync` | P2 |
| `integrations.reconnect` | OAuth start URL with scope | P1 |
| `ebay.refresh_account_token` | `POST /api/ebay/refresh-token` | P5 |
| `incoming.attach_tracking` | ✅ exists | — |

### 5.4 Workflow diagnostics (Studio Gaps lens)

Implement rules from `studio-integrations-master-plan.md` §1.1 Hook C:

| Rule id | Severity | Trigger |
|---|---|---|
| `integration-disconnected` | error | Graph node `requiredIntegration` set; org not connected |
| `integration-sync-stale` | warning | `last_synced_at` > SLA (default 24h) |
| `integration-capability-mismatch` | error | Node needs `inventory`; connection lacks it |
| `integration-token-expiring` | warning | `token_expires_at` < 24h |
| `integration-account-orphan` | warning | `platform_accounts` row with no vault scope |

**Publish gate:** `integration-disconnected` at error blocks station publish when binding requires provider.

### 5.5 Diagnostics context extension

```ts
// src/lib/workflow/diagnostics.ts
interface DiagnosticsContext {
  connections: ConnectionStatus[];
  platformAccounts: PlatformAccountRow[];
}
```

---

## 6. Cron & orchestration — target schedule

### 6.1 Consolidated crons (target)

| Cron | Schedule | Scope |
|---|---|---|
| `/api/cron/integrations/sync` | `*/15 * * * *` | All `orders`-capable connectors with `sync()` |
| `/api/cron/integrations/refresh` | `0 */6 * * *` | All connectors with `refresh()` |
| `/api/cron/integrations/reconcile` | `0 4 * * *` | All with `reconcile()` — **implement first** |
| `/api/cron/integrations/incoming` | `*/30 * * * *` | Zoho + eBay buyer + Amazon Business incoming |
| `/api/cron/zoho/*` | merge into incoming + fulfillment | Strangler: one Zoho supervisor cron |

### 6.2 Per-org fan-out

All integration crons must use `forEachOrgWithProvider(provider, fn)` from
`src/lib/cron/for-each-org.ts` — never a global credential pass.

**USAV transitional flag:** `includeUsavTransitional: true` until vault migration
complete; remove in P0 exit criteria.

### 6.3 Observability

| Signal | Where |
|---|---|
| Sync outcomes | `withCronRun('integrations.orders_sync', …)` — already live |
| Per-org failure isolation | `forEachOrgWithProvider` result array → log + optional alert |
| Metrics | Count imported/updated/failures by provider (Datadog/log drain) |

---

## 7. Phase detail — files, migrations, exit criteria

### P0 — Foundation (weeks 1–3)

**Theme:** One connect path, one token home, one account identity.

| Work item | Paths |
|---|---|
| Generalize `syncPlatformAccountForConnection(orgId, { provider, scope, role, label })` | `src/lib/neon/catalog-queries.ts` |
| eBay token migration to vault | `ebay/callback`, `ebay/credentials.ts`, migration backfill script |
| Amazon: verify vault scope per seller | `amazon/oauth/callback` (already upserts vault) |
| `assertCanConnectProvider(orgId, provider)` | new `src/lib/integrations/connect-policy.ts`; call from connect/callback/nango/upsert |
| Fix integration counting | `connections.ts` |
| `integration_connection_facts` table + registry | migration + `src/lib/integrations/connection-facts/registry.ts` |
| Apply `2026-07-01l/m` inbound migrations | `src/lib/migrations/2026-07-01*.sql` |
| Deprecate `ebay_accounts` token columns (nullable first) | migration |

**Exit criteria:**

- [ ] New eBay connect: tokens only in vault; label in Settings + `platform_accounts`
- [ ] `wouldExceedIntegrationLimit` enforced on eBay/Amazon/Zoho OAuth connect
- [ ] No prod code reads `ebay_accounts.access_token` (grep gate in CI)
- [ ] `syncEbayAccountsToPlatformAccounts` (or successor) called from every marketplace connect
- [ ] Zoho second-org blocker documented; mirror migration scheduled

### P1 — Connection ops (weeks 3–5)

| Work item | Paths |
|---|---|
| `integration_credential_audit` migration | `src/lib/migrations/` |
| `organization_integrations.last_synced_at` / `expires_at` | migration + orchestrator write |
| `platform_accounts` health columns | migration + connect/callback |
| Refresh sweep cron | `connectors/refresh-sweep.ts`, `/api/cron/integrations/refresh` |
| Wire `validate()` on ebay, amazon, zoho, google_drive | connector registry |
| Settings card: expiring token + last sync | `IntegrationCard.tsx` |
| Standardize audit actions | `integrations.ebay.connected` → use `AUDIT_ACTION.INTEGRATION_CONNECT` |

**Exit criteria:**

- [ ] Token within 1h of expiry shows amber chip; refresh sweep runs 6h
- [ ] Health check uses connector `validate()` where wired
- [ ] Credential audit queryable for support

### P2 — Ingestion unify (weeks 5–7)

| Work item | Paths |
|---|---|
| Amazon → orchestrator cron | `vercel.json`, deprecate dedicated cron |
| ShipStation Settings card | `registry.ts`, vault upsert, cron entry |
| Ecwid OAuth or document vault-only | `docs/integrations/ecwid.md` |
| Expand credential allowlist | `credential-allowlist.ts` |
| Route sidebar backfill → sync API | `OrdersSyncPopover`, `useConnectionsPanel` |
| `withCredentialScope` on Zoho sync paths | `zoho/*` writers |
| Nango connect: limit + catalog seed | `nango/connected/route.ts` |

**Exit criteria:**

- [ ] No production UI calls `/api/orders/backfill/*` without deprecation banner
- [ ] `POST /api/integrations/{provider}/sync` covers all order-import providers
- [ ] ShipStation card + sync cron live

### P3 — Universal Incoming (weeks 7–10)

Follow `incoming-universal-purchase-orders-plan.md`:

| Work item | Paths |
|---|---|
| eBay buyer connect `?role=buyer` | `ebay/connect`, `ebay/callback`, `oauth-config.ts` buyer scopes |
| `syncEbayPurchasesToReceiving` | `src/lib/inbound/sync-ebay-purchases.ts` |
| Incoming filter on `inbound_source_type` | `receiving-lines/route.ts` |
| Merge algorithm | `mergeIfZohoEquivalentExists` |
| Cron `/api/cron/ebay/purchase-sync` | `vercel.json` |

**Exit criteria:**

- [ ] eBay buyer purchase appears in Incoming before Zoho PO exists
- [ ] Dedup merges eBay + Zoho into one `receiving_lines` row
- [ ] `platform_account_id` chip on Incoming rows

### P4 — ShipStation shipping engine (weeks 10–12)

| Work item | Paths |
|---|---|
| Settings card + vault shape documented | `docs/integrations/shipstation.md` *(new)* |
| Rate shop route wired to pack station | `src/app/api/outbound/rates/route.ts` |
| `ship.node.ts` tap implementation | `src/lib/workflow/nodes/ship.node.ts` |
| v1 order sync in orchestrator cron | `vercel.json` |

### P5 — Studio layer (weeks 12–14)

| Work item | Paths |
|---|---|
| `src/lib/stations/integrations/*` | see §5.1 |
| Diagnostics rules | `src/lib/workflow/diagnostics.ts` |
| Gaps lens connection input | Studio publish gate |
| Feature flag `incoming_universal` per org | `organization_feature_flags` |

### P6 — Nango GA (weeks 14+)

Follow `nango-additive-integration-plan.md` + `docs/integrations/shopify.md`.

### P7 — Enterprise QoL (ongoing)

Outbound webhooks, audit export, SSO-managed integration admin, per-tenant API rate dashboards.

---

## 8. Permissions & audit map

### 8.1 Permissions (`permission-registry.ts`)

| Permission | Routes |
|---|---|
| `integrations.ebay` | eBay connect/callback/accounts/sync/health |
| `integrations.amazon` | Amazon OAuth, accounts, sync |
| `integrations.zoho` | Zoho OAuth, sync, debug |
| `integrations.ecwid` | Ecwid transfer, square sync |
| `integrations.google_drive` | Drive connect/backup |
| `integrations.sheets` | Sheets transfer trigger |
| `integrations.zendesk` | Zendesk + voicemail routes |
| `admin.manage_features` | Vault upsert/delete, most carrier keys |

**Gap:** ShipStation, Nextiva lack dedicated permissions — add `integrations.shipstation`, fix Nextiva health gate (currently `integrations.zendesk`).

### 8.2 Audit actions (standardize)

| Action | When |
|---|---|
| `integration.connect` | Any successful OAuth/vault connect |
| `integration.disconnect` | Token destruction |
| `integration.sync` | Manual "Sync now" (optional; cron uses `cron_run_log`) |
| `integration.error` | `markIntegrationError` |
| `integrations.ebay.connected` | Legacy — migrate to `integration.connect` |

---

## 9. Testing strategy

| Layer | Coverage |
|---|---|
| Unit | `credential-allowlist`, `crypto`, `sync-hash`, connector adapters (mocked HTTP) |
| Contract | PROVIDER_CATALOG ↔ CONNECTORS parity; scope convention |
| E2E | `tests/e2e/ebay-connect.spec.ts` — extend to callback+DB state |
| Cron | Smoke `GET /api/cron/integrations/sync` with CRON_SECRET in CI |
| Tenant | Second org connects eBay — no mirror bleed, RLS on new tables |

---

## 10. Overlap resolution — which doc wins

| Question | Authoritative doc |
|---|---|
| Build order P0–P7 | **This doc** |
| Studio diagnostics rules detail | `studio-integrations-master-plan.md` |
| Provider OAuth steps | `docs/integrations/{provider}.md` |
| Token home | `token-sot-consolidation-plan.md` |
| Catalog schema | `platform-account-type-catalog-plan.md` + STATUS |
| Incoming polymorphic DDL | `incoming-universal-purchase-orders-plan.md` |
| Nango deployment | `nango-additive-integration-plan.md` |
| New connector steps | `integration-connector` skill |

---

## 11. Immediate next actions (recommended sprint)

1. **P0-1:** `assertCanConnectProvider` + fix entitlement counting (1–2 days)
2. **P0-2:** Generalize post-connect `platform_accounts` sync for eBay + Amazon (1 day)
3. **P0-3:** eBay vault token migration script + read path switch (3–5 days)
4. **P1-1:** `last_synced_at` write in orchestrator + Settings card display (1 day)
5. **P2-1:** ShipStation Settings card + cron (2 days)
6. **P2-2:** Deprecation banner on `OrdersSyncPopover` backfill tab (0.5 day)

---

## Appendix A — Key file index

### Core library

| Path | Role |
|---|---|
| `src/lib/integrations/credentials.ts` | Vault SoT, provider types, cache |
| `src/lib/integrations/crypto.ts` | AES-GCM encryption |
| `src/lib/integrations/credential-scope.ts` | Operation allowlist choke point |
| `src/lib/integrations/credential-allowlist.ts` | Per-provider operation declarations |
| `src/lib/integrations/connectors/registry.ts` | Behavior registry |
| `src/lib/integrations/connectors/orchestrator.ts` | Sync + reconcile runners |
| `src/lib/integrations/connectors/connections.ts` | Connection reader + limits |
| `src/lib/integrations/nango.ts` | Nango sidecar seam |
| `src/lib/integrations/sync-hash.ts` | Outbound idempotency hashing |
| `src/lib/neon/catalog-queries.ts` | `platform_accounts` CRUD + seed |
| `src/lib/catalog/org-catalog.ts` | Cached resolvers |
| `src/lib/cron/for-each-org.ts` | Per-tenant cron fan-out |
| `src/lib/sync-cursors.ts` | Incremental watermarks |

### API routes

| Path | Role |
|---|---|
| `src/app/api/integrations/[provider]/sync/route.ts` | Sync now |
| `src/app/api/integrations/nango/{session,connected}/route.ts` | Nango Connect UI |
| `src/app/api/integrations/google-drive/*` | Drive OAuth |
| `src/app/api/integrations/nextiva/*` | Voice webhooks + health |
| `src/app/api/admin/integrations/{upsert,delete,list}/route.ts` | Vault CRUD |
| `src/app/api/cron/integrations/{sync,reconcile}/route.ts` | Unified crons |
| `src/app/api/ebay/{connect,callback,accounts,health,sync}/route.ts` | eBay stack |
| `src/app/api/amazon/oauth/*` | Amazon OAuth |
| `src/app/api/zoho/oauth/*` | Zoho OAuth |

### UI

| Path | Role |
|---|---|
| `src/app/settings/integrations/page.tsx` | Server-rendered catalog |
| `src/app/settings/integrations/IntegrationCard.tsx` | Per-provider actions |
| `src/app/settings/integrations/ResultBanner.tsx` | OAuth return messages |
| `src/components/unshipped/OrdersSyncPopover.tsx` | Legacy manual sync |
| `src/components/sidebar/connections-panel/*` | Admin connections panel |
| `src/components/receiving/workspace/line-edit/PlatformAccountsManager.tsx` | Catalog account CRUD |

### Studio

| Path | Role |
|---|---|
| `src/lib/stations/data-sources.ts` | 3 builtin feeds |
| `src/lib/stations/actions.ts` | 4 builtin actions |
| `src/lib/stations/contract.ts` | Field kinds + binding rules |
| `src/lib/workflow/diagnostics.ts` | Gaps lens (extend for integrations) |

### Crons (`vercel.json`)

| Path | Schedule |
|---|---|
| `/api/cron/integrations/sync?providers=ebay,square` | `*/15 * * * *` |
| `/api/cron/integrations/reconcile` | `0 4 * * *` |
| `/api/cron/ebay/refresh-tokens` | `0 */6 * * *` |
| `/api/cron/amazon/orders-sync` | dedicated |
| `/api/cron/zoho/*` | 5 routes |
| `/api/cron/google-sheets/transfer-orders` | dedicated |

---

## Appendix B — `maxIntegrations` by plan

From `src/lib/billing/plans.ts`:

| Plan | Max integrations |
|---|---|
| trial | 2 |
| starter | 3 |
| growth | 8 |
| pro | 0 (unlimited) |
| enterprise | 0 (unlimited) |

**Note:** Counting must include marketplace **accounts** (scoped vault rows), not just
distinct provider keys — otherwise eBay multi-store bypasses limits.

---

*Last deep-scan: 2026-07-01 against `main` working tree. Re-verify provider matrix
before each phase kickoff — concurrent WIP moves quickly in this repo.*
