I have everything I need. Here is the Phase B plan.

---

# Phase B — Schema Coverage Plan (org_id + RLS readiness)

Source of truth: `docs/tenancy/coverage.generated.json`. Reference column pattern: `src/lib/migrations/2026-05-23_org_id_on_business_tables.sql`. Enforcement helpers: `src/lib/migrations/2026-06-14_rls_enforcement_infra.sql` (`enforce_tenant_isolation`/`relax_tenant_isolation`). Drizzle helper: `orgIdCol()` at `src/lib/drizzle/schema.ts:5`.

## 0. The core architectural decision: denormalize org_id everywhere

**Recommendation: every tenant-scoped table gets a denormalized `organization_id` column. Do NOT use transitive `EXISTS`-subquery policies for any of the 49 child tables.** Reasons specific to this repo:

1. **The canonical policy is column-equality only.** Both `2026-05-23` (`USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)`) and `enforce_tenant_isolation` (`src/lib/migrations/2026-06-14_rls_enforcement_infra.sql:54-58`) generate a flat `organization_id = GUC` predicate plus a matching `WITH CHECK`. An EXISTS-subquery policy cannot reuse either helper — you'd hand-author and maintain 49 bespoke policies, breaking the "one canonical policy" invariant the whole Phase A infra is built on.
2. **`WITH CHECK` on a subquery is a footgun.** `enforce_tenant_isolation` adds `WITH CHECK`. An EXISTS-based check has to re-query the parent on every INSERT/UPDATE — and several children point at parents that themselves only get org_id in *this* phase (e.g. `shipping_tracking_numbers`, `warehouses`, `suppliers`), so the subquery target wouldn't even have the column until its batch lands. Ordering hell.
3. **Index speed.** The established pattern creates `idx_<table>_organization` (step 5). A flat column is a single-column btree scan; an EXISTS policy forces a parent join on every row read on hot tables like `station_scan_sessions` (1344 rows), `receiving_scans` (1678), `mobile_scan_events` (17268), `shipment_tracking_events` (18135).
4. **Backfill is trivial via the parent.** Every child already has an FK to a parent that has (or is getting) org_id, so the backfill `UPDATE child SET organization_id = parent.organization_id FROM parent WHERE ...` is a one-liner per table.

The only place transitive logic is acceptable is the `staff`-only children where `staff.organization_id` already exists and is the natural authority — but even there we denormalize the column and backfill from `staff` once, rather than subquery forever.

**One exception to "add a column":** `staff` and `staff_sessions` already HAVE `organization_id` (and FK) but no RLS policy — they only need `enforce_tenant_isolation`, handled in the RLS-only batch, not a column batch.

---

## 1. Ordered migration batches (parents before children)

Each batch is one dated SQL file under `src/lib/migrations/`. Files B1–B5 ADD COLUMNS (using the DO-block template in §1.6). File B6 turns on RLS for already-columned tables. **Do not call `enforce_tenant_isolation` (FORCE) in any of these** — that's Phase C, gated on routes moving to `withTenantConnection`. These batches use the *transitional* `2026-05-23` pattern (ENABLE + non-forced policy + USAV-fallback default) so the 342 raw-pool routes keep working.

### Batch B1 — `2026-06-15_org_id_phase_b_roots.sql` — independent roots (no tenant-scoped FK parent)
These are the parents that other tables scope through; they must get org_id first.

| Table | Rows | In schema.ts? | Backfill source |
|---|---|---|---|
| `warehouses` | 1 | no | USAV fallback (`staff`, `locations`, `sku_stock` all FK to it) |
| `shipping_tracking_numbers` | 5700 | no | USAV fallback (huge fan-in: orders, receiving, fba_*, station_*) |
| `suppliers` | — | yes (`schema.ts:1630`) | USAV fallback |
| `zoho_po_mirror` | 3477 | no | USAV fallback |
| `zoho_item_images` | 214 | no | USAV fallback |
| `sku_management` | 100 | no | USAV fallback |
| `square_transactions` | 50 | no | USAV fallback |
| `messages` | — | no | USAV fallback |
| `google_photos_albums` | — | no | USAV fallback |
| `google_photos_settings` | — | no | USAV fallback |
| `operations_kpi_rollup_state` | — | no | USAV fallback |
| `api_idempotency_responses` | 277 | no | USAV fallback |
| `hermes_insights` | — | no | USAV fallback (parent of `hermes_outcomes`) |
| `hermes_precision_scores` | — | no | USAV fallback |
| `hermes_thresholds` | — | no | USAV fallback |

