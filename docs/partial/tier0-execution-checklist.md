# Tier 0 — Sellable-Foundation Execution Checklist

> **SUPERSEDED meta-tracker (82%). Status verified 2026-06-28.**
> **SUPERSEDED — frozen at 2026-06-14c; trust migrations/code over these checkboxes; see `docs/tier0-go-live-runbook.md`.** The codebase advanced far past this list: `app_tenant` role exists + RLS genuinely enforces; many enforce-cohorts and composite-key EXPAND migrations are live through 2026-06-28.

Living tracker for reaching a **tenant-safe + billable v1** (the confirmed steering goal, 2026-06-13). Legend: `[x]` done · `[~]` partial · `[ ]` not started · **[you]** = owner manual step (Neon / Vercel / Stripe / a decision); everything else is code.

Companion docs: `docs/saas-commercialization-plan.md`, `docs/tenancy/multi-tenancy-execution-plan.md` (the RLS spine), `docs/phase-1-rls-plan.md` (superseded role decision).

---

## #1 — Stripe go-live (can charge)
- [x] Live subscription catalog exists (acct_1QgG6jLvhV85DRvt) — verified via MCP.
- [x] Webhook route deployed (`/api/billing/webhook` → 400 INVALID_SIGNATURE on prod).
- [x] Code: `Stripe-Version` pin + `current_period` fallback; webhook idempotency gate; removed no-JS `<form>` wrapper.
- [x] Idempotent `scripts/stripe/setup-webhook-and-portal.mjs` (creates webhook endpoint + portal config); test-validated.
- [ ] **[you]** Run `STRIPE_SECRET_KEY=sk_live_… node scripts/stripe/setup-webhook-and-portal.mjs --live` (capture the `whsec_…`).
- [ ] **[you]** Vercel Production env: `STRIPE_WEBHOOK_SECRET`, confirm `sk_live`/`pk_live` keys + the 3 live `STRIPE_PRICE_*` (`…LvhV85DRvt…`, not the test `…Q2odN2RRiM…`); redeploy.
- [ ] **[you]** Smoke-test: checkout → webhook mirrors `billing_subscriptions` → `organizations.plan` flips → portal cancel.
- [ ] (defer) `invoice.payment_failed` dunning.

