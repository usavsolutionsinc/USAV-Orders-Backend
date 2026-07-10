# TODO — plan-doc status index

**Cross-feature SoT:**
- **Staff / 1-on-1 upgrades:** [`docs/master-connections-and-refactor/staff/INDEX.md`](../master-connections-and-refactor/staff/INDEX.md) — now-vs-change plans per person
- **Technical:** [`docs/master-connections-and-refactor/master-index-plan.md`](../master-connections-and-refactor/master-index-plan.md) — polymorphic hubs, Item Journey, adapters, DS reuse  
Hub: [`docs/master-connections-and-refactor/README.md`](../master-connections-and-refactor/README.md). Every new feature plan must update technical §7 **and** the matching staff plan when operator-visible.

Re-audited **2026-07-06** (24 parallel audit agents), then **re-verified and largely executed
2026-07-09→10** by the backlog run recorded in `TODO-BACKLOG-RUN-REPORT.md` (8 scout agents +
6 build waves, ~12M agent tokens, every wave adversarially verified). Per-doc status headers inside
each plan carry the detail and are now the freshest source; this index is the roll-up.

Percentages = rough share of the plan's scope verified implemented. "External" = remaining work
needs credentials / third-party approval / live-DB apply / counsel — not buildable from this repo.
**Migrations authored by the 2026-07-09/10 run are NOT applied** — see the run report's apply list.

## Shipped / mostly shipped (≥85%)

- `incoming-tracking-todo-plan.md` — **95%** — Phases 1–4 shipped incl. 4a receiving-scoped
  match-email + 4b realtime subscription (2026-07-10). Residual: server-side `email-signal.changed`
  publisher (blocked on in-flight `publish.ts`).
- `testing-priority-needs-test-plan.md` — **93%** — shipped and evolved past the plan
  (`priority_tier` 0–3; precedence SoT `src/lib/receiving/display/precedence.ts`). Residual:
  owner migration-state check.
- `phase-1-rls-plan.md` — **92%** — `enforce_tenant_isolation()` in **72** migration files;
  192/206 org-id tables FORCEd; two-pool split; CI canary + guard. 2026-07-09/10: USAV-fallback
  burn-down 40→29 route files + `tenancy:usav-guard` ratchet; webhooks multi-tenant fail-closed.
  Residual: tail cohort + remaining 29 ledgered fallback files.
- `packing-checklist-plan.md` — **90%** — Phases 1–3 shipped (2026-07-10: tick persistence to
  `tech_verifications`, N/M lines-packed rollup, + Zendesk-in-packing rode along). Residual:
  `block_short_ship` enforcement, template-rename migration (deferred by design).
- `bose-parts-sourcing-engine-plan.md` — **88%** — all tables/routes/crons/5-mode UI. Residual:
  §8.2 compatibility CSV bulk-import (small, buildable — not reached this run), Phase-5 polish.
- `nango-additive-integration-plan.md` — **85%** — seam + registry + routes; §11 enablement
  runbook added 2026-07-10. Residual: live enablement (external).
- `ai-chat-ux-plan.md` — **85%** — P0 + P1 shipped (2026-07-10: copy/retry/AgentStepTimeline;
  latent `localResolution` crash fixed 2026-07-09). Residual: P2 session sidebar + resume, P3.
- `platform-account-type-catalog-plan.md` — **85%** — Phases 1–5 live; Phase-3 reader AUDIT
  complete (`platform-catalog-reader-audit-2026-07-09.md`; one inline dup migrated). Residual:
  Phase 6 (behavioral literal sweep + drop migration — owner migration-state gate).
- `incoming-universal-purchase-orders-plan.md` (in `docs/`) — **85%** — Phases 1–6 SHIPPED
  (4c55d7df). Residual: seed migration apply + per-org flag + eBay approval (all owner/external).

## Majority shipped (65–80%)

- `sourcing-hub-integration-plan.md` — **80%** — 2026-07-10: demand collectors (5 sources through
  the one `createDemandAlert` writer) + analytics 6th mode. Residual: backorder collector,
  `alert_type` CHECK widening migration, sell-side items.
- `integrations-oauth-connection-plan.md` — **80%** — 2026-07-09/10 closed the 5 code gaps:
  connect-path entitlement guard, token refresh sweep cron, `validate()` for ebay/zoho/amazon,
  operational-columns migration (authored) + writeback, Ecwid connector + OrdersSyncPopover
  retirement. Residual: `reconcile()` first impls, per-provider webhooks.
- `reversibility-fixes-plan.md` — **78%** — Phases 1–4 + P5 safe subset (5.4/5.7/5.9) + F11
  transition() back-edge. Residual: P5 external side-effects (5.1/5.3/5.6/5.8 owner-gated;
  5.2/5.5 credential-gated).
- `saas-commercialization-plan.md` — **75%** — ceilings/gates/connect-guard/dunning-hook/
  activation-events shipped 2026-07-09/10 (dormant behind `PLAN_FEATURE_ENFORCED`). Residual:
  Stripe live catalog + counsel + staged flips (external/owner).