`warehouses` and `shipping_tracking_numbers` MUST be in B1 because `locations`/`staff`/`sku_stock` and a dozen children read through them.

### Batch B2 — `2026-06-16_org_id_phase_b_tracking_children.sql` — children of B1 roots
Run after B1 so backfill-from-parent works.

| Table | Backfill via |
|---|---|
| `shipment_tracking_events` (18135) | `shipping_tracking_numbers.organization_id` (now exists) |
| `hermes_outcomes` | `hermes_insights.organization_id` |
| `repair_failure_resolutions` (schema.ts:2099) | `unit_repairs` (gets col in B4) OR `failure_modes`+USAV — backfill from USAV fallback, it's near-empty |

### Batch B3 — `2026-06-17_org_id_phase_b_staff_children.sql` — `staff`-scoped children (largest group)
`staff` already has org_id, so backfill = `FROM staff WHERE staff.id = child.<staff_fk>`. Pure-`staff` scopers:

`auth_audit`, `google_oauth_tokens`, `google_photos_backup_runs`, `mobile_scan_events`, `operations_kpi_rollups_daily`, `operations_kpi_rollups_hourly`, `pay_periods`, `payroll_settings`, `staff_availability_rules`, `staff_enrollments`, `staff_goal_history`, `staff_goals`, `staff_passkeys`, `staff_pay_rates`, `staff_schedule_overrides`, `staff_stations`, `staff_todo_completions`, `staff_todos`, `staff_week_plans`, `staff_weekly_schedule`, `time_off_requests`, `time_punches`.

Plus `staff_stepups` (scoper `staff_sessions` — already has org_id; backfill from `staff_sessions`).

### Batch B4 — `2026-06-18_org_id_phase_b_domain_children.sql` — children of `sku_catalog`/`receiving`/`orders`/`serial_units`/`repair_service` (all of which already have org_id)
Ordered so multi-parent children come last:

`product_manuals` (sku_catalog), `sourcing_candidates` (sku_catalog), `sourcing_alerts` (sku_catalog,staff), `pending_skus` (sku_catalog,staff), `sku_pairing_suggestions` (sku_catalog,sku_platform_ids), `sku_pairing_audit` (sku_catalog,sku_platform_ids,staff), `local_pickup_order_items` (receiving), `local_pickup_orders` (staff,receiving), `receiving_scans` (receiving,staff), `receiving_shipments` (receiving,staff — schema.ts:935), `tracking_exceptions` (staff,receiving), `picking_sessions` (orders,staff), `rma_authorizations` (orders,customers,staff), `repair_actions` (repair_service,staff), `part_acquisitions` (sku_catalog,receiving,serial_units), `unit_quality_scores` (serial_units), `unit_failure_tags` (serial_units,staff,inventory_events), `unit_repairs` (staff,repair_service,serial_units,…), `testing_results` (serial_units,receiving_lines,staff,inventory_events), `handling_units` (locations,staff), `replenishment_tasks` (locations,staff), `shift_templates` (staff,locations), `shifts` (shift_templates,staff,locations), `station_scan_sessions` (staff,orders_exceptions).

For each, backfill from the **first scoper that already has org_id** (pick `staff` when present — simplest single-FK backfill).

### Batch B5 — `2026-06-19_org_id_phase_b_workflow_children.sql` — workflow graph children
`workflow_definitions` already has org_id (loud-fail default). Children:
`workflow_edges`, `workflow_nodes` → backfill from `workflow_definitions`. (Note: `workflow_definitions`, `workflow_runs`, `workflow_node_stats`, `item_workflow_state`, `sku_relationships`, `station_definitions`, `warranty_*` already have the column with **loud-fail** default — they only need RLS, see B6.)

