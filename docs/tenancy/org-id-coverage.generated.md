# Tenancy org_id + RLS coverage — GENERATED

> Source of truth: **the live database catalog** (`pg_class` / `pg_attribute` / `pg_policies`),
> not `schema.ts`. Regenerate with `node scripts/tenancy-coverage.mjs`. Do not hand-edit.

## Summary

| metric | count |
|---|---|
| base tables | 173 |
| with `organization_id` | 93 |
| `organization_id NOT NULL` | 89 |
| RLS enabled | 68 |
| **RLS FORCEd** | **0** |
| has tenant_isolation policy | 68 |
| still on USAV-fallback default (footgun) | 77 |
| tenant-owned, **missing org_id col** | 18 |
| child-scoped (FK to a tenant parent) | 49 |
| reference — needs explicit decision | 6 |
| system/global (never enforce) | 9 |

## Per-table

Legend: org=has organization_id · NN=NOT NULL · dflt=default kind · FK=FK→organizations · RLS=enabled · FORCE=forced · pol=tenant_isolation policy present · hermes=hermes_agent_read policy.

| table | classification | org | NN | dflt | FK | RLS | FORCE | pol | hermes | ~rows |
|---|---|:-:|:-:|---|:-:|:-:|:-:|:-:|:-:|--:|
| `handling_units` | child-scoped(locations,staff) | — | — | none | — | — | — | — | — | ? |
| `replenishment_tasks` | child-scoped(locations,staff) | — | — | none | — | — | — | — | — | ? |
| `rma_authorizations` | child-scoped(orders,customers,staff) | — | — | none | — | — | — | — | — | ? |
| `picking_sessions` | child-scoped(orders,staff) | — | — | none | — | — | — | — | — | ? |
| `receiving_scans` | child-scoped(receiving,staff) | — | — | none | — | — | — | — | — | 1678 |
| `receiving_shipments` | child-scoped(receiving,staff) | — | — | none | — | — | — | — | — | ? |
| `local_pickup_order_items` | child-scoped(receiving) | — | — | none | — | — | — | — | — | 185 |
| `repair_actions` | child-scoped(repair_service,staff) | — | — | none | — | — | — | — | — | ? |
| `testing_results` | child-scoped(serial_units,receiving_lines,staff,inventory_events) | — | — | none | — | — | — | — | — | 106 |
| `unit_failure_tags` | child-scoped(serial_units,staff,inventory_events) | — | — | none | — | — | — | — | — | ? |
| `unit_quality_scores` | child-scoped(serial_units) | — | — | none | — | — | — | — | — | ? |
| `part_acquisitions` | child-scoped(sku_catalog,receiving,serial_units) | — | — | none | — | — | — | — | — | ? |
| `sku_pairing_audit` | child-scoped(sku_catalog,sku_platform_ids,staff) | — | — | none | — | — | — | — | — | 66 |
| `sku_pairing_suggestions` | child-scoped(sku_catalog,sku_platform_ids) | — | — | none | — | — | — | — | — | 1744 |
| `pending_skus` | child-scoped(sku_catalog,staff) | — | — | none | — | — | — | — | — | ? |
| `sourcing_alerts` | child-scoped(sku_catalog,staff) | — | — | none | — | — | — | — | — | ? |
| `product_manuals` | child-scoped(sku_catalog) | — | — | none | — | — | — | — | — | 393 |
| `sourcing_candidates` | child-scoped(sku_catalog) | — | — | none | — | — | — | — | — | ? |
| `staff_stepups` | child-scoped(staff_sessions) | — | — | none | — | — | — | — | — | ? |
| `shift_templates` | child-scoped(staff,locations) | — | — | none | — | — | — | — | — | 70 |
| `shifts` | child-scoped(staff,locations) | — | — | none | — | — | — | — | — | 220 |
| `station_scan_sessions` | child-scoped(staff,orders_exceptions) | — | — | none | — | — | — | — | — | 1344 |
| `local_pickup_orders` | child-scoped(staff,receiving) | — | — | none | — | — | — | — | — | 39 |
| `tracking_exceptions` | child-scoped(staff,receiving) | — | — | none | — | — | — | — | — | 275 |
| `unit_repairs` | child-scoped(staff,repair_service,inventory_events,serial_units) | — | — | none | — | — | — | — | — | ? |
| `auth_audit` | child-scoped(staff) | — | — | none | — | — | — | — | — | 2163 |
| `google_oauth_tokens` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `google_photos_backup_runs` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `mobile_scan_events` | child-scoped(staff) | — | — | none | — | — | — | — | — | 17268 |
| `operations_kpi_rollups_daily` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `operations_kpi_rollups_hourly` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `pay_periods` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `payroll_settings` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_availability_rules` | child-scoped(staff) | — | — | none | — | — | — | — | — | 56 |
| `staff_enrollments` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_goal_history` | child-scoped(staff) | — | — | none | — | — | — | — | — | 670 |
| `staff_goals` | child-scoped(staff) | — | — | none | — | — | — | — | — | 1 |
| `staff_passkeys` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_pay_rates` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_schedule_overrides` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_stations` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_todo_completions` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_todos` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_week_plans` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_weekly_schedule` | child-scoped(staff) | — | — | none | — | — | — | — | — | 56 |
| `time_off_requests` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `time_punches` | child-scoped(staff) | — | — | none | — | — | — | — | — | 85 |
| `workflow_edges` | child-scoped(workflow_definitions) | — | — | none | — | — | — | — | — | 12 |
| `workflow_nodes` | child-scoped(workflow_definitions) | — | — | none | — | — | — | — | — | 12 |
| `available_sku_suffixes` | reference-decide | — | — | none | — | — | — | — | — | ? |
| `bose_models` | reference-decide | — | — | none | — | — | — | — | — | ? |
| `bose_serial_prefixes` | reference-decide | — | — | none | — | — | — | — | — | ? |
| `failure_modes` | reference-decide | — | — | none | — | — | — | — | — | ? |
| `part_compatibility` | reference-decide | — | — | none | — | — | — | — | — | ? |
| `return_dispositions` | reference-decide | — | — | none | — | — | — | — | — | ? |
| `admin_features` | system-global | — | — | none | — | — | — | — | — | ? |
| `config` | system-global | — | — | none | — | — | — | — | — | ? |
| `cron_runs` | system-global | — | — | none | — | — | — | — | — | 10167 |
| `organization_integrations` | system-global | ✅ | ✅ | none | ✅ | — | — | — | — | ? |
| `organizations` | system-global | — | — | none | — | — | — | — | — | ? |
| `roles` | system-global | — | — | none | — | — | — | — | — | 8 |
| `schema_migrations` | system-global | — | — | none | — | — | — | — | — | 221 |
| `staff_roles` | system-global | — | — | none | — | — | — | — | — | ? |
| `stripe_events` | system-global | ✅ | — | none | ✅ | — | — | — | — | ? |
| `ai_chat_messages` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 243 |
| `ai_chat_sessions` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 15 |
| `audit_logs` | tenant-owned | ✅ | — | usav-fallback | — | — | — | — | — | 5496 |
| `billing_subscriptions` | tenant-owned | ✅ | ✅ | none | ✅ | — | — | — | — | ? |
| `bin_contents` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `credit_notes` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `customers` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 54 |
| `cycle_count_campaigns` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `cycle_count_lines` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `documents` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 16 |
| `ebay_accounts` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 4 |
| `ebay_api_calls` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `email_delivery_signals` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `email_missing_purchase_orders` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | 56 |
| `entity_notes` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `favorite_sku_workspaces` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 6 |
| `favorite_skus` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 6 |
| `fba_fnsku_logs` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 120 |
| `fba_fnskus` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 233 |
| `fba_shipment_item_units` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `fba_shipment_items` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 32 |
| `fba_shipment_tracking` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 7 |
| `fba_shipments` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 32 |
| `fba_tracking_item_allocations` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 12 |
| `inventory_events` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2462 |
| `invoices` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `item_adjustments` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `item_location_stock` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `item_stock_cache` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 35 |
| `item_workflow_state` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `items` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2088 |
| `local_pickup_items` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 4 |
| `location_transfers` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `locations` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 22 |
| `model_versions` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `order_ingest_queue` | tenant-owned | ✅ | — | none | — | — | — | — | — | ? |
| `order_shipment_links` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2511 |
| `order_unit_allocations` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 1 |
| `orders` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2537 |
| `orders_exceptions` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 1668 |
| `packages` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `packer_logs` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 3376 |
| `photos` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 85 |
| `pipeline_cycles` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `pipeline_tasks` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `printer_profiles` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `qc_check_templates` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 42 |
| `rag_document_chunks` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `rag_documents` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `reason_codes` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 33 |
| `receiving` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 1730 |
| `receiving_lines` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 980 |
| `repair_service` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 60 |
| `replenishment_order_lines` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 370 |
| `replenishment_requests` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 35 |
| `replenishment_status_log` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 10 |
| `sales_orders` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `serial_unit_condition_history` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `serial_units` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 811 |
| `shipment_orders` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `sku` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 0 |
| `sku_catalog` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 1289 |
| `sku_kit_parts` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `sku_platform_ids` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 5479 |
| `sku_relationships` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `sku_stock` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2638 |
| `sku_stock_ledger` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2317 |
| `staff` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | — | — | — | — | 13 |
| `staff_messages` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `staff_sessions` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | — | — | — | — | 849 |
| `station_activity_logs` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 13013 |
| `station_definitions` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `stock_alerts` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 26 |
| `sync_cursors` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 3 |
| `tech_serial_numbers` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 1250 |
| `tech_verifications` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 4 |
| `ticket_links` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `training_runs` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `training_samples` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `unfound_overlay` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | 28 |
| `unit_id_sequences` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 140 |
| `warranty_claim_events` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `warranty_claims` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `warranty_quotes` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `warranty_repair_attempts` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `work_assignments` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 5398 |
| `workflow_definitions` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `workflow_node_stats` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `workflow_runs` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `zoho_fulfillment_sync` | tenant-owned | ✅ | — | none | — | — | — | — | — | 266 |
| `zoho_locations` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `api_idempotency_responses` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | 277 |
| `google_photos_albums` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `google_photos_settings` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `hermes_insights` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `hermes_outcomes` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `hermes_precision_scores` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `hermes_thresholds` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `messages` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `operations_kpi_rollup_state` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `repair_failure_resolutions` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `shipment_tracking_events` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | 18135 |
| `shipping_tracking_numbers` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | 5700 |
| `sku_management` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | 100 |
| `square_transactions` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | 50 |
| `suppliers` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `warehouses` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | 1 |
| `zoho_item_images` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | 214 |
| `zoho_po_mirror` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | 3477 |
