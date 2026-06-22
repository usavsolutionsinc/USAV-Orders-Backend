# Tenancy org_id + RLS coverage — GENERATED

> Source of truth: **the live database catalog** (`pg_class` / `pg_attribute` / `pg_policies`),
> not `schema.ts`. Regenerate with `node scripts/tenancy-coverage.mjs`. Do not hand-edit.

## Summary

| metric | count |
|---|---|
| base tables | 207 |
| with `organization_id` | 167 |
| `organization_id NOT NULL` | 122 |
| RLS enabled | 126 |
| **RLS FORCEd** | **9** |
| has tenant_isolation policy | 126 |
| still on USAV-fallback default (footgun) | 109 |
| tenant-owned, **missing org_id col** | 8 |
| child-scoped (FK to a tenant parent) | 23 |
| reference — needs explicit decision | 6 |
| system/global (never enforce) | 10 |

## Per-table

Legend: org=has organization_id · NN=NOT NULL · dflt=default kind · FK=FK→organizations · RLS=enabled · FORCE=forced · pol=tenant_isolation policy present · hermes=hermes_agent_read policy.

| table | classification | org | NN | dflt | FK | RLS | FORCE | pol | hermes | ~rows |
|---|---|:-:|:-:|---|:-:|:-:|:-:|:-:|:-:|--:|
| `photo_share_pack_items` | child-scoped(photo_share_packs,photos) | — | — | none | — | — | — | — | — | ? |
| `sku_pairing_audit` | child-scoped(sku_catalog,sku_platform_ids,staff) | — | — | none | — | — | — | — | — | 66 |
| `pending_skus` | child-scoped(sku_catalog,staff) | — | — | none | — | — | — | — | — | ? |
| `staff_stepups` | child-scoped(staff_sessions) | — | — | none | — | — | — | — | — | ? |
| `shift_templates` | child-scoped(staff,locations) | — | — | none | — | — | — | — | — | 70 |
| `shifts` | child-scoped(staff,locations) | — | — | none | — | — | — | — | — | 293 |
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
| `time_punches` | child-scoped(staff) | — | — | none | — | — | — | — | — | 113 |
| `workflow_edges` | child-scoped(workflow_definitions) | — | — | none | — | — | — | — | — | 12 |
| `workflow_nodes` | child-scoped(workflow_definitions) | — | — | none | — | — | — | — | — | 12 |
| `available_sku_suffixes` | reference-decide | — | — | none | — | — | — | — | — | ? |
| `bose_models` | reference-decide | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | ? |
| `bose_serial_prefixes` | reference-decide | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | ? |
| `failure_modes` | reference-decide | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 15 |
| `part_compatibility` | reference-decide | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | ? |
| `return_dispositions` | reference-decide | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | ? |
| `admin_features` | system-global | — | — | none | — | — | — | — | — | ? |
| `config` | system-global | — | — | none | — | — | — | — | — | ? |
| `cron_runs` | system-global | — | — | none | — | — | — | — | — | 27929 |
| `organization_integrations` | system-global | ✅ | ✅ | none | ✅ | — | — | — | — | ? |
| `organizations` | system-global | — | — | none | — | — | — | — | — | ? |
| `roles` | system-global | — | — | none | — | — | — | — | — | 8 |
| `schema_migrations` | system-global | — | — | none | — | — | — | — | — | 292 |
| `staff_roles` | system-global | — | — | none | — | — | — | — | — | ? |
| `stripe_events` | system-global | ✅ | — | none | ✅ | — | — | — | — | 17 |
| `workflow_templates` | system-global | — | — | none | — | — | — | — | — | ? |
| `_tenant_iso_test` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `ai_chat_messages` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 243 |
| `ai_chat_sessions` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 15 |
| `amazon_accounts` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `amazon_api_calls` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `api_idempotency_responses` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | — | 274 |
| `audit_logs` | tenant-owned | ✅ | — | usav-fallback | — | — | — | — | — | 7255 |
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
| `email_missing_purchase_orders` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | 74 |
| `entity_notes` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `favorite_sku_workspaces` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 6 |
| `favorite_skus` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 7 |
| `fba_fnsku_logs` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 120 |
| `fba_fnskus` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 233 |
| `fba_shipment_item_units` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `fba_shipment_items` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 42 |
| `fba_shipment_tracking` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 7 |
| `fba_shipments` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 32 |
| `fba_tracking_item_allocations` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 12 |
| `google_photos_albums` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | ✅ | 6 |
| `google_photos_settings` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | ✅ | 1 |
| `handling_units` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `hermes_insights` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | ✅ | 1 |
| `hermes_outcomes` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | ✅ | ? |
| `hermes_precision_scores` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | ✅ | ? |
| `hermes_thresholds` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | ✅ | 7 |
| `integration_credential_audit` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | 235 |
| `inventory_events` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 3118 |
| `invoices` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `item_adjustments` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `item_location_stock` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `item_stock_cache` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 35 |
| `item_workflow_state` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | 97 |
| `items` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2088 |
| `local_pickup_items` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 4 |
| `local_pickup_order_items` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | 224 |
| `local_pickup_orders` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | 39 |
| `location_transfers` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `locations` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 22 |
| `messages` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 10 |
| `mobile_scan_events` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 18079 |
| `model_versions` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `operations_kpi_rollup_state` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 2 |
| `operations_kpi_rollups_daily` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 5 |
| `operations_kpi_rollups_hourly` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 5 |
| `order_ingest_queue` | tenant-owned | ✅ | — | none | — | — | — | — | — | ? |
| `order_shipment_links` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2643 |
| `order_unit_allocations` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 1 |
| `orders` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2641 |
| `orders_exceptions` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 1742 |
| `packages` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `packer_logs` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 3376 |
| `part_acquisitions` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | ? |
| `photo_analysis` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_analysis_runs` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_entity_links` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | 2 |
| `photo_exports` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_jobs` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_share_pack_access` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_share_pack_links` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_share_packs` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_storage` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_storage_providers` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photos` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2 |
| `picking_sessions` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 2 |
| `pipeline_cycles` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `pipeline_tasks` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `platform_accounts` | tenant-owned | ✅ | ✅ | none | ✅ | ✅ | — | ✅ | — | ? |
| `platform_listings` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | — | ✅ | — | ? |
| `platforms` | tenant-owned | ✅ | ✅ | none | ✅ | ✅ | — | ✅ | — | ? |
| `printer_profiles` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `product_manuals` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 393 |
| `qc_check_templates` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 42 |
| `rag_document_chunks` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `rag_documents` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `reason_codes` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 45 |
| `receiving` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1853 |
| `receiving_claim_seller_messages` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `receiving_line_views` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 213 |
| `receiving_lines` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1100 |
| `receiving_scans` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1800 |
| `receiving_shipments` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1496 |
| `repair_actions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `repair_failure_resolutions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `repair_service` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 69 |
| `replenishment_order_lines` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 461 |
| `replenishment_requests` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 35 |
| `replenishment_status_log` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 10 |
| `replenishment_tasks` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | ? |
| `rma_authorizations` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | ? |
| `sales_orders` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `serial_unit_condition_history` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `serial_unit_listings` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | — | ✅ | — | ? |
| `serial_units` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 953 |
| `shipment_orders` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `shipment_tracking_events` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 19570 |
| `shipping_tracking_numbers` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 6022 |
| `sku` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 0 |
| `sku_catalog` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 1289 |
| `sku_kit_parts` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `sku_management` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 101 |
| `sku_pairing_suggestions` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 1859 |
| `sku_platform_ids` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 5479 |
| `sku_relationships` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `sku_stock` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2638 |
| `sku_stock_ledger` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 2317 |
| `sourcing_alerts` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | ? |
| `sourcing_candidates` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | ? |
| `sourcing_searches` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | ? |
| `square_transactions` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 50 |
| `staff` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | — | — | — | — | 14 |
| `staff_goal_history` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 698 |
| `staff_goals` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 5 |
| `staff_messages` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `staff_preferences` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | ✅ | ✅ | ✅ | ? |
| `staff_sessions` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | — | — | — | — | 968 |
| `staff_stations` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 2 |
| `staff_todo_completions` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | ? |
| `staff_todos` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 6 |
| `station_activity_logs` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 14195 |
| `station_definitions` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `stock_alerts` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 84 |
| `suppliers` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | ? |
| `sync_cursors` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 3 |
| `tech_serial_numbers` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1420 |
| `tech_verifications` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 5 |
| `testing_results` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | 109 |
| `ticket_links` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `tracking_exceptions` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 349 |
| `training_runs` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `training_samples` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `types` | tenant-owned | ✅ | ✅ | none | ✅ | ✅ | — | ✅ | — | ? |
| `unfound_overlay` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | 28 |
| `unit_failure_tags` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | ? |
| `unit_id_sequences` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 149 |
| `unit_quality_scores` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 5 |
| `unit_repairs` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | — | ✅ | — | ? |
| `warehouses` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 1 |
| `warranty_claim_events` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `warranty_claims` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `warranty_quotes` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `warranty_repair_attempts` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `work_assignments` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | 5682 |
| `workflow_definitions` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `workflow_node_stats` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `workflow_runs` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | 139 |
| `zoho_fulfillment_sync` | tenant-owned | ✅ | — | none | — | — | — | — | — | 274 |
| `zoho_item_images` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 237 |
| `zoho_locations` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `zoho_po_mirror` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 3574 |
| `zoho_webhook_events` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `account_emails` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `account_identities` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `account_mfa` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `accounts` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `auth_events` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `memberships` | tenant-owned-NEEDS-COL | — | — | none | ✅ | — | — | — | — | ? |
| `org_invitations` | tenant-owned-NEEDS-COL | — | — | none | ✅ | — | — | — | — | ? |
| `webauthn_credentials` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
