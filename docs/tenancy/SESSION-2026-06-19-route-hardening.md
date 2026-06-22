# Tenancy route hardening — session record (2026-06-19)

Goal of the session: drive the codebase toward **production-ready SaaS multi-tenancy**.
This is the Phase C (route burn-down) slice plus an authoritative triage of the critical/high
route surface. It supersedes the stale leak list in `_analysis/routes.md` (dated 2026-06-13).

## Headline

- **Baseline:** tsc clean, `tenancy:guard` green, **0 tables FORCEd** (RLS still inert under the
  `neondb_owner` BYPASSRLS role — the E1 keystone is unchanged).
- **The audit heuristic is noisy.** Of **59** critical/high routes, deep + adversarially-verified
  classification found only **6 real cross-tenant leaks (~10%)**. The other 53 are false positives
  (no DB access / global-only tables), already-safe (helper-scoped), or `needs_special` patterns
  (auth primitives, webhooks, crons) that must NOT be naively GUC-wrapped.
- **All real leaks fixed and tsc-verified this session EXCEPT the Zoho receiving-sync cluster**
  (`work-orders`, `manual-server/assign`, `receiving/touch-scan`, `shipping/track/register`,
  `bose-models` — the last now fully closed incl. the per-org UNIQUE migration). The remaining Zoho
  cluster is documented below with an exact fix plan; it is not exploitable until a 2nd tenant
  connects Zoho, which is itself blocked on per-org Zoho credentials (and its files are under active
  concurrent edit — do it as one focused slice).
- **Objective movement:** critical routes **30 → 25**; GUC-wrapped **242 → 244**; guard still green.

## Real leaks — status

