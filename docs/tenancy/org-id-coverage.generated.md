# Tenancy org_id + RLS coverage — GENERATED

> Source of truth: **the live database catalog** (`pg_class` / `pg_attribute` / `pg_policies`),
> not `schema.ts`. Regenerate with `node scripts/tenancy-coverage.mjs`. Do not hand-edit.

## Summary

| metric | count |
|---|---|
| base tables | 181 |
| with `organization_id` | 144 |
| `organization_id NOT NULL` | 105 |
| RLS enabled | 115 |
| **RLS FORCEd** | **0** |
| has tenant_isolation policy | 115 |
| still on USAV-fallback default (footgun) | 77 |
| tenant-owned, **missing org_id col** | 7 |
| child-scoped (FK to a tenant parent) | 22 |
| reference — needs explicit decision | 6 |
| system/global (never enforce) | 9 |

## Per-table

Legend: org=has organization_id · NN=NOT NULL · dflt=default kind · FK=FK→organizations · RLS=enabled · FORCE=forced · pol=tenant_isolation policy present · hermes=hermes_agent_read policy.

| table | classification | org | NN | dflt | FK | RLS | FORCE | pol | hermes | ~rows |
|---|---|:-:|:-:|---|:-:|:-:|:-:|:-:|:-:|--:|
| `sku_pairing_audit` | child-scoped(sku_catalog,sku_platform_ids,staff) | — | — | none | — | — | — | — | — | 66 |
| `pending_skus` | child-scoped(sku_catalog,staff) | — | — | none | — | — | — | — | — | ? |
| `staff_stepups` | child-scoped(staff_sessions) | — | — | none | — | — | — | — | — | ? |
| `shift_templates` | child-scoped(staff,locations) | — | — | none | — | — | — | — | — | 70 |
| `shifts` | child-scoped(staff,locations) | — | — | none | — | — | — | — | — | 220 |
| `station_scan_sessions` | child-scoped(staff,shipping_tracking_numbers,orders_exceptions) | — | — | none | — | — | — | — | — | 1344 |
| `auth_audit` | child-scoped(staff) | — | — | none | — | — | — | — | — | 2163 |
| `google_oauth_tokens` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `google_photos_backup_runs` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `pay_periods` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `payroll_settings` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_availability_rules` | child-scoped(staff) | — | — | none | — | — | — | — | — | 56 |
| `staff_enrollments` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_passkeys` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_pay_rates` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_schedule_overrides` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_week_plans` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `staff_weekly_schedule` | child-scoped(staff) | — | — | none | — | — | — | — | — | 56 |
| `time_off_requests` | child-scoped(staff) | — | — | none | — | — | — | — | — | ? |
| `time_punches` | child-scoped(staff) | — | — | none | — | — | — | — | — | 85 |
| `workflow_edges` | child-scoped(workflow_definitions) | — | — | none | — | — | — | — | — | 12 |
| `workflow_nodes` | child-scoped(workflow_definitions) | — | — | none | — | — | — | — | — | 12 |
| `available_sku_suffixes` | reference-decide | — | — | none | — | — | — | — | — | ? |
| `bose_models` | reference-decide | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `bose_serial_prefixes` | reference-decide | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `failure_modes` | reference-decide | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 15 |
| `part_compatibility` | reference-decide | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `return_dispositions` | reference-decide | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `admin_features` | system-global | — | — | none | — | — | — | — | — | ? |
| `config` | system-global | — | — | none | — | — | — | — | — | ? |
| `cron_runs` | system-global | — | — | none | — | — | — | — | — | 13119 |
| `organization_integrations` | system-global | ✅ | ✅ | none | ✅ | — | — | — | — | ? |
| `organizations` | system-global | — | — | none | — | — | — | — | — | ? |
| `roles` | system-global | — | — | none | — | — | — | — | — | 8 |
| `schema_migrations` | system-global | — | — | none | — | — | — | — | — | 221 |
| `staff_roles` | system-global | — | — | none | — | — | — | — | — | ? |
| `stripe_events` | system-global | ✅ | — | none | ✅ | — | — | — | — | ? |
| `_tenant_iso_test` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `ai_chat_messages` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 243 |
| `ai_chat_sessions` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 15 |
| `amazon_accounts` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `amazon_api_calls` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `audit_logs` | tenant-owned | ✅ | — | usav-fallback | — | — | — | — | — | 6143 |
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
| `handling_units` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `inventory_events` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2462 |
| `invoices` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `item_adjustments` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `item_location_stock` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `item_stock_cache` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 35 |
| `item_workflow_state` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `items` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2088 |
| `local_pickup_items` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 4 |
| `local_pickup_order_items` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | 224 |
| `local_pickup_orders` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | 39 |
| `location_transfers` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `locations` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 22 |
| `messages` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 10 |
| `mobile_scan_events` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 18079 |
| `model_versions` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `operations_kpi_rollup_state` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 2 |
| `operations_kpi_rollups_daily` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 5 |
| `operations_kpi_rollups_hourly` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 5 |
| `order_ingest_queue` | tenant-owned | ✅ | — | none | — | — | — | — | — | ? |
| `order_shipment_links` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2511 |
| `order_unit_allocations` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 1 |
| `orders` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2610 |
| `orders_exceptions` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 1668 |
| `packages` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `packer_logs` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 3376 |
| `part_acquisitions` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `photos` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 85 |
| `picking_sessions` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 2 |
| `pipeline_cycles` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `pipeline_tasks` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `platform_accounts` | tenant-owned | ✅ | ✅ | none | ✅ | ✅ | — | ✅ | — | ? |
| `platforms` | tenant-owned | ✅ | ✅ | none | ✅ | ✅ | — | ✅ | — | ? |
| `printer_profiles` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `product_manuals` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 393 |
| `qc_check_templates` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 42 |
| `rag_document_chunks` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `rag_documents` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `reason_codes` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 33 |
| `receiving` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 1730 |
| `receiving_line_views` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | — | — | — | — | 9 |
| `receiving_lines` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 980 |
| `receiving_scans` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | 1668 |
| `receiving_shipments` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `repair_actions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `repair_failure_resolutions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `repair_service` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 60 |
| `replenishment_order_lines` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 370 |
| `replenishment_requests` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 35 |
| `replenishment_status_log` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 10 |
| `replenishment_tasks` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `rma_authorizations` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `sales_orders` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `serial_unit_condition_history` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `serial_units` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 811 |
| `shipment_orders` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `shipment_tracking_events` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 19570 |
| `shipping_tracking_numbers` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 5704 |
| `sku` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 0 |
| `sku_catalog` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 1289 |
| `sku_kit_parts` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `sku_management` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 101 |
| `sku_pairing_suggestions` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 1744 |
| `sku_platform_ids` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 5479 |
| `sku_relationships` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `sku_stock` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2638 |
| `sku_stock_ledger` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2317 |
| `sourcing_alerts` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `sourcing_candidates` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `sourcing_searches` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `square_transactions` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 50 |
| `staff` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | — | — | — | — | 14 |
| `staff_goal_history` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 698 |
| `staff_goals` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 5 |
| `staff_messages` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `staff_sessions` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | — | — | — | — | 866 |
| `staff_stations` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 2 |
| `staff_todo_completions` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `staff_todos` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 6 |
| `station_activity_logs` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 13013 |
| `station_definitions` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `stock_alerts` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 56 |
| `suppliers` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `sync_cursors` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 3 |
| `tech_serial_numbers` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 1250 |
| `tech_verifications` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 4 |
| `testing_results` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | 109 |
| `ticket_links` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `tracking_exceptions` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 312 |
| `training_runs` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `training_samples` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `types` | tenant-owned | ✅ | ✅ | none | ✅ | ✅ | — | ✅ | — | ? |
| `unfound_overlay` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | 28 |
| `unit_failure_tags` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `unit_id_sequences` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 140 |
| `unit_quality_scores` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 5 |
| `unit_repairs` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `warehouses` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 1 |
| `warranty_claim_events` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `warranty_claims` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `warranty_quotes` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `warranty_repair_attempts` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `work_assignments` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 5398 |
| `workflow_definitions` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `workflow_node_stats` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `workflow_runs` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `zoho_fulfillment_sync` | tenant-owned | ✅ | — | none | — | — | — | — | — | 266 |
| `zoho_item_images` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 237 |
| `zoho_locations` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `zoho_po_mirror` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | — | 3477 |
| `api_idempotency_responses` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | 277 |
| `google_photos_albums` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `google_photos_settings` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `hermes_insights` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `hermes_outcomes` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `hermes_precision_scores` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `hermes_thresholds` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
