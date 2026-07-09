# Schema-Wide Polymorphic Tables Refactor — Monolithic → Extensible Plan

> **Scope split (2026-06-29):** this document is the **whole-schema** view (~15 tables across 3 tiers). The **receiving / receiving_lines deep-dive** — the "streets" decomposition, the logic-vs-display separation, and the clean (non-live) destructive cutover — moved to its own doc: [`polymorphic-tables-database-refactor-plan.md`](./polymorphic-tables-database-refactor-plan.md). The receiving Tier-1 summary stays here for the cross-table picture; the detailed receiving plan lives there.
>
> Status: **Phase 0 EXECUTED (2026-07-01)**; **Phase 1 IN PROGRESS — `serial_unit_provenance` migration APPLIED live 2026-07-03**; Phases 2–4 still PLAN (2026-06-28; **deep code+migration scan folded in 2026-06-29**). Phase 0 (data-integrity fixes, reference-contract ratification, Drizzle modeling of `photo_entity_links`/`part_links`/`organization_integrations`) has landed — see the corrected Data-integrity findings section and the Phase 0 bullet list below for exactly what changed and what was already stale. Phases 1–4 (new provenance/allocation structures, dual-write, reader migration, cleanup) remain an unstarted proposal requiring separate scoping/buy-in per table. Belongs with the multi-tenancy hardening, inventory v2, Studio/Operations, and receiving redesign initiatives.
>
> The 2026-06-29 scan (5 parallel passes over `src/lib/drizzle/schema.ts` (3,129 lines), all 305 files in `src/lib/migrations/`, and `src/lib/workflow/` / `src/lib/integrations/`) produced the concrete appendices at the end of this doc: **Appendix A** (exact contract of every existing polymorphic surface + 10 cross-surface inconsistencies), **Appendix B** (Tier-1 monolith before-snapshots), **Appendix C** (all 48 jsonb columns + variant-config-vs-junk-drawer taxonomy), **Appendix D** (discriminator/status-column inventory: ~70 status columns, only ~10 real enums), and a **Data-integrity findings** section of bugs/drift to fix *regardless* of the refactor. Tiered findings and target shapes below were expanded with what the scan found.

## Context — why this work

The codebase has evolved rapidly through inventory v2, workflow engine, platform catalog, receiving line extraction, unified shipment links, and heavy multi-tenancy (GUC + RLS) work. Many core tables started as relatively simple records and grew into **monolithic "god tables"**:

- Wide column sets with many nullable "variant" fields.
- Repeated source/platform/intake/type denorm columns (`source_platform`, `account_source`, `intake_type`, `receiving_type`, `return_platform`, etc.).
- Heavy `jsonb` (`metadata`, `payload`, `platform_metadata`, `config`, `status_history`, `line_items`, `parts_used`...) used both for true variant config and for business facts that should be structured.
- One table handling multiple conceptual "kinds" (different receiving flows, different listing origins, mixed order vs FBA vs repair provenance, event types with wildly different shapes).
- Legacy columns kept for back-compat (sku table retirement, old shipment link tables, drift columns).

This pattern is expensive for a **SaaS**:
- Hard to add org-specific behaviors or new channels without widening tables.
- Workflow/Studio (node graphs + station definitions) want to compose over typed entities.
- Tenant isolation and per-org catalogs become harder when logic is scattered across denorms.
- Query performance, indexes, and audit timelines suffer.
- Domain logic (state machines, transitions, allocations) fights against implicit subtypes.

A full codebase + migration + domain scan (Drizzle schema, 300+ migrations, `src/lib/inventory/*`, `src/lib/receiving/*`, `src/lib/workflow/*`, `src/lib/orders/*`, integrations, etc.) produced the list below.

## Existing strong polymorphic patterns (build on these)

> Corrected against the live schema 2026-06-29. **There is no single established contract yet** — these surfaces diverge on column naming, id type, discriminator-constraint mechanism, integrity triggers, and org-scoping. Appendix A documents the exact shape of each + the 10 inconsistencies to standardize. The two cleanest references to codify are **`part_links`** (tenant-from-birth) and **`photo_entity_links`** (normalized polymorphic hub).

- `photo_entity_links` — **the live polymorphic photo hub** (`entity_type` TEXT + `entity_id` BIGINT + a *second* axis `link_role`, named CHECKs, cascade FK → `photos`). Born `2026-06-18`; the legacy `photos.entity_type/entity_id/url` columns were **dropped** `2026-06-21` (Phase E). ⚠️ The old plan said "`photos` — entity_type + entity_id" — that is now stale; `photos` is a plain table and the link was *extracted*. (Not yet modeled in Drizzle.)
- `work_assignments` — the **only enum-backed** discriminator: `entity_type` (pg enum `work_entity_type_enum`) + `entity_id` INT + `work_type` (pg enum) + partial unique `WHERE status IN ('ASSIGNED','IN_PROGRESS')` + BEFORE-DELETE **cancel** triggers (only for `ORDER`+`RECEIVING`, not its 3 other enum values).
- `shipment_links` — unified `owner_type` TEXT + `owner_id` INT + `direction` + `role` (replaced `receiving_shipments` + `order_shipment_links`, dropped `2026-06-28q`). Org-led partial unique `WHERE is_primary`. **No owner-side delete trigger** — an owner delete orphans link rows (the planned Phase-4 cleanup trigger was never created).
- `documents` — `entity_type` TEXT + `entity_id` INT, **free-text, no CHECK, no trigger, no unique** (a parent delete orphans rows). The weakest surface.
- `entity_notes` — `entity_type` TEXT + `entity_id` **UUID** (the only UUID id-type), free-text, no trigger.
- `receiving_exceptions` — status-discriminated (`exception_code` + `status`), **not** owner-polymorphic (both parents are real FK `ON DELETE CASCADE`). Extracted from the receiving god-table `2026-06-24`.
- `part_links` (`2026-06-28g`) — **the cleanest tenant-from-birth example**: org `NOT NULL` no-default + `enforce_tenant_isolation('part_links')` *in the same migration*, named CHECKs encoding a discriminated-union shape (`status='confirmed'`⇒parent NOT NULL; `status='not_a_part'`⇒parent NULL), org-led partial uniques. (Not modeled in Drizzle.)
- Platform catalog (`platforms`, `platform_accounts`, `types`) — replaces hard-coded `SOURCE_PLATFORMS` / `RECEIVING_TYPE_OPTS` (see `docs/todo/platform-account-type-catalog-plan.md`). Note: only `platform_accounts.platform_id` is a real FK; `platforms.provider`, `platform_accounts.integration_scope`, `types.workflow_node_id` are **soft "agree-by-string" links**, not FKs.
- `serial_units` + `inventory_events` + `sku_stock_ledger` — the authoritative spine (status only via `transition()` / `applyTransition()`).
- `reason_codes` — `flow_context`-discriminated multi-vocabulary store (named CHECK, org-led unique `(organization_id, flow_context, code)`). ⚠️ a live CHECK regression — see Data-integrity findings.

**The contract to codify (from `part_links` + `photo_entity_links`):** typed discriminator (prefer **named CHECK** over free text; pg-enum only for small, stable, rarely-extended sets) + id column + **org-led** partial/unique indexes + integrity trigger (cascade *or* cancel) on every parent OR a real FK on the non-polymorphic side + `organization_id UUID NOT NULL` with `enforce_tenant_isolation()` **in the birth migration** + a Drizzle model that matches the DB + audit via `recordAudit`. Appendix A is the gap analysis against this contract.

## Scan findings — monolithic tables (prioritized)

### Tier 1 (highest value / core domain)

1. **`receiving` + `receiving_lines`** (the largest current monolith)
   - receiving: carrier, qa/disposition/grade, source/source_platform/intake_type, zoho* mirrors, support notes, zendesk, lpn, priority_tier, many timestamps, type_id (new), exception_code, etc.
   - receiving_lines: even wider (Zoho line mirrors + workflow_status + qa + disposition + condition + receiving_type + source_* + unit_price + line-level timestamps + sku_catalog_id + exception + `disposition_audit` jsonb).
   - Multiple "kinds": PO | RETURN | TRADE_IN | PICKUP | sourcing_import | local_pickup. Per-line vs carton-level facts mixed.
   - Recent good work: `receiving_exceptions` extracted; many line-level facts added in 2026-06 redesign.

2. **`serial_units`**
   - Central unit root. Identity + current_status (growing enum) + condition + location + multiple `origin_*` + legacy columns + `metadata` jsonb.
   - Different origins and "flavors" (standard inventory, repair candidates, parts, FBA units) crammed together.

