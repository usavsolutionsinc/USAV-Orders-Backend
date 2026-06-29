# TODO — planned, not yet started

Plan docs whose features are **not implemented** (proposals / specs with no shipped code).
Audited 2026-06-28. Verify against the live codebase before starting — a doc may have moved since.

## Revenue / go-to-market critical path
- `saas-commercialization-plan.md` — billing + isolation + identity + compliance; Stripe catalog & RLS unbuilt
- `phase-1-rls-plan.md` — no table has RLS enforced yet
- `onboarding-foundational-plan.md` — blocked on identity + billing layers
- `beta-intake-funnel-plan.md` — zero code shipped

## Features
- `testing-priority-needs-test-plan.md`
- `packing-checklist-plan.md`
- `incoming-tracking-todo-plan.md`
- `reversibility-fixes-plan.md` — reversible label case still live
- `ai-chat-ux-plan.md`
- `nextiva-voice-support-mode-plan.md`
- `bose-parts-sourcing-engine-plan.md` — note: the migration/endpoint sibling doc is DONE; this engine doc is still "Proposed"
- `sourcing-hub-integration-plan.md` — backend mostly built, frontend IA unstarted
- `platform-account-type-catalog-plan.md` — nothing built (the `-STATUS` sibling in ../partial is partial)
- `warehouse-map-react-flow-plan.md` — prototype in /design-demo only

## Integrations / infra
- `integrations-oauth-connection-plan.md`
- `nango-additive-integration-plan.md`

## Database & modeling
- `polymorphic-tables-database-refactor-plan.md` — comprehensive scan of monolithic tables best upgraded to polymorphic designs (receiving + receiving_lines, serial_units, orders, inventory_events, platform_listings, workflow/station configs, warranty/repair cluster, Zoho mirrors, etc.). Builds on shipment_links, work_assignments, receiving_exceptions, and the platform catalog.