| Route | Table(s) | Status | Fix |
|---|---|---|---|
| `/api/work-orders` | orders, work_assignments, fba_shipments, receiving | ✅ **fixed** | `getOrders`+all fetchers + `upsertAssignment` threaded org; PATCH wrapped in `withTenantTransaction` with a parent-ownership **404** gate; all reads via `tenantQuery`. |
| `/api/receiving/touch-scan` | receiving, receiving_scans | ✅ **fixed** | Ownership `SELECT` org-scoped via `tenantQuery` → cross-tenant `receivingId` 404s, gating the `recordReceivingScan` write. |
| `/api/manual-server/assign` | product_manuals | ✅ **fixed** | Route threads `ctx.organizationId`; `getProductManualByRelativePath`/`upsert`/`update` helpers gained explicit `($n::uuid IS NULL OR organization_id = $n)` predicates + INSERT org stamp (back-compat for legacy callers). |
| `/api/shipping/track/register` | orders, sku_stock_ledger (+STN global) | ✅ **fixed** | Threaded `ctx.organizationId` into `registerAndSyncShipment`; the ledger emit now scopes orders/sku_stock_ledger. STN/event tables are global-by-design (untouched). |
| `/api/bose-models` | bose_models, part_compatibility | ✅ **fixed** | Route threads org; `getBoseModelList`/`getBoseModelByModelNumber` gained explicit org predicates; `upsertBoseModel` rewritten from `ON CONFLICT (model_number)` (global key → write-clobber) to an org-scoped SELECT-then-INSERT/UPDATE (timing-independent of the migration). Migration `2026-06-19_bose_models_per_org_unique.sql` drops the global `UNIQUE(model_number)` → `UNIQUE(organization_id, model_number)`. |
| `/api/zoho/purchase-orders/sync`, `/api/zoho/purchase-receives/import`, `/api/zoho/purchase-receives/sync` | receiving, receiving_lines, local_pickup_orders, local_pickup_order_items | ✅ **fixed (Wave 2, 2026-06-20)** | `zoho-receiving-sync.ts` fully org-threaded: the hardcoded `USAV_ORG_ID` stamp is gone, both import entry points run under `withTenantTransaction(orgId, …)` (tenant pool + `app.current_org` GUC), all Zoho-id existence probes + the late-line adoption are `AND organization_id = $org`, and Zoho API reads are bound via `withZohoOrg(orgId)`. Every caller threads a real org (session routes → `ctx.organizationId`; reconcile → the receiving row's `organization_id`; webhook/cron → `transitionalUsavOrgId()` seams marked `TODO(Wave 3/4)`). tsc clean, guard green. **Deferred:** the global partial-unique indexes `ux_receiving_zoho_po_matched (zoho_purchaseorder_id)` and `ux_local_pickup_orders_zoho_po (zoho_po_id)` stay global — flipping them to `(organization_id, …)` requires changing the `ON CONFLICT` inference target in the same change, a deploy-ordering hazard (the `bose_models` lesson). Do it with the per-org Zoho creds slice using the bose SELECT-then-upsert pattern. Not exploitable before then. |

### Remaining real leak — the Zoho receiving-sync cluster

All three routes delegate to `src/lib/zoho-receiving-sync.ts`, which writes tenant tables on the raw
BYPASSRLS pool and **stamps a hardcoded `USAV_ORG_ID`** (the code already flags this as "Phase-A3
debt"). A non-USAV caller holding `integrations.zoho` / `receiving.mark_received` would write into
USAV's receiving data. Exact remediation points:

- `pool.connect()` (no GUC): `importZohoPurchaseOrderToReceiving` (line ~473),
  `importZohoPurchaseReceiveToReceiving` (line ~642) → wrap in `withTenantTransaction(orgId, …)`.
- Hardcoded `USAV_ORG_ID` stamps: lines ~119, ~289, ~337, ~682 → replace with threaded `orgId`.
- Org-less existence probes/upserts keyed on global Zoho ids (`zoho_purchaseorder_id`,
  `zoho_line_item_id`, `zoho_purchase_receive_id`) → add `AND organization_id = $org`.
- Thread an `orgId` param: route handlers → `syncZohoPurchaseOrdersToReceiving` →
  `importZohoPurchaseOrderToReceiving` → `syncPurchaseOrderLines` / `syncLocalPickupOrder` /
  `importZohoPurchaseReceiveToReceiving`.

**Not exploitable yet:** multi-tenant Zoho also requires per-org Zoho credentials in
`organization_integrations` (Phase D blocker per `_analysis/cron.md`). Do this as one focused slice
together with the per-org Zoho creds work.

## Full triage ledger (40 of 59 routes; the other 19 are crons → all Phase D2)

Verdicts are deep-read + (for real_leak) adversarially verified. `needs_special` = a non-session
pattern that must be handled in its own wave, NOT a naive GUC wrap.

| route | verdict | pattern | conf | tables |
|---|---|---|---|---|
| `/api/receiving/nas-archive-test` | **already_safe** | session | high | organizations |
| `/api/webhooks/ups` | **already_safe** | webhook | high | shipping_tracking_numbers; shipment_tracking_events; orders; sku_stock_ledger |
| `/api/ai/search` | **false_positive** | other | high | — |
| `/api/desktop-app/release` | **false_positive** | public_static | high | — |
| `/api/ecwid/products/search` | **false_positive** | other | high | — |
| `/api/manual-server/by-item` | **false_positive** | other | high | — |
| `/api/manual-server/unassigned` | **false_positive** | other | high | — |
| `/api/nas-dev/[[...path]]` | **false_positive** | public_static | high | — |
| `/api/orders/skip` | **false_positive** | session | high | — |
| `/api/orders/start` | **false_positive** | other | high | — |
| `/api/receiving/disposition-suggest` | **false_positive** | other | high | — |
| `/api/receiving/zendesk-claim/classify` | **false_positive** | other | high | — |
| `/api/repair/ecwid-categories` | **false_positive** | other | high | — |
| `/api/repair/ecwid-products` | **false_positive** | other | high | — |
| `/api/support/overview` | **false_positive** | other | high | — |
| `/api/vision-config` | **false_positive** | public_static | high | — |
| `/api/zoho/oauth/authorize` | **false_positive** | other | high | — |
| `/api/auth/enroll/[token]` | **needs_special** | auth_primitive | high | staff; staff_enrollments; staff_sessions |
| `/api/auth/passkey/authenticate/begin` | **needs_special** | auth_primitive | high | staff_passkeys |
| `/api/auth/passkey/authenticate/finish` | **needs_special** | auth_primitive | high | staff_passkeys; staff; staff_sessions; shifts; time_punches |
| `/api/auth/passkey/register/begin` | **needs_special** | auth_primitive | high | staff; staff_passkeys; staff_enrollments; staff_sessions |
| `/api/auth/passkey/register/finish` | **needs_special** | auth_primitive | high | staff_passkeys; auth_audit |
| `/api/auth/pin` | **needs_special** | auth_primitive | high | staff |
| `/api/auth/pin/create` | **needs_special** | auth_primitive | high | staff; staff_sessions; auth_audit |
| `/api/auth/signin` | **needs_special** | auth_primitive | high | staff; shifts; time_punches; staff_sessions; auth_audit |
| `/api/auth/signout` | **needs_special** | auth_primitive | high | staff_sessions; time_punches; payroll_settings; auth_audit |
| `/api/auth/signup` | **needs_special** | auth_primitive | high | organizations; staff; staff_roles; roles |
| `/api/auth/staff-picker` | **needs_special** | auth_primitive | high | staff; organizations |
| `/api/auth/step-up` | **needs_special** | auth_primitive | high | staff; staff_stepups; staff_passkeys; staff_sessions; auth_audit |
| `/api/auth/switch` | **needs_special** | auth_primitive | high | staff; staff_sessions; auth_audit |
| `/api/receiving-lines/incoming/zoho-refresh` | **needs_special** | session | high | receiving_lines; receiving; local_pickup_orders; local_pickup_order_items; zoho_po_mirror |
| `/api/webhooks/square` | **needs_special** | webhook | high | square_transactions |
| `/api/zoho/purchase-receives/sync` | **needs_special** | session | high | receiving; receiving_lines; local_pickup_orders; local_pickup_order_items |
| `/api/zoho/webhooks` | **needs_special** | webhook | high | zoho_webhook_events; receiving_lines; receiving; local_pickup_orders; local_pickup_order_items |
| `/api/bose-models` | **real_leak** | session | high | bose_models; part_compatibility |
| `/api/manual-server/assign` | **real_leak** | session | high | product_manuals |
| `/api/receiving/touch-scan` | **real_leak** | session | high | receiving; receiving_scans |
| `/api/shipping/track/register` | **real_leak** | session | medium | sku_stock_ledger; orders; shipping_tracking_numbers; shipment_tracking_events |
| `/api/zoho/purchase-orders/sync` | **real_leak** | session | high | receiving_lines; receiving; local_pickup_orders; local_pickup_order_items |
| `/api/zoho/purchase-receives/import` | **real_leak** | session | high | receiving_lines |

## `needs_special` buckets (handle by pattern, not by GUC-wrap)

- **Auth primitives** (`auth/signin|pin|pin/create|passkey/*|switch|signout|step-up|enroll|signup|staff-picker`):
  pre-org by construction — the credential (PIN/passkey/token/session) resolves a `staff` row, and
  org is derived from it. Not freely reachable cross-tenant (an attacker needs another org's secret).
  Fix = resolve org **from the credential**, then run the post-resolution `staff`/`staff_sessions`/
  `shifts`/`time_punches` writes under `withTenantConnection(derivedOrg)` + add a documented
  guard allowlist entry. Several helpers (`enrollment.ts`, `pin.ts`) already ship the org-gated branch.
- **Webhooks** (`webhooks/square`, `zoho/webhooks`): no session; resolve org from the integration
  account / external id, then `withTenantConnection`. `webhooks/ups` is **already_safe** (STN-only,
  global by design).
  - **`zoho/webhooks` — DONE (Wave 3, 2026-06-20).** Production multi-tenant pattern (Stripe-Connect
    style): per-tenant URL `/api/zoho/webhooks/{token}` where `token` → org via the unique
    `organization_integrations.webhook_token` index, authenticated by that org's OWN HMAC secret
    (encrypted in the integration payload). `resolveOrgFromWebhook` (`src/lib/zoho/webhooks/resolve-org.ts`)
    resolves org+secret BEFORE body parse; `assertEventFromOrgZohoAccount` cross-checks the envelope
    Zoho org id post-verify; the dedupe ledger is now keyed `(organization_id, event_id)` (org-scoped,
    replay-safe). Shared pipeline `process.ts` is called by both the `{token}` route and the legacy
    tokenless route (global env secret → transitional USAV, retired once USAV moves to a token URL).
    Token+secret minted in the Zoho OAuth callback. Migration `2026-06-20_zoho_webhook_org_resolution.sql`
    (additive, idempotent, UNAPPLIED — apply before deploy). tsc clean; unit tests in
    `verify.test.ts` (incl. the cross-tenant-secret rejection). The `audit-route-auth` exemption now
    covers `/api/zoho/webhooks` (HMAC + token-resolved org).
- **Crons (Phase D2) — primitives built + Zoho slice DONE (Wave 4, 2026-06-20).** See the Wave 4
  section below for the playbook + remaining-cron checklist.

## Wave 4 (2026-06-20) — cron fan-out + distributed locking

**Two reusable primitives added:**
- **`withCronLock(jobName, fn)`** (`src/lib/cron/lock.ts`) — Postgres SESSION advisory lock
  (`pg_try_advisory_lock(hashtext(jobName))`) on the privileged owner pool. Overlapping invocations
  (Vercel retry / slow run overlapping next tick / manual trigger) **skip** (`ran:false`) instead of
  double-processing; auto-released on disconnect so a crash can't wedge it. No Redis/Redlock needed.
- **`forEachOrgWithProvider(provider, fn, opts)`** (`src/lib/cron/for-each-org.ts`) — fans out only
  over orgs that connected `provider` (vault row, or `ebay_accounts`/`amazon_accounts` for those two).
  Unlike `forEachActiveOrg` it does NOT open a wrapping tenant transaction (integration syncs do many
  short per-unit transactions; an org-long txn would idle-in-transaction for up to maxDuration) — `fn`
  receives only `orgId` and self-scopes via `withTenantTransaction`/`withZohoOrg`.
  **`opts.includeUsavTransitional`**: USAV's Zoho creds still come from env (no vault row), so without
  this it would silently drop out of the provider sweep and its sync would STOP. Retire once USAV's
  creds are migrated into the vault.

**Converted:**
- `zoho/incoming-po-sync` — **fully converted**: `withCronLock` + `forEachOrgWithProvider('zoho', …,
  {includeUsavTransitional:true})`, per-org summaries aggregated, `orgs_swept`/`orgs_failed` reported,
  `skipped:'locked'` short-circuit. Its sync fn (`syncZohoPurchaseOrdersToReceiving`) was made
  org-aware in Wave 2, so this is end-to-end multi-tenant.
- `zoho/po-sync`, `zoho/fulfillment-sync` — **NOW FULLY CONVERTED (2026-06-20, follow-up done).**
  `syncZohoPoMirror(opts, orgId)` and `syncShippedOrdersToZoho({…, orgId})` are org-threaded:
  per-org Zoho creds via `withZohoCredential`, org-stamped + GUC-scoped writes (`tenantQuery`),
  org-scoped reads (`reconcileZohoReceivedLines(orgId)`, the po-sync email-worklist auto-resolve, and
  `findShippedOrdersForFulfillment({orgId})`). Both crons now `withCronLock` +
  `forEachOrgWithProvider('zoho', …, {includeUsavTransitional:true})`, aggregate per-org, report
  `orgs_swept`/`orgs_failed`. The Zoho integration is multi-tenant end-to-end (inbound + outbound).
  Callers `incoming/sync-one` + `incoming/zoho-refresh` thread `ctx.organizationId`. tsc clean;
  `fulfillment-sync.test.ts` 7/7.

**Conversion playbook for the remaining crons** (apply per cron):
1. Wrap the whole work unit in `withCronLock('<job>', …)`; return `skipped:'locked'` when `!ran`.
2. If the job touches an integration: ensure its sync fn takes `orgId` (thread it Wave-2 style if not),
   then replace the single call with `forEachOrgWithProvider('<provider>', orgId => syncFn(orgId, …),
   {includeUsavTransitional: <true while that provider uses env creds>})`; aggregate per-org results.
3. If the job touches tenant DATA but no external provider (sweeps a table for all tenants): use
   `forEachActiveOrg((orgId, client) => …)` (client-based, wrapped txn).
4. If the job is global/system (no tenant data, single global resource): lock only — no fan-out.

**Remaining-cron checklist** (verify each against the playbook; not yet converted):
- Already fan out: `stock-alerts`, `inventory/drift-check`, `integrations/sync`, `integrations/reconcile`
  (add `withCronLock` for overlap protection).
- Provider crons needing per-org fan-out: `amazon/orders-sync`, `ebay/refresh-tokens`,
  `google-sheets/transfer-orders`, `replenishment/sync`, `replenishment-detect`, `sourcing/{scan,scour,
  replenish}`, `shipping/{sync-due,reconcile-delivered,metrics,subscribe-ups,subscribe-fedex,subscribe-usps}`,
  `receiving/incoming-tracking-sync`, `zoho/{po-sync,fulfillment-sync}` (finish per-org), `zoho/orders-ingest-drain`
  (row already carries its own org → drain per-row org, lock + per-row `withTenantTransaction`).
- `reconcile-unmatched` cron: `reconcileUnmatchedReceiving` is already org-aware (reads the row's
  `organization_id`, Wave 2) — just add `withCronLock`.
- Global/system (lock-only): `cleanup`, `refresh-reports`, `workflow-node-stats`, `staff-goals/history`,
  `photos/{analyze,nas-mirror}`, `sku-catalog/refresh-suggestions` (confirm not per-org).

## Wave 5 (2026-06-20) — credential-scoped auth primitives + allowlist

Adds the SERVICE-layer credential authorization that pairs with the existing ROUTE-layer
`withAuth({permission})`: the route checks the staff may invoke the feature; this checks the
*credential* may perform the *operation*. Both must pass.

- **Operation allowlist** (`src/lib/integrations/credential-allowlist.ts`): per-provider set of
  permitted `"<resource>.<verb>"` operations, **deny-by-default**. A credential is authorized only for
  its provider's declared operations even if the OAuth token has broader scope — and new code can't
  call a provider operation that wasn't deliberately added here. Zoho's set covers the inbound
  (`purchaseorders.read`, `purchasereceives.read`, `organizations.read`) and outbound fulfillment
  (`salesorders.*`, `packages.write`, `shipments.write`, `invoices.write`) operations.
- **`requireCredentialPermission(provider, op)`** + **`withCredentialScope({orgId,provider,operation,scope}, fn)`**
  (`src/lib/integrations/credential-scope.ts`): the choke point — allowlist check → require an ACTIVE
  vault credential → audit usage + touch `last_used_at` → run → flag the integration on error. Errors
  `CredentialPermissionError` (→403) / `CredentialNotConnectedError` (→409), mapped at routes via
  `credentialErrorStatus()`.
- **Audit ledger**: `integration_credential_audit` (migration `2026-06-20_integration_credential_audit.sql`,
  additive/idempotent/UNAPPLIED). Writes are best-effort (swallow a missing table) and the common
  'allowed' path is throttled per (org,provider,scope,operation) via an in-memory 5-min window so a
  high-frequency sync doesn't amplify writes; denials/errors are always recorded.
- **Zoho wiring**: `withZohoCredential(orgId, operation, fn)` (`src/lib/zoho/with-zoho-credential.ts`)
  = `withCredentialScope` + `withZohoOrg`. The Wave-2 `withZohoOrg` calls in `zoho-receiving-sync.ts`
  (list POs, get PO, get PR) now run through it. The credential SIDE is already prod-ready
  (`loadZohoCredentials(orgId)` reads the per-org vault w/ USAV-env fallback).
- **Remaining**: bring the still-global Zoho paths (`po-mirror-sync.ts`, `fulfillment-sync.ts`) under
  `withZohoCredential` as they get org-threaded (same TODO as Wave 4); declare operation sets for
  ebay/amazon/etc. as their service code adopts `withCredentialScope`.
- tsc: my Wave 5 files are clean; unit tests `credential-allowlist.test.ts` (deny-by-default + the
  CredentialPermissionError throw).

## Wave 6 (2026-06-20) — org_id on the final 7 Phase-B tables

Resolves the 7 `tenant-owned-NEEDS-COL` tables that `2026-06-14_org_id_phase_b_needs_col_2.sql`
deliberately deferred pending product decisions. Decisions + handling:

- **`hermes_insights`, `hermes_precision_scores`, `hermes_thresholds`** → PER-TENANT;
  **`hermes_outcomes`** → CHILD (org derived from `hermes_insights` via `insight_id`);
  **`google_photos_albums`, `google_photos_settings`** → PER-TENANT. Migration
  `2026-06-20_org_id_phase_b_final_six.sql` — additive-NULLABLE column + USAV backfill (parent-derived
  for outcomes) + GUC default + FK + index + ARMED (non-FORCE) policy + `hermes_agent_read` bypass. No
  PK/NOT-NULL change ON PURPOSE: the `hermes_*` tables are written by the EXTERNAL Hermes service
  (sibling repo owns their SoT) which won't stamp org yet — changing their PKs would break its writers.
  Follow-up before FORCE: thread org through the Hermes writer + SET NOT NULL.
- **`api_idempotency_responses`** → PER-TENANT, and a genuine isolation bug (the cache keyed on
  `(idempotency_key, route)` globally → org B could be served org A's cached response body). Migration
  `2026-06-20_api_idempotency_org_scope.sql` adds `organization_id` (NOT NULL, USAV-backfilled) + FK +
  `(org, key, route)` index + armed policy. The fix is CODE: `src/lib/api-idempotency.ts` now
  org-FILTERS the read and STAMPS org on write (orgId required), threaded through **all ~33 caller
  routes** (`ctx.organizationId` / `gate.ctx.organizationId`; anonymous-capable routes fall back to
  USAV). The PK stays `(idempotency_key, route)` — flipping to composite would couple the writer's
  ON CONFLICT target to the migration (the bose deploy-ordering trap). The org-filtered read CLOSES the
  leak; residual is only that a cross-org key collision leaves org B's response uncached (minor
  correctness, not a leak). **Follow-up** (true per-tenant idempotency, at 2nd-tenant go-live): flip the
  PK to `(organization_id, idempotency_key, route)` AND the ON CONFLICT target atomically.

Both migrations additive/idempotent/UNAPPLIED (apply the api_idempotency one WITH the code deploy).
Full-project `tsc` is clean (0 errors). This closes Phase B schema coverage — all tenant-owned tables
now have `organization_id`.

## False positives the audit heuristic mis-flags (no action)

`ai/search` (the "messages" hit is the LLM chat array, not a table), `orders/skip` (no-op; column
removed), `orders/start`, `desktop-app/release`, `vision-config`, `support/overview`,
`ecwid/products/search`, `repair/ecwid-*`, `manual-server/by-item|unassigned` (external manual
server, not `product_manuals`), `receiving/disposition-suggest`, `receiving/zendesk-claim/classify`,
`zoho/oauth/authorize`, `nas-dev`. These query no tenant table (or only global ones). Consider
teaching `scripts/tenancy-route-audit.mjs` to down-rank routes with no `rawPool`/`drizzle` and no
DB-touching helper so they stop blocking the enforcement gate.

## What this means for "production-ready multi-tenant"

Two distinct goals, both gated on the same E1 keystone:

1. **Data safety (onboard tenant #2 without leaks)** — the load-bearing requirement. After this
   session, the known real leaks on session routes are closed except the Zoho cluster (which a 2nd
   tenant can't reach until per-org Zoho creds exist). This is the bulk of "safe to sell."
2. **FORCE enforcement (defense-in-depth)** — needs a table's *entire* route fan-in to read `low`
   in the audit (route-level GUC visibility, not just helper-scoped) **and** the E1 role flip
   (`app_tenant`, NOBYPASSRLS). 14 leaf tables are already slice-ready; hubs (`orders`,
   `sku_catalog`, `bin_contents`) need their full fan-in wrapped first.

### Next actions (priority order)

1. **Zoho sync slice** — fix `zoho-receiving-sync.ts` (above) + land per-org Zoho creds. Closes the
   last real session-route leak.
2. **bose_models per-org UNIQUE** migration + flip the upsert `ON CONFLICT` target.
3. **Auth-primitive wave** — credential-derived org + guard allowlist for the 11 auth routes.
4. **Phase D2 crons** — convert the non-blocked crons to `forEachActiveOrg`; track the creds-blocked ones.
5. **Phase B** — resolve the 7 deferred NEEDS-COL tables (`hermes_*` likely global AI infra →
   classify system/reference; `google_photos_*` + `api_idempotency_responses` → product decision).
6. **E1 keystone** — apply `2026-06-21_app_tenant_role.sql.template`, two-pool wiring, redeploy, run
   the cross-org canary; then `enforce_tenant_isolation()` the best-covered tables first.

## STATE CHANGE (2026-06-20): receiving-core FORCE applied to main

Mid-session, `enforce_tenant_isolation_receiving_core.sql` was applied to main (guard B went from
**0 → 5 FORCEd tables**: `receiving`, `receiving_lines`, `receiving_scans`, `receiving_shipments`,
`receiving_line_views`). Per the `receiving-tenant-hardening` record this was intentional and verified
working via the **non-bypass `app_tenant` role** (GUC-set inside a txn → tenant rows isolated;
GUC=USAV → full baseline counts).

`tenancy:guard:check` now reports a violation — but note **the guard's B-check connects via the owner
`DATABASE_URL` (`neondb_owner`, BYPASSRLS)**, so it is correctly flagging that *the owner pool* bypasses
RLS. Real business traffic routes through `tenantPool` (`app_tenant`), where FORCE is active. So this
is the expected dual-pool nuance, not a regression: owner pool = global/admin work (bypasses by
design), tenant pool = enforced. If the red guard blocks CI, either point the guard at the tenant role
or treat B as informational. Wave 2/3 writers are GUC-wrapped + org-stamped, so they behave correctly
under the tenant role.

## Pre-flight verification of the staged `enforce_tenant_isolation_receiving_core.sql` (2026-06-19)

Independent read-only check of the concurrently-staged receiving-core FORCE migration (forces
`receiving`, `receiving_lines`, `receiving_scans`, `receiving_shipments`, `receiving_line_views`).
Under the owner role the only effect that bites is the **loud-fail `organization_id` default**, so the
risk is an INSERT writer that doesn't stamp org. Result: **safe to apply.**

- All 5 tables: `organization_id NOT NULL` = true (loud-fail default is a backstop, not a data risk).
- An independent `INSERT INTO <table>` scan found **exactly** the writers the migration header audited
  — no missed writer. The dynamic-column writers (`lookup-po`, `receiving-entry`,
  `add-unmatched-line`, `sourcing-queries`) all reference `organization_id` (stamp, not default-reliant).
- Residual (standard, E1-gated): reads/updates to these tables only break under `app_tenant`, gated by
  `tenancy:guard` once coverage shows them `rls_forced`. Confirm guard green after applying.

## E1 is code-ready; the keystone is human-owned

`src/lib/db.ts` already wires the incremental two-pool split (`tenantPool` → `app_tenant` via
`TENANT_APP_DATABASE_URL`; default `pool` stays owner). The full cutover is documented in
**`docs/tier0-go-live-runbook.md` Part B** (create role → canary → set env → redeploy → enforce per
table → rollback). The remaining steps — provisioning the `app_tenant` DB role, the env change, the
redeploy, and applying the FORCE migrations — are consequential production operations that must be
performed by a human, not autonomously. They are the actual gate to "enforcing".

Audit regenerate: `npm run tenancy:audit`. Guard: `npm run tenancy:guard:check`.