### Batch B6 — `2026-06-20_rls_phase_b_enable_armed.sql` — RLS ENABLE + policy for tables that ALREADY have org_id but no policy (23 tables)
No column work. For each, ENABLE RLS + create the non-forced `<t>_tenant_isolation` policy + `hermes_agent_read` (mirroring step 6 of `2026-05-23`). These are the "~25 tables that have org_id but no RLS policy yet":

`audit_logs`, `billing_subscriptions`, `email_delivery_signals`, `email_missing_purchase_orders`, `item_workflow_state`, `order_ingest_queue`, `rag_document_chunks`, `rag_documents`, `sku_relationships`, `staff`, `staff_messages`, `staff_sessions`, `station_definitions`, `ticket_links`, `unfound_overlay`, `warranty_claim_events`, `warranty_claims`, `warranty_quotes`, `warranty_repair_attempts`, `workflow_definitions`, `workflow_node_stats`, `workflow_runs`, `zoho_fulfillment_sync`.

Special handling inside B6:
- **Nullable-org tables** (`audit_logs`, `order_ingest_queue`, `stripe_events`, `zoho_fulfillment_sync`) — see §3. Backfill + `SET NOT NULL` BEFORE enabling the policy, or the policy silently drops NULL-org rows.
- **`stripe_events`, `organization_integrations`** — system-global per the audit; **skip RLS** (kept in B6 only as an explicit "do not enforce" comment so a future reader knows it was deliberate).

### Batch ordering rationale (dependency-correct)
B1 (roots `warehouses`, `shipping_tracking_numbers`, …) → B2/B3/B4/B5 (children backfill from now-columned parents) → B6 (arm RLS on everything that has the column). Every child's backfill-source column exists before that child's batch runs.

### 1.6 — The exact idempotent migration DO-block template (extends the `2026-05-23` pattern)

Use this for B1 (independent roots, USAV-fallback backfill):

```sql
-- 2026-06-15_org_id_phase_b_roots.sql
-- Phase B coverage: add organization_id to tenant-owned tables that still lack it.
-- Follows src/lib/migrations/2026-05-23_org_id_on_business_tables.sql exactly:
--   ADD COLUMN NOT NULL DEFAULT '<USAV>' (implicit backfill) → flip DEFAULT to the
--   tenant GUC → FK → index → ENABLE RLS + non-forced tenant_isolation policy.
-- NOT FORCEd: raw-pool routes still work. FORCE is Phase C via enforce_tenant_isolation().
-- Idempotent: every step guarded by IF (NOT) EXISTS.
DO $$
DECLARE
  business_table text;
  business_tables text[] := ARRAY[
    'warehouses','shipping_tracking_numbers','suppliers','zoho_po_mirror',
    'zoho_item_images','sku_management','square_transactions','messages',
    'google_photos_albums','google_photos_settings','operations_kpi_rollup_state',
    'api_idempotency_responses','hermes_insights','hermes_precision_scores',
    'hermes_thresholds'
  ];
  table_exists boolean;
  col_exists boolean;
BEGIN
  FOREACH business_table IN ARRAY business_tables LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=''public'' AND table_name=%L)',
      business_table) INTO table_exists;
    IF NOT table_exists THEN
      RAISE NOTICE 'skipping % — table does not exist', business_table; CONTINUE;
    END IF;

    -- 1. add column with USAV backfill default
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=''public'' AND table_name=%L AND column_name=''organization_id'')',
      business_table) INTO col_exists;
    IF NOT col_exists THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN organization_id uuid NOT NULL DEFAULT ''00000000-0000-0000-0000-000000000001''',
        business_table);
      RAISE NOTICE 'added organization_id to %', business_table;
    END IF;

    -- 2. backfill stragglers
    EXECUTE format(
      'UPDATE %I SET organization_id = ''00000000-0000-0000-0000-000000000001'' WHERE organization_id IS NULL',
      business_table);

    -- 3. flip default to the tenant GUC (USAV-fallback transitional default still
    --    in 2026-05-23; for Phase B roots we keep the SAME USAV-fallback so raw-pool
    --    inserts don't loud-fail before Phase C). Use the 2026-05-23 GUC default:
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT NULLIF(current_setting(''app.current_org'', true), '''')::uuid',
      business_table);

    -- 4. FK to organizations(id) ON DELETE RESTRICT
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
                   business_table, business_table || '_organization_fk');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT',
      business_table, business_table || '_organization_fk');

    -- 5. index
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id)',
                   'idx_' || business_table || '_organization', business_table);

    -- 6. ENABLE RLS + non-forced policy (+ hermes read bypass)
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', business_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I',
                   business_table || '_tenant_isolation', business_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)',
      business_table || '_tenant_isolation', business_table);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hermes_agent') THEN
      EXECUTE format('DROP POLICY IF EXISTS hermes_agent_read ON %I', business_table);
      EXECUTE format('CREATE POLICY hermes_agent_read ON %I FOR SELECT TO hermes_agent USING (true)', business_table);
    END IF;
  END LOOP;
END $$;
```