- `schema-wide-polymorphic-refactor-plan.md` — **75%** — Phase 0 contract + serial_units origin arc.
  Residual: next-tier candidates (decision-gated).
- `ops-events-station-workflow-unification-plan.md` — **70%** — Phases 0–2 CODE-COMPLETE
  (2026-07-10: `workflowNodeId` threaded via `surface-workflow-node.ts` resolver; SAL new-writer
  freeze). Residual: owner DB-apply of the 2026-07-06 migration; Phase 3 read view (unscheduled).
- `beta-intake-funnel-plan.md` — **70%** — waitlist tier + the $50 `beta_applications` pipeline
  (2026-07-10: migration authored, public apply route w/ honeypot+rate-limit+dedupe, review API).
  Residual: admin review UI; Stripe payment link + migration apply (owner).
- `nextiva-voice-support-mode-plan.md` — **65%** — Phases 1–4 built. Residual: Phase-5 hardening
  (buildable); Nextiva creds (external).

## Partial (40–60%)

- `tech-substitution-wiring-plan.md` — **60%** (was 2%) — Phases 0–2 SHIPPED 2026-07-10 (policy
  route + hook + eligibility lib 14 tests + mount in `ActiveOrderWorkspace` + post-submit
  reconciliation + pending banner; `tech.substitute_unit` + backfill migration authored).
  Residual: Phase 3 (deferred — StationTesting in-flight collision), Phases 4–5; owner applies
  `2026-06-27e` + `2026-07-09c` and flips `FULFILLMENT_SUBSTITUTION`.
- `studio-integrations-master-plan.md` — **60%** — 2026-07-10: integration diagnostics rules
  (disconnected/sync-stale) + connections context in the graph route; station actions/sources
  (shipstation.rate_shop/buy_label, ebay.sync_now/open_orders). Residual: seed-template
  `requiredIntegration` pass, BlockRenderer rate-shop sheet, remaining wiring checklist.
- `production-integrations-system-plan.md` — **55%** — 2026-07-09/10: multi-tenant webhooks +
  rate limits (F28), admin diagnostics page, operational columns + writeback, refresh sweep.
  Residual: remaining QoL/webhook phases; provider approvals (external).
- `polymorphic-tables-database-refactor-plan.md` — **55%** — line-facts + street tables + spine
  rename shipped. Residual: reader cutovers + typed-fact promotions — **deliberately deferred
  this run** (same-file churn with the receiving-lines decompose; e2e-gated per memory).
- `onboarding-foundational-plan.md` — **55%** — 2026-07-10: `/api/onboarding/stats` + plan-filtered
  step catalog + `GettingStartedChecklist`. Residual: O0 dashboard empty-states (partially blocked
  by in-flight files), O3–O4 guides/instrumentation; identity/billing deps (external).
- `warehouse-map-react-flow-plan.md` — **40%** (was 3%, regressed prototype) — Phase 1 SHIPPED
  2026-07-10 (`/warehouse?tab=map&view=floorplan`, read-only React Flow floor plan, shared
  `map-tones.ts` SoT). Residual: Phase 2 SKU trace, Phase 3 layout persistence + edit.

## Roll-ups & artifacts

- `serial-label-pairing-split-combine-plan.md` — **~60%** — Phase 0 + print-jobs ledger +
  manifests **committed** (fcb1738c; the "uncommitted in-flight" warning is obsolete). Residual
  phases build on that substrate — still do-not-double-build without checking live state.
- `packer-testing-photo-scan-timeline-plan.md` — BUILT + E2E-verified per its header; ships dark
  behind `NEXT_PUBLIC_UNIT_SCAN_PHOTOS`; **uncommitted working tree** (owner commits).
- `studio-driven-operator-surfaces-refactor-plan.md` — shipped (995d2003).
- `universal-feed-polymorphic-plan.md` — Phases 0–3 code-complete; migrations j–q apply =
  owner-gated.
- `redis-caching-plan.md` — Phases 0–4 **DONE** per its header (2026-07-04); the old "Phase 1 in
  progress" note here was stale. 2026-07-09: 11 legacy sync `checkRateLimit` sites →
  org-scoped distributed limiter.
- `saas-production-readiness-audit-2026-07-08.md` — F01–F10 closed in code 2026-07-09 (see run
  report); F11/F13/F15 routed through `transition()`; F17–F22 recordAudit swaps (F17 deferred —
  in-flight file); F28/F29/F30/F34 fixed.
- `roi-execution/` — Tier 0/1/2 status blocks updated in-doc; Tier 3 largely shipped via Wave 4.
- `TODO-BACKLOG-SCOUT-MAP.md` — the 2026-07-09 wave-0 reconnaissance map (collision matrix).
- `TODO-BACKLOG-RUN-REPORT.md` — the 2026-07-09/10 run: waves, gates (with output), owner
  runbook, migrations-to-apply, honest deferrals.
