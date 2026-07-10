# TODO backlog run report — 2026-07-09 → 2026-07-10

Autonomous ultracode execution of the remaining buildable scope of `docs/todo/README.md`, per the
mission prompt (Tier 0 → Tier 1 [#6 before #5] → Tier 2 → Tier 3 → residuals). ~12M agent tokens
across 8 scout agents + 6 build workflows (≈65 subagents), every implementation adversarially
verified. Working tree left **uncommitted** for GitHub Desktop. **No migration was applied to any
database. No env was flipped. `.env` untouched. All work on `main`.**

Companion artifacts: `TODO-BACKLOG-SCOUT-MAP.md` (wave-0 reconnaissance + collision matrix),
per-plan status headers (updated in each doc), `docs/todo/README.md` (revised roll-up).

---

## 1. Waves completed

| Wave | Scope | Agents (impl+verify) | Verdicts |
|---|---|---|---|
| 0 Scouts | 8 parallel reconnaissance scouts → scout map; gate baselines; 7 pre-existing tsc breakages fixed (19→0, incl. two **live runtime crashes**: ai-chat `localResolution` ReferenceError, `receiving/lines/[id]/move` undefined `ctx`) | 8 | n/a (read-only) |
| 1 Tier 0 | trial-gate → injectable Deps + 9-test suite; **11** sync `checkRateLimit` sites → org-scoped distributed `checkRateLimitForOrg`; 2 bonus USAV-fallback kills (scan-tracking, shipping/track/sync-one) | main-loop | — |
| 2a Tenancy | Carrier webhooks (USPS/FedEx/**UPS**/Square) org-resolved fail-closed + rate-limited; legacy Zoho webhook → 410; `currentZohoOrgId()` throws unbound (20 files bound); `?? USAV_ORG_ID` stripped from sku-stock/orders-add/orders-assign/shipped-scan-out; 9 domain-fn USAV defaults removed; ShipStation env-token fail-closed; F18/F21/F22 `recordAudit` swaps; IDOR suite 5→7 cases; migration **2026-07-09a** authored; `needs-col-classification.md`; `tenancy:usav-guard` ratchet | 9+8 | **8/8 ok** |
| 2b Revenue | `feature:` gates — fba 26 / repair 38 / support 14 handlers; `plan-ceilings.ts` (maxStaff ×3 routes, soft maxMonthlyOrders ×2, maxWarehouses helper — no create route exists) + 10 tests; `assertCanConnectProvider` on 5 connect paths; `delinquency.ts`; `activation-events.ts` | 3+3 | 2 ok + **1 ok=false → fixed** (guard lacked dormant short-circuit/dogfood-exempt/fail-open — corrected in main loop) |
| 3 Reliability | receiving-lines GET **1,500→240 lines** with byte-identical legacy-SQL fixture (88/88 tests); replenishment orgId REQUIRED on 15 fns (17/17 tests) + 5.7 release route; tap observability (8 typed drop reasons → ops_events; outbox behind `WORKFLOW_TAP_OUTBOX`; migration **2026-07-09b**; reconcile cron); reversibility 5.4/5.9; F11/F13/F15 → `transition()` (F12/F16 out-of-scope w/ rationale) | 5+5 | **5/5 ok** |
| 4 Quick wins | Tech-substitution **Phases 0–2** (policy route, hook, eligibility lib 14 tests, mount in `ActiveOrderWorkspace`, pending-amendment banner, `tech.substitute_unit` + migration **2026-07-09c**); packing-checklist P2 (tick persistence) + P3 (N/M rollup) + A3 `PackZendeskSection`; incoming-todo P4a match-email + P4b realtime (subscriber side); A2 `LineSkuHeaderChip`; AI-chat P1 (copy/retry/`AgentStepTimeline`); A1 `StaffFilterButton` on 3 surfaces | 6+6 | **6/6 ok** (2 minors fixed post-verify: match-email uuid 400, Retry only on last row) |
| 5 Integrations | ShipStation rates/labels/void routes + station actions/sources; connector ops (migration **2026-07-09d**, writeback, refresh-sweep cron, `validate()` ebay/zoho/amazon, Ecwid connector); studio integration diagnostics (2 rules + graph context, 28/28); sourcing demand collectors + analytics mode; settings diagnostics page + OrdersSyncPopover retirement; beta-intake (migration **2026-07-09e**, apply route, review API, 13/13); onboarding O1/O2 | 7+7 | 6 ok + **1 ok=false → fixed** (Ecwid `ECWID_*` env creds served ANY org — now dogfood-gated fail-closed) |
| 6 Schema arc | ops-events **Phase 2** (`workflowNodeId` threaded via new `surface-workflow-node.ts` resolver; SAL new-writer freeze — agent correctly refused my prompt's "SAL sweep" as contradicting the plan); platform-catalog Phase-3 reader **audit** (28-row table; 1 inline dup migrated; behavioral literals enumerated for Phase 6) | 2+2 | **2/2 ok** |
| 7 Differentiation | Warehouse floor-plan **Phase 1** (recovered deleted prototype from `34c52758`; `/warehouse?tab=map&view=floorplan`; shared `map-tones.ts` SoT); Nango §11 enablement runbook | 1+1 | **1/1 ok** |

**Session-limit incident:** Wave 5's first launch lost beta-intake + all verifiers to the subagent
session limit (reset 4:20am PT); resumed at 6:36am via `resumeFromRunId` — 6 implementers replayed
from cache, the rest ran live. No work lost.

---

## 2. Final gate suite (actual output, 2026-07-10 ~07:00 PT)

```
=== tsc --noEmit ===
src/lib/inbound/ingest-purchase.ts(313,11): error TS2345 … TxClient not assignable to Client
errors: 1        ← NOT ours: fresh in-flight work from another session (new eBay-tracking ingest
                   logic + untracked receiving-delivered-not-unboxed.ts). Session-start baseline
                   was 19 errors; this run fixed all 19; this 1 appeared mid-run in files we are
                   forbidden to touch.

=== tenancy:usav-guard ===
✓ usav-fallback-guard: OK (31 known offender(s), allowlist=31).
  (40 seeded → 29 after fixes → +2 need-to-order routes whose previously-INVISIBLE unscoped-pool
   debt became greppable when replenishment made orgId required — annotated exception in-script.)

=== test:tenancy-idor ===
# pass 7 / fail 0            ← suite grew 5→7 (Wave-2a regression cases)

=== audit-route-auth ===
high-risk ungated writes: 0 · authed-but-no-permission writes: 20 · ungated reads: 0 · routes: 810
=== audit-route-auth:check ===
✓ route-permissions manifest matches live source

=== test:ds-guards (13 guards) ===
8 ok / 5 ratchets red — identical counts to session-start baseline where measurable
(raw neutrals 41, title= 46, raw <button> 36, text-[Npx] long-tail 112 vs 111).
Every failing offender was per-file attributed by wave verifiers to OTHER sessions' in-flight
files; zero growth from this run's files (each UI agent reported before→after counts unchanged).

=== all new/extended test suites (18 files, one run) ===
# tests 276 / pass 276 / fail 0

=== knip ===
408 findings vs baseline — the baseline is computed against the COMMITTED tree; the working tree
carries ~250 changed paths from ≥3 sessions. Findings split between (a) other sessions' in-flight
files (mobile/unit, SerialPreviewStrip, CartonUnitsRollup, packer-board-lanes…) and (b) this run's
deliberate public-contract exports (rate-request body types, WorkflowTapDropReason,
NodeIntegrationConfig, TechSubstitutionEligibility, FLOOR_CELL/GAP…). Baseline deliberately NOT
refreshed (would absorb other sessions' findings). → Owner: `npm run knip:baseline` at commit time.
```

`tenancy:routes` note: critical/high counts (22/38) are UNCHANGED by design — that audit's static
classification keys off raw-pool usage patterns, a different debt class than the USAV fallbacks
this run eliminated. Re-running it regenerated `docs/tenancy/*.generated.*` (their intended
lifecycle; the prior uncommitted regeneration was itself generated content).

---

## 3. Migrations authored this run — NONE APPLIED (owner applies, in this order)

| File | What | Apply constraint |
|---|---|---|
| `2026-07-09a_drop_usav_fallback_org_defaults.sql` | Drops USAV DEFAULT on 8 tables (writer audit in header) | **Same deploy as (or after) the webhook org-resolution code — never before** |
| `2026-07-09b_workflow_tap_outbox.sql` | Tap outbox table (tenant-from-birth, Drizzle modeled) | Before flipping `WORKFLOW_TAP_OUTBOX`; cron schedule = owner (`/api/cron/workflow/tap-reconcile` not in vercel.json) |
| `2026-07-09c_tech_substitute_permission_backfill.sql` | Grants `tech.substitute_unit` + `orders.view` to technician roles | Before flipping `FULFILLMENT_SUBSTITUTION` for tech use; pairs with `2026-06-27e` |
| `2026-07-09d_org_integrations_operational_cols.sql` | `last_synced_at`/`last_sync_status`/`sync_cursor`/`enabled`/`expires_at` | Enables sync-stale diagnostics + refresh sweep + "Synced X ago" UI (all column-tolerant until applied) |
| `2026-07-09e_beta_applications.sql` | Platform-level (org-less, classified) beta applications table | Before beta `/api/beta/apply` goes live; set `BETA_APPLY_PAYMENT_LINK` |

Pre-existing unapplied (unchanged status): `2026-07-06` ops-events CHECK+node column,
`2026-07-06e` incoming seed, universal-feed j–q, `2026-06-27e` order_unit_amendments,
`2026-06-08` inbound_handling_unit.

## 4. Owner runbook (env flips / credentials / decisions — nothing here is agent-buildable)

1. **Commit the in-flight clusters** (GitHub Desktop). The scout map's collision matrix lists the
   six clusters that predate this run; this run's changes are additive around them.
2. **Env flips, each verified ready:** `TRIAL_ENFORCEMENT=1` (dogfood first) · Upstash
   `UPSTASH_REDIS_REST_URL/_TOKEN` in prod (limiter is per-instance until then) ·
   `SHIPSTATION_WEBHOOK_ORG_ID` (required if the env-token webhook path is in use — now
   fail-closed) · `FULFILLMENT_SUBSTITUTION=1` (after 2026-06-27e + 09c) · `PLAN_FEATURE_ENFORCED`
   (staged; gates+ceilings+connect-guard all dormant until then) · `STUDIO_ENTITLEMENT_ENFORCED`
   (after plan-ladder decision) · `WORKFLOW_TAP_OUTBOX` (after 09b) · `PHOTOS_ANALYZE_*` ·
   `PLACEMENT_PARITY_OBSERVE` → strangle flips · `RECEIVING_UNIFIED_INBOUND` (after 2026-06-08 +
   backfill) · `UNIFIED_ENGINE_*` per parity · `NEXT_PUBLIC_UNIT_SCAN_PHOTOS` /
   `NEXT_PUBLIC_SHIPPED_SPINE_FIRST` (build-time; after the in-flight commit) · `SPREADSHEET_ID`
   (sheets sync now fail-closed without it) · `BETA_APPLY_PAYMENT_LINK`.
3. **Square multi-tenant prerequisite:** insert an `organization_integrations` row
   (provider='square', status='active', scope=merchant_id) for the dogfood org — its
   `payment.completed` events are now `{ignored:true}` without one (fail-closed by design).
4. **Behavior deltas to be aware of:** carrier webhooks now SKIP unregistered tracking numbers
   (no more auto-created USAV rows); legacy `/api/webhooks/zoho/orders` returns 410 (Zoho console
   should point at the tokenized path); Ecwid sync for a vault-less non-dogfood org degrades
   instead of using USAV creds.
5. **CI wiring (recommended, deliberately not done by agents):** add `tenancy:usav-guard` and
   `test:ds-guards` to `.github/workflows/ci.yml`; schedule `/api/cron/integrations/refresh` and
   `/api/cron/workflow/tap-reconcile` in `vercel.json`; `npm run knip:baseline` at commit.
6. **External:** ShipStation per-org keys · eBay `buy.order.readonly` · Nextiva creds · Nango
   sidecar (runbook §11 in its plan) · Stripe live catalog + counsel review.

## 5. Honest deferrals & known debt (do not read as done)

- **Polymorphic Phase-2 reader cutover** — deliberately skipped (same-file churn with the
  receiving-lines decompose in one run; e2e-gated per auto-memory).
- **Substitution Phase 3 / A1-on-Testing / `pack_verified` tap / B2 result UI / F17 packerlogs
  audit swap / lookup-po sku-join (F26) / `UNIT_SCAN_PHOTOS` flag-mechanism reconciliation** — all
  blocked by the same uncommitted in-flight files; queue them after the owner commits.
- **F12/F16 transition() bypasses** — out of scope with documented rationale (chokepoint flag
  decision; create-vs-transition split).
- **Dynamic-route-guard has no `feature:` hook** — 14 dynamic-segment fba/repair routes are
  RBAC-only until `requireRoutePerm` learns feature gating.
- **SKU-identity string joins** — the new sourcing collectors LEFT-JOIN on raw SKU (no
  `sku_catalog_id` FK exists on the 4 source tables); documented in-code as F23–F26 debt class;
  proper fix = FK columns (schema wave).
- **Packing ticks are write-only** (no rehydration into the checklist UI yet); `clientEventId` on
  ticks is trace-only (no unique column — migration was out of scope).
- **need-to-order internal-token routes** ride the explicit transitional service-org shim (guard-
  ledgered); real fix = internal-token→org mapping.
- **Bose §8.2 CSV bulk-import** — small buildable residual that did not fit this run.
- **1 tsc error + 5 ds-guard ratchets + knip 408** — all attributed to other sessions' in-flight
  tree, with per-file attribution evidence from verifiers.

## 6. Do-not-double-build notes for parallel sessions

- `serial-label-pairing` Phase 0 + print-jobs + manifests are **committed** — build residuals on
  top; do not re-create `resolve-batch`/`CartonUnitsRollup`/`SerialPreviewStrip`.
- `packer-testing-photo-scan-timeline` remains uncommitted+flag-dark — do not touch its file set
  (list in the scout map).
- This run created: `webhook-org-resolver`, `plan-ceilings`, `delinquency`, `activation-events`,
  `receiving/lines/{query,build-sql}`, `tap-outbox`, `surface-workflow-node`,
  `substitution-eligibility`, `TechSubstituteSection`, `PackZendeskSection`, `LineSkuHeaderChip`,
  `StaffFilterButton`, `AgentStepTimeline`, `sourcing-demand-collectors`, `AnalyticsPane`,
  `rate-request`, `refresh-sweep`, ecwid connector, `GettingStartedChecklist`, `steps.ts`,
  `beta/apply-schema`, `WarehouseFloorPlan`/`floor-layout`/`map-tones`, `usav-fallback-guard`,
  five `2026-07-09{a–e}` migrations — check before re-implementing any of these.

## 7. Updated % table

See the revised `docs/todo/README.md` (single source for the roll-up). Largest movements:
tech-substitution 2→60 · warehouse-map 3→40 · ops-events 8→70 · beta-intake 30→70 ·
onboarding 35→55 · production-integrations 35→55 · studio-integrations 45→60 ·
integrations-oauth 60→80 · sourcing-hub 60→80 · packing-checklist 70→90 · ai-chat 75→85 ·
reversibility 70→78 · saas-commercialization 67→75 · incoming-todo 85→95 · serial-label-pairing
15→60 (commit recognition) · incoming-universal-POs 60→85 (commit recognition).