> **Note on step 3 / step 1 default choice:** `2026-05-23` flips to the bare GUC default `NULLIF(current_setting('app.current_org',true),'')::uuid` (which is *loud-fail*, not USAV-fallback). For Phase B the safer transitional choice is the **USAV-fallback default** `COALESCE(NULLIF(current_setting('app.current_org',true),'')::uuid, '00000000-0000-0000-0000-000000000001'::uuid)` (the one `relax_tenant_isolation` restores, `2026-06-14_rls_enforcement_infra.sql:77-80`), because most of these tables are touched by raw-pool routes with no GUC. Pick USAV-fallback in steps 1+3 for B1–B5; Phase C's `enforce_tenant_isolation` flips each to loud-fail + FORCE per table as its routes migrate. (The template above shows the bare-GUC variant to match `2026-05-23` literally; substitute the COALESCE default if you want raw-pool inserts to keep landing under USAV during the window.)

**Child-batch variant (B2–B5):** identical, except step 2's backfill reads from the parent instead of the constant. Per-table backfill snippet, e.g. for `shipment_tracking_events`:

```sql
EXECUTE format(
  'UPDATE %I c SET organization_id = p.organization_id '
  'FROM shipping_tracking_numbers p WHERE p.id = c.tracking_id AND c.organization_id IS NULL',
  business_table);
```
For `staff`-scoped children (B3): `FROM staff p WHERE p.id = c.staff_id`. (Confirm the exact FK column name per table — most are `staff_id`; `auth_audit`/`mobile_scan_events` use `staff_id`.) Keep the constant-fallback UPDATE after the parent-UPDATE to catch orphan rows whose parent FK is NULL.

**B6 (RLS-only, no column) template:**
```sql
DO $$
DECLARE t text;
  tables text[] := ARRAY[
    'audit_logs','billing_subscriptions','email_delivery_signals',
    'email_missing_purchase_orders','item_workflow_state','rag_document_chunks',
    'rag_documents','sku_relationships','staff','staff_messages','staff_sessions',
    'station_definitions','ticket_links','unfound_overlay','warranty_claim_events',
    'warranty_claims','warranty_quotes','warranty_repair_attempts',
    'workflow_definitions','workflow_node_stats','workflow_runs'
    -- order_ingest_queue, zoho_fulfillment_sync handled separately (nullable, see §3)
    -- stripe_events, organization_integrations: system-global, intentionally NOT enforced
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = NULLIF(current_setting(''app.current_org'',true),'''')::uuid)',
      t || '_tenant_isolation', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hermes_agent') THEN
      EXECUTE format('DROP POLICY IF EXISTS hermes_agent_read ON %I', t);
      EXECUTE format('CREATE POLICY hermes_agent_read ON %I FOR SELECT TO hermes_agent USING (true)', t);
    END IF;
  END LOOP;
END $$;
```

---

## 2. Decision table for child tables (all → denormalized column; parent for backfill)

