# TODO backlog — Wave-0 scout map (2026-07-09)

Produced by 8 parallel reconnaissance scouts (S1–S8, ~1.28M tokens, 287 tool calls, evidence-based
file:line verification against the live tree). This is the execution map for the 2026-07-09 backlog
run. **Nothing in this file is aspirational — every claim was verified in code.**

## Headline corrections (scouting contradicted the docs)

| Doc claim | Reality (evidence) |
|---|---|
| Plan 01 #1 "add an expiry check to the request path" | **Already built** — `withAuth.ts:237` returns 402 `TRIAL_EXPIRED`; `page-guard.ts:62` redirects. Only the `TRIAL_ENFORCEMENT` env flip remains (owner). |
| Plan 01 #2 "flip `PACKER_LOG_ENRICHMENT_READ=true`" | **Superseded** — flag defaults ON since 2026-07-09 (`feature-flags.ts:221-223`); env var is now a kill-switch only. |
| Mission "Redis Phase 1 in progress" | **Stale** — redis-caching-plan.md's own header: Phases 0–4 all DONE (2026-07-04). Residual: 11 legacy sync `checkRateLimit()` call sites → async org-scoped. |
| Plan 02 #5 "only 2 routes gate on plan" | **44 handlers** declare `feature:` (studio 16, walkIn 11, sourcing 9, aiChat 7, support 1). Gaps: fba + repair groups ungated; all ceilings except `maxIntegrations` unchecked. |
| Plan 02 #6a "repair-service / shipped / packerlogs unscoped" | ⅔ **fixed** — repair-service + shipped now thread `ctx.organizationId`; packerlogs DELETE is GUC-scoped. **One live leak left: packerlogs PUT** (bare integer id, no org predicate, unvalidated spread) — in an **uncommitted** file. |
| README "ops-events 8% — CHECK/`workflow_node_id`/Drizzle all missing" | **All three shipped** (migration `2026-07-06_ops_events_entity_type_chk_and_workflow_node.sql`, `schema.ts:3989`, `src/lib/ops-events.ts`, drift-pinning test). Residual: owner DB-apply + Phase-2 writer adoption. |
| README "serial-label-pairing 15%, uncommitted in-flight" | **Committed** (fcb1738c + migrations 2026-07-06a/b, `/api/label-print-jobs`, print-history route). Real ≈60%. In-flight exclusion for it is lifted; do-not-double-build still applies. |
| README "incoming-universal-POs 60%" | Plan doc (updated after README) declares **Phases 1–6 SHIPPED** (4c55d7df). Real ≈85%; residuals owner-gated (seed apply, per-org flag, eBay approval). |
| DISCOVERY.md "4 tap producers; pack/ship untapped; no lock; no recovery" | **10 producers**; listed/packed/shipped tap behind `UNIFIED_ENGINE_FULFILLMENT_TAPS`; `lock.ts` + `recover.ts` built and wired. |
| Audit F09 "ShipStation falls back to USAV on token miss" | Overstated — unknown token already fails closed; the only leak is the **env-token bootstrap branch** (`webhook.ts:47`). |
| Audit F02–F04 webhook list | **Missed UPS** — `webhooks/ups/route.ts:121` has the identical `transitionalUsavOrgId()` leak. Fix wave must include it. |
| warehouse-map "Phase 0 ✅ prototype in /design-demo" | Prototype **deleted** in cleanup; recoverable via `git show 34c52758:src/app/design-demo/_gallery/warehouse-flow-section.tsx`. Phase 1 = fresh build. |
| F01 "ESLint USAV ban advisory" | Actually **ERROR-level** with a per-file burn-down allowlist (`eslint.config.mjs:134-153`); new files already hard-blocked. |

## In-flight working tree — six clusters (S5), collision matrix

