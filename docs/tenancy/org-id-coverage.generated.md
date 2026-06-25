# Tenancy org_id + RLS coverage — GENERATED

> Source of truth: **the live database catalog** (`pg_class` / `pg_attribute` / `pg_policies`),
> not `schema.ts`. Regenerate with `node scripts/tenancy-coverage.mjs`. Do not hand-edit.

## Summary

| metric | count |
|---|---|
| base tables | 215 |
| with `organization_id` | 175 |
| `organization_id NOT NULL` | 160 |
| RLS enabled | 135 |
| **RLS FORCEd** | **118** |
| has tenant_isolation policy | 135 |
| still on USAV-fallback default (footgun) | 23 |
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
| `station_scan_sessions` | child-scoped(staff,shipping_tracking_numbers,orders_exceptions) | — | — | none | — | — | — | — | — | 1529 |
| `auth_audit` | child-scoped(staff) | — | — | none | — | — | — | — | — | 2430 |
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
| `cron_runs` | system-global | — | — | none | — | — | — | — | — | 34114 |
| `organization_integrations` | system-global | ✅ | ✅ | none | ✅ | — | — | — | — | ? |
| `organizations` | system-global | — | — | none | — | — | — | — | — | ? |
| `roles` | system-global | — | — | none | — | — | — | — | — | 8 |
| `schema_migrations` | system-global | — | — | none | — | — | — | — | — | 292 |
| `staff_roles` | system-global | — | — | none | — | — | — | — | — | ? |
| `stripe_events` | system-global | ✅ | — | none | ✅ | — | — | — | — | 17 |
| `workflow_templates` | system-global | — | — | none | — | — | — | — | — | ? |
| `_tenant_iso_test` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `ai_chat_messages` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 243 |
| `ai_chat_sessions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 15 |
| `amazon_accounts` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `amazon_api_calls` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `api_idempotency_responses` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 217 |
| `audit_logs` | tenant-owned | ✅ | — | usav-fallback | — | — | — | — | — | 7845 |
| `billing_subscriptions` | tenant-owned | ✅ | ✅ | none | ✅ | — | — | — | — | ? |
| `bin_contents` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `credit_notes` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `customers` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 54 |
| `cycle_count_campaigns` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `cycle_count_lines` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `documents` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 16 |
| `ebay_accounts` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 4 |
| `ebay_api_calls` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `email_delivery_signals` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `email_login_tokens` | tenant-owned | ✅ | ✅ | none | ✅ | — | — | — | — | ? |
| `email_missing_purchase_orders` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | 74 |
| `entity_notes` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `favorite_sku_workspaces` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 6 |
| `favorite_skus` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 7 |
| `fba_fnsku_logs` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 120 |
| `fba_fnskus` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 233 |
| `fba_shipment_item_units` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `fba_shipment_items` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 42 |
| `fba_shipment_tracking` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 7 |
| `fba_shipments` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 32 |
| `fba_tracking_item_allocations` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 12 |
| `google_photos_albums` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 6 |
| `google_photos_settings` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1 |
| `handling_units` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `hermes_insights` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | ✅ | 1 |
| `hermes_outcomes` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | ✅ | ? |
| `hermes_precision_scores` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | ✅ | ? |
| `hermes_thresholds` | tenant-owned | ✅ | — | loud-fail | ✅ | ✅ | — | ✅ | ✅ | 7 |
| `integration_credential_audit` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | 940 |
| `inventory_events` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 3302 |
| `invoices` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `item_adjustments` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `item_location_stock` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `item_stock_cache` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 35 |
| `item_workflow_state` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | ✅ | ✅ | ✅ | 122 |
| `items` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 2088 |
| `local_pickup_items` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 4 |
| `local_pickup_order_items` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 224 |
| `local_pickup_orders` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 39 |
| `location_transfers` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `locations` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 22 |
| `messages` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 10 |
| `mobile_scan_events` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 18079 |
| `model_versions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `operations_kpi_rollup_state` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 2 |
| `operations_kpi_rollups_daily` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 5 |
| `operations_kpi_rollups_hourly` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 5 |
| `operations_saved_views` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | ✅ | ✅ | ✅ | ? |
| `order_ingest_queue` | tenant-owned | ✅ | — | none | — | — | — | — | — | ? |
| `order_shipment_links` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 2756 |
| `order_unit_allocations` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1 |
| `orders` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 2730 |
| `orders_exceptions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1875 |
| `packages` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `packer_logs` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 3711 |
| `part_acquisitions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `photo_analysis` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_analysis_runs` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_entity_links` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | 46 |
| `photo_exports` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_folder_items` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | ✅ | ✅ | ✅ | ? |
| `photo_folders` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | ✅ | ✅ | ✅ | ? |
| `photo_jobs` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | 36 |
| `photo_share_pack_access` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_share_pack_links` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_share_packs` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photo_storage` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | 61 |
| `photo_storage_providers` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `photos` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 19 |
| `picking_sessions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 2 |
| `pipeline_cycles` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `pipeline_tasks` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `platform_accounts` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `platform_listings` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | ✅ | ✅ | ✅ | ? |
| `platforms` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `printer_profiles` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `product_manuals` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 393 |
| `qc_check_templates` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 42 |
| `rag_document_chunks` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `rag_documents` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `reason_codes` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 45 |
| `receiving` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1909 |
| `receiving_claim_seller_messages` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `receiving_exceptions` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | — | ✅ | — | ? |
| `receiving_line_views` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 327 |
| `receiving_lines` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1104 |
| `receiving_scans` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1844 |
| `receiving_shipments` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1496 |
| `repair_actions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `repair_failure_resolutions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `repair_service` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 69 |
| `replenishment_order_lines` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 461 |
| `replenishment_requests` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 35 |
| `replenishment_status_log` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 10 |
| `replenishment_tasks` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `rma_authorizations` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `sales_orders` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `serial_unit_condition_history` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `serial_unit_listings` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | ✅ | ✅ | ✅ | ? |
| `serial_units` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 996 |
| `shipment_links` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | — | ✅ | — | 4273 |
| `shipment_orders` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `shipment_tracking_events` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 20990 |
| `shipping_tracking_numbers` | tenant-owned | ✅ | — | usav-fallback | ✅ | ✅ | — | ✅ | — | 6195 |
| `sku` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |
| `sku_catalog` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1289 |
| `sku_kit_parts` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `sku_management` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 101 |
| `sku_pairing_suggestions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1870 |
| `sku_platform_ids` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 5479 |
| `sku_relationships` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `sku_stock` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 2662 |
| `sku_stock_ledger` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 2599 |
| `sourcing_alerts` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `sourcing_candidates` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `sourcing_searches` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `square_transactions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 50 |
| `staff` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | — | — | — | — | 14 |
| `staff_goal_history` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 698 |
| `staff_goals` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 5 |
| `staff_messages` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `staff_preferences` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | ✅ | ✅ | ✅ | 1 |
| `staff_sessions` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | — | — | — | — | 1014 |
| `staff_stations` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 2 |
| `staff_todo_completions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `staff_todos` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 6 |
| `station_activity_logs` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 15873 |
| `station_definitions` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `stock_alerts` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 84 |
| `suppliers` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `support_ticket_assignments` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `sync_cursors` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 3 |
| `tech_serial_numbers` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1508 |
| `tech_verifications` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 5 |
| `testing_results` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 109 |
| `ticket_links` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `tracking_exceptions` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 349 |
| `training_runs` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `training_samples` | tenant-owned | ✅ | ✅ | usav-fallback | ✅ | ✅ | — | ✅ | ✅ | ? |
| `types` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `unfound_overlay` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | 28 |
| `unit_failure_tags` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `unit_id_sequences` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 153 |
| `unit_quality_scores` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 5 |
| `unit_repairs` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `warehouses` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 1 |
| `warranty_claim_events` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | 10 |
| `warranty_claims` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `warranty_quotes` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `warranty_repair_attempts` | tenant-owned | ✅ | ✅ | loud-fail | — | — | — | — | — | ? |
| `work_assignments` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 5823 |
| `workflow_definitions` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | ✅ | ✅ | ✅ | ? |
| `workflow_node_stats` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | ✅ | ✅ | ✅ | ? |
| `workflow_runs` | tenant-owned | ✅ | ✅ | loud-fail | — | ✅ | ✅ | ✅ | ✅ | 179 |
| `zendesk_users` | tenant-owned | ✅ | ✅ | usav-fallback | — | — | — | — | — | ? |
| `zoho_fulfillment_sync` | tenant-owned | ✅ | — | none | — | — | — | — | — | 275 |
| `zoho_item_images` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 237 |
| `zoho_locations` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| `zoho_po_mirror` | tenant-owned | ✅ | ✅ | loud-fail | ✅ | ✅ | ✅ | ✅ | ✅ | 3574 |
| `zoho_webhook_events` | tenant-owned | ✅ | ✅ | none | — | — | — | — | — | ? |
| `account_emails` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `account_identities` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `account_mfa` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `accounts` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `auth_events` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
| `memberships` | tenant-owned-NEEDS-COL | — | — | none | ✅ | — | — | — | — | ? |
| `org_invitations` | tenant-owned-NEEDS-COL | — | — | none | ✅ | — | — | — | — | ? |
| `webauthn_credentials` | tenant-owned-NEEDS-COL | — | — | none | — | — | — | — | — | ? |