All 49 get a **denormalized `organization_id` column** (decision: COLUMN, never EXISTS-subquery, per §0). "Backfill parent" = the FK parent whose `organization_id` seeds the backfill UPDATE; chosen as the first scoper that already has org_id.

| Child table | Batch | Decision | Backfill parent (FK col) | Notes |
|---|---|---|---|---|
| shipment_tracking_events | B2 | column | shipping_tracking_numbers (`tracking_id`) | 18135 rows; flat index critical |
| hermes_outcomes | B2 | column | hermes_insights | |
| repair_failure_resolutions | B2 | column | USAV fallback | near-empty; schema.ts:2099 |
| auth_audit | B3 | column | staff (`staff_id`) | schema.ts:163 |
| google_oauth_tokens | B3 | column | staff | not in schema.ts |
| google_photos_backup_runs | B3 | column | staff | |
| mobile_scan_events | B3 | column | staff | 17268 rows |
| operations_kpi_rollups_daily | B3 | column | staff | |
| operations_kpi_rollups_hourly | B3 | column | staff | |
| pay_periods | B3 | column | staff | |
| payroll_settings | B3 | column | staff | |
| staff_availability_rules | B3 | column | staff | schema.ts:211 |
| staff_enrollments | B3 | column | staff | schema.ts:144 |
| staff_goal_history | B3 | column | staff | |
| staff_goals | B3 | column | staff | |
| staff_passkeys | B3 | column | staff | schema.ts:112 |
| staff_pay_rates | B3 | column | staff | |
| staff_schedule_overrides | B3 | column | staff | schema.ts:188 |
| staff_stations | B3 | column | staff | schema.ts:101 |
| staff_stepups | B3 | column | staff_sessions | schema.ts:153 |
| staff_todo_completions | B3 | column | staff | |
| staff_todos | B3 | column | staff | |
| staff_week_plans | B3 | column | staff | schema.ts:198 |
| staff_weekly_schedule | B3 | column | staff | schema.ts:178 |
| time_off_requests | B3 | column | staff | |
| time_punches | B3 | column | staff | |
| product_manuals | B4 | column | sku_catalog (`sku_id`) | 393 rows |
| sourcing_candidates | B4 | column | sku_catalog | schema.ts:1667 |
| sourcing_alerts | B4 | column | sku_catalog | schema.ts:1649 |
| pending_skus | B4 | column | sku_catalog | schema.ts:1558 |
| sku_pairing_suggestions | B4 | column | sku_catalog | 1744 rows |
| sku_pairing_audit | B4 | column | sku_catalog | |
| local_pickup_order_items | B4 | column | receiving | 185 rows |
| local_pickup_orders | B4 | column | staff | |
| receiving_scans | B4 | column | receiving (`receiving_id`) | 1678 rows |
| receiving_shipments | B4 | column | receiving | schema.ts:935 |
| tracking_exceptions | B4 | column | staff | 275 rows |
| picking_sessions | B4 | column | orders | |
| rma_authorizations | B4 | column | orders | |
| repair_actions | B4 | column | repair_service | |
| part_acquisitions | B4 | column | sku_catalog | schema.ts:1693 |
| unit_quality_scores | B4 | column | serial_units | schema.ts:2111 |
| unit_failure_tags | B4 | column | serial_units | schema.ts:2057 |
| unit_repairs | B4 | column | serial_units | schema.ts:2078 |
| testing_results | B4 | column | serial_units | 106 rows |
| handling_units | B4 | column | staff | |
| replenishment_tasks | B4 | column | staff | |
| shift_templates | B4 | column | staff | 70 rows |
| shifts | B4 | column | staff | 220 rows |
| station_scan_sessions | B4 | column | staff | 1344 rows |
| workflow_edges | B5 | column | workflow_definitions | schema.ts:2415 |
| workflow_nodes | B5 | column | workflow_definitions | schema.ts:2399 |

---

## 3. Reference-decide tables (6) — global-shared vs per-tenant

This is a **used-goods reseller**; the Bose parts/compatibility/disposition knowledge is operator-curated reference data, not customer data. Recommendation: keep the **knowledge base global-shared** (read-only to all tenants), make the **tenant-private feeders per-tenant**.