Uncommitted clusters (owner commits via GitHub Desktop; never revert/rename):
**A** packer-testing-photo-scan-timeline (bulk; flag-dark `NEXT_PUBLIC_UNIT_SCAN_PHOTOS`) ·
**B** shipped-table spine-first hydration (`/api/packerlogs/hydrate`, `NEXT_PUBLIC_SHIPPED_SPINE_FIRST`) ·
**C** order full-page card polish · **D** condition-grade lock after ship · **E** Redis creds
testability refactor (`resolveRedisRestCreds`) · **F** lookup-po SQL param cleanup.

| Uncommitted file(s) | Colliding residual | Ruling |
|---|---|---|
| `src/lib/redis/client.ts` (+ new test) | rate-limit call-site migration | LOW — don't touch client module; build on `resolveRedisRestCreds` |
| `src/app/api/packerlogs/route.ts`, `packer-logs-week.ts`, new `hydrate/` | 6a packerlogs PUT org-scope; F17 `createAuditLog`→`recordAudit` | HIGH — **additive-only, minimal-line** edits; must also cover the new hydrate endpoint |
| `StationTesting.tsx`, `useStationTestingController.ts`, `hooks/station/*` | substitution Phase 3; A1 Testing picker; pack_verified tap | HIGH — **DEFER** these sub-items; Phases 0–2 of substitution are clean (ActiveOrderWorkspace/TechRightPane untouched) |
| `src/app/api/receiving/lookup-po/route.ts` | F26 sku-join; B4 unified-inbound; polymorphic reader cutover | HIGH — defer edits to this file |
| `src/lib/photos/service.ts`, `photos/types.ts`, upload route | B2 Hermes analyze surfacing | SEVERE — defer code; env flip unaffected |
| `EventTimeline.tsx` (~L540-580), `timeline/index.ts` | new timeline adapters | LOW — additive files fine; avoid row-render body |
| `src/lib/realtime/publish.ts` | incoming-todo 4b Ably | LOW — subscriber-side only; review diff first |

## Execution queue (dependency-ordered)

### Wave 1 — Tier 0 (S)
1. `trial-gate.test.ts` (new, DB-free) — pins exempt paths, expiry predicate, flag short-circuit.
2. Migrate 11 legacy sync `checkRateLimit()` sites → `checkRateLimitForOrg`/`checkRateLimitAsync` (cross-instance).
3. Doc truth-sync: roi-execution 01/00 status corrections; README stale lines (§Headline above).
   Pre-existing gate repair (done in Wave 0): 19 tsc errors → 0, incl. live crashes in `ai/chat*` + `receiving/lines/[id]/move`.

### Wave 2a — tenancy leak closure (blocks 2b)
Ordered by blast radius (S3): ① webhook org-resolution USPS/FedEx/**UPS**/Square (fail-closed + rate-limit F28) → ② kill legacy Zoho orders webhook → ③ `currentZohoOrgId()` fail-closed → ④ strip `?? USAV_ORG_ID` from sku-stock ×3 / orders-add / orders-assign / shipped-scan-out (F06–F08) → ⑤ 9 defaulting domain fns (warranty ×3, po-gmail ×6; F61/F62) → ⑥ ShipStation env-token branch (F09) → ⑦ F17–F22 `createAuditLog`→`recordAudit` (skip packerlogs until commit) → ⑧ IDOR regression tests per fixed route → ⑨ **author** 6b DEFAULT-drop migration (8 tables; sequence AFTER webhook resolution — webhooks are the writers leaning on the DEFAULT) → ⑩ 6c: the "9 needs_col tables" are the **identity/auth cluster** — classification doc, not a naive add-column wave → ⑪ eslint allowlist burn-down + CI `usav-fallback-guard`.

### Wave 2b — revenue switch
`feature:'fba'` on FBA groups; repair gating; ceilings `maxStaff` (staff create/invite), `maxMonthlyOrders` (order ingestion), `maxWarehouses`; `assertCanConnectProvider()` on all connect paths; support-group coverage. Owner: ladder decision + `PLAN_FEATURE_ENFORCED` staged flip.

