# TODO — planned, not yet started

Plan docs whose features are **not implemented** (proposals / specs with no shipped code).
Audited 2026-06-28. Verify against the live codebase before starting — a doc may have moved since.

## Revenue / go-to-market critical path
- `saas-commercialization-plan.md` — billing + isolation + identity + compliance; Stripe catalog & RLS unbuilt
- `phase-1-rls-plan.md` — no table has RLS enforced yet
- `onboarding-foundational-plan.md` — blocked on identity + billing layers
- `beta-intake-funnel-plan.md` — zero code shipped

## Features
- `tech-substitution-wiring-plan.md` — wire fulfillment substitution (`SubstituteUnitCard` / customer reason picker) into `/tech` `ActiveOrderWorkspace`; policy API, permissions, phases 0–7
- `serial-label-pairing-split-combine-plan.md` — serial↔label audit ledger, prebox manifest combine/split, LPN desktop parity, multi-serial acknowledgement UI (receiving + testing); grounded in `serial_units` / `post-multi-sn` / `handling_units`
- `testing-priority-needs-test-plan.md`
- `packing-checklist-plan.md`
- `incoming-tracking-todo-plan.md`
- `../incoming-universal-purchase-orders-plan.md` — polymorphic incoming spine (`inbound_purchase_order_links` / mirror / equivalence), eBay purchasing, dedup merge, Studio integration
- `reversibility-fixes-plan.md` — reversible label case still live
- `ai-chat-ux-plan.md`
- `nextiva-voice-support-mode-plan.md`
- `bose-parts-sourcing-engine-plan.md` — note: the migration/endpoint sibling doc is DONE; this engine doc is still "Proposed"
- `sourcing-hub-integration-plan.md` — backend mostly built, frontend IA unstarted
- `platform-account-type-catalog-plan.md` — nothing built (the `-STATUS` sibling in ../partial is partial)
- `warehouse-map-react-flow-plan.md` — prototype in /design-demo only

## Integrations / infra
- `production-integrations-system-plan.md` — **2026 production master plan** (deep-scan): maturity matrix, P0–P7 build order, QoL/diagnostics/webhooks, Studio wiring, cron consolidation, exit criteria; execution index over the docs below
- `studio-integrations-master-plan.md` — Studio wiring checklist, diagnostics rules, P0–P5 phasing (detail layer for production plan §5)
- `integrations-oauth-connection-plan.md`
- `nango-additive-integration-plan.md`

## Database & modeling
- `polymorphic-tables-database-refactor-plan.md` — **receiving-only deep-dive** (2026-06-29). The `receiving`/`receiving_line` spine split into a thin relational spine + polymorphic typed-facts + per-street code lanes; "share display, not logic"; clean destructive cutover (codebase not live). Builds on shipment_links, reason_codes flow-context, the workflow registry, and the `types` catalog.
- `schema-wide-polymorphic-refactor-plan.md` — **whole-schema** scan of monolithic tables best upgraded to polymorphic designs (serial_units, orders, inventory_events, platform_listings, workflow/station configs, warranty/repair cluster, FBA family, Zoho mirrors, etc.) + the reference contract and Appendices A–D. The receiving Tier-1 deep-dive lives in the sibling above.
- `ops-events-station-workflow-unification-plan.md` — unifies `ops_events`/`station_activity_logs`/`workflow_nodes` identity: adds a CHECK to `ops_events.entity_type` (currently unconstrained) and a nullable `workflow_node_id` FK so tenant-customized Studio stations aren't hardcoded into a TS union; freezes `station_activity_logs` migration as a separate future project.