| Table | FK parents | Recommendation | Why |
|---|---|---|---|
| `bose_models` | — | **GLOBAL-SHARED** | A model catalog is universal industry knowledge — "QC35 II" is the same product for every reseller. Duplicating it per tenant is pure waste and fragments compatibility lookups. Treat like `roles`/`config` (system-global): no org_id, no RLS. |
| `bose_serial_prefixes` | bose_models | **GLOBAL-SHARED** | Pure derived reference (serial→model decoding). Same rationale; child of a global parent. |
| `part_compatibility` | bose_models, sku_catalog | **HYBRID → per-tenant column, nullable** | The bose_models↔generic-part edges are shareable knowledge, but the `sku_catalog` FK is tenant-private (every tenant has its own SKUs). Add `organization_id` **nullable**: NULL = global/seed compatibility row (visible to all), non-NULL = tenant-authored. Policy: `USING (organization_id IS NULL OR organization_id = GUC)`. This is a *deviation* from the canonical equality policy — document it as the one intentional "shared+private" table. |
| `failure_modes` | — | **GLOBAL-SHARED with per-tenant extension (nullable org_id)** | The failure taxonomy ("no power", "BT pairing fail") is shared QC vocabulary referenced by `qc_check_templates`, `tech_verifications`, `repair_failure_resolutions`, `unit_failure_tags`. Seed rows global (NULL org); allow tenants to add private modes (non-NULL). Same nullable-org policy as part_compatibility. Keeps the shared FK targets valid for everyone. |
| `available_sku_suffixes` | — | **PER-TENANT** | This is SKU-numbering allocation state — a tenant's available suffix pool. It is operational, not knowledge. Add `organization_id NOT NULL` + standard policy (treat as a B1 root if you want it scoped). |
| `return_dispositions` | rma_authorizations, serial_units, staff, inventory_events | **PER-TENANT** | Despite the name, the fan-out of FKs (rma, serial_units, staff, inventory_events — all tenant-private) shows these are *actual disposition events* on a tenant's returned units, not a code list. Add `organization_id NOT NULL`, backfill from `serial_units`/`staff`, standard policy. Add to a child batch (B4-style). |

Net: 2 stay global (`bose_models`, `bose_serial_prefixes`), 2 become nullable-org hybrid with a custom `IS NULL OR =GUC` policy (`part_compatibility`, `failure_modes`), 2 become standard per-tenant (`available_sku_suffixes`, `return_dispositions`).

---

## 4. Nullable-org tables (4) — flag + remediation

These have `organization_id` but `not_null=false`. **Risk: a non-forced/forced equality policy silently hides NULL-org rows** (NULL = GUC is never true), so any NULL row becomes invisible once RLS is enforced — a data-loss-shaped bug.

| Table | Current | Action |
|---|---|---|
| `audit_logs` | usav-fallback default, no FK, no policy, 5496 rows; `2026-05-23:163-178` deliberately left system-event rows NULL | Backfill NULLs to USAV in B6, then either (a) `SET NOT NULL` + standard policy, or (b) keep nullable + use the `organization_id IS NULL OR = GUC` policy so system events stay visible. **Recommend (b)** — preserves actor-less system rows. |
| `order_ingest_queue` | no default, no FK, nullable | Ingest is written by `transitionalUsavOrgId` callers (`src/app/api/cron/zoho/orders-ingest-drain/route.ts`). Backfill USAV, add FK + index + `SET NOT NULL` + standard policy in B6. Coordinate with the drain cron switching to a real org. |
| `stripe_events` | system-global, has FK to orgs, nullable | **Leave alone / exempt.** Webhook events arrive before org context. Keep nullable, NO RLS (system-global). Document the exemption. |
| `zoho_fulfillment_sync` | no default, no FK, nullable, 266 rows; written by `src/lib/zoho/fulfillment-sync.ts` via `transitionalUsavOrgId` | Backfill USAV, add FK + index, `SET NOT NULL`, standard policy. Gate on `fulfillment-sync.ts` adopting a real org. |

---

## 5. schema.ts reconciliation list (Drizzle drift)