3. **`orders`**
   - Fulfillment line + channel facts + sale price + statusHistory jsonb + account_source/fulfillmentChannel + type_id + sku links.
   - Overlaps with FBA, local pickup, walk-in, warranty claims.

4. **`inventory_events`**
   - Already the right direction (unified append-only spine). Still has many optional FKs + free-form `event_type` + large `payload` jsonb.

5. **`station_activity_logs`**
   - Cross-station fact ledger with many optional FKs to heterogeneous entities + `metadata` jsonb.
   - **Scan detail (Appendix B):** 17 cols, 7 sparse FK anchors (`shipment_id`, `fnsku`, `orders_exception_id`, `fba_shipment_id`, `fba_shipment_item_id`, `tech_serial_number_id`, `packer_log_id`) + `scan_ref`.
   - ⚠️ **CORRECTION (live-data scan 2026-07-03): the anchors are NOT mutually exclusive.** Of 19,037 rows, **6,608 (35%) set 2+ anchors** — they compose as *primary subject + context*, not "one of N entity types": e.g. a PACK scan carries `shipment_id` (the order) + `packer_log_id` (the pack action) + often `orders_exception_id` + `scan_ref` (raw scan) simultaneously (top patterns: `ship+packer+ordexc+scanref`, `ship+tsn`, `fbaship+fbaitem+fnsku`; `scan_ref` alone on 9,171). **A single typed `entity_type`/`entity_id` pair is therefore the WRONG shape — it would silently drop the secondary anchors.** The Appendix-A single-pair contract does not apply here. Remaining real options: **(a) leave as-is** (these are legitimate co-occurring real-FK context dimensions on an append-only ledger, not the untyped-soft-FK anti-pattern), or **(b) fold onto the `inventory_events` spine** (the larger Tier-1 option). The naive collapse was investigated and **rejected on the data**; not attempted.

