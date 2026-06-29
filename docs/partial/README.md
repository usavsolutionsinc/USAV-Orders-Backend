# PARTIAL — started, work remaining

Plan docs where some phases shipped but work remained.
**Re-audited + reconciled 2026-06-28** against the live codebase (not the prose): most of these were far
more complete than the old notes claimed. Each doc now carries a verified status banner, a
`Session 2026-06-28 — completion pass` section (what shipped), and a categorized
`Remaining work — handoff (2026-06-28)` section. Trust the code/migrations over any older checkbox.

> 👉 **[`HUMAN-TODO.md`](HUMAN-TODO.md)** — single aggregated checklist of everything left that needs a *person*
> (credentials, your data, a running app, or a coordinated deploy). Start there.

Handoff legend: **[OWNER-GATED]** = needs a human (Neon/Vercel/Stripe/Amazon/office-Mac) — an AI cannot do it ·
**[MIGRATION-DEPLOY-COUPLED]** = a written-but-unapplied migration that must land *with* a coordinated deploy
(dangerous standalone) · **[MIGRATION-VERIFY]** = additive migration, just confirm it's applied ·
**[DESIGN-DECISION]** = needs an owner decision before coding · **[DEFERRED-BY-DESIGN]** = intentionally out of v1 ·
**[CODE]** = safe in-repo code still to write.

| Doc | Verified status | What actually remains |
|---|---|---|
| `qc-crud-endpoints-plan.md` | ✅ DONE 100% | [MIGRATION-VERIFY] confirm 2 migrations applied — then archive |
| `receiving-workspace-mode-primitives-plan.md` | ✅ DONE 100% | none — archive (README "Phase 2 gating remains" was stale) |
| `serial-units-tenant-force-plan.md` | ✅ DONE 100% (FORCE RLS **applied & live**) | none — archive (header "deferred" was stale) |
| `amazon-sp-api-order-import-plan.md` | ✅ DONE 95% | [OWNER-GATED] Amazon Appstore app + PII role; [MIGRATION-VERIFY] |
| `condition-grading-repair-qc-plan.md` | ✅ DONE 96% | backfill script **created this session**; [DEFERRED] live eBay push |
| `handling-unit-lpn-plan.md` | ✅ CODE DONE 90% | [MIGRATION-OWNER] apply handling_units migration; [DEFERRED] H6 |
| `unshipped-tracking-label-record-plan.md` | ✅ DONE 90% | Phase 5 row chips **shipped this session**; [MIGRATION-VERIFY] |
| `multi-tracking-po-plan.md` | ✅ SUPERSEDED 90% (→ shipment_links) | [MIGRATION-DEPLOY-COUPLED] 28q legacy drop; small triage-link check |
| `platform-account-type-catalog-STATUS.md` | ◑ MOSTLY DONE 80% | script recreated + label wired (6 surfaces) this session; [MIGRATION-DEPLOY-COUPLED] 14f |
| `identity-layer-plan.md` | ◑ CORE DONE 80% (SSO built — doc was stale) | [DESIGN-DECISION] account merge / session collapse / SSO-storage |
| `receiving-scans-stn-link-plan.md` | ◑ MOSTLY DONE 72% | backfill script **created**; [DESIGN] S5 key; [MIGRATION-COUPLED] S6 drop |
| `receiving-door-classification-plan.md` | ◑ Initiative A+B DONE (was 45%) | A1-step3/A3/A4 + B1/B4 **shipped**; [DESIGN] B2/B3 only |
| `relational-backend-reuse-plan.md` | ◑ ROADMAP (P1 done, §2 partial) | 1/3 raw TSN writers migrated; recordUnitEvent retrofit = **REDESIGN** (bypasses transition() — not a safe swap, confirmed); [MIGRATION-COUPLED] §3/§5/§6/§7 |
| `sku-reconciliation-plan.md` | ◔ §7 + endpoint + §6 + queue-wiring done | [OWNER-BLOCKED] Step B suffix semantics; [MIGRATION-COUPLED] Step A/E union-seed + FK |
| `dead-code-triage.md` | 📓 living log — Waves 1-6 done (75%) | 2 orphans **deleted this session**; [DEAD-CODE-RISKY] knip backlog |
| `DEAD_CODE_CLEANUP_PLAN.md` | 📓 living tracker — hard parts done (78%) | [DEAD-CODE-RISKY] Phase 3 waves; [DEFERRED] Phase 5 detection |
| `nas-receiving-write-tunnel-plan.md` | 🔌 code-complete, infra-pending (55%) | [OWNER-GATED] office Mac agent + Caddy + Vercel env (everything left) |
| `tier0-execution-checklist.md` | 🗂️ SUPERSEDED meta-tracker (82%) | [OWNER-GATED] Stripe live; [MIGRATION-COUPLED] .gated PK contract swaps |

## Migration status — verified 2026-06-29

`npm run db:migrate:dry` against the live DB → **0 pending** (371 on record). Every additive migration the
audit had flagged as "unapplied" (it had no DB access) is in fact **APPLIED & live**: `handling_units`,
`orders` tracking/label timestamps, `qc_template_lifecycle`, `failure_modes`, catalog `14f`, and the `28q`
legacy-table drop. **The only unapplied migrations are the 2 deploy-coupled `.gated` files**
(`2026-06-14_fba_fnskus_composite_pk.sql.gated`, `2026-06-14_sku_catalog_composite_unique.sql.gated`) — these
must land *with* their already-shipped `ON CONFLICT` code in a coordinated deploy, never standalone. Net:
handling-unit-lpn, condition-grading, qc-crud, platform-catalog, and unshipped are fully live (not
migration-pending).

## 2026-06-28 completion pass — summary

A read-only audit (18 agents) verified each doc against the code, three code passes finished every in-repo gap
(tsc-clean throughout, all new unit tests pass, route-permission manifest regenerated), and every doc was
reconciled to its true state. **Code shipped:** deleted 2 orphaned receiving modes; created
`scripts/backfill-unit-quality.ts`, `scripts/backfill-catalog-type-id.mjs`,
`scripts/backfill-receiving-scans-shipment-id.sql`; created `/api/pending-skus` + tests; added handling-unit unit
tests; door-classification A1–A4 + B1 (`TriageRecentRail`) + B4 (scan-auto-select); wired `useOrderChannelLabel`
into 7 order surfaces + Phase-5 TRK/LBL row chips; sku `§6` guarded pairing fn + additive queue-on-miss in
receiving/Amazon imports (12 tests); migrated 1/3 raw `tech_serial_numbers` writers to `attachTechSerial`.

**Empirically confirmed NOT a safe swap:** the relational `recordUnitEvent` hot-path retrofit — an agent read both
sides and found the façade bypasses the `transition()` state machine that all four hot paths depend on; it is a
redesign, not a completion, and stays deferred.

**Not done autonomously (irreducible — needs a human):** production migrations (incl. deploy-coupled `.gated`
ones), owner-gated infra (Stripe, NAS Mac/Caddy, Amazon Appstore, Neon roles, Vercel env), and owner design
decisions (SKU suffix semantics, identity account-merge/session-collapse, receiving-scans S5 key). Each is
itemized in the owning doc's handoff section.
