# Tenancy hardening — docs index

The build-out of [`../multi-tenancy-hardening-prompt.md`](../multi-tenancy-hardening-prompt.md) into a concrete, executable plan for this codebase.

## Start here
- **[multi-tenancy-execution-plan.md](./multi-tenancy-execution-plan.md)** — the spine. Phases A→F with real table/route/file names, the BYPASSRLS keystone (§0), sequencing, and acceptance-criteria→proof mapping. Supersedes the role decision in [`../phase-1-rls-plan.md`](../phase-1-rls-plan.md).

## Generated ground truth (reproducible — do not hand-edit)
- **[org-id-coverage.generated.md](./org-id-coverage.generated.md)** — per-table org_id/RLS state from `pg_catalog`. Regenerate: `npm run tenancy:coverage`.
- **[route-scoping-audit.generated.md](./route-scoping-audit.generated.md)** — per-route risk + the **reverse index** (routes per table) that gates Phase E enforcement. Regenerate: `npm run tenancy:routes`.
- `coverage.generated.json` / `route-audit.generated.json` — machine sidecars consumed by `scripts/tenancy-guard.ts`.

## Deep per-subsystem specs (exhaustive call-site lists)
- [_analysis/tables.md](./_analysis/tables.md) — Phase B schema batches + child-table decisions.
- [_analysis/routes.md](./_analysis/routes.md) — adversarially-verified leaks + exact fixes for the priority targets.
- [_analysis/repos.md](./_analysis/repos.md) — Phase C5 choke-points + the neon-http blocker (`withTenantDrizzle`).
- [_analysis/realtime.md](./_analysis/realtime.md) — Phase D1 Ably org-isolation (channels + token + ~70 publishers + ~24 subscribers).
- [_analysis/cron.md](./_analysis/cron.md) — Phase D2 per-job table + `forEachActiveOrg` + two-pool split.
- [_analysis/infra.md](./_analysis/infra.md) — Phase D3/D4/D5 + audit-log org threading + USAV burn-down.
- [_analysis/critique.md](./_analysis/critique.md) — completeness/correctness critic (note: its "role-store is a live leak" claim is corrected in the exec plan §0).

## Tooling shipped with this plan
| What | Where |
|---|---|
| Coverage generator | `scripts/tenancy-coverage.mjs` (`npm run tenancy:coverage`) |
| Route audit generator | `scripts/tenancy-route-audit.mjs` (`npm run tenancy:routes`) |
| CI guard (enforcement gate + BYPASSRLS invariant) | `scripts/tenancy-guard.ts` (`npm run tenancy:guard:check`) |
| ESLint escape-hatch ban + burn-down allowlist | `eslint.config.mjs` |
| Cross-org test harness + canary | `src/lib/tenancy/cross-org-harness.ts`, `cross-org-isolation.test.ts` |
| Phase E role template (manual-apply) | `src/lib/migrations/2026-06-21_app_tenant_role.sql.template` |

**Status:** Phase A complete (in this branch). Nothing has been applied to the live DB — Phases B→F are plan + scaffolds awaiting go-ahead.