6. **`warranty_claims` + repair cluster** *(NEW — scan 2026-06-29)*
   - `warranty_claims` is a ~30-col god-table that **denormalizes the spine**: `serial_unit_id` FK *and* free-text `serial_number`/`sku`/`product_title`; `order_id` *and* `source_order_id`/`source_tracking_number`; the delivered/packed warranty clock (`delivered_at`, `packed_scanned_at`, `clock_basis`) that `shipping_tracking_numbers` + the order-lifecycle spine already own. Status is free-text (`LOGGED|SUBMITTED|APPROVED|DENIED|IN_REPAIR|REPAIRED|CLOSED|EXPIRED`).
   - **Repair is modeled three times**: `repair_service` (ticket intake — re-stored `serial_number`/`source_sku` as text; `unit_repairs` (serial-anchored — *the good model*, cross-links `start_event_id`/`done_event_id` into `inventory_events`), and `warranty_repair_attempts` (claim-anchored). All three carry parts/cost/labor independently.
   - ✅ **PARTIAL (2026-07-03): `repair_service.serial_unit_id` FK added** (`2026-07-03s`, nullable, FK→`serial_units`, org-led index, backfilled the 1 matchable row) so an internal-inventory ticket can anchor to its unit.
   - ⚠️ **CORRECTION (live-data scan 2026-07-03): do NOT collapse `repair_service` onto `unit_repairs`.** They are DISTINCT domains: `repair_service` is **customer walk-in / RMA device repair** (`contact_info`, `customer_id`, `price`, `ticket_number`, `pickup_signed_at`) — of 72 rows only **1** matches a `serial_units` row; the other 71 are customers' own devices, never inventory, correctly serial-unit-less. `unit_repairs` is internal inventory-serial repair. They relate via `unit_repairs.repair_service_id`. The new `serial_unit_id` is an OPTIONAL enrichment, not a consolidation.
   - ✅ **`warranty_repair_attempts` spine links added** (`2026-07-03t`, 2026-07-04 decision = **keep separate, do NOT merge into `unit_repairs`**): added `serial_unit_id` (INTEGER FK) + `start_event_id`/`done_event_id` (BIGINT FK → `inventory_events`) + org-led index, mirroring `unit_repairs`' spine anchoring without merging. Empty table (0 rows) → no backfill; `serial_unit_id` denormalized from the claim at write time. Drizzle updated.

   **Tier-1 decisions (2026-07-04):** FBA fold = **SKIP/defer** (owner: not worth the churn now); `orders` decomposition = **SKIP**; `station_activity_logs` = **leave as-is** (co-occurring real-FK context, not the anti-pattern — see #5); `warranty_repair_attempts` = **keep separate + spine links** (done above). Tier-1 is now resolved (done / corrected / deferred by decision).

7. **FBA family — a self-contained parallel spine** *(NEW — scan 2026-06-29)*
   - The FBA subtree re-implements three spine concerns instead of reusing them: **`fba_fnsku_logs` ≈ `inventory_events`** (its own lifecycle event stream, even carrying bridge FKs back to `station_activity_logs`/`tech_serial_numbers`); **`fba_shipment_item_units` ≈ `order_unit_allocations`** (unit→destination reservation — two allocation tables for two destinations); **`fba_shipment_tracking` ≈ `shipment_links`** (its own shipment↔tracking junction, when `shipment_links.owner_type` could simply be `'FBA_SHIPMENT'`, `direction='OUTBOUND'`).
   - Stacked denorm: `fba_shipment_items` repeats `productTitle/asin/sku` off `fba_fnskus`, which repeats them off `sku_catalog`; `fba_fnskus.condition` duplicates `serial_units.condition_grade`. `fba_shipment_items` also flattens a state machine into a per-stage staff+timestamp quadruplet (`ready/verified/labeled/shipped` × `ByStaffId/At`).
   - **Target:** fold FBA onto the spine — `owner_type='FBA_SHIPMENT'` shipment links, `order_unit_allocations` for FBA destinations (or a shared `unit_allocations` with a destination discriminator), and `inventory_events` instead of `fba_fnsku_logs`.

### Tier 2 (high leverage)

- `platform_listings` — `platform`/`account_name` **free text (not FK)** + `platform_metadata` jsonb + sync state. ⚠️ Does **not** join the platform catalog at all (agree-by-string). `platform_metadata` is the clearest **junk-drawer jsonb** in the schema: nullable, no comment, no discriminator, sitting *alongside* already-structured `listing_price_cents`/`listing_quantity`/`listing_condition`/`upc` columns. Should FK `platform_accounts` and type its extension per platform (Appendix C).
- `sku_platform_ids` vs `platform_listings` — **two per-channel SKU→external-id mapping tables**.
  - ✅ **RESOLVED by usage (2026-07-04): `sku_platform_ids` is the LIVE mapping home** (18 cols, has `organization_id`, writers + readers — the sku-catalog pairing route + picking sessions). `platform_listings` is **intentional forward-scaffolding** for a planned listings feature (0 rows / 0 writers *by design*, per owner 2026-07-04) — NOT dead code; its `2026-07-03r` `platform_account_id` FK is deliberate normalized forward-prep, annotated in the Drizzle model so no future scan drops it as "unused". Two separate tables is the intended end state (a thin id-map + a richer future listing store), not a dedup target.
  - ✅ **`sku_platform_ids` Drizzle model reconciled** to the live 18 columns (was 8; added `organization_id` + display/listing/pairing fields). Read-for-types only (table used via raw SQL), so a documentation-accuracy fix.
- `organization_integrations` — provider + scope + encrypted payload. **No Drizzle model at all** (raw `pool.query` only, in `src/lib/integrations/credentials.ts`); the in-code `IntegrationProvider` union has **drifted to 15 providers** vs the migration comment's 12. *Good* discipline to emulate: queryable status (`display_label`/`status`/`last_used_at`/`scope`/`webhook_token`) is in real columns, secrets stay in the opaque `payload_encrypted` blob. Needs a Drizzle model + formal per-provider shapes.
- Workflow / Studio cluster: `workflow_definitions` (jsonb `annotations`) + `workflow_nodes` (`type` text + `config` jsonb) + `workflow_edges` + `item_workflow_state` (`context` jsonb) + `workflow_runs` + `workflow_node_stats` + `station_definitions` (`config` jsonb) + `workflow_templates` (`graph` jsonb, **no `organization_id` — deliberately global blueprints**). Node `type` is a **free-text key validated by an in-code registry** (`src/lib/workflow/registry.ts`, 11 types: `receiving|inspection|repair|data_wipe|kit_verify|list_ebay|list|pack|ship|returns|decision`); `decision` is the one genuinely-polymorphic node (rule table in `config`). This jsonb is *legitimate variant config* (shape keyed by a known discriminator) — keep it, but govern with a per-`type` schema registry; see Appendix C.
- `tech_verifications` *(NEW — scan 2026-06-29)* — carries **two untyped polymorphic pairs in one row**: `source_kind`+`source_row_id` and `step_type`+`step_id` (integer FK whose target table is chosen by a sibling string, no referential integrity). Overlaps `testing_results` (two per-test record tables, different anchoring). The textbook anti-pattern vs `shipment_links.owner_type/owner_id`.
  - ⚠️ **INVESTIGATED 2026-07-03, no migration warranted:** designed-polymorphic but **used monomorphically** — both writers (`serial-units/[id]/checklist/route.ts` + `.../bulk/route.ts`) hard-code `SOURCE_KIND='serial_unit'` / `STEP_TYPE='QC'` constants; 16 live rows, both discriminators single-valued; `source_row_id`→`serial_units`, `step_id`→`qc_check_templates` (no FK). A single-value named CHECK is marginal, a hard FK would break the intended polymorphic flexibility, and the contract exempts existing tables from retroactive constraint. Left as-is (a genuine "watch/document" item, not a build).
- Fragmented SKU identity *(NEW — scan 2026-06-29)* — SKU identity lives in **4 homes**: `sku_catalog` (SoT), `sku` (retired — INSERTs trigger-blocked, kept as FK target/archive), `sku_stock` (now a trigger-maintained projection of `sku_stock_ledger`, not SoT), `items` (Zoho, the known collision per `items-vs-sku_catalog`). `sku_catalog` itself accretes 3 domains (identity + sourcing + packing). Document the homes + their authority; don't widen `sku_catalog` further.
- `tech_serial_numbers` *(NEW — scan 2026-06-29)* — the **legacy serial spine being strangled by `serial_units`** (~25 cols, `serialType`/`stationSource` discriminators, FKs to fnsku/fba/receiving/exception/sku). Central to the FBA/testing duplication above; track its retirement alongside the FBA fold.
- Zoho mirror tables (`customers`, `sales_orders`, `items`, `packages`, `invoices`, `credit_notes`, `item_adjustments`) — the **jsonb-densest cluster** (addresses/line_items/custom_fields/channel_refs). `customers` **double-stores address** (flat `shipping_address_1/2/...` columns *and* a `shipping_address` jsonb) and has its own untyped `entity_type`/`entity_id` pair. Largely acceptable as external sync mirrors (Tier 2/3), but the jsonb + double-store belong in the inventory (Appendix C).

### Tier 3 (watch / incremental)

- SKU hub sprawl (`sku_catalog`, legacy `sku`, `skuPlatformIds`, `pendingSkus`, bose tables).
- Testing/quality tables (`testing_results`, `unit_failure_tags`, `unit_quality_scores`, `failure_modes`).
- Various sync/outbox tables and narrow domain tables that may accumulate variant columns.
- **AI / RAG / sourcing cluster** (`ai_chat_*`, `rag_documents`, `rag_document_chunks`, `suppliers`, `sourcing_*`, `part_acquisitions`) — the scan found this the **cleanest cluster: no god-tables, no mis-modeled polymorphism, proper FKs + org-scoping throughout** (`part_acquisitions` correctly bridges the spine via `serial_unit_id` + `receiving_id`). Fine as-is; recorded so it isn't re-scanned.

Legacy retired-but-present tables (e.g. `sku`) are out of scope except for cleanup waves.

## Data-integrity findings surfaced by the scan (fix regardless of the refactor)

> **Status update (2026-07-01, Phase 0 executed):** all five findings below were investigated against the live
> DB and either fixed or found to be already-resolved / re-scoped. Two turned out to be **stale** — the live
> database had already moved past what the 2026-06-29 scan saw — and investigating one of them (#5) surfaced a
> **new, real, currently-live tenant-isolation bug** that is unrelated to this refactor. See the per-item notes.

1. **~~`reason_codes` CHECK regression~~ — RESOLVED, was already stale when this doc was written.** A fifth
   migration, `2026-06-29e_reason_codes_serial_absent.sql` (authored in the same commit as this doc,
   `c49ef8ce`), sorts after both `28d` and `28e` and explicitly re-affirms the full union — it restores
   `lifecycle_unshipped`/`lifecycle_outbound` and adds `serial_absent_reason` on top. Verified live: the actual
   `reason_codes_flow_context_chk` definition today is
   `CHECK (flow_context = ANY (ARRAY['inventory_event','substitution','short_pick','receiving_exception','repair_failure','verdict_detail','warranty_denial','inventory_adjust','lifecycle_unshipped','lifecycle_outbound','serial_absent_reason']))`
   — both lifecycle values are present. The label-vocabulary migration (`2026-06-28d_reason_codes_label_presentation.sql`)
   is also confirmed **applied** live (`tone`/`icon` columns exist) — the separate auto-memory note claiming
   "authored, not applied" was stale and has been corrected. No migration needed; this finding is closed.

2. **Drizzle models that contradict the live DB (type-level lies) — RESOLVED.** Fixed directly in
   `src/lib/drizzle/schema.ts`:
   - `photos` — dropped `entityType`/`entityId`/`url`; added `organizationId`, `deletedFromBlobAt`, `poRef`.
   - `reason_codes` — added `organizationId`, `flowContext`, `appliesTo`, `tone`, `icon`; removed the stale
     global `code` UNIQUE (replaced with the real composite `uniqueIndex` on `(organizationId, flowContext,
     code)`, matching live `reason_codes_org_flow_code_key`); `category` is now nullable (matches the live
     CHECK, which explicitly allows `NULL`).
   - `work_assignments` / `documents` — added `organizationId`.
   - `serial_units` — added the previously-undocumented `handlingUnitId` (bigint, nullable) column found live
     during the investigation. `organization_id` stays **intentionally** omitted per the table's existing
     comment ("SQL-migration is SoT") — that's the deliberate-partial-model case this finding's own fix text
     called out as acceptable, not a bug.
   - `receiving_lines` — the omitted GENERATED `zoho_purchaseorder_number_norm` is **also already deliberately
     annotated** (inline comment explains drizzle-kit could mishandle the generated expression) — no change
     needed, same acceptable-partial-model case.
   - `photo_entity_links`, `part_links`, `organization_integrations` — all three now modeled in Drizzle (see
     finding-adjacent bullet below); full live DDL was captured first so every column/FK/index matches exactly.
   New contract for future tables: `.claude/rules/polymorphic-tables.md` (point 8: model in Drizzle in the same PR).

3. **Orphan-on-parent-delete — RESOLVED for the confirmed, unambiguous gaps.**
   `2026-07-01j_polymorphic_orphan_delete_triggers.sql` adds:
   - `documents` — cascade-delete on `orders` (entity_type `ORDER` and the legacy `SHIPPING_LABEL` alias) and
     `repair_service` (`REPAIR`), via a new `fn_delete_documents_on_parent_delete()`, mirroring
     `fn_delete_photos_on_parent_delete()`.
   - `entity_notes` — cascade-delete on `sales_orders` (its one real writer only ever uses
     `entity_type='sales_order'`), via `fn_delete_entity_notes_on_parent_delete()`.
   - `shipment_links` (owner side) — cascade-delete on `receiving` and `orders`, closing the Phase-4 trigger
     the birth migration's own header flagged as planned-but-never-created, via
     `fn_delete_shipment_links_on_owner_delete()`.
   - `work_assignments` — extended the existing `fn_cancel_work_assignments_on_entity_delete()` family (already
     generic via `TG_ARGV[0]`) to the 3 previously-uncovered `work_entity_type_enum` values: `REPAIR` →
     `repair_service`, `FBA_SHIPMENT` → `fba_shipments`, `SKU_STOCK` → `sku_stock`.
   - **Deliberately left uncovered, per the "accept + document" option this finding itself offered:**
     `documents.entity_type = 'WALK_IN_ORDER'` — no confirmed writer exists (the only reader,
     `src/app/api/walk-in/receipt/[id]/route.tsx`, queries a `data` column `documents` doesn't even have — that
     read path is already dead) and no parent table could be confirmed. Revisit if/when a real writer lands.

4. **No entity-existence validation anywhere — DECIDED, not left open.** Ratified in
   `.claude/rules/polymorphic-tables.md` (point 6): the contract delegates entity-existence validation to the
   **application layer** (the domain helper performing the write), matching the deliberate choice already made
   for `photos` in Phase E. No DB-side validation trigger is planned for any surface, existing or new.

5. **~~`sku_platform_ids` has no `organization_id`~~ — RESOLVED, was already stale when this doc was written.**
   `2026-05-23_org_id_on_business_tables.sql` added the column and `2026-06-22d_enforce_tenant_isolation_sku_platform_ids.sql`
   FORCE-enabled RLS on it, both **before** the 2026-06-29 scan ran. The scan's finding almost certainly came
   from reading the (separately stale) Drizzle model, which still only declares 8 of the table's live 18
   columns — that drift is real but low-risk (the model isn't queried anywhere; harmless as a documentation gap,
   not fixed in this pass since it wasn't one of the 5 tables finding #2 named).
   >
   > **New finding surfaced while investigating this one — real, currently-live, unrelated to this refactor:**
   > two reader modules join `sku_platform_ids` (+ `sku_catalog`/`sku_stock`) by SKU string with **zero**
   > `organization_id` predicate: `src/lib/neon/packer-log-enrichment.ts` (the `ecwid_lookup` lateral) and
   > `src/lib/neon/packer-logs-week.ts` — the latter's `fetchPackerLogRows()` has **no org parameter or filter
   > at all**, and `src/app/api/packerlogs/route.ts` `GET` calls it without `ctx.organizationId`, meaning that
   > route returns **every tenant's** packing-log rows to any authenticated caller. A third path,
   > `src/lib/picking/sessions.ts`'s legacy `loadPickTasks(orderId)` branch (still exercised by
   > `/api/orders/[id]/pick-tasks`, whose own comment acknowledges the gap), does the same unscoped SKU-string
   > join. **This is a genuine tenant-isolation bug, not a polymorphic-modeling issue — flagged here because it
   > surfaced during this investigation, tracked as a separate follow-up, not fixed in this pass.**
   >
   > **FIXED 2026-07-01 (follow-up executed):**
   > - `src/lib/neon/packer-logs-week.ts` — `fetchPackerLogRows()` now takes a **required** `organizationId`; the
   >   page CTE is scoped by `sal.organization_id` (bounding both the legacy and enriched queries, which share the
   >   `conditions`), the org id is part of the cache key (no more cross-org cache poisoning), the SKU-string
   >   enrichment laterals (`sku_platform_ids`/`sku_catalog`/`sku_stock`) and the `orders` join are org-scoped, and
   >   the trailing photos lookup carries an explicit org predicate. Both callers thread org:
   >   `/api/packerlogs` GET (`ctx.organizationId`) and the `/packer` server prefetch (`user.organizationId`).
   > - `src/lib/neon/packer-log-enrichment.ts` — the `ENRICHMENT_SELECT` SKU-string laterals + `orders` join are
   >   org-scoped by `sal.organization_id`, so precomputed enrichment can no longer bake in a foreign tenant's title.
   > - `src/app/api/orders/[id]/pick-tasks/route.ts` — now passes `ctx.organizationId` into `loadPickTasks`, which
   >   takes its already-correct GUC-scoped branch instead of the legacy unscoped raw-pool reads.
   > - **RESIDUAL (documented, not fixed):** the `v_sku` compat view drops `organization_id`, so its SKU-string
   >   branch in the enrichment `sku_lookup` remains cross-org until `v_sku` exposes org — tracked with the
   >   `tech_serial_numbers` / serial-spine strangle. `tsc --noEmit` clean.

## Guiding principles & invariants (non-negotiable)

- **Status only via the state machine** (`src/lib/inventory/state-machine.ts` `transition()` / `applyTransition()`). Never raw `UPDATE ... current_status`.
- **Audit only via `recordAudit()`** with `AUDIT_ACTION` / `AUDIT_ENTITY` constants.
- **Tenant scope via `withTenantTransaction(orgId, ...)`** (GUC) for writes; columns default from `app.current_org`.
- **Idempotency via `clientEventId`** on `inventory_events`.
- **Polymorphic reference contract**: discriminator column (typed enum or constrained text) + id column. Partial unique indexes + BEFORE DELETE triggers for integrity (see work_assignments, shipment_links).
- **Additive first**: new columns/tables/FKs/views. Dual-write + cache columns. Readers migrate later. Cleanup only after verification gates.
- **Source of truth** (see `.claude/rules/source-of-truth.md`): conditions, platforms, etc. live in one place.
- **Compose, don't fork**: use `SidebarRailShell`, event timelines, etc. The same rule applies to data modeling.
- **Degrade-not-fail** and teaching empty states remain mandatory.
- Workflow nodes and station blocks are code registries; the DB tables hold instance data/config.

## The reference contract — canonical DDL template

Codified from the two cleanest live examples (`part_links` `2026-06-28g`, `photo_entity_links` `2026-06-18`). Every new or refactored polymorphic/typed-fact table should match this skeleton. This is the concrete form of the "contract to codify" bullet above.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS <table> (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,                 -- NO default; enforce_tenant_isolation() installs the loud-fail GUC default
  -- ── polymorphic anchor (choose ONE naming convention; see Appendix A inconsistency #1) ──
  entity_type     TEXT NOT NULL,                 -- discriminator
  entity_id       BIGINT NOT NULL,               -- pick ONE id width project-wide (Appendix A #2: today INT/BIGINT/UUID all coexist)
  link_role       TEXT NOT NULL DEFAULT 'primary',-- optional 2nd axis (only photo_entity_links has this today)
  -- ... typed fact columns (promote queryable business facts to real columns; keep only true variant config in jsonb) ...
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Discriminator domain: NAMED CHECK (preferred) — not free text, not an inline unnamed CHECK.
-- Use a pg ENUM only for a small, stable, rarely-extended set (cf. work_assignments).
DO $$ BEGIN
  ALTER TABLE <table> ADD CONSTRAINT <table>_entity_type_chk
    CHECK (entity_type IN ('RECEIVING','ORDER',/* ... */));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Discriminated-union shape constraint (cf. part_links_parent_shape_chk): make illegal combinations unrepresentable.

-- Org-LED indexes (every unique/partial leads with organization_id — Appendix A #6).
CREATE UNIQUE INDEX IF NOT EXISTS ux_<table>_natural
  ON <table> (organization_id, entity_type, entity_id, link_role);
CREATE INDEX IF NOT EXISTS idx_<table>_entity
  ON <table> (organization_id, entity_type, entity_id);

-- Integrity: EITHER a real FK ON DELETE CASCADE on the non-polymorphic side (cf. receiving_exceptions, part_links),
-- OR a BEFORE-DELETE cascade/cancel trigger on EVERY parent the discriminator can name (cf. photos' 6-trigger family).
-- Do not ship a polymorphic id with neither (Appendix A #3/#4 — today documents/entity_notes/shipment_links orphan).

-- Tenant-from-birth: FORCE RLS in THIS migration, not a later backstop wave.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('<table>');
  END IF;
END $$;

COMMIT;
```

And **model it in Drizzle in the same PR** (Appendix A #8: `photo_entity_links`/`part_links` were never modeled, so type-level reads can't see them). `enforce_tenant_isolation()` lives in `2026-06-14_rls_enforcement_infra.sql`.

## Recommended target shapes (high-level)

### 1. Receiving / Receiving Lines

- `receiving` stays the **carton / LPN container** (physical package facts, dock timestamps, carton-level notes, lpn, priority, linked via `shipment_links`).
- `receiving_lines` becomes thinner operational unit + attaches typed facts via narrow tables or a `receiving_line_facts` (or direct child tables for high-volume concerns).
- All variant flow info routes through `type_id` (from the platform catalog) + `receiving_type` (line override).
- Exception/claim data already moving to `receiving_exceptions`.

### 2. Serial Units

- Keep `serial_units` as the **aggregate root** (identity, current_status, grade, location, unit_uid, sku_catalog link).
- Move origin provenance to `serial_unit_provenance` (polymorphic `origin_type` + `origin_id` + timestamps). Today `serial_units` carries a denormalized provenance family — `origin_source` (text) + `origin_receiving_line_id` (FK) + `origin_tsn_id`/`origin_sku_id` (integer soft-FKs, no `.references`) — i.e. the same "string + untyped int id" anti-pattern flagged in Appendix A.
- Variant attributes and unstructured data stay in `metadata` **only** when truly unstructured; otherwise typed history tables (already started with condition history, failure tags, repairs, quality scores).
- All lifecycle writes continue to flow through inventory_events + transition().

  **Worked DDL sketch** (collapses the `origin_*` family onto the contract; additive, backfillable from the existing columns):

  ```sql
  CREATE TABLE IF NOT EXISTS serial_unit_provenance (
    id              BIGSERIAL PRIMARY KEY,
    organization_id UUID NOT NULL,
    serial_unit_id  BIGINT NOT NULL REFERENCES serial_units(id) ON DELETE CASCADE,
    origin_type     TEXT NOT NULL,        -- CHECK ('RECEIVING_LINE','TECH_SERIAL','SKU_IMPORT','RETURN','FBA','MANUAL')
    origin_id       BIGINT,               -- the row in the origin_type's table (nullable for MANUAL)
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- named CHECK on origin_type; ux (organization_id, serial_unit_id, origin_type, origin_id);
  -- idx (organization_id, origin_type, origin_id) for where-used; enforce_tenant_isolation('serial_unit_provenance').
  -- Backfill: origin_receiving_line_id -> ('RECEIVING_LINE', id); origin_tsn_id -> ('TECH_SERIAL', id);
  --           origin_sku_id -> ('SKU_IMPORT', id); origin_source text maps to the CHECK vocabulary.
  ```

  The same shape generalizes to the **FBA fold** (Tier 1 #7): `order_unit_allocations` gains a destination discriminator (or a sibling `unit_allocations` with `dest_type IN ('ORDER','FBA_SHIPMENT')`), and `fba_shipment_tracking` collapses into `shipment_links` with `owner_type='FBA_SHIPMENT'`.

### 3. Orders & Channel Data

- `orders` stays relatively lean (core fulfillment facts + `type_id` + `sku_catalog_id`).
- Channel-specific realized facts (price at sale time, fulfillment channel details) move to thin `order_channel_facts` or are derived from allocations + events + platform listings.
- Use `platform_accounts` + `types` for account_source / fulfillment_channel normalization.

### 4. Events & Activity

- `inventory_events` evolves toward typed events (registry of allowed `event_type` + shape validation on payload, or narrow event subtype tables for frequent shapes).
- `station_activity_logs` can be slimmed or become a derived/denormalized view over the primary spines for operator visibility.
- `workflow_runs` and `warranty_claim_events` already follow append-only patterns — keep them.

### 5. Listings & Integrations

- `platform_listings` FKs to `platform_accounts` (or platform + account) instead of free-text `platform`/`account_name` (today they don't join the catalog at all — agree-by-string). `platform_metadata` (the junk-drawer jsonb) becomes a typed extension per platform (or small json-schema registry); the queryable fields already promoted to columns (`listing_price_cents` etc.) stay columns.
- `organization_integrations` gets full Drizzle modeling (it has **none** today) + the in-code `IntegrationProvider` union reconciled (drifted to 15 providers vs the migration's documented 12) + tighter linkage so `platforms.provider` / `platform_accounts.integration_scope` become *real* references (or a documented soft-link with a guard), not agree-by-string. Keep the good split: secrets in `payload_encrypted`, status facts in columns.
- **Decision to make:** turn the soft "agree-by-string" links (`platforms.provider`→`organization_integrations.provider`, `platform_accounts.integration_scope`→`...scope`, `types.workflow_node_id`/`station_definitions.workflow_node_id`→`workflow_nodes.id`) into real FKs, or formally bless them as soft-links with an app-side resolver + a consistency check. Right now they're neither enforced nor documented as intentionally-loose.

### 6. Workflow / Studio Config

- `workflow_nodes.config`, `station_definitions.config`, `workflow_templates.graph` remain jsonb but are governed by a registry + schema validation (node types are code; config shape is declared). The registry already exists: `src/lib/workflow/registry.ts` (`NodeDefinition` in `contract.ts`, `configSchema` per type; 11 registered types).
  - ✅ **`workflow_nodes.config` write-time validation SHIPPED 2026-07-04** (`src/lib/workflow/validate-config.ts` `validateNodeConfig(type, config)`): validates a node's config against its type's `configSchema` (declared-property types + `options` enums; permissive — no `required`/`additionalProperties:false`, unknown type / no-schema → ok). Wired into **both** write paths: the granular draft writers (`draftUpdateNodeConfig`/`draftReplaceNodeConfig` → 400 on violation) and the **publish gate** (`publishDefinition` emits an `invalid-config` error-severity `Diagnostic` → the existing `PUBLISH_BLOCKED` 422). So `workflow_nodes.type` + `config` is now an enforced tagged union at write time. **50 tests green** (validator unit + write-path + publish integration). This is the model jsonb pattern — replicate it for any new config blob rather than adding an untyped column.
  - Not done (deferred): a DB-side `jsonb` CHECK, and validation of `station_definitions.config` / `workflow_templates.graph` (blueprints are cloned, not directly edited).
- `item_workflow_state.context` accumulates node outputs in a defined shape per node.
- **Asymmetry to resolve:** live graphs are relational (`workflow_nodes` + `workflow_edges`), but `workflow_templates.graph` is a denormalized `{nodes,edges}` jsonb document. Pick one representation for blueprints, or document why the blueprint stays a blob (it's cloned, not queried).

## Phased migration strategy (additive, reversible, gated)

Each phase must be shippable. Follow the pattern from `platform-account-type-catalog-plan.md` and the inventory v2 / receiving redesign migrations.

**Phase 0 — Audit & Foundation (no schema change) — EXECUTED 2026-07-01**
- Finalize this plan + get buy-in. ✅
- Inventory every reader/writer of the key denorm columns and jsonb payloads. *(Appendices A–D are the starting inventory: the discriminator/jsonb/status column catalog is done; the remaining work — mapping each to its readers/writers in `src/lib` + `src/app/api` — is still open for Phase 1+.)*
- **Land the Data-integrity fixes first** ✅ — see the corrected findings above. Two of five (`reason_codes` CHECK, `sku_platform_ids` org_id) turned out to already be resolved before this pass ran; the Drizzle-drift and orphan-delete-trigger findings were fixed directly (`src/lib/drizzle/schema.ts` edits + `2026-07-01j_polymorphic_orphan_delete_triggers.sql`); the validation-trigger-vs-app question was decided (app-side, ratified in `.claude/rules/polymorphic-tables.md`). A real, unrelated tenant-isolation bug (`packer-log-enrichment.ts` / `packer-logs-week.ts` / `picking/sessions.ts`) surfaced during the `sku_platform_ids` investigation and is tracked separately, not fixed here.
- **Ratify the reference contract** ✅ — `.claude/rules/polymorphic-tables.md` (naming = `entity_type`/`entity_id`, id width = BIGINT default, named-CHECK-over-enum, integrity via real FK or a shared dispatch-on-`TG_ARGV[0]` trigger family, tenant-from-birth, model-in-Drizzle-same-PR). Applies to **new** surfaces only — existing ones (`shipment_links`' `owner_type`/`owner_id`, `work_assignments`' pg enum + INTEGER id, etc.) are not retroactively renamed.
- Add or strengthen partial indexes + integrity triggers for any new polymorphic surfaces. ✅ (the orphan-delete migration above)
- Create or expand the catalog resolvers (mirror `getOrgTypes` etc.). Not done — no new catalog resolvers were needed for the Phase-0 scope; revisit in Phase 1.
- Model the currently-unmodeled tables in Drizzle (`photo_entity_links`, `part_links`, `organization_integrations`). ✅ all three added to `src/lib/drizzle/schema.ts`, matched against live DDL column-for-column.

**Phase 1 — New structures + catalog linkage (additive) — IN PROGRESS (started 2026-07-01; `serial_unit_provenance` APPLIED 2026-07-03)**
- New tables or columns for provenance, typed facts, refined listings (e.g. `serial_unit_provenance`, improvements to `platform_listings`).
  - ✅ **`serial_unit_provenance`** authored + **APPLIED 2026-07-03**: `2026-07-01n_serial_unit_provenance.sql` (recorded in `schema_migrations`; verified live — FORCE RLS on, named CHECK + FK + PK + 4 org-led indexes, `tenant_isolation` policy installed). Collapses the `serial_units.origin_source`/`origin_receiving_line_id`/`origin_tsn_id`/`origin_sku_id` family onto the ratified contract: `origin_type` named CHECK (`RECEIVING_LINE|TECH_SERIAL|SKU_IMPORT|RETURN|FBA|MANUAL|LEGACY`) + `origin_id BIGINT`, `serial_unit_id INTEGER` FK `ON DELETE CASCADE` (matches `serial_units.id` = SERIAL), org-led natural/partial/where-used indexes, tenant-from-birth via `enforce_tenant_isolation()`. Idempotent in-migration backfill projected **1,131 rows** (RECEIVING_LINE 712, TECH_SERIAL 327, SKU_IMPORT 73, MANUAL 19; concrete id wins over `origin_source` text; `origin_id` NULL for text-only). Modeled in Drizzle (`serialUnitProvenance` in `src/lib/drizzle/schema.ts`) in the same change, per contract point 8. `RETURN`/`FBA` reserved for the Tier-1 #7 FBA-fold.
  - ✅ **`platform_listings` → `platform_accounts` FK** APPLIED 2026-07-03 (`2026-07-03r_platform_listings_account_fk.sql`): nullable `platform_account_id BIGINT` FK (`ON DELETE SET NULL`) + org-led index `idx_platform_listings_account` + Drizzle `platformAccountId`. No backfill — table is empty (0 rows); resolve at write time in the domain helper when writers land. `platform`/`account_name` stay as the read-through cache (reader migration = later phase).
  - Not yet done: other provenance/typed-fact tables (station_activity_logs polymorphic anchor, FBA fold, repair consolidation — all Tier-1, larger).
- Additive `*_type_id` or discriminator columns where missing.
- Update Drizzle schema + seeders. (`serial_unit_provenance` ✅)
- Idempotent backfill scripts (org-by-org via GUC). (`serial_unit_provenance` backfills in-migration ✅)
- **Phase 1 is NOT reader-migrated:** nothing reads `serial_unit_provenance` yet; `serial_units.origin_*` stay the live source (dual-write + reader cutover are Phases 2–3).

**Phase 2 — Dual write + cache columns — `serial_unit_provenance` DONE 2026-07-03**
- Writers set both the old denorm/text columns **and** the new normalized/polymorphic fields.
- Keep old columns as read-through caches.
- Update domain helpers (`src/lib/receiving/...`, inventory state machine side effects, workflow taps) to use the new paths internally.
- ✅ **`serial_unit_provenance` dual-write APPLIED**: `2026-07-03a_serial_unit_provenance_dualwrite_trigger.sql`. A trigger-maintained projection (`fn_sync_serial_unit_provenance` / `trg_sync_serial_unit_provenance`, AFTER INSERT OR UPDATE OF the `origin_*` columns) — chosen over app-side dual-write because `serial_units` is INSERTed from 3 paths + COALESCE-updated later, and a trigger covers all with zero missed sites (mirrors the `sku_stock` projection pattern). Verified live: trigger enabled, exact parity (RECEIVING_LINE 706=706, TECH_SERIAL 327=327 concrete edges), 0 concrete-id units missing an edge, live-fire smoke test (an `origin_tsn_id` UPDATE materialized a `TECH_SERIAL` edge 0→1). `serial_units.origin_*` stay the live read source.

**Phase 3 — Reader migration — COMPLETE 2026-07-03 (plan-literal, all 4 columns); write-side + drop remain**
- ✅ **All ~20 `origin_*` readers migrated** off `serial_units.origin_*` onto `v_serial_unit_origins` (augment reads) / indexed `serial_unit_provenance` subqueries (filter-by-origin), across `serial-units-queries.ts`, `line-catalog.ts`, `receive-line.ts`, `serial-attach.ts`, `journey.ts`, `handling-unit-queries.ts`, `photos/queries/library.ts`, `zendesk-claim-template.ts`, `tech-aggregator.ts`, `mark-received-po`, `receiving/[id]`, `recordTestVerdict.ts`, `recordDataWipe.ts`, `receiving-lines/route.ts`, `serial-units/[id]/route.ts`, `trace-aggregator.ts`, `sku/by-tracking`. Verified: **tsc clean, 25 unit tests pass, live parity 0 mismatches, zero remaining raw `su.origin_*` reads**. Display components (ByUnitView, unit-detail, AuditLogTrace) are fed by the migrated routes — no change needed. **Stable dual-state**: writes still populate both columns and provenance (trigger); reads come from provenance/view.
- ⏭ **Remaining before the Phase-4 drop = write-side only**: move the `origin_*` writes in `upsertSerialUnit` / `mark-received` / `insertTechSerialForTracking` to app-side `serial_unit_provenance` inserts, retire the dual-write trigger, and drop the 4 fields from the SELECT-result types + Drizzle. Checklist in the `.BLOCKED` migration header.

**Phase 3 (historical) — Reader migration — foundation built + parity-proven 2026-07-03**
- UI components, queries, aggregators, reports, and audit timelines read from the normalized/polymorphic side (via resolvers or views).
- Old columns become write-only during transition.
- ✅ **Reconstruction view `v_serial_unit_origins`** (`2026-07-03c_serial_unit_origins_view.sql`, APPLIED, `security_invoker` so tenant RLS holds): rebuilds all four `origin_*` fields from `serial_unit_provenance`. **Parity-proven against live data: 0 mismatches across 1,130 units** for the three id columns (lossless); `origin_source` is a semantic display label only (327 `legacy_tsn_backfill` → `tsn`/`receiving`, accepted — `defaultStatusForSource` reads write-input, not the column).
- ⚠️ **Blocker for `origin_receiving_line_id`:** it is a **load-bearing functional FK**, not vestigial provenance — ~20 live paths read it as the frozen fallback in `COALESCE(current_receiving_line_id, origin_receiving_line_id)` (testing scans, journey, photo→line joins, handling-unit grouping, tech aggregator, zendesk). These are raw SQL strings in TS template literals: **`tsc` doesn't typecheck them and the unit tests only regex the SQL shape** — a wrong rewrite silently returns the wrong receiving line and passes CI. The full reader inventory + the per-read-type rewrite recipe (augment→view-join; filter-by-origin→indexed provenance subquery) + a per-reader parity-verify mandate live in the Phase 4 migration header (`...drop_origin_columns.sql.BLOCKED`). Each reader migrates + parity-verifies individually; un-block Phase 4 only when the checklist is green.

**Phase 4 — Cleanup — `serial_units.origin_*` DROP APPLIED LIVE 2026-07-03 ✅ (arc COMPLETE)**
- ✅ **`2026-07-03b` applied** (recorded in `schema_migrations`): all 4 `origin_*` columns + the dual-write trigger/function dropped. The dependency check surfaced two DB **views** (not code readers) that referenced the columns — both redefined in the same migration first: `v_unfound_queue` (join → `serial_unit_provenance`) and `v_sku` (dead `origin_sku_id` branch removed; output byte-identical). Verified post-drop: tsc clean · 25 tests · live reader (provenance subquery) + writer (INSERT sans `origin_*`) + both views all work · `serial_unit_provenance` 1,131 rows + `v_serial_unit_origins` intact.
- ⚠️ **Applied pre-deploy at owner's explicit direction.** The migrated code is still uncommitted (HEAD `2b39d809`), so the **live deployment now errors on its old `origin_*` reads until this branch is committed + deployed.** Deploy the branch to restore production.

**Phase 4 (superseded status line) — CODE-COMPLETE + VERIFIED 2026-07-03**
- ✅ **Write-side migrated**: `upsertSerialUnit` (INSERT + UPDATE), `mark-received` fallback INSERT, and `insertTechSerialForTracking` no longer write `origin_*`; a shared exported `recordOriginProvenance()` helper (first-wins per `origin_type` via `NOT EXISTS`, ON CONFLICT, on the txn client) writes the edges app-side — replacing the Phase-2 trigger. `SerialUnitRow` de-columned (input keeps `origin_*` as the write API → provenance); Drizzle `serialUnits` de-columned. **Verified: tsc clean · 20 unit tests pass · live write smoke test (INSERT without `origin_*`, first-wins edge, view reconstruction) · live parity 0 mismatches.**
- 🚧 **The DROP itself (`2026-07-03b_..._.sql.BLOCKED`) is DEPLOY-GATED, not code-gated.** The migrated code is uncommitted/undeployed; production runs `2b39d809` whose readers+writers still reference `origin_*`. Applying the DROP against the shared prod DB now would 500 the live app. **Apply order: (1) commit+deploy this branch, (2) verify the deployed app, (3) rename `.BLOCKED`→`.sql` + run.** This is the one irreducibly human step — it needs a deploy the agent can't perform.

**Phase 4 (template) — Cleanup**
- Drop CHECK constraints, old columns, and legacy tables only after:
  - `grep` + static analysis proves zero remaining readers.
  - Full test suite + e2e passes.
  - Verification reports for data parity.
- Gated behind feature flags or explicit cleanup waves (see dead-code patterns).
- 🔒 **`2026-07-03b_serial_units_drop_origin_columns.sql.BLOCKED`** — drops the four `origin_*` columns + the Phase-2 trigger. Authored complete with rollback + the full Phase-3 reader checklist embedded, but shipped with a `.BLOCKED` extension so the runner (which globs `*.sql`) cannot pick it up. Un-block (rename → `.sql`) **only** after every checklist item migrates to `serial_unit_provenance`, the writes move app-side, `serialUnits` is de-columned in Drizzle, and an app smoke test passes. Deliberately not applied this pass — it fails the Phase-4 gate above (no e2e/data-parity run available here) and dropping a functional FK blind risks silent line-resolution corruption for live tenants.

**Safety invariants across phases**
- All writes go through existing domain chokepoints (never ad-hoc UPDATEs on status or core facts).
- `clientEventId` / idempotency preserved.
- Audit rows continue to be written via `recordAudit`.
- RLS / org scoping never bypassed.
- Performance regression gates (indexes on new FKs + discriminator columns).

## Cross-cutting impact areas

- **Inventory v2 / state machine**: any new tables must participate in `transition()` / `applyTransition()` flows and emit `inventory_events`.
- **Workflow engine + Studio**: nodes will be able to declare required entity shapes more cleanly; item_workflow_state benefits from better typed units.
- **Receiving redesign**: continue the direction of the 2026-06 line-level work.
- **Platform catalog**: this plan is a natural extension — listings, orders, and receiving should all resolve through `type_id` → platform_account → integration.
- **Zoho / external syncs**: mirrors stay, but the internal operational model becomes the source of truth.
- **Audit / timelines / reports**: `AuditTimeline`, `EventTimeline`, and aggregators must consume the new shapes (or stay on the event spine).
- **UI / display archetypes**: Workbench pickers, station cards, and Monitor timelines will see richer typed data.
- **Tenancy / RLS**: every new table must be org-scoped from birth (use `orgIdCol()`).

## Risks & mitigations

- **Blast radius of denorm columns** (account_source, source_platform, etc.): keep caches; migrate readers last (as done for the platform catalog).
- **Data volume on events/logs**: new indexes must be partial + selective.
- **Drift between Drizzle and live schema**: treat migrations as the source of truth during transition; reconcile explicitly.
- **Workflow / Studio coupling**: node config changes must remain backward-compatible for published definitions.
- **Rollback**: every step additive or behind a feature flag + clear rollback SQL.
- **Performance**: new joins must be covered by indexes; consider materialized views or denorm caches for hot paths.

## Verification & success criteria

- Every Tier 1 table has a clear "before" vs "after" shape documented in this plan + a migration that is additive.
- Existing behavior (UI, reports, sync jobs, station scans) is unchanged until explicit reader migration phases.
- New orgs can define custom flows/types without schema changes.
- `npx tsc --noEmit`, build, and full test suite pass at each gate.
- Backfill scripts produce dry-run reports with zero silent data loss.
- Audit and timeline surfaces show the same history before and after.
- A new channel or custom receiving type can be added with only catalog data + (optionally) a new workflow node.

## Open questions

- Should we introduce a small `entity_kinds` or registry table for the discriminator values, or keep them as constrained text + enums in code?
- How far do we push typed event subtypes vs a validated `payload` registry?
- Do `sales_orders` / Zoho mirrors need parallel polymorphic treatment, or are they acceptable as external mirrors?
- Is there a point at which we extract a narrow `units` base + `inventory_items` / `consumables` distinction?
- Should `platform_listings` become the single source for listed state (price/qty/condition) with `serial_units` only representing physical stock?
- **Standardize the polymorphic column convention** — `entity_type`/`entity_id` vs `owner_type`/`owner_id` (Appendix A #1). Pick one for all new surfaces; leave existing ones or rename in a cleanup wave?
- **Unify the polymorphic id width** — today `INTEGER` / `BIGINT` / `UUID` all coexist as `entity_id`/`owner_id` (Appendix A #2). A generic helper/contract can't assume one; settle on `BIGINT` (most common) + a documented exception list?
- **Discriminator-constraint policy** — named CHECK as default, pg-enum only for small stable sets? (Appendix D: only ~10 of ~70 status columns are real enums today.) Where's the line, given enum `ALTER TYPE ... ADD VALUE` is awkward but CHECK redefinition caused the `reason_codes` regression?
- **Entity-existence validation** — does the contract mandate a validation trigger (none exist now), or formally delegate to the writing lib function (the post-Phase-E `photos` choice)?
- **FBA fold sequencing** — fold `fba_*` onto the spine vs the `tech_serial_numbers` strangle: which leads, and can they share one migration arc?
- **One repair model** — collapse `repair_service` / `unit_repairs` / `warranty_repair_attempts` onto `unit_repairs`' serial-anchored + event-cross-linked shape; what's the back-compat path for the legacy `repair_service` (no `serial_unit_id`) rows?

## References & related docs

- `.claude/rules/backend-patterns.md` — transition(), audit, tenant scoping, Deps injection.
- `.claude/rules/source-of-truth.md`
- `context/inventory_system_upgrade_plan.md`
- `docs/todo/platform-account-type-catalog-plan.md` *(moved from `docs/` root; root copy deleted)* + status at `docs/partial/platform-account-type-catalog-STATUS.md`.
- `docs/pending-migrations-plan.md`
- **Reference-contract migrations (codify these):** `2026-06-28g_part_links.sql` (tenant-from-birth template), `2026-06-18_photos_platform_side_tables.sql` (`photo_entity_links` normalized hub), `2026-06-21_photos_phase_e_drop_legacy_columns.sql` (the polymorphic-link extraction), `2026-06-14_rls_enforcement_infra.sql` (`enforce_tenant_isolation()` definition).
- **Spine / surface migrations:** `2026-04-10_create_serial_units.sql`, `2026-05-13_create_inventory_events.sql`, `2026-06-17_platform_listings.sql`, `2026-06-24_receiving_exceptions.sql`, `2026-06-24_shipment_links.sql`, `2026-06-28q_drop_legacy_shipment_link_tables.sql`, `2026-05-22_organization_integrations.sql`, `0000_baseline_through_2026-03.sql` (work_assignments + photos triggers), and the `reason_codes` chain (`2026-06-28d`/`28e` — the CHECK regression).
- Key modules: `src/lib/drizzle/schema.ts`, `src/lib/inventory/state-machine.ts`, `src/lib/workflow/` (`registry.ts`, `contract.ts` — node-type registry), `src/lib/receiving/`, `src/lib/integrations/credentials.ts` (the un-modeled `organization_integrations` access), `src/lib/audit-logs.ts`.
- Existing polymorphic surfaces detailed in **Appendix A** below.

## Next steps (once approved)

1. Flesh out per-table detailed DDL sketches + backfill queries in a follow-up PR or sibling doc.
2. Produce an ordered list of concrete migration filenames (additive only).
3. Pair with ongoing receiving redesign and platform catalog rollout.
4. Update this plan with actual migration names and status as work proceeds (move to `docs/partial/` when active).

This plan turns the comprehensive scan into an actionable, safe, phased architecture improvement that makes the SaaS more extensible while protecting existing invariants.

---

# Appendix A — Existing polymorphic-surface contract matrix (scan 2026-06-29)

Exact shape of every discriminator/polymorphic surface, against the contract in "The reference contract" above. This is the gap analysis for "standardize the contract."

| Surface | Discriminator | id type | Constraint mechanism | Parent-delete integrity | Org-scoped unique? | Drizzle model |
|---|---|---|---|---|---|---|
| `photo_entity_links` | `entity_type` + `entity_id` (+ 2nd axis `link_role`) | **BIGINT** | **named CHECK** (9 entity types, 3 roles) | cascade FK→`photos` + 6 parent-delete triggers (`fn_delete_photos_on_parent_delete`) | no (`photo_id,entity_type,entity_id,link_role`) | **not modeled** |
| `work_assignments` | `entity_type` + `entity_id` (+ `work_type`) | INT | **pg ENUM** (`work_entity_type_enum` — the only enum) | **cancel** trigger, **ORDER+RECEIVING only** (3 enum vals uncovered) | no (global `entity_type,entity_id,work_type`) | omits `organization_id` |
| `shipment_links` | `owner_type` + `owner_id` (+ `direction`, `role`) | INT | inline CHECK (owner_type, direction); `role` **free text** | **NONE** (owner delete orphans) | **yes** (partial `WHERE is_primary`) | modeled ✓ |
| `documents` | `entity_type` + `entity_id` | INT | **none — free text** | **NONE** | **none** | omits `organization_id` |
| `entity_notes` | `entity_type` + `entity_id` | **UUID** | **none — free text** | **NONE** | **none** | modeled ✓ (has org_id) |
| `receiving_exceptions` | `exception_code` + `status` (not owner-poly) | — | none — free text (app-validated) | FK `ON DELETE CASCADE` (real parents) | **none** | modeled ✓ |
| `part_links` | `status` (+ hard FK parent) | — | **named CHECK** + shape CHECK | FK `ON DELETE CASCADE` | **yes** (org-led partial uniques) | **not modeled** |
| `reason_codes` | `flow_context` (multi-vocabulary) | — | **named CHECK** | none (lookup table) | **yes** (`org,flow_context,code`) | **severely stale** (5 cols missing) |

**The 10 cross-surface inconsistencies to normalize:**
1. **Two naming conventions** — `entity_type`/`entity_id` (5 surfaces) vs `owner_type`/`owner_id` (`shipment_links`).
2. **id type not uniform** — INT (`documents`, `work_assignments`, `shipment_links`) vs BIGINT (`photo_entity_links`) vs UUID (`entity_notes`). A generic helper can't assume one.
3. **Discriminator-constraint mechanism is all over the map** — pg enum (1) / named CHECK (3) / inline unnamed CHECK (1) / no constraint, free text (the rest).
4. **Integrity triggers inconsistent & partly absent** — `photos` has a 6-trigger cascade family; `work_assignments` cancels (2 of 5 entity types); `documents`/`entity_notes`/`shipment_links`-owner have **none** (orphan on parent delete); `receiving_exceptions`/`part_links` sidestep via real FK.
5. **Entity-existence validation exists nowhere** — the only validator (`fn_validate_photo_entity_ref`) was removed in Phase E.
6. **Org-scoping of the unique key is inconsistent** — org-led (`shipment_links`, `part_links`, `reason_codes`) vs global (`work_assignments`) vs none (`documents`, `entity_notes`, `receiving_exceptions`).
7. **FORCE-RLS timing differs** — at birth (`part_links`) vs armed-then-FORCEd in a backstop wave (`shipment_links`, `receiving_exceptions`) vs bulk-retrofit (`photos`, `work_assignments`, `documents`, `entity_notes`, `reason_codes`).
8. **Drizzle model drift (high-risk)** — see Data-integrity findings #2.
9. **Live CHECK regression in `reason_codes`** — see Data-integrity findings #1.
10. **Only `photo_entity_links` has a true second discriminator axis** (`link_role`); `shipment_links` approximates it with `is_primary` + free-text `role`; nothing else supports multi-role.

# Appendix B — Tier-1 monolith before-snapshots (scan 2026-06-29)

Exact current shape from `src/lib/drizzle/schema.ts` (the live DB is *wider* than the model for the two starred rows — see Data-integrity #2).

| Table | Const | Lines | Cols | NOT NULL | jsonb | Zoho-mirror cols | Headline issue |
|---|---|---|---|---|---|---|---|
| `orders` | `orders` | 915–950 | 22 | 2 | `status_history` | 0 | `account_source` denorm cache; text-typed `quantity`/`out_of_stock` |
| `station_activity_logs` | `stationActivityLogs` | 975–997 | 17 | 5 | `metadata` | 0 | 7 sparse FK anchors — but **CO-OCCURRING** (35% of rows set 2+), *not* mutually-exclusive → NOT a single-pair candidate (see Tier-1 #5 correction) |
| `receiving` | `receiving` | 1014–1077 | 37 | 10 | none | 5 | "Drift reconciliation (2026-06-19)" 12-col block; decomposition underway |
| `receiving_lines` | `receivingLines` | 1151–1247 | **51** | 12 | `disposition_audit` | 11 | widest table; `receiving_line_status` derive-dup; carton/line duplication |
| `serial_units` ★ | `serialUnits` | 2110–2146 | 24 | 7 | `metadata` | 1 | `origin_*` provenance trio; **`organization_id` only in SQL migrations** |
| `inventory_events` | `inventoryEvents` | 2189–2218 | 20 | 5 | `payload` | 0 | cleanest; 8 sparse anchors; `client_event_id` UNIQUE idempotency |

# Appendix C — jsonb inventory (48 columns) + the variant-config-vs-junk-drawer taxonomy

**Taxonomy (the actionable split):**
- **Legitimate variant config / runtime state (keep; govern with a per-discriminator schema):** `workflow_nodes.config` (shape keyed by `type`), `station_definitions.config`, `workflow_templates.graph`, `item_workflow_state.context`, `workflow_definitions.annotations` (pure canvas decoration), `organizations.settings`, `cycle_count_campaigns.scope`, `qc_check_templates.value_enum`. `organization_integrations.payload_encrypted` is the model case (opaque secret blob, queryable status promoted to columns) — though it's `text`, not `jsonb`.
- **Append-only audit/event payloads (acceptable on the event spine; type the `event_type`→`payload` shape):** `inventory_events.payload`, `station_activity_logs.metadata`, `warranty_claim_events.payload`, `fba_fnsku_logs.metadata`, `orders.status_history`, `receiving_lines.disposition_audit`, `repair_service.status_history`, `auth_audit.detail`.
- **External-mirror blobs (by design for Zoho sync; lower priority):** `customers.{billing_address,shipping_address,custom_fields,channel_refs}`, `items.custom_fields`, `sales_orders.{line_items,billing_address,shipping_address}`, `packages.line_items`, `invoices.custom_fields`, `credit_notes.{line_items,custom_fields}`, `item_adjustments.line_items`, `zoho_fulfillment_sync.raw`, `zoho_locations.address`. ⚠️ `customers` **double-stores address** (flat columns + jsonb).
- **Junk-drawer business facts (flag — structure these):** **`platform_listings.platform_metadata`** (nullable, no comment, no discriminator, beside already-structured price/qty/condition columns) — the clearest offender. Watch: `unit_quality_scores.risk_reasons`, `unit_repairs.parts_used`, `warranty_repair_attempts.{parts_used,photo_attachment_ids}`, `warranty_quotes.line_items`, `sourcing_candidates.raw`, `ai_chat_messages.analysis`, `documents.document_data`, `favorite_skus.metadata`, `serial_units.metadata`, `staff.mobile_display_config`, `roles.mobile_defaults`, `amazon_accounts.marketplace_ids`, `training_samples.file_paths`, `pipeline_tasks.file_paths`.

(48 columns total across 40 tables — the four buckets above are exhaustive.)

# Appendix D — Discriminator & status-column inventory (scan 2026-06-29)

**The headline:** of **~70 status/state/disposition/grade/condition columns across ~50 tables, only ~10 are real Postgres enums.** The other ~50 are free-text `TEXT`/`varchar` with the allowed set living only in a code comment or a CHECK — the implicit subtypes to consolidate.

- **The 10 real pg enums (exhaustive):** `serial_status_enum` (19 states), `inbound_workflow_status_enum` (11), `qa_status_enum`, `disposition_enum`, `condition_grade_enum`, `assignment_status_enum`, `replenishment_status`, `admin_feature_status_enum`, `training_sample_status`, `training_run_status`. Plus the small discriminator enums `work_entity_type_enum`, `work_type_enum`, `return_platform_enum`, `target_channel_enum`.
- **High-value free-text status columns** (values in comments only — prime consolidation targets): `orders.status`, `sales_orders.{status,return_status}` + every Zoho-mirror `status`, `receiving_lines.receiving_line_status` (`INCOMING|SCANNED|UNBOXED|RECEIVED`, no enum yet), `receiving_lines.disposition_final`, `repair_service.status`, `unit_repairs.status`, `warranty_claims.status` (8 states), `warranty_quotes.status`, `fba_shipments.status`, `fba_shipment_items.status`, `sku_catalog.lifecycle_status`, `platform_listings.sync_status`, `pending_skus.status`, the whole `sourcing_*`/`part_acquisitions.status` chain, `item_workflow_state.status`, `order_unit_allocations.state`.

**`entity_type` is the worst polymorphic-sprawl discriminator — 6 tables, all `entity_id`, mostly free-text:** `customers`, `entity_notes`, `documents`, `location_transfers` (`SKU_STOCK|SKU_RECORD`), `photos`→now `photo_entity_links` (`RECEIVING|RECEIVING_LINE|PACKER_LOG|SERIAL_UNIT|SKU|SKU_STOCK|BIN_ADJUSTMENT|SHARE_PACK|ZENDESK_TICKET`), and `work_assignments` (the one enum). Plus the untyped `*_kind`/`*_id` pairs: `tech_verifications.{source_kind/source_row_id, step_type/step_id}`, `customers.entity_type/entity_id`.

**The channel cluster mid-migration** (denormalized text caches coexisting with the normalized `type_id`→`types`→`platform_accounts`→`platforms` catalog): `receiving.{source_platform(CHECK),intake_type,source,target_channel(enum),return_platform(enum)}`, `receiving_lines.{source_platform_pill,intake_type,receiving_type,source_system}`, `orders.{account_source,fulfillment_channel}`. Comments explicitly label `intake_type`/`account_source` as "denormalized cache." `event_type` repeats across 3 append-only tables (`inventory_events`, `fba_fnsku_logs`, `warranty_claim_events`), each free-text with its own vocabulary. `platform`/`provider`/`sso_provider` duplicate channel/integration identity across `ebay_accounts`, `sku_platform_ids`, `platform_listings`, `platforms`, `staff`, `accounts`, `account_identities` instead of FK-ing the catalog or `organization_integrations`.