### Wave 3 — reliability
#8 receiving-lines GET decompose (now 2,536 lines) → `src/lib/receiving/lines/{query,build-sql}.ts` + DB-free tests, behavior-identical. #9 replenishment Deps tests + required orgId. #10 tap observability: thread `AdvanceOutcome` out of `tapWorkflow` → `ops_events` `workflow_tap_dropped` rows; outbox reconciler (author migration; `entity_search_outbox` worker is the template). F11–F16 `transition()` bypasses in touched paths.

### Wave 4 — ops quick wins
Substitution wiring **Phases 0–2** (policy route + hook + eligibility lib + mount in `ActiveOrderWorkspace` — clean files; **Phase 3 deferred**, collision). A2 SKU chip+edit on LineEditPanel. A3 Zendesk picker in packing. A1 staff picker (skip Testing surface). Packing-checklist Phase 2 persistence route + Phase 3 rollup. AI-chat P1 polish (copy/retry/step timeline). Incoming-todo 4a match-email route (+4b Ably, review publish.ts diff).

### Wave 5 — integrations & adjacent
ShipStation operator rates/labels/void routes + station actions (keys = owner). Studio integration diagnostics rules. org_integrations operational-columns migration + orchestrator writeback. Token refresh sweep cron. `connector.validate()` for ebay/zoho/amazon. Amazon → unified sync cron. Sourcing demand collectors + analytics mode. `ebay.open_orders` source + `ebay.sync_now` action. Admin diagnostics page. OrdersSyncPopover retirement. Ecwid connection-driven sync. Beta-intake `beta_applications` pipeline. Onboarding O0–O2.

### Wave 6 — schema arc (decision-gated; kept to plan-listed items)
ops-events Phase 2 (thread `workflowNodeId` into writers; SAL freeze/sweep). Platform-catalog Phase-6 precursor reader migration. Polymorphic Phase-2 reader cutover **minus** lookup-po (collision).

### Wave 7 — differentiation tail
Warehouse floor-plan Phase 1 (recover prototype from `34c52758`, rebuild per plan). Nango code-only enablement runbook.

## Owner runbook (external / env / DB-apply — not agent-buildable)
- **Commit the six in-flight clusters** (GitHub Desktop) — unblocks the HIGH-collision residuals.
- **Env flips** (each verified ready-to-flip by S4): `TRIAL_ENFORCEMENT=1`; `FULFILLMENT_SUBSTITUTION=1` (after `2026-06-27e` apply); `PHOTOS_ANALYZE_ENABLED` (+provider creds); `PLACEMENT_PARITY_OBSERVE` → strangle flips; `RECEIVING_UNIFIED_INBOUND` (after `2026-06-08` apply+backfill); `UNIFIED_ENGINE_*` per parity; `NEXT_PUBLIC_UNIT_SCAN_PHOTOS` / `_SHIPPED_SPINE_FIRST` (build-time, after commit). `STUDIO_ENTITLEMENT_ENFORCED` + `PLAN_FEATURE_ENFORCED` after ladder/coverage decisions.
- **DB applies**: `2026-07-06` ops-events CHECK; `2026-07-06e` incoming seed; universal-feed j–q; `2026-06-27e`; every migration authored this run (listed in the run report).
- **Credentials/external**: Upstash prod envs; ShipStation keys; eBay `buy.order.readonly`; Nextiva creds; Nango sidecar; Stripe live config; counsel review.

## Explicit deferrals (do NOT build this run)
- Anything editing the six uncommitted clusters' files beyond additive minimal lines (matrix above).
- Substitution Phase 3 scan-feedback; A1 on Testing; `pack_verified` tap — all StationTesting-coupled.
- `UNIT_SCAN_PHOTOS` mechanism reconciliation (NEXT_PUBLIC vs plan's resolveForOrg) — needs the feature committed first; flagged in plan doc instead.
- 6c naive add-column on identity/auth tables — classification decision documented, not DDL.
- DB applies of any kind; `drizzle-kit push`; env flips.