## #3 — Ably realtime isolation (~95% built)
- [x] Channels org-namespaced; token endpoint; ~75 publishers + subscriber hooks migrated.
- [x] Fixed the 2 missed subscribers (OperationsDashboard, StudioShell→now StudioWorkspaceContext) + org-scoped `getPrimaryTechStaffIds`.
- [~] Re-verify the `item_workflow_state` channel in `StudioWorkspaceContext` is org-namespaced (Studio refactor may have reset it).
- [ ] Ship the whole Ably set as ONE coordinated commit+deploy (all uncommitted).
- [ ] **[you]** Update the external `realtime-db` emitter to send `organization_id` as `orgId` (else `db.row.changed` 400s post-deploy).
- [ ] (defer to tenant #2) session-less transitional-org publishers + Square webhook org-resolution + fail-closed sig.

## #2 — Logical-RLS tenant isolation (exec-plan A→B→C+D→E1→E2→E4)
### Done
- [x] Phase A: guardrails, generators, ESLint ban, CI guard, cross-org harness.
- [x] Foundation: `withTenantConnection` hardened (tx + `SET LOCAL`, GUC auto-clears); `withTenantTransaction` delegates.
- [x] `withTenantDrizzle` (`src/lib/drizzle/tenant-db.ts`) — C5 unblocker.
- [x] `forEachActiveOrg` (`src/lib/cron/for-each-org.ts`) — D2 unblocker.
- [x] Table migrated: **`reason_codes`** (helpers required-orgId + `tenantQuery` + filter; route + `[id]`).
- [~] Table migrated: **`warranty` read path** (`claims.ts` readers + 6 read routes; `getClaim` orgId currently OPTIONAL).
- [x] Mapped next domains (warranty/repair/orders-satellite/pilot/fba) — call-sites + blockers verified.

### E1 — the keystone (gates ALL enforcement) — full steps in `docs/tier0-go-live-runbook.md`
- [x] **Two-pool wiring (code, inert until env set):** `src/lib/db.ts` exports `tenantPool` (= `TENANT_APP_DATABASE_URL` || owner); `withTenantConnection`/`tenantQuery`/`withTenantTransaction`/`withTenantDrizzle` run on it. Default `pool` stays owner — enables **incremental** per-table FORCE without a big-bang flip (raw routes keep working on ENABLE-but-not-FORCE tables; no `ADMIN_DATABASE_URL` needed).
- [x] **[you]** Create non-BYPASSRLS `app_tenant` role on Neon — **DONE 2026-06-28** (`2026-06-28_app_tenant_grants_reaffirm.sql` confirms a non-BYPASSRLS `app_tenant` role; `rolbypassrls=f`).
- [ ] **[you]** Run the `cross-org-isolation.test.ts` canary (`TENANT_APP_DATABASE_URL=<dsn>`) — proves isolation on a scratch table.
- [x] **[you]** Set `TENANT_APP_DATABASE_URL` = app_tenant DSN in prod (keep `DATABASE_URL` = owner) — **DONE 2026-06-28**: runtime connects via `TENANT_APP_DATABASE_URL`, RLS genuinely enforces.

### Phase C — route-scoping burn-down (the long pole; ~390 critical/high routes)
- [x] `warranty` write path **org-stamped (fixed a real prod bug — claim creation was 500'ing on NULL org)**: `mutations.ts` + `quotes.ts` + `linkage.ts` + `zendesk-link.ts` + `notify.ts` — every `warranty_*`/`repair_service` INSERT now stamps `organization_id` (explicit on createClaim, subquery-derive elsewhere), signature-safe. `warranty-zendesk` e2e **passes**. Remaining for warranty FORCE: move writes onto `withTenantConnection` (GUC) + per-org `clock-sweep` cron, then flip `getClaim` orgId → required.
- [x] **D3 PO-Gmail guard** done (token chokepoint). Follow-up: guard `/api/admin/po-gmail/status`/`disconnect`/`oauth-callback` (singleton-row reads/writes still unguarded).
- [x] **e2e health**: suite runs live; `realtime-token` / `crud-catalog-reasoncodes` / `po-mailbox-fetch` / `receiving-lines-endpoints` / `warranty-zendesk` all green; fixed a pre-existing reason-codes spec enum bug + a warranty-spec teardown race.
- [~] `fba` — **DONE (request paths, tsc-green):** 6 helpers + 5 route groups (~35 routes) + `fetchFbaContext` org-threaded; fixed a real cross-tenant `fnsku`-join leak. Remaining for fba enforce-readiness: tech/* scan routes + cross-domain readers (`work-orders`/`global-search`/`packing-logs`/`sync-sheets`) + `link-unit` serial_units scoping. **Before E2 on `fba_fnskus`: add a composite `(organization_id, fnsku)` PK/unique (it's bare-global `fnsku` today) + flip its `ON CONFLICT` — else cross-org INSERTs throw under FORCE.**
- [~] `sku_catalog` — **core CRUD + graph DONE (tsc-clean)**: `sku-catalog-queries.ts` row/platform helpers → backward-compatible optional-`orgId` (session-less Zoho/sync callers untouched); routes `route`/`[id]`/`search`/`resolve`/`[id]/similar`/`[id]/platform-ids` + graph `children`/`parents`/`tree`/`relationships`/`relationships/[id]` threaded. Fixed `createRelationship` NULL-org **write bug** + closed graph-read cross-org vectors (`sku-relationship-queries.ts` traversal org-scoped). Deferred: pairing/ecwid-sync routes (entangled w/ active sync), `[id]/manuals` + `[id]/qc-checks` (child tables need Phase B), a within-org platform-id IDOR (non-tenancy), 2 boolean-EXISTS search imperfections (LOW). Session-less helpers (`resolveOrCreateSkuCatalogId`/`ensureSkuCatalogEntry`/`syncSkuCatalogFromItems`) need a service-org before `sku_catalog` FORCE.
- [~] `receiving` — **C4 severe leaks DONE (tsc-clean)**: `receiving-lines/route.ts` (every GET/POST/PATCH/DELETE org-scoped via tenantQuery/withTenantTransaction; sku_catalog/receiving/serial_units joins org-aligned; POST stamps org; verifier-caught `photos` ×4 + `email_delivery_signals` leaks fixed) + `receiving/match/route.ts` (withTenantTransaction + org-filtered receiving_lines/work_assignments + staff join aligned). Remaining: the other ~65 receiving routes (full sweep) + LOW follow-ups (recomputeCartonSourceLink internal explicit filters; `email_delivery_signals`/child tables Phase B columns). Session-less zoho-receiving-sync untouched (needs service-org for FORCE).
- [x] **`local_pickup` (walk-in) — FULLY DONE (tsc-clean, audit all-`low`):** all 10 routes GUC-safe — `local-pickup-orders` (list+POST), `[id]` (GET/PATCH/DELETE), `[id]/items`(+`[itemId]`), `complete`/`finalize`/`void`/`reopen`, and `local-pickups` (`local_pickup_items`). Reads org-filtered + GUC-wrapped; writes stamp org (POST writes were already Phase-B-stamped); `sku_catalog`/`sku_platform_ids`/`items` string joins org-aligned; added a **parent-ownership guard** on the `local-pickups` upsert/delete (receiving_id was an IDOR vector). Tables `local_pickup_orders`/`local_pickup_order_items`/`local_pickup_items` now all-`low` → FORCE-ready after E1 (lone non-`low` toucher is `/api/receiving/[id]`, part of the receiving sweep).
- [x] **`cycle_count` — FULLY DONE (tsc-clean, audit all-`low`):** all 4 API routes (`cycle-counts/campaigns`, `campaigns/[id]`, `lines/[id]`, `inventory/counts`) + both server-component pages (`/admin/inventory/cycle-counts` + `[id]`: page reads switched to `tenantQuery`, server actions resolve org via `getCurrentUser()`) + the (previously unused-by-routes) `src/lib/inventory/cycle-count.ts` module (5 fns now require `organizationId`, on `withTenantTransaction`). `bin_contents`/`sku_stock`/`sku_stock_ledger` writes org-stamped; `sku_stock` string join aligned. Remaining for `cycle_count_*` FORCE: nothing in-domain; the `lines/[id]` route still delegates the variance write to the shared `adjustBinQty`/`recordInventoryEvent` helpers — those are tracked under the `bin_contents`/`inventory_events` enforcement gates, not cycle_count's.
- [x] **Parallel sweep 2026-06-14 (9 cold domains, workflow `tier0-tenant-sweep.js`, 33 agents):** GUC plumbing added to the request paths of **locations**, **staff-messages**, **suppliers-sourcing**, **stock-alerts**, **staff-scheduling**, **rma**, **workflows-engine**, **catalog-types-platforms**, **square**. Disjoint-fileset partition (union-find) held — no overstep into the user's hot files; tsc clean (fixed a `<StaffGoal>` generic regression). Adversarial verifiers ran per domain (6 issues / 3 pass) — findings triaged below. **Audit-metric caveat:** the route audit detects GUC by scanning the *route file*, so helper-pattern migrations (locations/catalog/suppliers/scheduling put the GUC in `*-queries.ts`) show as still-⛔ even though they ARE GUC-safe via the helper — the reverse-index UNDERSTATES this sweep. Verified the shared modules genuinely use `tenantQuery` + optional/required-org.
  - **REAL residuals the verifiers caught (NEEDS-COL — GUC wrap is RLS-ready plumbing, NOT isolation yet):** `suppliers`, `square_transactions`, `warehouses` have no org column; `sourcing_candidates/alerts/searches` (SKU-less rows) + `rma_authorizations` (order-less rows) have parent-scoping gaps. **Fix written:** `src/lib/migrations/2026-06-14_org_id_phase_b_needs_col.sql` (NULLABLE column variant — session-less writers not yet threaded; see file header for the NOT-NULL + writer-threading + explicit-filter follow-ups per table).
  - **Deferred (stoppedFiles, out-of-fileset):** session-less crons/jobs (square webhook, sourcing-scan/scour-watch/replenishment-watch, staff-goal-history-snapshot, dashboard/operations) — need org threading before their tables FORCE.
  - **Pre-existing (flagged, not from sweep):** `api_idempotency_responses` keyed without org; `locations` PATCH/swap trust body-supplied `staffId` (auth pattern, broader than tenancy).
- [x] **Parallel sweep ROUND 2 2026-06-14b (5 more cold domains):** printer-profiles, payroll-settings, item-stock-cache, auth-audit, sku-pairing-audit — GUC-wrapped, tsc-clean. Verifiers: 3 pass, 2 issues → (a) `payroll_settings` is a GLOBAL singleton (`id=1`, no org col) — wrap is harmless but it needs a STRUCTURAL per-org migration (see below); (b) `pairing-queries.ts` `runBatchPair` `product_manuals` backfill is NEEDS-COL (no org col, string-match) + **`pairing-queries.ts` is hot-adjacent to your live pairing UI work — review its diff before committing.**
  - **8 dropped (all correct):** `pending_skus` = DEAD CODE (no callers — orphaned module); `failure_modes`/`kpi_rollups`/`mobile_scan_events`/`unit_quality`/`mobile_scan_events` = child-scoped/no-col + cross-cutting modules tangled with serial_units/state-machine/workflow-engine (hot); `part_acquisitions`/`email_delivery_signals`/`sync_cursors` = hot or cross-cutting (receiving-lines was "modified 2 seconds ago" during the run).
- [ ] **STRUCTURAL per-org migrations needed (child-scoped / global tables — a column-vs-parent-scoping DECISION, not a GUC-wrap):** `payroll_settings` (drop the `id=1` singleton → per-org row), `product_manuals` (add org col; string-match backfill leaks at tenant #2), `operations_kpi_rollups_daily/hourly`, `mobile_scan_events`, `failure_modes`, `unit_quality_scores`, `unit_failure_tags` (all child-scoped via staff/serial_units). Plus the NEEDS-COL set already covered by `2026-06-14_org_id_phase_b_needs_col.sql`.
- [x] **HOT-CORE SWEEP + Wave 2 (2026-06-14b, ~370 agents / 3 workflows):** swept the 225 critical/high leaking route files + 7 backbone modules (`tier0-hotcore-sweep.js`) → verifiers found 96 residual leaks (routes delegate to shared modules) → **Wave 2** (`tier0-wave2-sweep.js`) migrated the **51 shared query/aggregator modules** to optional-orgId + re-threaded the 35 issue units (one rate-limited batch recovered via `resumeFromRunId`) → 12 residual, of which I hand-fixed the 5 route-fixable (2 CRITICAL: `admin/staff/[id]/stations` org-blind probe + `insertTechSerialForSalContext` SAL resolver; + part-compatibility/[id], dashboard `getAllStaffGoalsWithStats` CTEs, delivered-unscanned confirmed parent-scoped). **tsc clean throughout (fixed ~17 agent-introduced generic/arg errors); guard green.**
- [x] **2nd NEEDS-COL migration written (unapplied):** `2026-06-14_org_id_phase_b_needs_col_2.sql` — 28 tables (product_manuals, part_compatibility, staff_stations, staff_goals/history, staff_todos/completions, operations_kpi_rollups_*, picking_sessions, mobile_scan_events, shipping_tracking_numbers, zoho_po_mirror, messages, shipment_tracking_events, return_dispositions, unit_failure_tags, unit_quality_scores, bose_models, failure_modes, replenishment_tasks, sku_pairing_suggestions, part_acquisitions, tracking_exceptions). Nullable variant. Excludes hermes_*/google_photos_*/api_idempotency_responses (per-org-vs-global decision needed).
- [ ] **Remaining 49 critical + 30 high — categorized, deferred-by-design:**
  - **Identity/RBAC (25) → Phase F:** `/api/auth/*` (signin/pin/passkey/enroll — establish org, can't filter by it) + `/api/admin/staff|roles/*` (CRUD should org-scope; sensitive identity layer — careful dedicated pass).
  - **Session-less sync/webhooks (10) → Phase D:** Zoho/Ecwid/Square/UPS — no session; org-from-payload or `forEachActiveOrg`/service-org.
  - **NEEDS-COL / non-tenant (14):** close once `needs_col`/`needs_col_2` apply + explicit filters land; `nas-dev` is a file proxy (false positive); orders/skip+start fixable but in the hot orders zone.
- [x] **IDENTITY LAYER + CRONS + MIGRATIONS APPLIED (2026-06-14c):**
  - **Migrations APPLIED to live DB:** `2026-06-14_org_id_phase_b_needs_col.sql` + `…needs_col_2.sql` (35 NEEDS-COL tables got a nullable `organization_id` + USAV backfill + GUC default + armed RLS; zero prod behavior change — owner pool bypasses armed RLS). Composite-PK migrations renamed `.sql.gated` (deploy-coupled — need the `ON CONFLICT` flip redeployed *with* them, else live prod upserts break). Catalog seed left for the owner.
  - **Identity/RBAC scoped (workflow, all verifier-pass):** admin staff/role CRUD routes org-scope `staff`/`staff_passkeys`/`staff_sessions`; `roles`/`staff_roles` kept GLOBAL; auth-flow sign-in/PIN/passkey logic untouched; backbone `role-store`/`enrollment`/`pin`/`mobile-display-config` made optional-org (cache-poisoning-safe). `admin staff/roles` critical category → 0.
  - **Session-less crons:** ecwid/google-sheets/shipping/square/ups threaded via `transitionalUsavOrgId` service-org + `TODO(multi-tenant)`. Zoho sync (`zoho-receiving-sync.ts`) is USAV-hardcoded (single-tenant-correct; multi-tenant needs `forEachActiveOrg` + per-org Zoho creds — 2nd-tenant design item).
  - **Hand-closed:** `failure-modes`(+[id]) + `staff-todos` (now that their columns exist + modules are optional-org).
- **SESSION DELTA 2026-06-14 (full): critical 178→29, high ~132→29, GUC-wrapped 59→242, references-org 224→484.** Remaining 29 critical = 12 auth-flow (Phase F by design) + 6 session-less Zoho sync (single-tenant-correct) + ~11 "other" (orders/skip+start in hot zone, nas-dev/nas-archive-test dev/test, AI-read routes). Class A CLEAN; Class B request paths scoped across cold + hot core + identity; **Class C owner keystones (E1 `app_tenant` role + composite-PK coordinated deploy + Stripe) still gate actual enforcement** — until E1 the armed RLS on every columned table is inert (owner pool bypasses it).

### Phase B — schema coverage (tables missing org_id)
- [~] Add `org_id` to child tables: **DONE (written, UNAPPLIED)** in `src/lib/migrations/2026-06-14_org_id_phase_b_domain_children.sql` — `handling_units`, `receiving_scans`, `receiving_shipments`, `testing_results`, `repair_actions`, `unit_repairs`, `repair_failure_resolutions`, `local_pickup_orders/items` (idempotent DO-block; USAV-default backfill = parent backfill while single-tenant; armed-not-FORCED). Apply via `npm run db:migrate` when ready. Remaining Phase B batches (tracking children, staff children, roots) per `docs/tenancy/_analysis/tables.md`.
- [ ] Drizzle `orgIdCol()` reconciliation on `order_shipment_links` / `order_unit_allocations` / `orders_exceptions` / `replenishment_order_lines`.

### Phase C5 / D — repos & cross-cutting
- [ ] Thread orgId through Drizzle-only repos via `withTenantDrizzle`: `salesOrderRepository`, `repositories/inventory/allocations.ts`.
- [ ] D2 crons → `forEachActiveOrg` + a **service-org** for: Zoho sync, eBay sync/refresh, sheets transfer, replenishment, warranty `clock-sweep` (the warranty FORCE blocker).
- [x] **D4 audit-log `organization_id` threading** — `recordAudit` auto-stamps `ctx.organizationId` (cron/transitional use `organizationIdOverride`); `createAuditLog` writes the column. Backward-compatible, no call-site changes. (`audit_logs.organization_id` was always NULL before.)
- [~] **D5 rate-limit** — `checkRateLimitForOrg({…, organizationId})` wrapper added + a production boot warning when `UPSTASH_REDIS_*` is unset (was silently failing open under autoscale). Remaining: per-route sweep to pass `scope: ctx.organizationId` (deferred — touches many active routes) + **[you]** confirm `UPSTASH_REDIS_*` in Vercel prod.
- [ ] D3 PO-Gmail singleton guard (`assertUsavMailbox` + org default on `getAccessToken`/`poGmailFetch`).

### E2 / E4 — enforce + prove
- [ ] FORCE-READY now (zero code, just need E1): `rag_documents`, `rag_document_chunks`, `shipment_orders`. Add their `enforce_tenant_isolation()` migrations once E1 lands.
- [~] Per-table E2 enforce migrations as each table's routes go all-`low` — **many cohorts APPLIED through 2026-06-28** (`enforce_tenant_isolation` leaf 1-3, receiving_core, ready_cohort, core_usav_fallback, backstop_wave6); remaining cohorts ongoing.
- [ ] E4: wire per-enforced-table cross-org specs into CI.

## Verification (codebase-wide audit, 2026-06-14)
- [x] 8-agent adversarial audit + 12-agent fix loop: gate GREEN (tsc 0, e2e 5/5, unit suites pass); **8 real cross-tenant defects found + fixed + re-verified** (warranty clock-sweep NULL-org, tech/scan fba_* scoping, fba/logs/summary serial CTE, warranty lifecycle WRITE IDOR ×13 routes, sku unpaired/pair-ecwid leaks, po-gmail disconnect/oauth-callback/status guards).
- [x] **Recommended follow-ups DONE (tsc-clean, stripe 6/6):** Stripe webhook retry-safety (`recordStripeEvent` reprocesses unhandled events via `processed_at IS NULL`, `markStripeEventProcessed` on success, 500-on-error so Stripe retries, + `2026-06-14_stripe_events_processed_at_nullable.sql` — degrades safely pre/post migration); regenerated `coverage.generated.json`; `warranty/coverage.ts` `resolveOrder` + `findExistingClaim` org-scoped.
- [~] **FORCE prerequisite (schema): EXPAND phase LIVE 2026-06-28.** The add-composite-unique EXPAND migrations for `fba_fnskus` + `sku_catalog` are applied and their `ON CONFLICT` code flips are live. **Remaining (deploy-coupled, `.gated`):** the contract-phase PK swaps (`fba_fnskus` PK → composite; `sku_catalog` → composite UNIQUE) land only AFTER the `ON CONFLICT` code is live everywhere and a redeploy ships WITH them — applying standalone breaks the upserts.

## Non-isolation foundation
- [ ] **F1** owner email identity + verification (PIN-only today).
- [ ] **F4-lite** minimal onboarding/activation (blank-dashboard problem).
- [ ] Legal baseline (ToS / privacy / DPA) + `BILLING_NOTIFICATION_DOMAIN`.
- [ ] Hygiene: commit the large uncommitted diff; decide the 4 pending migrations (`docs/pending-migrations-plan.md`).

---

## Critical path (shortest route to "safe to sell to tenant #2")
1. **[you]** Stripe live env + webhook (charge) → **[you]** E1 `app_tenant` role (enable enforcement).
2. Finish Phase C on the **hot tables** + D1 (Ably) + D2 (crons w/ service-org).
3. E2-enforce the hot tables + the FORCE-ready trio; E4 canary green.
4. Do NOT onboard tenant #2 until the hot tables are FORCE-enforced; long tail continues as CI-guarded debt.

---

## Session 2026-06-28 — completion pass
- No code changes — doc-only status reconciliation. This tracker was frozen at 2026-06-14c; the codebase advanced far past it.
- Recorded VERIFIED-DONE: the E1 keystone `app_tenant` role exists (non-BYPASSRLS, `2026-06-28_app_tenant_grants_reaffirm.sql`), runtime connects via `TENANT_APP_DATABASE_URL`, RLS genuinely enforces.
- Recorded VERIFIED-DONE: many `enforce_tenant_isolation` cohorts applied through 2026-06-28 (leaf 1-3, receiving_core, ready_cohort, core_usav_fallback, backstop_wave6).
- Recorded VERIFIED-DONE: composite-key EXPAND migrations live (`fba_fnskus` + `sku_catalog` add-composite-unique, `ON CONFLICT` flipped).

## Remaining work — handoff (2026-06-28)
- **[OWNER-GATED]** Stripe live env + webhook + smoke-test (capture `whsec_…`, set prod env, redeploy, end-to-end checkout→portal-cancel).
- **[OWNER-GATED]** Fresh-tenant-DB role creation (run the `app_tenant` role provisioning on any new tenant DB before onboarding).
- **[OWNER-GATED]** Vercel `UPSTASH_REDIS_*` confirmed in prod, and update the external `realtime-db` emitter to send `organization_id` as `orgId` — required BEFORE the Ably set deploys (else `db.row.changed` 400s).
- **[MIGRATION-DEPLOY-COUPLED]** The `.gated` contract-phase PK swaps (`fba_fnskus` PK → composite; `sku_catalog` → composite UNIQUE) apply ONLY after `ON CONFLICT` code is live everywhere + a redeploy ships WITH them.
- **[MIGRATION-DEPLOY-COUPLED]** Ongoing E2 `enforce_tenant_isolation` cohorts as remaining tables' routes go all-`low`.
- **[DEFERRED-BY-DESIGN]** D2 per-org crons via a service-org (Zoho/eBay/sheets/replenishment/warranty clock-sweep).
- **[DEFERRED-BY-DESIGN]** Phase F identity/RBAC (auth-flow org-scoping, owner email identity, onboarding/activation).

> **WARNING:** do NOT onboard tenant #2 until hot-table FORCE + the contract-phase PK swaps are confirmed live.