The Drizzle defs that exist in `src/lib/drizzle/schema.ts` but are **missing `organizationId: orgIdCol()`** after Phase B adds the DB column. These MUST be edited (add `organizationId: orgIdCol(),` as the field right after `id`, plus an `orgIdx: index('idx_<t>_organization').on(table.organizationId)` in the table-config callback to match the migration's index name):

**NEEDS-COL, defined in schema (2):**
- `suppliers` (`schema.ts:1630`) — add `orgIdCol()` + `idx_suppliers_organization`.
- `repair_failure_resolutions` (`schema.ts:2099`) — add `orgIdCol()` + `idx_repair_failure_resolutions_organization`.

**child-scoped, defined in schema (these have a `pgTable` def, currently no org col):**
- `auth_audit` (163), `staff_passkeys` (112), `staff_stations` (101), `staff_stepups` (153), `staff_weekly_schedule` (178), `staff_schedule_overrides` (188), `staff_week_plans` (198), `staff_availability_rules` (211), `staff_enrollments` (144)
- `receiving_shipments` (935)
- `pending_skus` (1558), `sourcing_alerts` (1649), `sourcing_candidates` (1667), `part_acquisitions` (1693)
- `unit_failure_tags` (2057), `unit_repairs` (2078), `unit_quality_scores` (2111), `testing_results` (2132)
- `workflow_nodes` (2399), `workflow_edges` (2415)

**Already has org_id at DB but verify the Drizzle def carries `orgIdCol()` (drift check, no migration needed — only fix if the field is absent):** `staff`, `staff_sessions` (both have DB column + FK; confirm `schema.ts` defs include `organizationId` — they're getting RLS in B6, so the column type must already be modeled).

**No action in schema.ts (table not modeled in Drizzle — pure raw-pool/SQL, so no Drizzle drift to fix; the SQL migration is the only change):**
All other NEEDS-COL and child tables — `warehouses`, `shipping_tracking_numbers`, `shipment_tracking_events`, `zoho_po_mirror`, `zoho_item_images`, `sku_management`, `square_transactions`, `messages`, `google_photos_*`, `operations_kpi_rollup_state(_s)`, `api_idempotency_responses`, `hermes_*`, `mobile_scan_events`, `product_manuals`, `receiving_scans`, `sku_pairing_*`, `local_pickup_*`, `rma_authorizations`, `repair_actions`, `picking_sessions`, `handling_units`, `replenishment_tasks`, `shift_templates`, `shifts`, `station_scan_sessions`, `tracking_exceptions`, `staff_todos`, `staff_todo_completions`, `staff_goals`, `staff_goal_history`, `staff_pay_rates`, `pay_periods`, `payroll_settings`, `time_punches`, `time_off_requests`, `google_oauth_tokens`, `google_photos_backup_runs`, `operations_kpi_rollups_daily/hourly` — confirmed **not** present as `pgTable(...)` in `schema.ts` (grep returned `not-in-schema`). Their access is via the raw `@/lib/db` pool, so only the SQL migration matters; flag for Phase D route work, not schema reconciliation.

---

## Summary counts
- **18 NEEDS-COL** → all get denormalized column (B1 roots + B2 children). 2 need schema.ts edits.
- **49 child-scoped** → all get denormalized column (decision: COLUMN, never EXISTS); B3 (`staff`, 23), B4 (domain, 24), B5 (workflow, 2). 20 need schema.ts edits.
- **6 reference-decide** → 2 global, 2 nullable-hybrid (custom `IS NULL OR =GUC` policy), 2 per-tenant.
- **4 nullable-org** → backfill+`SET NOT NULL`+policy for `order_ingest_queue`/`zoho_fulfillment_sync`; nullable+`IS NULL OR =GUC` for `audit_logs`; exempt `stripe_events`.
- **23 have-col-no-policy** → B6 RLS-arming (non-forced); `stripe_events`/`organization_integrations` explicitly exempt.
- All batches use the `2026-05-23` idempotent DO-block; **none** call `enforce_tenant_isolation` (FORCE is Phase C, gated on route migration to `withTenantConnection`).