# TODO — plan-doc status index

Re-audited **2026-07-06** against the live codebase (evidence-based: per-doc verification of the named
tables, routes, components, and flags, by 24 parallel audit agents). The prior 2026-06-28 "not yet started"
labels were badly stale — 11 major commits landed in between. Statuses below are verified, not aspirational.
Build-out of the remaining in-repo gaps started 2026-07-06; per-doc status headers inside each plan carry
the detail.

Percentages = rough share of the plan's scope verified implemented. "External" = remaining work needs
credentials / third-party approval / live-DB apply / counsel — not buildable from this repo alone.

## Shipped / mostly shipped (≥85%)

- `testing-priority-needs-test-plan.md` — **93%** — shipped end-to-end and evolved past the plan
  (boolean `is_priority` generalized to `priority_tier` 0–3; rules-as-data precedence SoT in
  `src/lib/receiving/display/precedence.ts`). Residual: minor UI nit + one migration-state check.
- `phase-1-rls-plan.md` — **90%** — `enforce_tenant_isolation()` infra + ~38 per-table migrations;
  192/206 org-id tables FORCEd; `app_tenant` two-pool split; CI canary + guard gates. Residual: tail
  cohort + `transitionalUsavOrgId` caller reduction.
- `bose-parts-sourcing-engine-plan.md` — **88%** — all 8 tables, §5 routes + extras, eBay Browse client,
  nightly scan/scour crons, `/sourcing` 5-mode UI. Residual: small UI gaps.
- `platform-account-type-catalog-plan.md` — **85%** — Phases 1–5 shipped AND live (catalog tables + RLS,
  resolver layer, `type_id` FKs applied — the "migration UNAPPLIED" note was stale). Residual: Phase 6.
- `incoming-tracking-todo-plan.md` — **85%** — row-anchored attach-tracking, `/api/receiving-lines/incoming/todo`
  worklist, EmailTriagePanel (`?incview=email`). Residual: small closures.
- `nango-additive-integration-plan.md` — **85%** — seam (`src/lib/integrations/nango.ts`), NANGO_BACKED
  registry, both additive routes shipped 2026-06-05. Residual: live enablement (external).

## Majority shipped (65–75%)

- `ai-chat-ux-plan.md` — **75%** — SSE streaming route with the plan's exact event protocol + unified
  `useAiChat`. Residual: UI polish gaps (buildable).
- `schema-wide-polymorphic-refactor-plan.md` — **75%** — Phase 0 contract ratified
  (`.claude/rules/polymorphic-tables.md`) + full serial_units `origin_*` arc (provenance table, backfill,
  dual-write, readers migrated). Residual: next-tier candidates, mostly decision-gated.
- `packing-checklist-plan.md` — **70%** — Phase 1 exceeded: order-scoped condition-gated `OrderPackChecklist`
  across desktop + mobile pack surfaces; per-org enforcement toggle. Residual: later-phase items.
- `reversibility-fixes-plan.md` — **70%** — Phases 1–4 shipped (label scan-back, warranty reversibility,
  soft-delete restores, state-machine back-edges + tests). Residual: Phase 5 integration un-sync.
- `saas-commercialization-plan.md` — **67%** — billing loop code-complete, RLS isolation live, identity
  built beyond plan (magic-link, passkeys, OIDC SSO, invitations). Residual: plan ceilings, dunning UX,
  activation instrumentation (buildable); Stripe live config + counsel review (external).
- `nextiva-voice-support-mode-plan.md` — **65%** — migrations, signature-verified webhook, voicemail CRUD,
  `/support` 3-mode switcher shipped (commit d4ed2f0b). Residual: polish (buildable); Nextiva creds (external).

## Partial (30–60%)

- `../incoming-universal-purchase-orders-plan.md` — **60%** — entire backend spine live (4 polymorphic
  tables applied, Zoho backfill, eBay purchase sync). Residual: UI surfaces + Studio integration
  (buildable); eBay `buy.order.readonly` approval (external).
- `integrations-oauth-connection-plan.md` — **60%** — connector framework, connection-driven order sync,
  vault entitlements, Zoho global-KV→per-tenant-vault migration all shipped. Residual: 5 code gaps.
- `sourcing-hub-integration-plan.md` — **60%** — the "frontend IA unstarted" line was stale: 5-mode hub UI,
  SourceAdapter `scour()` fan-in, standing searches + cron shipped. Residual: sell-side integration items.
- `polymorphic-tables-database-refactor-plan.md` — **55%** — line-facts + street tables
  (`receiving_triage`/`receiving_unbox`) + spine rename (`receiving_carton`/`receiving_line` via
  security_invoker compat views) shipped. Residual: reader cutovers + typed-fact promotions.
- `studio-integrations-master-plan.md` — **45%** — P2 Universal Incoming (~80%) + P3 ShipStation (~70%)
  live; P0 Zoho per-tenant done. Residual: Studio wiring checklist + diagnostics rules.
- `production-integrations-system-plan.md` — **35%** — P3/P4 concentrated (Universal Incoming code-complete,
  ShipStation rate/label + webhook). Residual: QoL/diagnostics/webhook phases (buildable); provider
  approvals (external).
- `onboarding-foundational-plan.md` — **35%** — typed first-run empty states + self-dismissing activation
  card shipped. Residual: checklist, guides, instrumentation (buildable); some identity/billing deps (external).
- `beta-intake-funnel-plan.md` — **30%** — lighter `beta_waitlist` tier live (public routes, proxy allowlist,
  confirmation email). Residual: the $50 refundable `beta_applications` pipeline.

## Unbuilt (<20%)

- `serial-label-pairing-split-combine-plan.md` — **15%** — ⚠️ **in-flight in a parallel session**: Phase 0
  (~80%) exists as uncommitted working-tree changes (`/api/serial-units/resolve-batch`, CartonUnitsRollup,
  SerialPreviewStrip). Do not double-build; see the plan doc + auto-memory for live state.
- `ops-events-station-workflow-unification-plan.md` — **8%** — unbuilt: `ops_events.entity_type` still
  unconstrained, no `workflow_node_id`, no Drizzle model.
- `warehouse-map-react-flow-plan.md` — **3%** — unbuilt and regressed: the Phase-0 design-demo prototype was
  removed in cleanup; `/warehouse` still renders the flat table.
- `tech-substitution-wiring-plan.md` — **2%** — unbuilt: the fulfillment substitution stack
  (`SubstituteUnitCard`/`SubstitutePanel`/route/flag) is intact but mounted nowhere except design-demo.

## Also in this directory (not part of the 2026-06-28 pending index)

- `studio-driven-operator-surfaces-refactor-plan.md` — shipped via commit 995d2003 (surface registry +
  `SurfaceRenderer` host); see doc header.
- `universal-feed-polymorphic-plan.md` (+ `universal-feed-ai-first-EXECUTION-PROMPT.md` /
  `-RUN-REPORT.md`) — Phases 0–3 code-complete; migrations j–q application state tracked in auto-memory.
- `redis-caching-plan.md` — Phase 0 substrate done (cache:v2 org keys + tags); Phase 1 in progress.
- `roi-execution/` — execution artifacts.
