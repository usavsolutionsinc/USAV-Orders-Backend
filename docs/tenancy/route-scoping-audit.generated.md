# Route scoping audit — GENERATED

> Static scan of `src/app/api/**/route.ts`. Regenerate: `node scripts/tenancy-route-audit.mjs`.
> "touches tenant table" = the handler body word-matches a non-system table from the coverage doc.
> Risk: **critical** = mutates a tenant table with no org filter & no GUC; **high** = reads one with no
> org filter & no GUC; **medium** = has an org filter but no GUC/RLS backstop; **low** = GUC-wrapped.

## Summary

| metric | count |
|---|---|
| total route files | 572 |
| withAuth | 436 |
| GUC-wrapped (tenantQuery/withTenantConnection/withTenantTransaction) | 7 |
| references organizationId | 90 |
| raw @/lib/db pool import | 342 |
| drizzle / neon-http | 17 |
| uses USAV_ORG_ID / transitionalUsavOrgId | 2 |
| cron routes | 27 |

| risk | count |
|---|---|
| critical | 243 |
| high | 158 |
| medium | 71 |
| low | 7 |
| info | 93 |

## Routes by risk (critical + high first)

| risk | route | methods | auth | orgRef | GUC | tables touched |
|---|---|---|:-:|:-:|:-:|---|
| critical | `/api/admin/fba-fnskus` | GET/POST | ✅ | — | — | fba_fnskus, sku |
| critical | `/api/admin/fba-fnskus/[fnsku]` | GET/PATCH/DELETE | — | — | — | fba_shipment_items, fba_fnsku_logs, fba_fnskus, sku |
| critical | `/api/admin/fba-fnskus/upload` | POST | ✅ | — | — | fba_fnskus, sku |
| critical | `/api/admin/features` | GET/POST | ✅ | — | — | staff |
| critical | `/api/admin/features/[id]` | GET/PATCH/DELETE | ✅ | — | — | staff |
| critical | `/api/admin/fix-status` | POST | ✅ | — | — | orders |
| critical | `/api/admin/po-gmail/disconnect` | POST | ✅ | — | — | google_oauth_tokens |
| critical | `/api/admin/po-gmail/missing-orders` | GET/PATCH | ✅ | — | — | email_missing_purchase_orders, orders, items |
| critical | `/api/admin/po-gmail/triage/[id]` | PATCH | — | — | — | email_missing_purchase_orders |
| critical | `/api/admin/po-gmail/triage/[id]/extract` | POST | — | — | — | email_missing_purchase_orders, messages |
| critical | `/api/admin/roles/[id]` | GET/PATCH/DELETE | ✅ | — | — | staff |
| critical | `/api/admin/roles/[id]/mobile-defaults` | PATCH | ✅ | — | — | staff |
| critical | `/api/admin/staff` | GET/POST | ✅ | — | — | staff_passkeys, staff |
| critical | `/api/admin/staff/[id]` | PATCH/DELETE | ✅ | — | — | staff |
| critical | `/api/admin/staff/[id]/enroll-token` | POST | ✅ | — | — | staff |
| critical | `/api/admin/staff/[id]/mobile-display-config` | PATCH | ✅ | — | — | staff |
| critical | `/api/admin/staff/[id]/passkeys/[pid]` | DELETE | ✅ | — | — | staff_passkeys, staff |
| critical | `/api/admin/staff/[id]/permissions` | PATCH | ✅ | — | — | staff |
| critical | `/api/admin/staff/[id]/reset-pin` | POST | ✅ | — | — | staff |
| critical | `/api/admin/staff/[id]/roles` | GET/PUT | ✅ | — | — | staff |
| critical | `/api/admin/staff/[id]/sessions` | GET/DELETE | ✅ | — | — | staff_sessions, staff |
| critical | `/api/admin/staff/[id]/set-pin` | POST | ✅ | — | — | staff |
| critical | `/api/admin/staff/[id]/stations` | GET/PUT | ✅ | — | — | staff |
| critical | `/api/admin/staff/reorder` | PATCH | ✅ | — | — | staff |
| critical | `/api/ai/search` | POST | ✅ | — | — | messages |
| critical | `/api/auth/enroll/[token]` | GET/POST | — | — | — | staff |
| critical | `/api/auth/passkey/authenticate/begin` | POST | — | — | — | staff |
| critical | `/api/auth/passkey/authenticate/finish` | POST | — | — | — | staff |
| critical | `/api/auth/passkey/register/begin` | POST | — | — | — | staff |
| critical | `/api/auth/passkey/register/finish` | POST | — | — | — | staff |
| critical | `/api/auth/pin` | POST | — | — | — | staff |
| critical | `/api/auth/pin/create` | POST | — | — | — | staff |
| critical | `/api/auth/signin` | POST | — | — | — | staff |
| critical | `/api/auth/signout` | POST | — | — | — | staff |
| critical | `/api/auth/signup` | POST | ✅ | — | — | staff |
| critical | `/api/auth/switch` | POST | — | — | — | staff |
| critical | `/api/bose-models` | GET/POST | ✅ | — | — | items |
| critical | `/api/cycle-counts/campaigns` | GET/POST | ✅ | — | — | cycle_count_campaigns, cycle_count_lines, bin_contents, locations, staff, sku |
| critical | `/api/cycle-counts/campaigns/[id]` | GET/PATCH | — | — | — | cycle_count_campaigns, cycle_count_lines, locations, sku_stock, sku |
| critical | `/api/cycle-counts/lines/[id]` | PATCH | — | — | — | cycle_count_campaigns, cycle_count_lines, bin_contents, sku_stock, sku |
| critical | `/api/ebay/refresh-token` | POST | ✅ | — | — | ebay_accounts |
| critical | `/api/ecwid/sync-exception-tracking` | POST | ✅ | — | — | orders_exceptions, orders, items, sku |
| critical | `/api/ecwid/transfer-orders` | POST | ✅ | — | — | orders |
| critical | `/api/failure-modes` | GET/POST | ✅ | — | — | sku_stock |
| critical | `/api/failure-modes/[id]` | PATCH/DELETE | ✅ | — | — | sku_stock |
| critical | `/api/favorites` | GET/POST | ✅ | — | — | sku_stock, sku |
| critical | `/api/favorites/[id]` | PATCH/DELETE | — | — | — | sku_stock, sku |
| critical | `/api/fba/fnskus` | POST | ✅ | — | — | fba_fnskus, sku |
| critical | `/api/fba/fnskus/[fnsku]` | PATCH/GET | — | — | — | fba_fnskus, sku |
| critical | `/api/fba/fnskus/bulk` | POST | ✅ | — | — | fba_fnskus, sku |
| critical | `/api/fba/items/[id]/link-unit` | POST | ✅ | — | — | fba_shipment_item_units, fba_shipment_items, inventory_events, serial_units, fba_fnskus, items +1 |
| critical | `/api/fba/items/verify` | POST | ✅ | — | — | fba_shipment_items, fba_fnsku_logs, items, staff |
| critical | `/api/fba/labels/bind` | POST | ✅ | — | — | fba_shipment_items, fba_fnsku_logs, fba_shipments, items, staff |
| critical | `/api/fba/logs` | GET/POST | ✅ | — | — | fba_fnsku_logs, fba_shipments, fba_fnskus, staff, sku |
| critical | `/api/fba/logs/[id]` | GET/DELETE | — | — | — | fba_fnsku_logs, fba_shipments, fba_fnskus, staff, sku |
| critical | `/api/fba/shipments/[id]` | GET/PATCH/DELETE | — | — | — | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, items, staff |
| critical | `/api/fba/shipments/[id]/items` | GET/POST | — | — | — | fba_shipment_items, fba_shipments, fba_fnskus, items, staff, sku |
| critical | `/api/fba/shipments/[id]/items/[itemId]` | GET/PATCH/DELETE | — | — | — | fba_tracking_item_allocations, fba_shipment_items, fba_fnsku_logs, fba_shipments, items, staff +1 |
| critical | `/api/fba/shipments/[id]/items/[itemId]/reassign` | PATCH | — | — | — | fba_shipment_items, fba_shipments, items |
| critical | `/api/fba/shipments/[id]/ship-units` | POST | ✅ | — | — | fba_shipment_item_units, fba_shipment_items, inventory_events, sku_stock_ledger, serial_units, fba_fnskus +1 |
| critical | `/api/fba/shipments/[id]/tracking` | GET/POST/PATCH/DELETE | — | — | — | fba_tracking_item_allocations, shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items |
| critical | `/api/fba/shipments/close` | POST | ✅ | — | — | fba_shipment_items, fba_fnsku_logs, fba_shipments, items, staff |
| critical | `/api/fba/shipments/mark-shipped` | POST | ✅ | — | — | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, items |
| critical | `/api/fba/shipments/split-for-paired-review` | POST | ✅ | — | — | fba_tracking_item_allocations, shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments |
| critical | `/api/google-sheets/execute-script` | POST | ✅ | — | — | shipping_tracking_numbers, tech_serial_numbers, orders_exceptions, packer_logs, orders |
| critical | `/api/google-sheets/sync-shipstation-orders` | POST | ✅ | — | — | shipping_tracking_numbers, orders_exceptions, work_assignments, orders, shifts, sku |
| critical | `/api/google-sheets/transfer-orders` | POST/GET | ✅ | — | — | orders |
| critical | `/api/handling-units` | GET/POST | ✅ | — | — | handling_units, items |
| critical | `/api/inventory-photos` | POST | ✅ | — | — | inventory_events, photos, sku |
| critical | `/api/inventory/alerts/[id]/ack` | POST | ✅ | — | — | stock_alerts, sku |
| critical | `/api/local-pickup-orders` | GET/POST | ✅ | — | — | local_pickup_order_items, local_pickup_orders, orders, items, staff, sku |
| critical | `/api/local-pickup-orders/[id]` | GET/PATCH/DELETE | — | — | — | local_pickup_order_items, local_pickup_orders, sku_catalog, orders, items, staff +1 |
| critical | `/api/local-pickup-orders/[id]/complete` | POST | — | — | — | local_pickup_orders, orders |
| critical | `/api/local-pickup-orders/[id]/finalize` | POST | — | — | — | local_pickup_order_items, local_pickup_orders, receiving, orders, items, sku |
| critical | `/api/local-pickup-orders/[id]/items` | POST | — | — | — | local_pickup_order_items, local_pickup_orders, orders, items, sku |
| critical | `/api/local-pickup-orders/[id]/items/[itemId]` | PATCH/DELETE | — | — | — | local_pickup_order_items, local_pickup_orders, orders, items, sku |
| critical | `/api/local-pickup-orders/[id]/void` | POST | — | — | — | local_pickup_orders, orders |
| critical | `/api/local-pickups` | GET/POST/PATCH | ✅ | — | — | local_pickup_items, sku_platform_ids, work_assignments, sku_catalog, receiving, sku |
| critical | `/api/locations/[barcode]/properties` | PATCH | — | — | — | locations, sku_stock |
| critical | `/api/locations/bulk` | POST | ✅ | — | — | locations |
| critical | `/api/locations/register` | POST | ✅ | — | — | locations |
| critical | `/api/manual-server/assign` | POST | ✅ | — | — | sku_stock |
| critical | `/api/manuals/upsert` | POST | ✅ | — | — | product_manuals, sku_stock, sku |
| critical | `/api/nas-dev/[[...path]]` | GET/PUT | — | — | — | photos, staff |
| critical | `/api/need-to-order/[id]` | PATCH/DELETE | — | — | — | staff |
| critical | `/api/orders-exceptions/delete` | POST | ✅ | — | — | orders_exceptions, orders |
| critical | `/api/orders-exceptions/sync` | POST | ✅ | — | — | orders_exceptions, receiving, orders, staff |
| critical | `/api/orders/[id]` | GET/PATCH/DELETE | — | — | — | orders |
| critical | `/api/orders/[id]/allocate` | POST | ✅ | — | — | serial_units, orders, sku |
| critical | `/api/orders/[id]/release` | POST | ✅ | — | — | order_unit_allocations, inventory_events, serial_units, orders, sku |
| critical | `/api/orders/add` | POST | ✅ | — | — | sku_catalog, orders, sku |
| critical | `/api/orders/backfill/ebay` | POST | ✅ | — | — | shipping_tracking_numbers, ebay_accounts, orders, sku |
| critical | `/api/orders/backfill/ecwid` | POST | ✅ | — | — | shipping_tracking_numbers, orders, items, sku |
| critical | `/api/orders/batch` | POST | ✅ | — | — | shipping_tracking_numbers, tech_serial_numbers, packer_logs, orders, staff, sku |
| critical | `/api/orders/check-shipped` | POST | ✅ | — | — | station_activity_logs, orders |
| critical | `/api/orders/delete` | POST | ✅ | — | — | orders, sku |
| critical | `/api/orders/integrity-check` | POST | ✅ | — | — | shipping_tracking_numbers, orders, sku |
| critical | `/api/orders/missing-parts` | POST | ✅ | — | — | orders, staff |
| critical | `/api/orders/set-item-number` | POST | ✅ | — | — | orders |
| critical | `/api/orders/skip` | POST | ✅ | — | — | orders |
| critical | `/api/orders/start` | POST | ✅ | — | — | tech_serial_numbers, orders |
| critical | `/api/pack/ship` | POST | ✅ | — | — | order_unit_allocations, station_activity_logs, inventory_events, sku_stock_ledger, serial_units, packer_logs +3 |
| critical | `/api/packing-logs/save-photo` | POST | ✅ | — | — | photos |
| critical | `/api/packing-logs/start-session` | POST | ✅ | — | — | shipping_tracking_numbers, packer_logs, orders, photos |
| critical | `/api/part-compatibility` | GET/POST | ✅ | — | — | items, sku |
| critical | `/api/payroll/settings` | GET/PATCH | ✅ | — | — | payroll_settings |
| critical | `/api/photos/[id]` | DELETE | — | — | — | receiving, sku_stock, photos |
| critical | `/api/pick/scan` | POST | ✅ | — | — | order_unit_allocations, inventory_events, serial_units, orders, sku |
| critical | `/api/picking/session` | POST | ✅ | — | — | orders |
| critical | `/api/picking/session/[id]/complete` | POST | ✅ | — | — | orders |
| critical | `/api/picking/session/[id]/confirm-pick` | POST | ✅ | — | — | orders |
| critical | `/api/picking/session/[id]/short-pick` | POST | ✅ | — | — | inventory_events, orders |
| critical | `/api/post-multi-sn` | POST | ✅ | — | — | station_activity_logs, tech_serial_numbers, inventory_events, serial_units, receiving, sku |
| critical | `/api/print/dispatch` | POST | ✅ | — | — | printer_profiles, orders, sku |
| critical | `/api/product-manuals` | GET/POST/PATCH/DELETE | ✅ | — | — | product_manuals, sku_stock, sku |
| critical | `/api/product-manuals/assign` | POST | ✅ | — | — | product_manuals |
| critical | `/api/product-manuals/bulk` | POST | ✅ | — | — | product_manuals |
| critical | `/api/product-manuals/rename-folder` | POST | ✅ | — | — | product_manuals |
| critical | `/api/product-manuals/sync` | POST | ✅ | — | — | product_manuals, items |
| critical | `/api/product-manuals/thumbnail` | POST | ✅ | — | — | product_manuals |
| critical | `/api/product-manuals/upload` | POST | ✅ | — | — | product_manuals, sku |
| critical | `/api/product-manuals/upsert` | POST | ✅ | — | — | product_manuals |
| critical | `/api/realtime/token` | GET/POST | ✅ | — | — | receiving, staff |
| critical | `/api/reason-codes` | GET/POST | ✅ | — | — | reason_codes, sku_stock |
| critical | `/api/reason-codes/[id]` | GET/PATCH/DELETE | — | — | — | sku_stock |
| critical | `/api/receiving-entry` | POST/GET | ✅ | — | — | shipping_tracking_numbers, work_assignments, receiving_lines, receiving |
| critical | `/api/receiving-lines` | GET/POST/PATCH/DELETE | ✅ | — | — | fba_tracking_item_allocations, shipping_tracking_numbers, local_pickup_order_items, shipment_tracking_events, email_delivery_signals, station_scan_sessions +11 |
| critical | `/api/receiving-lines/[id]/ensure-catalog` | POST | ✅ | — | — | sku_catalog, receiving |
| critical | `/api/receiving-lines/[id]/manuals` | POST/DELETE | ✅ | — | — | receiving |
| critical | `/api/receiving-lines/[id]/qc-checks` | POST/PUT/DELETE | ✅ | — | — | qc_check_templates, receiving, sku_stock, sku |
| critical | `/api/receiving-lines/incoming/email-rescan` | POST | ✅ | — | — | receiving, items, staff |
| critical | `/api/receiving-lines/incoming/refresh` | POST | ✅ | — | — | receiving, packages |
| critical | `/api/receiving-lines/incoming/refresh/stream` | POST | ✅ | — | — | shipping_tracking_numbers, receiving_lines, zoho_po_mirror, receiving, packages, orders |
| critical | `/api/receiving-lines/incoming/sync-one` | POST | ✅ | — | — | receiving |
| critical | `/api/receiving-lines/incoming/zoho-refresh` | POST | ✅ | — | — | receiving_lines, zoho_po_mirror, receiving |
| critical | `/api/receiving/[id]` | GET/PATCH | — | — | — | shipping_tracking_numbers, local_pickup_orders, inventory_events, receiving_lines, receiving_scans, serial_units +4 |
| critical | `/api/receiving/[id]/attach-box` | POST | — | — | — | receiving |
| critical | `/api/receiving/add-unmatched-line` | POST | ✅ | — | — | api_idempotency_responses, sku_platform_ids, receiving_lines, receiving, items, sku |
| critical | `/api/receiving/disposition-suggest` | POST | ✅ | — | — | receiving |
| critical | `/api/receiving/lines/[id]/condition` | PATCH | ✅ | — | — | receiving_lines, receiving |
| critical | `/api/receiving/lines/[id]/move` | POST | — | — | — | inventory_events, receiving_lines, serial_units, locations, receiving, sku |
| critical | `/api/receiving/lines/[id]/putaway` | POST | — | — | — | inventory_events, receiving_lines, serial_units, locations, receiving, sku |
| critical | `/api/receiving/lines/[id]/status` | POST | — | — | — | receiving_lines, serial_units, receiving, sku |
| critical | `/api/receiving/mark-received` | POST | ✅ | — | — | shipping_tracking_numbers, inventory_events, sku_stock_ledger, receiving_lines, serial_units, audit_logs +6 |
| critical | `/api/receiving/match` | POST/GET | ✅ | — | — | shipping_tracking_numbers, work_assignments, receiving_lines, receiving, staff, sku |
| critical | `/api/receiving/nas-archive-test` | POST | ✅ | — | — | receiving, photos |
| critical | `/api/receiving/po/[poId]/attach-box` | GET/POST | — | — | — | receiving_lines, zoho_po_mirror, receiving |
| critical | `/api/receiving/serials` | GET/POST/DELETE | ✅ | — | — | tech_serial_numbers, receiving_lines, serial_units, receiving |
| critical | `/api/receiving/visual-identify` | POST | ✅ | — | — | sku_catalog, receiving, sku |
| critical | `/api/receiving/zendesk-claim/classify` | POST | ✅ | — | — | receiving |
| critical | `/api/receiving/zendesk-claim/draft` | POST | ✅ | — | — | receiving, photos |
| critical | `/api/receiving/zendesk-claim/preview` | POST | ✅ | — | — | receiving, photos |
| critical | `/api/repair-service/[id]` | GET/DELETE | — | — | — | customers, documents |
| critical | `/api/repair-service/out-of-stock` | POST | ✅ | — | — | work_assignments |
| critical | `/api/repair-service/pickup` | POST | ✅ | — | — | work_assignments, repair_service, documents |
| critical | `/api/repair-service/repaired` | POST | ✅ | — | — | work_assignments, repair_service |
| critical | `/api/repair/actions` | GET/POST | ✅ | — | — | repair_actions, staff |
| critical | `/api/repair/actions/[id]` | PATCH/DELETE | ✅ | — | — | repair_actions |
| critical | `/api/repair/square-payment-link` | POST | ✅ | — | — | sku |
| critical | `/api/replenish/bulk-create-po` | POST | ✅ | — | — | orders |
| critical | `/api/replenishment/tasks/[id]/cancel` | POST | ✅ | — | — | staff |
| critical | `/api/replenishment/tasks/[id]/claim` | POST | ✅ | — | — | staff |
| critical | `/api/replenishment/tasks/[id]/complete` | POST | ✅ | — | — | inventory_events, bin_contents, staff |
| critical | `/api/rma` | GET/POST | ✅ | — | — | orders, staff |
| critical | `/api/rma/[id]` | GET/PATCH/DELETE | — | — | — | orders |
| critical | `/api/rma/[id]/close` | POST | ✅ | — | — | orders, staff |
| critical | `/api/rma/[id]/mark-received` | POST | ✅ | — | — | orders, staff |
| critical | `/api/rooms` | GET/POST | ✅ | — | — | sku_stock |
| critical | `/api/rooms/[room]` | PATCH/DELETE | — | — | — | sku_stock |
| critical | `/api/rooms/reorder` | POST | ✅ | — | — | sku_stock |
| critical | `/api/scan/resolve` | GET/POST | ✅ | — | — | shipping_tracking_numbers, tech_serial_numbers, mobile_scan_events, serial_units, sku_catalog, receiving +4 |
| critical | `/api/serial-units/[id]/allocate` | POST | ✅ | — | — | order_unit_allocations, inventory_events, serial_units, orders, sku |
| critical | `/api/serial-units/[id]/checklist` | GET/POST | ✅ | — | — | qc_check_templates, tech_verifications, testing_results, serial_units, sku_catalog, staff +1 |
| critical | `/api/serial-units/[id]/checklist/bulk` | POST | ✅ | — | — | qc_check_templates, tech_verifications, serial_units, sku_catalog, staff |
| critical | `/api/serial-units/[id]/failure-tags` | GET/POST/PATCH | ✅ | — | — | sku_stock |
| critical | `/api/serial-units/[id]/grade` | POST | ✅ | — | — | serial_unit_condition_history, inventory_events, serial_units, sku |
| critical | `/api/serial-units/[id]/hold` | POST | ✅ | — | — | inventory_events, sku_stock |
| critical | `/api/serial-units/[id]/move` | POST | ✅ | — | — | inventory_events, sku_stock_ledger, bin_contents, serial_units, locations, sku |
| critical | `/api/serial-units/[id]/release` | POST | ✅ | — | — | sku_stock |
| critical | `/api/serial-units/[id]/repairs` | GET/POST | ✅ | — | — | staff |
| critical | `/api/shifts/[id]/cover` | POST | — | — | — | staff_sessions, shifts, staff |
| critical | `/api/shipped/submit` | POST | ✅ | — | — | sku_catalog, orders, sku |
| critical | `/api/sku-catalog` | GET/POST | ✅ | — | — | sku_stock, items, sku |
| critical | `/api/sku-catalog/[id]` | GET/PATCH/DELETE | — | — | — | bin_contents, sku_stock, sku |
| critical | `/api/sku-catalog/[id]/manuals` | POST/PUT/DELETE | — | — | — | sku_stock, sku |
| critical | `/api/sku-catalog/[id]/platform-ids` | POST/PUT/DELETE | — | — | — | sku_stock, sku |
| critical | `/api/sku-catalog/[id]/qc-checks` | GET/POST/PUT/DELETE | ✅ | — | — | qc_check_templates, sku_stock, sku |
| critical | `/api/sku-catalog/graph/relationships` | POST | ✅ | — | — | sku_stock, sku |
| critical | `/api/sku-catalog/graph/relationships/[id]` | PATCH/DELETE | — | — | — | sku_stock, sku |
| critical | `/api/sku-catalog/pair` | POST/DELETE | ✅ | — | — | sku_platform_ids, sku_catalog, sku_stock, sku |
| critical | `/api/sku-catalog/pair-batch` | POST | ✅ | — | — | sku_pairing_audit, product_manuals, sku_stock, orders, sku |
| critical | `/api/sku-catalog/pair-ecwid` | POST | ✅ | — | — | sku_stock, sku |
| critical | `/api/sku-catalog/run-migration` | POST | ✅ | — | — | sku_platform_ids, sku_catalog, sku |
| critical | `/api/sku-catalog/suggest-pairings` | GET/POST | ✅ | — | — | sku_platform_ids, sku_stock, sku |
| critical | `/api/sku-catalog/sync-ecwid-products` | POST | ✅ | — | — | sku_platform_ids, items, sku |
| critical | `/api/sku-catalog/sync-ecwid-titles` | POST | ✅ | — | — | sku_catalog, items, sku |
| critical | `/api/sku/[id]/photos` | GET/POST | — | — | — | receiving, sku_stock, photos, sku |
| critical | `/api/sku/by-tracking` | GET/DELETE | ✅ | — | — | serial_units, sku_stock, photos, sku |
| critical | `/api/sourcing/alerts` | GET/PATCH | ✅ | — | — | items |
| critical | `/api/sourcing/candidates` | GET/POST | ✅ | — | — | items |
| critical | `/api/sourcing/candidates/[id]/import` | POST | — | — | — | part_acquisitions, receiving |
| critical | `/api/staff-goals` | GET/PUT | ✅ | — | — | station_activity_logs, staff_goals, staff |
| critical | `/api/staff-todos` | GET/POST/PATCH/DELETE | ✅ | — | — | staff_todo_completions, items, staff |
| critical | `/api/staff/availability-rules` | GET/POST/PUT/DELETE | ✅ | — | — | staff_availability_rules, staff |
| critical | `/api/staff/schedule` | GET/PUT | ✅ | — | — | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| critical | `/api/staff/schedule/bulk` | POST | ✅ | — | — | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| critical | `/api/staff/schedule/week` | GET/PUT | ✅ | — | — | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| critical | `/api/staff/schedule/week/copy` | POST | ✅ | — | — | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| critical | `/api/suppliers` | GET/POST | ✅ | — | — | suppliers, items |
| critical | `/api/suppliers/[id]` | GET/PATCH/DELETE | — | — | — | suppliers |
| critical | `/api/tech/add-serial` | POST | ✅ | — | — | station_activity_logs |
| critical | `/api/tech/add-serial-to-last` | POST | ✅ | — | — | station_activity_logs |
| critical | `/api/tech/delete` | POST | ✅ | — | — | station_activity_logs, tech_serial_numbers, fba_fnsku_logs, orders, staff |
| critical | `/api/tech/delete-tracking` | POST | ✅ | — | — | station_activity_logs, tech_serial_numbers |
| critical | `/api/tech/scan-repair-station` | POST | ✅ | — | — | staff |
| critical | `/api/tech/test-result` | POST | ✅ | — | — | serial_unit_condition_history, inventory_events, serial_units, sku |
| critical | `/api/tech/undo-last` | POST | ✅ | — | — | station_activity_logs |
| critical | `/api/tech/update-serials` | POST | ✅ | — | — | shipping_tracking_numbers, station_activity_logs, fba_fnsku_logs |
| critical | `/api/tracking-exceptions/[id]` | GET/PATCH/DELETE | — | — | — | tracking_exceptions, receiving, staff |
| critical | `/api/tracking-exceptions/[id]/refresh` | POST | — | — | — | tracking_exceptions, receiving_lines, receiving_scans, receiving, orders, sku |
| critical | `/api/transfers` | POST | ✅ | — | — | inventory_events, bin_contents, locations, sku |
| critical | `/api/units/next-id` | POST | ✅ | — | — | sku_catalog, sku |
| critical | `/api/units/resolve-id` | POST | ✅ | — | — | serial_units, sku_catalog, sku |
| critical | `/api/update-sku-location` | POST | ✅ | — | — | location_transfers, sku_stock, sku |
| critical | `/api/walk-in/customers` | GET/POST | ✅ | — | — | customers |
| critical | `/api/walk-in/orders` | POST | ✅ | — | — | orders |
| critical | `/api/walk-in/sales` | GET/DELETE | ✅ | — | — | square_transactions, orders |
| critical | `/api/walk-in/sync` | POST | ✅ | — | — | square_transactions, orders, sku |
| critical | `/api/warranty/claims/[id]/quote` | POST | ✅ | — | — | staff |
| critical | `/api/warranty/claims/[id]/repair` | POST | ✅ | — | — | photos |
| critical | `/api/warranty/claims/[id]/repair-handoff` | POST | ✅ | — | — | repair_service |
| critical | `/api/warranty/claims/[id]/rma` | POST | ✅ | — | — | warranty_claims, staff |
| critical | `/api/warranty/quotes/[id]` | PATCH | ✅ | — | — | repair_service |
| critical | `/api/webhooks/square` | POST/GET | — | — | — | orders, items, sku |
| critical | `/api/webhooks/ups` | POST/GET | — | — | — | packages |
| critical | `/api/webhooks/zoho/orders` | POST/GET | — | — | — | orders, items, sku |
| critical | `/api/work-orders` | GET/PATCH | ✅ | — | — | shipping_tracking_numbers, station_activity_logs, order_shipment_links, work_assignments, receiving_lines, repair_service +6 |
| critical | `/api/zoho/find-po` | POST | ✅ | — | — | receiving |
| critical | `/api/zoho/fulfillment-sync` | POST | ✅ | — | — | zoho_fulfillment_sync, invoices, packages, orders |
| critical | `/api/zoho/purchase-orders/receive` | POST | ✅ | — | — | work_assignments, receiving_lines, receiving, orders, items, sku |
| critical | `/api/zoho/purchase-orders/sync` | POST | ✅ | — | — | receiving_lines, receiving, orders |
| critical | `/api/zoho/purchase-receives/import` | POST | ✅ | — | — | receiving |
| critical | `/api/zoho/purchase-receives/sync` | POST | ✅ | — | — | receiving_lines, receiving, orders |
| high | `/api/activity/feed` | GET | ✅ | — | — | station_activity_logs, sku_stock_ledger, staff, sku |
| high | `/api/admin/audit` | GET | ✅ | — | — | auth_audit, staff |
| high | `/api/admin/logs` | GET | ✅ | — | — | shipping_tracking_numbers, station_activity_logs, tech_serial_numbers, packer_logs, audit_logs, staff |
| high | `/api/admin/po-gmail/oauth-callback` | GET | ✅ | — | — | google_oauth_tokens |
| high | `/api/admin/po-gmail/preview-unread` | GET | ✅ | — | — | messages, items |
| high | `/api/admin/po-gmail/reconcile` | GET | ✅ | — | — | email_missing_purchase_orders, receiving_lines, receiving, messages |
| high | `/api/admin/po-gmail/status` | GET | ✅ | — | — | google_oauth_tokens |
| high | `/api/admin/po-gmail/triage` | GET | ✅ | — | — | email_missing_purchase_orders, orders, items |
| high | `/api/admin/po-gmail/triage/[id]/detail` | GET | — | — | — | email_missing_purchase_orders, zoho_po_mirror, messages |
| high | `/api/admin/po-mirror/health` | GET | ✅ | — | — | email_missing_purchase_orders, receiving_lines, zoho_po_mirror, sync_cursors |
| high | `/api/admin/sessions` | GET | ✅ | — | — | staff_sessions, staff |
| high | `/api/admin/staff/[id]/detail` | GET | ✅ | — | — | staff_passkeys, staff_sessions, auth_audit, staff |
| high | `/api/admin/staff/[id]/passkeys` | GET | ✅ | — | — | staff_passkeys, staff |
| high | `/api/ai/chat-sessions/[sessionId]/messages` | GET | — | — | — | messages |
| high | `/api/assignments/next` | GET | — | — | — | work_assignments |
| high | `/api/audit-log/packing` | GET | ✅ | — | — | items, sku |
| high | `/api/audit-log/receiving` | GET | ✅ | — | — | receiving, items, sku |
| high | `/api/audit-log/report` | GET | ✅ | — | — | shipping_tracking_numbers, replenishment_requests, station_activity_logs, tech_serial_numbers, inventory_events, receiving_lines +5 |
| high | `/api/audit-log/sku` | GET | ✅ | — | — | items, sku |
| high | `/api/audit-log/staff` | GET | ✅ | — | — | staff |
| high | `/api/audit-log/staff-directory` | GET | ✅ | — | — | station_activity_logs, audit_logs, staff |
| high | `/api/audit-log/tech` | GET | ✅ | — | — | items |
| high | `/api/audit/bin/[id]` | GET | — | — | — | inventory_events, audit_logs |
| high | `/api/audit/sku/[sku]` | GET | — | — | — | inventory_events, sku_stock_ledger, audit_logs, sku |
| high | `/api/auth/session` | GET | — | — | — | staff |
| high | `/api/auth/staff-picker` | GET | — | — | — | staff |
| high | `/api/check-tracking` | GET | — | — | — | shipping_tracking_numbers, work_assignments, packer_logs, orders |
| high | `/api/cron/cleanup` | GET | — | — | — | api_idempotency_responses |
| high | `/api/cron/google-sheets/transfer-orders` | GET | — | — | — | orders |
| high | `/api/cron/inventory/drift-check` | GET | — | — | — | sku_stock_ledger, stock_alerts, sku_stock, sku |
| high | `/api/cron/receiving/incoming-tracking-sync` | GET | — | — | — | receiving |
| high | `/api/cron/reconcile-unmatched` | GET | — | — | — | receiving |
| high | `/api/cron/replenishment-detect` | GET | — | — | — | replenishment_tasks, sku |
| high | `/api/cron/shipping/reconcile-delivered` | GET | — | — | — | receiving |
| high | `/api/cron/shipping/sync-due` | GET | — | — | — | shipping_tracking_numbers, receiving |
| high | `/api/cron/sku-catalog/refresh-suggestions` | GET | — | — | — | sku_pairing_suggestions, sku_platform_ids, sku_catalog, sku |
| high | `/api/cron/sourcing/scan` | GET | — | — | — | sourcing_alerts |
| high | `/api/cron/staff-goals/history` | GET | — | — | — | staff_goals, staff |
| high | `/api/cron/stock-alerts` | GET | — | — | — | bin_contents, stock_alerts, sku |
| high | `/api/cron/workflow-node-stats` | GET | — | — | — | workflow_node_stats |
| high | `/api/cron/zoho/fulfillment-sync` | GET | — | — | — | zoho_fulfillment_sync, orders |
| high | `/api/cron/zoho/incoming-po-sync` | GET | — | — | — | receiving_lines, zoho_po_mirror, sync_cursors, receiving, orders, items |
| high | `/api/cron/zoho/orders-ingest-drain` | GET | — | — | — | order_ingest_queue, orders |
| high | `/api/cron/zoho/po-sync` | GET | — | — | — | email_missing_purchase_orders, receiving_lines, zoho_po_mirror, receiving, orders |
| high | `/api/dashboard/fba-shipments` | GET | ✅ | — | — | shipping_tracking_numbers, fba_shipment_items, fba_shipments, receiving, staff |
| high | `/api/dashboard/operations` | GET | — | — | — | shipping_tracking_numbers, station_activity_logs, work_assignments, repair_service, orders, staff |
| high | `/api/debug-tracking` | GET | ✅ | — | — | shipping_tracking_numbers, work_assignments, packer_logs, orders |
| high | `/api/desktop-app/release` | GET | — | — | — | orders |
| high | `/api/ebay/search` | GET | ✅ | — | — | shipping_tracking_numbers, tech_serial_numbers, work_assignments, orders, sku |
| high | `/api/ecwid/products/search` | GET | ✅ | — | — | sku_stock, items, sku |
| high | `/api/ecwid/recent-repair-orders` | GET | ✅ | — | — | sku_platform_ids, sku_catalog, receiving, orders, items, sku |
| high | `/api/fba/board` | GET | ✅ | — | — | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, fba_fnskus, sku |
| high | `/api/fba/board/[fnsku]/entries` | GET | — | — | — | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, fba_fnskus, sku |
| high | `/api/fba/fnskus/search` | GET | ✅ | — | — | fba_fnskus, items, sku |
| high | `/api/fba/fnskus/validate` | GET | ✅ | — | — | fba_fnskus, sku |
| high | `/api/fba/items/queue` | GET | ✅ | — | — | fba_shipment_items, fba_shipments, fba_fnskus, items, staff, sku |
| high | `/api/fba/logs/summary` | GET | ✅ | — | — | tech_serial_numbers, fba_shipment_items, fba_fnsku_logs, fba_shipments, fba_fnskus, sku |
| high | `/api/fba/print-queue` | GET | ✅ | — | — | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, fba_fnskus, items +1 |
| high | `/api/fba/shipments/active-with-details` | GET | ✅ | — | — | fba_tracking_item_allocations, shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, fba_fnskus +3 |
| high | `/api/fba/shipments/today` | GET | ✅ | — | — | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, fba_fnskus, items +2 |
| high | `/api/fba/stage-counts` | GET | ✅ | — | — | fba_shipment_items |
| high | `/api/get-title-by-sku` | GET | ✅ | — | — | sku_platform_ids, sku_catalog, sku_stock, items, sku |
| high | `/api/global-search` | GET | ✅ | — | — | shipping_tracking_numbers, repair_service, fba_shipments, receiving, orders, staff +1 |
| high | `/api/handling-units/[id]` | GET | ✅ | — | — | handling_units |
| high | `/api/inbox/tech-queue` | GET | ✅ | — | — | shipping_tracking_numbers, receiving_lines, receiving, items, staff |
| high | `/api/inventory-events` | GET | ✅ | — | — | serial_units, sku_catalog, locations, sku_stock, staff, sku |
| high | `/api/inventory/alerts` | GET | ✅ | — | — | stock_alerts, locations, sku_stock, items, sku |
| high | `/api/inventory/bins-overview` | GET | ✅ | — | — | sku_stock |
| high | `/api/inventory/counts` | GET | ✅ | — | — | cycle_count_campaigns, cycle_count_lines, items |
| high | `/api/inventory/sku-search` | GET | ✅ | — | — | bin_contents, sku_stock, sku |
| high | `/api/inventory/units` | GET | ✅ | — | — | serial_units, sku_catalog, sku_stock, items, sku |
| high | `/api/labels/recent` | GET | ✅ | — | — | station_activity_logs, tech_serial_numbers, serial_units, sku_catalog, items, staff +1 |
| high | `/api/manual-server/by-item` | GET | ✅ | — | — | sku_stock |
| high | `/api/manual-server/unassigned` | GET | ✅ | — | — | sku_stock |
| high | `/api/manuals/recent` | GET | — | — | — | product_manuals, sku_catalog, sku |
| high | `/api/manuals/resolve` | GET | ✅ | — | — | product_manuals, sku_catalog, sku_stock, sku |
| high | `/api/need-to-order` | GET | ✅ | — | — | sku_stock, sku |
| high | `/api/operations/kpi-table` | GET | — | — | — | operations_kpi_rollups_hourly, operations_kpi_rollups_daily, staff |
| high | `/api/orders/[id]/pick-tasks` | GET | ✅ | — | — | orders |
| high | `/api/orders/lookup/[orderId]` | GET | ✅ | — | — | shipping_tracking_numbers, tech_serial_numbers, work_assignments, customers, receiving, sku_stock +3 |
| high | `/api/orders/next` | GET | ✅ | — | — | shipping_tracking_numbers, station_activity_logs, work_assignments, orders, staff, sku |
| high | `/api/orders/recent` | GET | ✅ | — | — | shipping_tracking_numbers, work_assignments, product_manuals, orders, sku |
| high | `/api/orders/verify` | GET | ✅ | — | — | shipping_tracking_numbers, packer_logs, orders |
| high | `/api/packing-logs/details` | GET | ✅ | — | — | orders, photos |
| high | `/api/packing-logs/history` | GET | ✅ | — | — | shipping_tracking_numbers, packer_logs, orders, photos, staff, sku |
| high | `/api/packing-logs/last-order` | GET | ✅ | — | — | shipping_tracking_numbers, packer_logs, orders, photos, staff, sku |
| high | `/api/packing-logs/photos` | GET | ✅ | — | — | packer_logs, photos |
| high | `/api/pick/queue` | GET | ✅ | — | — | orders |
| high | `/api/product-manuals/by-category` | GET | ✅ | — | — | product_manuals, sku_stock, sku |
| high | `/api/product-manuals/search` | GET | — | — | — | product_manuals, sku |
| high | `/api/products/[sku]` | GET | — | — | — | sku_platform_ids, bin_contents, serial_units, sku_catalog, sku |
| high | `/api/quality/dashboard` | GET | ✅ | — | — | unit_quality_scores, unit_failure_tags, failure_modes, serial_units, unit_repairs, sku_stock +1 |
| high | `/api/receiving-lines/[id]/testing-bundle` | GET | ✅ | — | — | product_manuals, sku_catalog, receiving, sku |
| high | `/api/receiving-lines/incoming/delivered-unscanned` | GET | ✅ | — | — | receiving_lines, receiving_scans, zoho_po_mirror, receiving, items, sku |
| high | `/api/receiving-lines/incoming/details` | GET | ✅ | — | — | email_missing_purchase_orders, shipping_tracking_numbers, shipment_tracking_events, email_delivery_signals, inventory_events, receiving_lines +4 |
| high | `/api/receiving-lines/incoming/summary` | GET | ✅ | — | — | shipping_tracking_numbers, receiving_lines, receiving_scans, zoho_po_mirror, receiving, packages +1 |
| high | `/api/receiving-logs/search` | GET | ✅ | — | — | shipping_tracking_numbers, receiving |
| high | `/api/receiving/lines/[id]/timeline` | GET | — | — | — | inventory_events, serial_units, locations, receiving, staff, sku |
| high | `/api/receiving/pending-unboxing` | GET | ✅ | — | — | shipping_tracking_numbers, receiving_lines, receiving, staff, sku |
| high | `/api/receiving/po/[poId]` | GET | ✅ | — | — | receiving_lines, sku_catalog, receiving, photos, items, sku |
| high | `/api/receiving/po/list` | GET | ✅ | — | — | receiving_lines, receiving, photos, items, sku |
| high | `/api/repair-service/document/[id]` | GET | — | — | — | repair_service, documents |
| high | `/api/repair-service/next` | GET | ✅ | — | — | work_assignments, repair_service, staff, sku |
| high | `/api/repair/customers` | GET | ✅ | — | — | customers |
| high | `/api/repair/ecwid-categories` | GET | ✅ | — | — | items |
| high | `/api/repair/ecwid-products` | GET | ✅ | — | — | items, sku |
| high | `/api/replenish/shipped-fifo` | GET | ✅ | — | — | replenishment_requests, station_activity_logs, item_stock_cache, sku_stock, orders, items +1 |
| high | `/api/reports/dead-stock` | GET | — | — | — | sku |
| high | `/api/reports/velocity` | GET | — | — | — | sku |
| high | `/api/rma/by-number/[number]` | GET | ✅ | — | — | orders |
| high | `/api/scan/history` | GET | ✅ | — | — | mobile_scan_events, receiving, sku_stock, staff |
| high | `/api/serial-units/[id]` | GET | — | — | — | serial_unit_condition_history, order_unit_allocations, station_activity_logs, tech_serial_numbers, inventory_events, serial_units +5 |
| high | `/api/serial-units/[id]/quality` | GET | ✅ | — | — | serial_units, sku_stock |
| high | `/api/shifts` | GET | ✅ | — | — | shifts, staff |
| high | `/api/shipped/[id]` | GET | — | — | — | orders |
| high | `/api/shipped/debug` | GET | ✅ | — | — | shipping_tracking_numbers, packer_logs, orders |
| high | `/api/shipped/lookup-order` | GET | — | — | — | shipping_tracking_numbers, orders |
| high | `/api/sku` | GET | ✅ | — | — | sku_platform_ids, sku_catalog, sku_stock, sku |
| high | `/api/sku-catalog/[id]/similar` | GET | — | — | — | sku_catalog, sku_stock, items, sku |
| high | `/api/sku-catalog/graph/[skuId]/children` | GET | — | — | — | sku_catalog, sku_stock, sku |
| high | `/api/sku-catalog/graph/[skuId]/parents` | GET | — | — | — | sku_catalog, sku_stock, sku |
| high | `/api/sku-catalog/graph/[skuId]/tree` | GET | — | — | — | sku_catalog, sku_stock, sku |
| high | `/api/sku-catalog/pair-suggestions` | GET | ✅ | — | — | sku_platform_ids, sku_catalog, sku_stock, items, sku |
| high | `/api/sku-catalog/pairing-queue` | GET | ✅ | — | — | sku_pairing_suggestions, sku_platform_ids, sku_catalog, sku_stock, orders, items +1 |
| high | `/api/sku-catalog/pairing-queue/count` | GET | ✅ | — | — | sku_pairing_suggestions, sku_catalog, sku_stock, sku |
| high | `/api/sku-catalog/resolve` | GET | ✅ | — | — | sku_platform_ids, sku_catalog, orders, sku |
| high | `/api/sku-catalog/search` | GET | ✅ | — | — | qc_check_templates, sku_platform_ids, sku_catalog, sku_stock, items, sku |
| high | `/api/sku-catalog/search-unmatched` | GET | ✅ | — | — | sku_platform_ids, sku_catalog, sku_stock, orders, sku |
| high | `/api/sku-catalog/suggest-for-item` | GET | ✅ | — | — | sku_pairing_suggestions, sku_catalog, sku_stock, sku |
| high | `/api/sku-catalog/unpaired` | GET | ✅ | — | — | sku_stock, orders, items, sku |
| high | `/api/sku-catalog/unpaired-ecwid` | GET | ✅ | — | — | sku_stock, items, sku |
| high | `/api/sku-manager` | GET | ✅ | — | — | sku_management, sku_stock |
| high | `/api/sku-stock` | GET | ✅ | — | — | sku_platform_ids, sku_catalog, sku_stock, sku |
| high | `/api/sku-stock/[sku]/bins` | GET | — | — | — | sku_platform_ids, sku_catalog, sku_stock, sku |
| high | `/api/sku/lookup` | GET | ✅ | — | — | sku_stock, sku |
| high | `/api/sku/serials-from-code` | GET | ✅ | — | — | sku_stock, sku |
| high | `/api/staff-goals/history` | GET | ✅ | — | — | staff_goal_history, staff |
| high | `/api/staff-goals/me` | GET | ✅ | — | — | staff |
| high | `/api/staff/availability-today` | GET | ✅ | — | — | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| high | `/api/stock-alerts` | GET | ✅ | — | — | bin_contents, stock_alerts, locations, sku_stock, sku |
| high | `/api/support/overview` | GET | — | — | — | messages |
| high | `/api/tech-logs/search` | GET | ✅ | — | — | orders, sku |
| high | `/api/tech/logs` | GET | ✅ | — | — | shipping_tracking_numbers, station_activity_logs, order_shipment_links, tech_serial_numbers, work_assignments, fba_fnsku_logs +4 |
| high | `/api/tech/orders-without-manual` | GET | ✅ | — | — | shipping_tracking_numbers, tech_serial_numbers, work_assignments, product_manuals, fba_fnskus, orders +1 |
| high | `/api/testing/recent` | GET | ✅ | — | — | testing_results, serial_units, staff, sku |
| high | `/api/tracking-exceptions` | GET | ✅ | — | — | tracking_exceptions, receiving, orders, staff |
| high | `/api/vision-config` | GET | ✅ | — | — | receiving |
| high | `/api/walk-in/catalog` | GET | ✅ | — | — | items, sku |
| high | `/api/walk-in/status` | GET | ✅ | — | — | customers, locations |
| high | `/api/warehouses` | GET | ✅ | — | — | warehouses, sku_stock |
| high | `/api/warranty/reports/export` | GET | ✅ | — | — | sku |
| high | `/api/workflow/flow-audit` | GET | ✅ | — | — | inventory_events, serial_units |
| high | `/api/zoho/items/[id]/image` | GET | — | — | — | zoho_item_images, sku_stock, photos, items |
| high | `/api/zoho/oauth/authorize` | GET | ✅ | — | — | warehouses, receiving, items |
| high | `/api/zoho/oauth/callback` | GET | — | — | — | ebay_accounts |
| high | `/api/zoho/purchase-orders` | GET | ✅ | — | — | receiving, orders, items, sku |
| high | `/api/zoho/purchase-receives` | GET | ✅ | — | — | receiving |
| high | `/api/zoho/warehouses` | GET | ✅ | — | — | warehouses |
| medium | `/api/admin/integrations/list` | GET | ✅ | ✅ | — | staff |
| medium | `/api/admin/org/delete` | POST | ✅ | ✅ | — | staff_sessions |
| medium | `/api/admin/po-gmail/create-zoho-draft/[id]` | POST | ✅ | ✅ | — | email_missing_purchase_orders, items |
| medium | `/api/admin/staff/list` | GET | ✅ | ✅ | — | staff |
| medium | `/api/admin/staff/update` | POST | ✅ | ✅ | — | staff |
| medium | `/api/ai/chat` | POST | ✅ | ✅ | — | receiving, messages, orders, staff |
| medium | `/api/ai/chat/stream` | POST | ✅ | ✅ | — | receiving, messages, orders, staff |
| medium | `/api/assignments/sku-search` | GET/POST | ✅ | ✅ | — | work_assignments, sku_stock, items, staff, sku |
| medium | `/api/auth/sso/callback` | GET | ✅ | ✅ | — | staff |
| medium | `/api/billing/portal` | POST | ✅ | ✅ | — | invoices |
| medium | `/api/billing/webhook` | POST | — | ✅ | — | items |
| medium | `/api/fba/items/ready` | POST | ✅ | ✅ | — | fba_shipment_items, fba_fnsku_logs, fba_shipments, items, staff |
| medium | `/api/fba/items/scan` | POST | ✅ | ✅ | — | fba_shipment_items, fba_fnsku_logs, fba_shipments, items, staff, sku |
| medium | `/api/fba/shipments` | GET/POST | ✅ | ✅ | — | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, work_assignments, fba_shipments, items +2 |
| medium | `/api/fba/shipments/today/duplicate-yesterday` | POST | ✅ | ✅ | — | fba_shipment_items, work_assignments, fba_shipments, items, sku |
| medium | `/api/fba/shipments/today/items` | POST | ✅ | ✅ | — | fba_shipment_items, work_assignments, fba_shipments, fba_fnskus, items, sku |
| medium | `/api/import-orders` | POST | ✅ | ✅ | — | work_assignments, orders, sku |
| medium | `/api/locations` | GET/POST | — | ✅ | — | locations |
| medium | `/api/locations/[barcode]` | GET/PATCH/DELETE | — | ✅ | — | reason_codes, locations, sku_stock, sku |
| medium | `/api/locations/[barcode]/swap` | POST | — | ✅ | — | inventory_events, sku_stock_ledger, bin_contents, locations, sku_stock, sku |
| medium | `/api/nas-config` | GET | ✅ | ✅ | — | receiving, photos |
| medium | `/api/orders` | GET | ✅ | ✅ | — | replenishment_order_lines, shipping_tracking_numbers, replenishment_requests, station_activity_logs, order_shipment_links, work_assignments +5 |
| medium | `/api/orders/[id]/tracking` | POST/PATCH/DELETE | — | ✅ | — | shipping_tracking_numbers, order_shipment_links, orders |
| medium | `/api/orders/assign` | POST | ✅ | ✅ | — | order_shipment_links, work_assignments, orders, staff, sku |
| medium | `/api/packerlogs` | GET/POST/PUT/DELETE | ✅ | ✅ | — | station_activity_logs, packer_logs, orders, photos, sku |
| medium | `/api/packing-logs` | GET/POST | ✅ | ✅ | — | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, sku_platform_ids, work_assignments, fba_shipments +8 |
| medium | `/api/packing-logs/update` | POST | ✅ | ✅ | — | shipping_tracking_numbers, sku_stock_ledger, work_assignments, packer_logs, sku_stock, orders +2 |
| medium | `/api/receiving-logs` | GET/DELETE/PATCH | ✅ | ✅ | — | shipping_tracking_numbers, work_assignments, receiving_scans, receiving |
| medium | `/api/receiving-photos` | GET/POST/DELETE | ✅ | ✅ | — | receiving_lines, receiving_scans, receiving, photos |
| medium | `/api/receiving-tasks` | GET/POST/PUT/DELETE | ✅ | ✅ | — | receiving |
| medium | `/api/receiving/lookup-po` | POST | ✅ | ✅ | — | shipping_tracking_numbers, tracking_exceptions, receiving_lines, receiving_scans, zoho_po_mirror, sku_catalog +5 |
| medium | `/api/receiving/mark-received-po` | POST | ✅ | ✅ | — | shipping_tracking_numbers, inventory_events, sku_stock_ledger, receiving_lines, serial_units, audit_logs +4 |
| medium | `/api/receiving/pending-check` | GET | ✅ | ✅ | — | sku_platform_ids, pending_skus, receiving, orders, sku |
| medium | `/api/receiving/scan-serial` | POST/DELETE | ✅ | ✅ | — | tech_serial_numbers, receiving_lines, serial_units, receiving, sku |
| medium | `/api/receiving/unfound-queue` | GET | ✅ | ✅ | — | receiving |
| medium | `/api/receiving/unfound-queue/[kind]/[id]` | PATCH/DELETE | ✅ | ✅ | — | email_missing_purchase_orders, orders_exceptions, unfound_overlay, serial_units, receiving, staff |
| medium | `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk` | POST | ✅ | ✅ | — | unfound_overlay, receiving |
| medium | `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk/draft` | POST | ✅ | ✅ | — | receiving |
| medium | `/api/receiving/zendesk-claim` | POST | ✅ | ✅ | — | receiving_lines, ticket_links, receiving, photos |
| medium | `/api/receiving/zendesk-claim/link` | GET/POST/DELETE | ✅ | ✅ | — | receiving_lines, unfound_overlay, ticket_links, receiving |
| medium | `/api/receiving/zendesk-claim/thread` | GET | ✅ | ✅ | — | receiving |
| medium | `/api/repair/submit` | POST | ✅ | ✅ | — | work_assignments, documents |
| medium | `/api/returns/intake` | POST | ✅ | ✅ | — | inventory_events, sku_stock_ledger, serial_units, receiving, sku_stock |
| medium | `/api/rma/[id]/disposition` | POST | ✅ | ✅ | — | return_dispositions, inventory_events, orders, staff |
| medium | `/api/scan-tracking` | POST | ✅ | ✅ | — | shipping_tracking_numbers, orders_exceptions, orders |
| medium | `/api/serial-units/[id]/test` | POST | ✅ | ✅ | — | tech_serial_numbers, inventory_events, testing_results, audit_logs, receiving, staff +1 |
| medium | `/api/serial-units/lookup` | GET | ✅ | ✅ | — | order_unit_allocations, tech_serial_numbers, serial_units, receiving, orders, sku |
| medium | `/api/shipped` | GET/PATCH | ✅ | ✅ | — | packer_logs, orders, sku |
| medium | `/api/shipped/search` | GET/POST | ✅ | ✅ | — | orders |
| medium | `/api/sku-stock/[sku]` | GET/PATCH | ✅ | ✅ | — | inventory_events, sku_stock_ledger, sku_catalog, locations, sku_stock, photos +2 |
| medium | `/api/sourcing/search` | POST | ✅ | ✅ | — | ebay_api_calls |
| medium | `/api/staff` | GET/POST/PUT/DELETE | ✅ | ✅ | — | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| medium | `/api/staff-messages` | GET/POST/PATCH | ✅ | ✅ | — | messages, items, staff |
| medium | `/api/stations` | GET/POST | ✅ | ✅ | — | station_definitions, receiving, staff |
| medium | `/api/stations/publish` | POST | ✅ | ✅ | — | workflow_definitions, station_definitions, staff |
| medium | `/api/studio/definitions/[id]/graph` | PUT | ✅ | ✅ | — | workflow_definitions, workflow_edges, workflow_nodes |
| medium | `/api/studio/definitions/[id]/publish` | POST | ✅ | ✅ | — | workflow_definitions, workflow_edges, workflow_nodes, items |
| medium | `/api/studio/definitions/draft` | POST | ✅ | ✅ | — | workflow_definitions, workflow_edges, workflow_nodes |
| medium | `/api/studio/live` | GET | ✅ | ✅ | — | item_workflow_state |
| medium | `/api/sync-sheets` | POST | ✅ | ✅ | — | shipping_tracking_numbers, tech_serial_numbers, work_assignments, packer_logs, sku_catalog, fba_fnskus +2 |
| medium | `/api/tech/scan` | POST | ✅ | ✅ | — | shipping_tracking_numbers, tech_serial_numbers, fba_shipment_items, orders_exceptions, work_assignments, fba_fnsku_logs +5 |
| medium | `/api/tech/scan-sku` | POST | ✅ | ✅ | — | sku_stock_ledger, serial_units, sku_stock, orders, staff, sku |
| medium | `/api/tech/serial` | POST | ✅ | ✅ | — | station_activity_logs, tech_serial_numbers, orders |
| medium | `/api/warranty/claims` | GET/POST | ✅ | ✅ | — | staff, sku |
| medium | `/api/warranty/claims/[id]/zendesk` | GET/POST | ✅ | ✅ | — | ticket_links, receiving |
| medium | `/api/warranty/claims/bulk` | POST/DELETE | ✅ | ✅ | — | items, staff, sku |
| medium | `/api/warranty/lookup` | GET | ✅ | ✅ | — | sku |
| medium | `/api/zendesk/tickets` | GET/POST | ✅ | ✅ | — | ticket_links, photos |
| medium | `/api/zendesk/tickets/[id]/photos` | GET | ✅ | ✅ | — | unfound_overlay, ticket_links, photos |
| medium | `/api/zoho/items/sync` | POST/GET | ✅ | ✅ | — | items |
| medium | `/api/zoho/orders/ingest` | POST | ✅ | ✅ | — | order_ingest_queue, orders |
| low | `/api/admin/org/export` | POST | ✅ | ✅ | ✅ | staff_sessions, staff |
| low | `/api/admin/staff/deactivate` | POST | ✅ | ✅ | ✅ | staff_sessions, staff |
| low | `/api/admin/staff/invite` | POST | ✅ | ✅ | ✅ | staff_enrollments, staff |
| low | `/api/ebay/accounts` | GET/PUT | ✅ | ✅ | ✅ | ebay_accounts |
| low | `/api/ebay/callback` | GET | — | ✅ | ✅ | ebay_accounts |
| low | `/api/rag/documents` | POST | ✅ | ✅ | ✅ | rag_document_chunks, rag_documents, documents |
| low | `/api/rag/search` | POST | ✅ | ✅ | ✅ | rag_document_chunks |

## Reverse index — routes per tenant table (the Phase E enforcement gate)

> A table may be `enforce_tenant_isolation()`-d only once **every** route below it is GUC-wrapped (low risk).

### `api_idempotency_responses` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/cron/cleanup` (high)
- ⛔ `/api/receiving/add-unmatched-line` (critical)

### `audit_logs` — 7 routes, 7 not yet GUC-safe

- ⛔ `/api/admin/logs` (high)
- ⛔ `/api/audit-log/staff-directory` (high)
- ⛔ `/api/audit/bin/[id]` (high)
- ⛔ `/api/audit/sku/[sku]` (high)
- ⛔ `/api/receiving/mark-received` (critical)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ⛔ `/api/serial-units/[id]/test` (medium)

### `auth_audit` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/admin/audit` (high)
- ⛔ `/api/admin/staff/[id]/detail` (high)

### `bin_contents` — 11 routes, 11 not yet GUC-safe

- ⛔ `/api/cron/stock-alerts` (high)
- ⛔ `/api/cycle-counts/campaigns` (critical)
- ⛔ `/api/cycle-counts/lines/[id]` (critical)
- ⛔ `/api/inventory/sku-search` (high)
- ⛔ `/api/locations/[barcode]/swap` (medium)
- ⛔ `/api/products/[sku]` (high)
- ⛔ `/api/replenishment/tasks/[id]/complete` (critical)
- ⛔ `/api/serial-units/[id]/move` (critical)
- ⛔ `/api/sku-catalog/[id]` (critical)
- ⛔ `/api/stock-alerts` (high)
- ⛔ `/api/transfers` (critical)

### `customers` — 5 routes, 5 not yet GUC-safe

- ⛔ `/api/orders/lookup/[orderId]` (high)
- ⛔ `/api/repair-service/[id]` (critical)
- ⛔ `/api/repair/customers` (high)
- ⛔ `/api/walk-in/customers` (critical)
- ⛔ `/api/walk-in/status` (high)

### `cycle_count_campaigns` — 4 routes, 4 not yet GUC-safe

- ⛔ `/api/cycle-counts/campaigns` (critical)
- ⛔ `/api/cycle-counts/campaigns/[id]` (critical)
- ⛔ `/api/cycle-counts/lines/[id]` (critical)
- ⛔ `/api/inventory/counts` (high)

### `cycle_count_lines` — 4 routes, 4 not yet GUC-safe

- ⛔ `/api/cycle-counts/campaigns` (critical)
- ⛔ `/api/cycle-counts/campaigns/[id]` (critical)
- ⛔ `/api/cycle-counts/lines/[id]` (critical)
- ⛔ `/api/inventory/counts` (high)

### `documents` — 5 routes, 4 not yet GUC-safe

- ✅ `/api/rag/documents` (low)
- ⛔ `/api/repair-service/[id]` (critical)
- ⛔ `/api/repair-service/document/[id]` (high)
- ⛔ `/api/repair-service/pickup` (critical)
- ⛔ `/api/repair/submit` (medium)

### `ebay_accounts` — 5 routes, 3 not yet GUC-safe

- ✅ `/api/ebay/accounts` (low)
- ✅ `/api/ebay/callback` (low)
- ⛔ `/api/ebay/refresh-token` (critical)
- ⛔ `/api/orders/backfill/ebay` (critical)
- ⛔ `/api/zoho/oauth/callback` (high)

### `ebay_api_calls` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/sourcing/search` (medium)

### `email_delivery_signals` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/receiving-lines/incoming/details` (high)

### `email_missing_purchase_orders` — 11 routes, 11 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/create-zoho-draft/[id]` (medium)
- ⛔ `/api/admin/po-gmail/missing-orders` (critical)
- ⛔ `/api/admin/po-gmail/reconcile` (high)
- ⛔ `/api/admin/po-gmail/triage` (high)
- ⛔ `/api/admin/po-gmail/triage/[id]` (critical)
- ⛔ `/api/admin/po-gmail/triage/[id]/detail` (high)
- ⛔ `/api/admin/po-gmail/triage/[id]/extract` (critical)
- ⛔ `/api/admin/po-mirror/health` (high)
- ⛔ `/api/cron/zoho/po-sync` (high)
- ⛔ `/api/receiving-lines/incoming/details` (high)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]` (medium)

### `failure_modes` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/quality/dashboard` (high)

### `fba_fnsku_logs` — 14 routes, 14 not yet GUC-safe

- ⛔ `/api/admin/fba-fnskus/[fnsku]` (critical)
- ⛔ `/api/fba/items/ready` (medium)
- ⛔ `/api/fba/items/scan` (medium)
- ⛔ `/api/fba/items/verify` (critical)
- ⛔ `/api/fba/labels/bind` (critical)
- ⛔ `/api/fba/logs` (critical)
- ⛔ `/api/fba/logs/[id]` (critical)
- ⛔ `/api/fba/logs/summary` (high)
- ⛔ `/api/fba/shipments/[id]/items/[itemId]` (critical)
- ⛔ `/api/fba/shipments/close` (critical)
- ⛔ `/api/tech/delete` (critical)
- ⛔ `/api/tech/logs` (high)
- ⛔ `/api/tech/scan` (medium)
- ⛔ `/api/tech/update-serials` (critical)

### `fba_fnskus` — 26 routes, 26 not yet GUC-safe

- ⛔ `/api/admin/fba-fnskus` (critical)
- ⛔ `/api/admin/fba-fnskus/[fnsku]` (critical)
- ⛔ `/api/admin/fba-fnskus/upload` (critical)
- ⛔ `/api/fba/board` (high)
- ⛔ `/api/fba/board/[fnsku]/entries` (high)
- ⛔ `/api/fba/fnskus` (critical)
- ⛔ `/api/fba/fnskus/[fnsku]` (critical)
- ⛔ `/api/fba/fnskus/bulk` (critical)
- ⛔ `/api/fba/fnskus/search` (high)
- ⛔ `/api/fba/fnskus/validate` (high)
- ⛔ `/api/fba/items/[id]/link-unit` (critical)
- ⛔ `/api/fba/items/queue` (high)
- ⛔ `/api/fba/logs` (critical)
- ⛔ `/api/fba/logs/[id]` (critical)
- ⛔ `/api/fba/logs/summary` (high)
- ⛔ `/api/fba/print-queue` (high)
- ⛔ `/api/fba/shipments/[id]/items` (critical)
- ⛔ `/api/fba/shipments/[id]/ship-units` (critical)
- ⛔ `/api/fba/shipments/active-with-details` (high)
- ⛔ `/api/fba/shipments/today` (high)
- ⛔ `/api/fba/shipments/today/items` (medium)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/sync-sheets` (medium)
- ⛔ `/api/tech/logs` (high)
- ⛔ `/api/tech/orders-without-manual` (high)
- ⛔ `/api/tech/scan` (medium)

### `fba_shipment_item_units` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/fba/items/[id]/link-unit` (critical)
- ⛔ `/api/fba/shipments/[id]/ship-units` (critical)

### `fba_shipment_items` — 29 routes, 29 not yet GUC-safe

- ⛔ `/api/admin/fba-fnskus/[fnsku]` (critical)
- ⛔ `/api/dashboard/fba-shipments` (high)
- ⛔ `/api/fba/board` (high)
- ⛔ `/api/fba/board/[fnsku]/entries` (high)
- ⛔ `/api/fba/items/[id]/link-unit` (critical)
- ⛔ `/api/fba/items/queue` (high)
- ⛔ `/api/fba/items/ready` (medium)
- ⛔ `/api/fba/items/scan` (medium)
- ⛔ `/api/fba/items/verify` (critical)
- ⛔ `/api/fba/labels/bind` (critical)
- ⛔ `/api/fba/logs/summary` (high)
- ⛔ `/api/fba/print-queue` (high)
- ⛔ `/api/fba/shipments` (medium)
- ⛔ `/api/fba/shipments/[id]` (critical)
- ⛔ `/api/fba/shipments/[id]/items` (critical)
- ⛔ `/api/fba/shipments/[id]/items/[itemId]` (critical)
- ⛔ `/api/fba/shipments/[id]/items/[itemId]/reassign` (critical)
- ⛔ `/api/fba/shipments/[id]/ship-units` (critical)
- ⛔ `/api/fba/shipments/[id]/tracking` (critical)
- ⛔ `/api/fba/shipments/active-with-details` (high)
- ⛔ `/api/fba/shipments/close` (critical)
- ⛔ `/api/fba/shipments/mark-shipped` (critical)
- ⛔ `/api/fba/shipments/split-for-paired-review` (critical)
- ⛔ `/api/fba/shipments/today` (high)
- ⛔ `/api/fba/shipments/today/duplicate-yesterday` (medium)
- ⛔ `/api/fba/shipments/today/items` (medium)
- ⛔ `/api/fba/stage-counts` (high)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/tech/scan` (medium)

### `fba_shipment_tracking` — 11 routes, 11 not yet GUC-safe

- ⛔ `/api/fba/board` (high)
- ⛔ `/api/fba/board/[fnsku]/entries` (high)
- ⛔ `/api/fba/print-queue` (high)
- ⛔ `/api/fba/shipments` (medium)
- ⛔ `/api/fba/shipments/[id]` (critical)
- ⛔ `/api/fba/shipments/[id]/tracking` (critical)
- ⛔ `/api/fba/shipments/active-with-details` (high)
- ⛔ `/api/fba/shipments/mark-shipped` (critical)
- ⛔ `/api/fba/shipments/split-for-paired-review` (critical)
- ⛔ `/api/fba/shipments/today` (high)
- ⛔ `/api/packing-logs` (medium)

### `fba_shipments` — 27 routes, 27 not yet GUC-safe

- ⛔ `/api/dashboard/fba-shipments` (high)
- ⛔ `/api/fba/board` (high)
- ⛔ `/api/fba/board/[fnsku]/entries` (high)
- ⛔ `/api/fba/items/queue` (high)
- ⛔ `/api/fba/items/ready` (medium)
- ⛔ `/api/fba/items/scan` (medium)
- ⛔ `/api/fba/labels/bind` (critical)
- ⛔ `/api/fba/logs` (critical)
- ⛔ `/api/fba/logs/[id]` (critical)
- ⛔ `/api/fba/logs/summary` (high)
- ⛔ `/api/fba/print-queue` (high)
- ⛔ `/api/fba/shipments` (medium)
- ⛔ `/api/fba/shipments/[id]` (critical)
- ⛔ `/api/fba/shipments/[id]/items` (critical)
- ⛔ `/api/fba/shipments/[id]/items/[itemId]` (critical)
- ⛔ `/api/fba/shipments/[id]/items/[itemId]/reassign` (critical)
- ⛔ `/api/fba/shipments/active-with-details` (high)
- ⛔ `/api/fba/shipments/close` (critical)
- ⛔ `/api/fba/shipments/mark-shipped` (critical)
- ⛔ `/api/fba/shipments/split-for-paired-review` (critical)
- ⛔ `/api/fba/shipments/today` (high)
- ⛔ `/api/fba/shipments/today/duplicate-yesterday` (medium)
- ⛔ `/api/fba/shipments/today/items` (medium)
- ⛔ `/api/global-search` (high)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/tech/scan` (medium)
- ⛔ `/api/work-orders` (critical)

### `fba_tracking_item_allocations` — 5 routes, 5 not yet GUC-safe

- ⛔ `/api/fba/shipments/[id]/items/[itemId]` (critical)
- ⛔ `/api/fba/shipments/[id]/tracking` (critical)
- ⛔ `/api/fba/shipments/active-with-details` (high)
- ⛔ `/api/fba/shipments/split-for-paired-review` (critical)
- ⛔ `/api/receiving-lines` (critical)

### `google_oauth_tokens` — 3 routes, 3 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/disconnect` (critical)
- ⛔ `/api/admin/po-gmail/oauth-callback` (high)
- ⛔ `/api/admin/po-gmail/status` (high)

### `handling_units` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/handling-units` (critical)
- ⛔ `/api/handling-units/[id]` (high)

### `inventory_events` — 32 routes, 32 not yet GUC-safe

- ⛔ `/api/audit-log/report` (high)
- ⛔ `/api/audit/bin/[id]` (high)
- ⛔ `/api/audit/sku/[sku]` (high)
- ⛔ `/api/fba/items/[id]/link-unit` (critical)
- ⛔ `/api/fba/shipments/[id]/ship-units` (critical)
- ⛔ `/api/inventory-photos` (critical)
- ⛔ `/api/locations/[barcode]/swap` (medium)
- ⛔ `/api/orders/[id]/release` (critical)
- ⛔ `/api/pack/ship` (critical)
- ⛔ `/api/pick/scan` (critical)
- ⛔ `/api/picking/session/[id]/short-pick` (critical)
- ⛔ `/api/post-multi-sn` (critical)
- ⛔ `/api/receiving-lines/incoming/details` (high)
- ⛔ `/api/receiving/[id]` (critical)
- ⛔ `/api/receiving/lines/[id]/move` (critical)
- ⛔ `/api/receiving/lines/[id]/putaway` (critical)
- ⛔ `/api/receiving/lines/[id]/timeline` (high)
- ⛔ `/api/receiving/mark-received` (critical)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ⛔ `/api/replenishment/tasks/[id]/complete` (critical)
- ⛔ `/api/returns/intake` (medium)
- ⛔ `/api/rma/[id]/disposition` (medium)
- ⛔ `/api/serial-units/[id]` (high)
- ⛔ `/api/serial-units/[id]/allocate` (critical)
- ⛔ `/api/serial-units/[id]/grade` (critical)
- ⛔ `/api/serial-units/[id]/hold` (critical)
- ⛔ `/api/serial-units/[id]/move` (critical)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ⛔ `/api/tech/test-result` (critical)
- ⛔ `/api/transfers` (critical)
- ⛔ `/api/workflow/flow-audit` (high)

### `invoices` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/billing/portal` (medium)
- ⛔ `/api/zoho/fulfillment-sync` (critical)

### `item_stock_cache` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/replenish/shipped-fifo` (high)

### `item_workflow_state` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/studio/live` (medium)

### `items` — 87 routes, 87 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/create-zoho-draft/[id]` (medium)
- ⛔ `/api/admin/po-gmail/missing-orders` (critical)
- ⛔ `/api/admin/po-gmail/preview-unread` (high)
- ⛔ `/api/admin/po-gmail/triage` (high)
- ⛔ `/api/assignments/sku-search` (medium)
- ⛔ `/api/audit-log/packing` (high)
- ⛔ `/api/audit-log/receiving` (high)
- ⛔ `/api/audit-log/sku` (high)
- ⛔ `/api/audit-log/tech` (high)
- ⛔ `/api/billing/webhook` (medium)
- ⛔ `/api/bose-models` (critical)
- ⛔ `/api/cron/zoho/incoming-po-sync` (high)
- ⛔ `/api/ecwid/products/search` (high)
- ⛔ `/api/ecwid/recent-repair-orders` (high)
- ⛔ `/api/ecwid/sync-exception-tracking` (critical)
- ⛔ `/api/fba/fnskus/search` (high)
- ⛔ `/api/fba/items/[id]/link-unit` (critical)
- ⛔ `/api/fba/items/queue` (high)
- ⛔ `/api/fba/items/ready` (medium)
- ⛔ `/api/fba/items/scan` (medium)
- ⛔ `/api/fba/items/verify` (critical)
- ⛔ `/api/fba/labels/bind` (critical)
- ⛔ `/api/fba/print-queue` (high)
- ⛔ `/api/fba/shipments` (medium)
- ⛔ `/api/fba/shipments/[id]` (critical)
- ⛔ `/api/fba/shipments/[id]/items` (critical)
- ⛔ `/api/fba/shipments/[id]/items/[itemId]` (critical)
- ⛔ `/api/fba/shipments/[id]/items/[itemId]/reassign` (critical)
- ⛔ `/api/fba/shipments/active-with-details` (high)
- ⛔ `/api/fba/shipments/close` (critical)
- ⛔ `/api/fba/shipments/mark-shipped` (critical)
- ⛔ `/api/fba/shipments/today` (high)
- ⛔ `/api/fba/shipments/today/duplicate-yesterday` (medium)
- ⛔ `/api/fba/shipments/today/items` (medium)
- ⛔ `/api/get-title-by-sku` (high)
- ⛔ `/api/handling-units` (critical)
- ⛔ `/api/inbox/tech-queue` (high)
- ⛔ `/api/inventory/alerts` (high)
- ⛔ `/api/inventory/counts` (high)
- ⛔ `/api/inventory/units` (high)
- ⛔ `/api/labels/recent` (high)
- ⛔ `/api/local-pickup-orders` (critical)
- ⛔ `/api/local-pickup-orders/[id]` (critical)
- ⛔ `/api/local-pickup-orders/[id]/finalize` (critical)
- ⛔ `/api/local-pickup-orders/[id]/items` (critical)
- ⛔ `/api/local-pickup-orders/[id]/items/[itemId]` (critical)
- ⛔ `/api/orders/backfill/ecwid` (critical)
- ⛔ `/api/part-compatibility` (critical)
- ⛔ `/api/product-manuals/sync` (critical)
- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/receiving-lines/incoming/delivered-unscanned` (high)
- ⛔ `/api/receiving-lines/incoming/details` (high)
- ⛔ `/api/receiving-lines/incoming/email-rescan` (critical)
- ⛔ `/api/receiving/add-unmatched-line` (critical)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/mark-received` (critical)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ⛔ `/api/receiving/po/[poId]` (high)
- ⛔ `/api/receiving/po/list` (high)
- ⛔ `/api/repair/ecwid-categories` (high)
- ⛔ `/api/repair/ecwid-products` (high)
- ⛔ `/api/replenish/shipped-fifo` (high)
- ⛔ `/api/sku-catalog` (critical)
- ⛔ `/api/sku-catalog/[id]/similar` (high)
- ⛔ `/api/sku-catalog/pair-suggestions` (high)
- ⛔ `/api/sku-catalog/pairing-queue` (high)
- ⛔ `/api/sku-catalog/search` (high)
- ⛔ `/api/sku-catalog/sync-ecwid-products` (critical)
- ⛔ `/api/sku-catalog/sync-ecwid-titles` (critical)
- ⛔ `/api/sku-catalog/unpaired` (high)
- ⛔ `/api/sku-catalog/unpaired-ecwid` (high)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ⛔ `/api/sourcing/alerts` (critical)
- ⛔ `/api/sourcing/candidates` (critical)
- ⛔ `/api/staff-messages` (medium)
- ⛔ `/api/staff-todos` (critical)
- ⛔ `/api/studio/definitions/[id]/publish` (medium)
- ⛔ `/api/suppliers` (critical)
- ⛔ `/api/walk-in/catalog` (high)
- ⛔ `/api/warranty/claims/bulk` (medium)
- ⛔ `/api/webhooks/square` (critical)
- ⛔ `/api/webhooks/zoho/orders` (critical)
- ⛔ `/api/zoho/items/[id]/image` (high)
- ⛔ `/api/zoho/items/sync` (medium)
- ⛔ `/api/zoho/oauth/authorize` (high)
- ⛔ `/api/zoho/purchase-orders` (high)
- ⛔ `/api/zoho/purchase-orders/receive` (critical)

### `local_pickup_items` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/local-pickups` (critical)

### `local_pickup_order_items` — 6 routes, 6 not yet GUC-safe

- ⛔ `/api/local-pickup-orders` (critical)
- ⛔ `/api/local-pickup-orders/[id]` (critical)
- ⛔ `/api/local-pickup-orders/[id]/finalize` (critical)
- ⛔ `/api/local-pickup-orders/[id]/items` (critical)
- ⛔ `/api/local-pickup-orders/[id]/items/[itemId]` (critical)
- ⛔ `/api/receiving-lines` (critical)

### `local_pickup_orders` — 8 routes, 8 not yet GUC-safe

- ⛔ `/api/local-pickup-orders` (critical)
- ⛔ `/api/local-pickup-orders/[id]` (critical)
- ⛔ `/api/local-pickup-orders/[id]/complete` (critical)
- ⛔ `/api/local-pickup-orders/[id]/finalize` (critical)
- ⛔ `/api/local-pickup-orders/[id]/items` (critical)
- ⛔ `/api/local-pickup-orders/[id]/items/[itemId]` (critical)
- ⛔ `/api/local-pickup-orders/[id]/void` (critical)
- ⛔ `/api/receiving/[id]` (critical)

### `location_transfers` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/update-sku-location` (critical)

### `locations` — 21 routes, 21 not yet GUC-safe

- ⛔ `/api/cycle-counts/campaigns` (critical)
- ⛔ `/api/cycle-counts/campaigns/[id]` (critical)
- ⛔ `/api/inventory-events` (high)
- ⛔ `/api/inventory/alerts` (high)
- ⛔ `/api/locations` (medium)
- ⛔ `/api/locations/[barcode]` (medium)
- ⛔ `/api/locations/[barcode]/properties` (critical)
- ⛔ `/api/locations/[barcode]/swap` (medium)
- ⛔ `/api/locations/bulk` (critical)
- ⛔ `/api/locations/register` (critical)
- ⛔ `/api/receiving/[id]` (critical)
- ⛔ `/api/receiving/lines/[id]/move` (critical)
- ⛔ `/api/receiving/lines/[id]/putaway` (critical)
- ⛔ `/api/receiving/lines/[id]/timeline` (high)
- ⛔ `/api/receiving/mark-received` (critical)
- ⛔ `/api/serial-units/[id]` (high)
- ⛔ `/api/serial-units/[id]/move` (critical)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ⛔ `/api/stock-alerts` (high)
- ⛔ `/api/transfers` (critical)
- ⛔ `/api/walk-in/status` (high)

### `messages` — 10 routes, 10 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/preview-unread` (high)
- ⛔ `/api/admin/po-gmail/reconcile` (high)
- ⛔ `/api/admin/po-gmail/triage/[id]/detail` (high)
- ⛔ `/api/admin/po-gmail/triage/[id]/extract` (critical)
- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/ai/chat-sessions/[sessionId]/messages` (high)
- ⛔ `/api/ai/chat/stream` (medium)
- ⛔ `/api/ai/search` (critical)
- ⛔ `/api/staff-messages` (medium)
- ⛔ `/api/support/overview` (high)

### `mobile_scan_events` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/scan/history` (high)
- ⛔ `/api/scan/resolve` (critical)

### `operations_kpi_rollups_daily` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/operations/kpi-table` (high)

### `operations_kpi_rollups_hourly` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/operations/kpi-table` (high)

### `order_ingest_queue` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/cron/zoho/orders-ingest-drain` (high)
- ⛔ `/api/zoho/orders/ingest` (medium)

### `order_shipment_links` — 5 routes, 5 not yet GUC-safe

- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders/[id]/tracking` (medium)
- ⛔ `/api/orders/assign` (medium)
- ⛔ `/api/tech/logs` (high)
- ⛔ `/api/work-orders` (critical)

### `order_unit_allocations` — 6 routes, 6 not yet GUC-safe

- ⛔ `/api/orders/[id]/release` (critical)
- ⛔ `/api/pack/ship` (critical)
- ⛔ `/api/pick/scan` (critical)
- ⛔ `/api/serial-units/[id]` (high)
- ⛔ `/api/serial-units/[id]/allocate` (critical)
- ⛔ `/api/serial-units/lookup` (medium)

### `orders` — 119 routes, 119 not yet GUC-safe

- ⛔ `/api/admin/fix-status` (critical)
- ⛔ `/api/admin/po-gmail/missing-orders` (critical)
- ⛔ `/api/admin/po-gmail/triage` (high)
- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/ai/chat/stream` (medium)
- ⛔ `/api/audit-log/report` (high)
- ⛔ `/api/check-tracking` (high)
- ⛔ `/api/cron/google-sheets/transfer-orders` (high)
- ⛔ `/api/cron/zoho/fulfillment-sync` (high)
- ⛔ `/api/cron/zoho/incoming-po-sync` (high)
- ⛔ `/api/cron/zoho/orders-ingest-drain` (high)
- ⛔ `/api/cron/zoho/po-sync` (high)
- ⛔ `/api/dashboard/operations` (high)
- ⛔ `/api/debug-tracking` (high)
- ⛔ `/api/desktop-app/release` (high)
- ⛔ `/api/ebay/search` (high)
- ⛔ `/api/ecwid/recent-repair-orders` (high)
- ⛔ `/api/ecwid/sync-exception-tracking` (critical)
- ⛔ `/api/ecwid/transfer-orders` (critical)
- ⛔ `/api/global-search` (high)
- ⛔ `/api/google-sheets/execute-script` (critical)
- ⛔ `/api/google-sheets/sync-shipstation-orders` (critical)
- ⛔ `/api/google-sheets/transfer-orders` (critical)
- ⛔ `/api/import-orders` (medium)
- ⛔ `/api/local-pickup-orders` (critical)
- ⛔ `/api/local-pickup-orders/[id]` (critical)
- ⛔ `/api/local-pickup-orders/[id]/complete` (critical)
- ⛔ `/api/local-pickup-orders/[id]/finalize` (critical)
- ⛔ `/api/local-pickup-orders/[id]/items` (critical)
- ⛔ `/api/local-pickup-orders/[id]/items/[itemId]` (critical)
- ⛔ `/api/local-pickup-orders/[id]/void` (critical)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders-exceptions/delete` (critical)
- ⛔ `/api/orders-exceptions/sync` (critical)
- ⛔ `/api/orders/[id]` (critical)
- ⛔ `/api/orders/[id]/allocate` (critical)
- ⛔ `/api/orders/[id]/pick-tasks` (high)
- ⛔ `/api/orders/[id]/release` (critical)
- ⛔ `/api/orders/[id]/tracking` (medium)
- ⛔ `/api/orders/add` (critical)
- ⛔ `/api/orders/assign` (medium)
- ⛔ `/api/orders/backfill/ebay` (critical)
- ⛔ `/api/orders/backfill/ecwid` (critical)
- ⛔ `/api/orders/batch` (critical)
- ⛔ `/api/orders/check-shipped` (critical)
- ⛔ `/api/orders/delete` (critical)
- ⛔ `/api/orders/integrity-check` (critical)
- ⛔ `/api/orders/lookup/[orderId]` (high)
- ⛔ `/api/orders/missing-parts` (critical)
- ⛔ `/api/orders/next` (high)
- ⛔ `/api/orders/recent` (high)
- ⛔ `/api/orders/set-item-number` (critical)
- ⛔ `/api/orders/skip` (critical)
- ⛔ `/api/orders/start` (critical)
- ⛔ `/api/orders/verify` (high)
- ⛔ `/api/pack/ship` (critical)
- ⛔ `/api/packerlogs` (medium)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/packing-logs/details` (high)
- ⛔ `/api/packing-logs/history` (high)
- ⛔ `/api/packing-logs/last-order` (high)
- ⛔ `/api/packing-logs/start-session` (critical)
- ⛔ `/api/packing-logs/update` (medium)
- ⛔ `/api/pick/queue` (high)
- ⛔ `/api/pick/scan` (critical)
- ⛔ `/api/picking/session` (critical)
- ⛔ `/api/picking/session/[id]/complete` (critical)
- ⛔ `/api/picking/session/[id]/confirm-pick` (critical)
- ⛔ `/api/picking/session/[id]/short-pick` (critical)
- ⛔ `/api/print/dispatch` (critical)
- ⛔ `/api/receiving-lines/incoming/refresh/stream` (critical)
- ⛔ `/api/receiving-lines/incoming/summary` (high)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/pending-check` (medium)
- ⛔ `/api/replenish/bulk-create-po` (critical)
- ⛔ `/api/replenish/shipped-fifo` (high)
- ⛔ `/api/rma` (critical)
- ⛔ `/api/rma/[id]` (critical)
- ⛔ `/api/rma/[id]/close` (critical)
- ⛔ `/api/rma/[id]/disposition` (medium)
- ⛔ `/api/rma/[id]/mark-received` (critical)
- ⛔ `/api/rma/by-number/[number]` (high)
- ⛔ `/api/scan-tracking` (medium)
- ⛔ `/api/scan/resolve` (critical)
- ⛔ `/api/serial-units/[id]/allocate` (critical)
- ⛔ `/api/serial-units/lookup` (medium)
- ⛔ `/api/shipped` (medium)
- ⛔ `/api/shipped/[id]` (high)
- ⛔ `/api/shipped/debug` (high)
- ⛔ `/api/shipped/lookup-order` (high)
- ⛔ `/api/shipped/search` (medium)
- ⛔ `/api/shipped/submit` (critical)
- ⛔ `/api/sku-catalog/pair-batch` (critical)
- ⛔ `/api/sku-catalog/pairing-queue` (high)
- ⛔ `/api/sku-catalog/resolve` (high)
- ⛔ `/api/sku-catalog/search-unmatched` (high)
- ⛔ `/api/sku-catalog/unpaired` (high)
- ⛔ `/api/sync-sheets` (medium)
- ⛔ `/api/tech-logs/search` (high)
- ⛔ `/api/tech/delete` (critical)
- ⛔ `/api/tech/logs` (high)
- ⛔ `/api/tech/orders-without-manual` (high)
- ⛔ `/api/tech/scan` (medium)
- ⛔ `/api/tech/scan-sku` (medium)
- ⛔ `/api/tech/serial` (medium)
- ⛔ `/api/tracking-exceptions` (high)
- ⛔ `/api/tracking-exceptions/[id]/refresh` (critical)
- ⛔ `/api/walk-in/orders` (critical)
- ⛔ `/api/walk-in/sales` (critical)
- ⛔ `/api/walk-in/sync` (critical)
- ⛔ `/api/webhooks/square` (critical)
- ⛔ `/api/webhooks/zoho/orders` (critical)
- ⛔ `/api/work-orders` (critical)
- ⛔ `/api/zoho/fulfillment-sync` (critical)
- ⛔ `/api/zoho/orders/ingest` (medium)
- ⛔ `/api/zoho/purchase-orders` (high)
- ⛔ `/api/zoho/purchase-orders/receive` (critical)
- ⛔ `/api/zoho/purchase-orders/sync` (critical)
- ⛔ `/api/zoho/purchase-receives/sync` (critical)

### `orders_exceptions` — 8 routes, 8 not yet GUC-safe

- ⛔ `/api/ecwid/sync-exception-tracking` (critical)
- ⛔ `/api/google-sheets/execute-script` (critical)
- ⛔ `/api/google-sheets/sync-shipstation-orders` (critical)
- ⛔ `/api/orders-exceptions/delete` (critical)
- ⛔ `/api/orders-exceptions/sync` (critical)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]` (medium)
- ⛔ `/api/scan-tracking` (medium)
- ⛔ `/api/tech/scan` (medium)

### `packages` — 5 routes, 5 not yet GUC-safe

- ⛔ `/api/receiving-lines/incoming/refresh` (critical)
- ⛔ `/api/receiving-lines/incoming/refresh/stream` (critical)
- ⛔ `/api/receiving-lines/incoming/summary` (high)
- ⛔ `/api/webhooks/ups` (critical)
- ⛔ `/api/zoho/fulfillment-sync` (critical)

### `packer_logs` — 19 routes, 19 not yet GUC-safe

- ⛔ `/api/admin/logs` (high)
- ⛔ `/api/audit-log/report` (high)
- ⛔ `/api/check-tracking` (high)
- ⛔ `/api/debug-tracking` (high)
- ⛔ `/api/google-sheets/execute-script` (critical)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders/batch` (critical)
- ⛔ `/api/orders/verify` (high)
- ⛔ `/api/pack/ship` (critical)
- ⛔ `/api/packerlogs` (medium)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/packing-logs/history` (high)
- ⛔ `/api/packing-logs/last-order` (high)
- ⛔ `/api/packing-logs/photos` (high)
- ⛔ `/api/packing-logs/start-session` (critical)
- ⛔ `/api/packing-logs/update` (medium)
- ⛔ `/api/shipped` (medium)
- ⛔ `/api/shipped/debug` (high)
- ⛔ `/api/sync-sheets` (medium)

### `part_acquisitions` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/sourcing/candidates/[id]/import` (critical)

### `payroll_settings` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/payroll/settings` (critical)

### `pending_skus` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/receiving/pending-check` (medium)

### `photos` — 28 routes, 28 not yet GUC-safe

- ⛔ `/api/inventory-photos` (critical)
- ⛔ `/api/nas-config` (medium)
- ⛔ `/api/nas-dev/[[...path]]` (critical)
- ⛔ `/api/packerlogs` (medium)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/packing-logs/details` (high)
- ⛔ `/api/packing-logs/history` (high)
- ⛔ `/api/packing-logs/last-order` (high)
- ⛔ `/api/packing-logs/photos` (high)
- ⛔ `/api/packing-logs/save-photo` (critical)
- ⛔ `/api/packing-logs/start-session` (critical)
- ⛔ `/api/packing-logs/update` (medium)
- ⛔ `/api/photos/[id]` (critical)
- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/receiving-photos` (medium)
- ⛔ `/api/receiving/nas-archive-test` (critical)
- ⛔ `/api/receiving/po/[poId]` (high)
- ⛔ `/api/receiving/po/list` (high)
- ⛔ `/api/receiving/zendesk-claim` (medium)
- ⛔ `/api/receiving/zendesk-claim/draft` (critical)
- ⛔ `/api/receiving/zendesk-claim/preview` (critical)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ⛔ `/api/sku/[id]/photos` (critical)
- ⛔ `/api/sku/by-tracking` (critical)
- ⛔ `/api/warranty/claims/[id]/repair` (critical)
- ⛔ `/api/zendesk/tickets` (medium)
- ⛔ `/api/zendesk/tickets/[id]/photos` (medium)
- ⛔ `/api/zoho/items/[id]/image` (high)

### `printer_profiles` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/print/dispatch` (critical)

### `product_manuals` — 17 routes, 17 not yet GUC-safe

- ⛔ `/api/manuals/recent` (high)
- ⛔ `/api/manuals/resolve` (high)
- ⛔ `/api/manuals/upsert` (critical)
- ⛔ `/api/orders/recent` (high)
- ⛔ `/api/product-manuals` (critical)
- ⛔ `/api/product-manuals/assign` (critical)
- ⛔ `/api/product-manuals/bulk` (critical)
- ⛔ `/api/product-manuals/by-category` (high)
- ⛔ `/api/product-manuals/rename-folder` (critical)
- ⛔ `/api/product-manuals/search` (high)
- ⛔ `/api/product-manuals/sync` (critical)
- ⛔ `/api/product-manuals/thumbnail` (critical)
- ⛔ `/api/product-manuals/upload` (critical)
- ⛔ `/api/product-manuals/upsert` (critical)
- ⛔ `/api/receiving-lines/[id]/testing-bundle` (high)
- ⛔ `/api/sku-catalog/pair-batch` (critical)
- ⛔ `/api/tech/orders-without-manual` (high)

### `qc_check_templates` — 5 routes, 5 not yet GUC-safe

- ⛔ `/api/receiving-lines/[id]/qc-checks` (critical)
- ⛔ `/api/serial-units/[id]/checklist` (critical)
- ⛔ `/api/serial-units/[id]/checklist/bulk` (critical)
- ⛔ `/api/sku-catalog/[id]/qc-checks` (critical)
- ⛔ `/api/sku-catalog/search` (high)

### `rag_document_chunks` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/rag/documents` (low)
- ✅ `/api/rag/search` (low)

### `rag_documents` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/rag/documents` (low)

### `reason_codes` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/locations/[barcode]` (medium)
- ⛔ `/api/reason-codes` (critical)

### `receiving` — 95 routes, 95 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/reconcile` (high)
- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/ai/chat/stream` (medium)
- ⛔ `/api/audit-log/receiving` (high)
- ⛔ `/api/audit-log/report` (high)
- ⛔ `/api/cron/receiving/incoming-tracking-sync` (high)
- ⛔ `/api/cron/reconcile-unmatched` (high)
- ⛔ `/api/cron/shipping/reconcile-delivered` (high)
- ⛔ `/api/cron/shipping/sync-due` (high)
- ⛔ `/api/cron/zoho/incoming-po-sync` (high)
- ⛔ `/api/cron/zoho/po-sync` (high)
- ⛔ `/api/dashboard/fba-shipments` (high)
- ⛔ `/api/ecwid/recent-repair-orders` (high)
- ⛔ `/api/global-search` (high)
- ⛔ `/api/inbox/tech-queue` (high)
- ⛔ `/api/local-pickup-orders/[id]/finalize` (critical)
- ⛔ `/api/local-pickups` (critical)
- ⛔ `/api/nas-config` (medium)
- ⛔ `/api/orders-exceptions/sync` (critical)
- ⛔ `/api/orders/lookup/[orderId]` (high)
- ⛔ `/api/photos/[id]` (critical)
- ⛔ `/api/post-multi-sn` (critical)
- ⛔ `/api/realtime/token` (critical)
- ⛔ `/api/receiving-entry` (critical)
- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/receiving-lines/[id]/ensure-catalog` (critical)
- ⛔ `/api/receiving-lines/[id]/manuals` (critical)
- ⛔ `/api/receiving-lines/[id]/qc-checks` (critical)
- ⛔ `/api/receiving-lines/[id]/testing-bundle` (high)
- ⛔ `/api/receiving-lines/incoming/delivered-unscanned` (high)
- ⛔ `/api/receiving-lines/incoming/details` (high)
- ⛔ `/api/receiving-lines/incoming/email-rescan` (critical)
- ⛔ `/api/receiving-lines/incoming/refresh` (critical)
- ⛔ `/api/receiving-lines/incoming/refresh/stream` (critical)
- ⛔ `/api/receiving-lines/incoming/summary` (high)
- ⛔ `/api/receiving-lines/incoming/sync-one` (critical)
- ⛔ `/api/receiving-lines/incoming/zoho-refresh` (critical)
- ⛔ `/api/receiving-logs` (medium)
- ⛔ `/api/receiving-logs/search` (high)
- ⛔ `/api/receiving-photos` (medium)
- ⛔ `/api/receiving-tasks` (medium)
- ⛔ `/api/receiving/[id]` (critical)
- ⛔ `/api/receiving/[id]/attach-box` (critical)
- ⛔ `/api/receiving/add-unmatched-line` (critical)
- ⛔ `/api/receiving/disposition-suggest` (critical)
- ⛔ `/api/receiving/lines/[id]/condition` (critical)
- ⛔ `/api/receiving/lines/[id]/move` (critical)
- ⛔ `/api/receiving/lines/[id]/putaway` (critical)
- ⛔ `/api/receiving/lines/[id]/status` (critical)
- ⛔ `/api/receiving/lines/[id]/timeline` (high)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/mark-received` (critical)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ⛔ `/api/receiving/match` (critical)
- ⛔ `/api/receiving/nas-archive-test` (critical)
- ⛔ `/api/receiving/pending-check` (medium)
- ⛔ `/api/receiving/pending-unboxing` (high)
- ⛔ `/api/receiving/po/[poId]` (high)
- ⛔ `/api/receiving/po/[poId]/attach-box` (critical)
- ⛔ `/api/receiving/po/list` (high)
- ⛔ `/api/receiving/scan-serial` (medium)
- ⛔ `/api/receiving/serials` (critical)
- ⛔ `/api/receiving/unfound-queue` (medium)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]` (medium)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk` (medium)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk/draft` (medium)
- ⛔ `/api/receiving/visual-identify` (critical)
- ⛔ `/api/receiving/zendesk-claim` (medium)
- ⛔ `/api/receiving/zendesk-claim/classify` (critical)
- ⛔ `/api/receiving/zendesk-claim/draft` (critical)
- ⛔ `/api/receiving/zendesk-claim/link` (medium)
- ⛔ `/api/receiving/zendesk-claim/preview` (critical)
- ⛔ `/api/receiving/zendesk-claim/thread` (medium)
- ⛔ `/api/returns/intake` (medium)
- ⛔ `/api/scan/history` (high)
- ⛔ `/api/scan/resolve` (critical)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/serial-units/lookup` (medium)
- ⛔ `/api/sku/[id]/photos` (critical)
- ⛔ `/api/sourcing/candidates/[id]/import` (critical)
- ⛔ `/api/stations` (medium)
- ⛔ `/api/tracking-exceptions` (high)
- ⛔ `/api/tracking-exceptions/[id]` (critical)
- ⛔ `/api/tracking-exceptions/[id]/refresh` (critical)
- ⛔ `/api/vision-config` (high)
- ⛔ `/api/warranty/claims/[id]/zendesk` (medium)
- ⛔ `/api/work-orders` (critical)
- ⛔ `/api/zoho/find-po` (critical)
- ⛔ `/api/zoho/oauth/authorize` (high)
- ⛔ `/api/zoho/purchase-orders` (high)
- ⛔ `/api/zoho/purchase-orders/receive` (critical)
- ⛔ `/api/zoho/purchase-orders/sync` (critical)
- ⛔ `/api/zoho/purchase-receives` (high)
- ⛔ `/api/zoho/purchase-receives/import` (critical)
- ⛔ `/api/zoho/purchase-receives/sync` (critical)

### `receiving_lines` — 37 routes, 37 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/reconcile` (high)
- ⛔ `/api/admin/po-mirror/health` (high)
- ⛔ `/api/audit-log/report` (high)
- ⛔ `/api/cron/zoho/incoming-po-sync` (high)
- ⛔ `/api/cron/zoho/po-sync` (high)
- ⛔ `/api/inbox/tech-queue` (high)
- ⛔ `/api/receiving-entry` (critical)
- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/receiving-lines/incoming/delivered-unscanned` (high)
- ⛔ `/api/receiving-lines/incoming/details` (high)
- ⛔ `/api/receiving-lines/incoming/refresh/stream` (critical)
- ⛔ `/api/receiving-lines/incoming/summary` (high)
- ⛔ `/api/receiving-lines/incoming/zoho-refresh` (critical)
- ⛔ `/api/receiving-photos` (medium)
- ⛔ `/api/receiving/[id]` (critical)
- ⛔ `/api/receiving/add-unmatched-line` (critical)
- ⛔ `/api/receiving/lines/[id]/condition` (critical)
- ⛔ `/api/receiving/lines/[id]/move` (critical)
- ⛔ `/api/receiving/lines/[id]/putaway` (critical)
- ⛔ `/api/receiving/lines/[id]/status` (critical)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/mark-received` (critical)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ⛔ `/api/receiving/match` (critical)
- ⛔ `/api/receiving/pending-unboxing` (high)
- ⛔ `/api/receiving/po/[poId]` (high)
- ⛔ `/api/receiving/po/[poId]/attach-box` (critical)
- ⛔ `/api/receiving/po/list` (high)
- ⛔ `/api/receiving/scan-serial` (medium)
- ⛔ `/api/receiving/serials` (critical)
- ⛔ `/api/receiving/zendesk-claim` (medium)
- ⛔ `/api/receiving/zendesk-claim/link` (medium)
- ⛔ `/api/tracking-exceptions/[id]/refresh` (critical)
- ⛔ `/api/work-orders` (critical)
- ⛔ `/api/zoho/purchase-orders/receive` (critical)
- ⛔ `/api/zoho/purchase-orders/sync` (critical)
- ⛔ `/api/zoho/purchase-receives/sync` (critical)

### `receiving_scans` — 8 routes, 8 not yet GUC-safe

- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/receiving-lines/incoming/delivered-unscanned` (high)
- ⛔ `/api/receiving-lines/incoming/summary` (high)
- ⛔ `/api/receiving-logs` (medium)
- ⛔ `/api/receiving-photos` (medium)
- ⛔ `/api/receiving/[id]` (critical)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/tracking-exceptions/[id]/refresh` (critical)

### `repair_actions` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/repair/actions` (critical)
- ⛔ `/api/repair/actions/[id]` (critical)

### `repair_service` — 9 routes, 9 not yet GUC-safe

- ⛔ `/api/dashboard/operations` (high)
- ⛔ `/api/global-search` (high)
- ⛔ `/api/repair-service/document/[id]` (high)
- ⛔ `/api/repair-service/next` (high)
- ⛔ `/api/repair-service/pickup` (critical)
- ⛔ `/api/repair-service/repaired` (critical)
- ⛔ `/api/warranty/claims/[id]/repair-handoff` (critical)
- ⛔ `/api/warranty/quotes/[id]` (critical)
- ⛔ `/api/work-orders` (critical)

### `replenishment_order_lines` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/orders` (medium)

### `replenishment_requests` — 3 routes, 3 not yet GUC-safe

- ⛔ `/api/audit-log/report` (high)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/replenish/shipped-fifo` (high)

### `replenishment_tasks` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/replenishment-detect` (high)

### `return_dispositions` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/rma/[id]/disposition` (medium)

### `serial_unit_condition_history` — 3 routes, 3 not yet GUC-safe

- ⛔ `/api/serial-units/[id]` (high)
- ⛔ `/api/serial-units/[id]/grade` (critical)
- ⛔ `/api/tech/test-result` (critical)

### `serial_units` — 39 routes, 39 not yet GUC-safe

- ⛔ `/api/fba/items/[id]/link-unit` (critical)
- ⛔ `/api/fba/shipments/[id]/ship-units` (critical)
- ⛔ `/api/inventory-events` (high)
- ⛔ `/api/inventory/units` (high)
- ⛔ `/api/labels/recent` (high)
- ⛔ `/api/orders/[id]/allocate` (critical)
- ⛔ `/api/orders/[id]/release` (critical)
- ⛔ `/api/pack/ship` (critical)
- ⛔ `/api/pick/scan` (critical)
- ⛔ `/api/post-multi-sn` (critical)
- ⛔ `/api/products/[sku]` (high)
- ⛔ `/api/quality/dashboard` (high)
- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/receiving/[id]` (critical)
- ⛔ `/api/receiving/lines/[id]/move` (critical)
- ⛔ `/api/receiving/lines/[id]/putaway` (critical)
- ⛔ `/api/receiving/lines/[id]/status` (critical)
- ⛔ `/api/receiving/lines/[id]/timeline` (high)
- ⛔ `/api/receiving/mark-received` (critical)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ⛔ `/api/receiving/scan-serial` (medium)
- ⛔ `/api/receiving/serials` (critical)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]` (medium)
- ⛔ `/api/returns/intake` (medium)
- ⛔ `/api/scan/resolve` (critical)
- ⛔ `/api/serial-units/[id]` (high)
- ⛔ `/api/serial-units/[id]/allocate` (critical)
- ⛔ `/api/serial-units/[id]/checklist` (critical)
- ⛔ `/api/serial-units/[id]/checklist/bulk` (critical)
- ⛔ `/api/serial-units/[id]/grade` (critical)
- ⛔ `/api/serial-units/[id]/move` (critical)
- ⛔ `/api/serial-units/[id]/quality` (high)
- ⛔ `/api/serial-units/lookup` (medium)
- ⛔ `/api/sku/by-tracking` (critical)
- ⛔ `/api/tech/scan-sku` (medium)
- ⛔ `/api/tech/test-result` (critical)
- ⛔ `/api/testing/recent` (high)
- ⛔ `/api/units/resolve-id` (critical)
- ⛔ `/api/workflow/flow-audit` (high)

### `shifts` — 3 routes, 3 not yet GUC-safe

- ⛔ `/api/google-sheets/sync-shipstation-orders` (critical)
- ⛔ `/api/shifts` (high)
- ⛔ `/api/shifts/[id]/cover` (critical)

### `shipment_tracking_events` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/receiving-lines/incoming/details` (high)

### `shipping_tracking_numbers` — 60 routes, 60 not yet GUC-safe

- ⛔ `/api/admin/logs` (high)
- ⛔ `/api/audit-log/report` (high)
- ⛔ `/api/check-tracking` (high)
- ⛔ `/api/cron/shipping/sync-due` (high)
- ⛔ `/api/dashboard/fba-shipments` (high)
- ⛔ `/api/dashboard/operations` (high)
- ⛔ `/api/debug-tracking` (high)
- ⛔ `/api/ebay/search` (high)
- ⛔ `/api/fba/board` (high)
- ⛔ `/api/fba/board/[fnsku]/entries` (high)
- ⛔ `/api/fba/print-queue` (high)
- ⛔ `/api/fba/shipments` (medium)
- ⛔ `/api/fba/shipments/[id]` (critical)
- ⛔ `/api/fba/shipments/[id]/tracking` (critical)
- ⛔ `/api/fba/shipments/active-with-details` (high)
- ⛔ `/api/fba/shipments/mark-shipped` (critical)
- ⛔ `/api/fba/shipments/split-for-paired-review` (critical)
- ⛔ `/api/fba/shipments/today` (high)
- ⛔ `/api/global-search` (high)
- ⛔ `/api/google-sheets/execute-script` (critical)
- ⛔ `/api/google-sheets/sync-shipstation-orders` (critical)
- ⛔ `/api/inbox/tech-queue` (high)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders/[id]/tracking` (medium)
- ⛔ `/api/orders/backfill/ebay` (critical)
- ⛔ `/api/orders/backfill/ecwid` (critical)
- ⛔ `/api/orders/batch` (critical)
- ⛔ `/api/orders/integrity-check` (critical)
- ⛔ `/api/orders/lookup/[orderId]` (high)
- ⛔ `/api/orders/next` (high)
- ⛔ `/api/orders/recent` (high)
- ⛔ `/api/orders/verify` (high)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/packing-logs/history` (high)
- ⛔ `/api/packing-logs/last-order` (high)
- ⛔ `/api/packing-logs/start-session` (critical)
- ⛔ `/api/packing-logs/update` (medium)
- ⛔ `/api/receiving-entry` (critical)
- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/receiving-lines/incoming/details` (high)
- ⛔ `/api/receiving-lines/incoming/refresh/stream` (critical)
- ⛔ `/api/receiving-lines/incoming/summary` (high)
- ⛔ `/api/receiving-logs` (medium)
- ⛔ `/api/receiving-logs/search` (high)
- ⛔ `/api/receiving/[id]` (critical)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/mark-received` (critical)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ⛔ `/api/receiving/match` (critical)
- ⛔ `/api/receiving/pending-unboxing` (high)
- ⛔ `/api/scan-tracking` (medium)
- ⛔ `/api/scan/resolve` (critical)
- ⛔ `/api/shipped/debug` (high)
- ⛔ `/api/shipped/lookup-order` (high)
- ⛔ `/api/sync-sheets` (medium)
- ⛔ `/api/tech/logs` (high)
- ⛔ `/api/tech/orders-without-manual` (high)
- ⛔ `/api/tech/scan` (medium)
- ⛔ `/api/tech/update-serials` (critical)
- ⛔ `/api/work-orders` (critical)

### `sku` — 194 routes, 194 not yet GUC-safe

- ⛔ `/api/activity/feed` (high)
- ⛔ `/api/admin/fba-fnskus` (critical)
- ⛔ `/api/admin/fba-fnskus/[fnsku]` (critical)
- ⛔ `/api/admin/fba-fnskus/upload` (critical)
- ⛔ `/api/assignments/sku-search` (medium)
- ⛔ `/api/audit-log/packing` (high)
- ⛔ `/api/audit-log/receiving` (high)
- ⛔ `/api/audit-log/report` (high)
- ⛔ `/api/audit-log/sku` (high)
- ⛔ `/api/audit/sku/[sku]` (high)
- ⛔ `/api/cron/inventory/drift-check` (high)
- ⛔ `/api/cron/replenishment-detect` (high)
- ⛔ `/api/cron/sku-catalog/refresh-suggestions` (high)
- ⛔ `/api/cron/stock-alerts` (high)
- ⛔ `/api/cycle-counts/campaigns` (critical)
- ⛔ `/api/cycle-counts/campaigns/[id]` (critical)
- ⛔ `/api/cycle-counts/lines/[id]` (critical)
- ⛔ `/api/ebay/search` (high)
- ⛔ `/api/ecwid/products/search` (high)
- ⛔ `/api/ecwid/recent-repair-orders` (high)
- ⛔ `/api/ecwid/sync-exception-tracking` (critical)
- ⛔ `/api/favorites` (critical)
- ⛔ `/api/favorites/[id]` (critical)
- ⛔ `/api/fba/board` (high)
- ⛔ `/api/fba/board/[fnsku]/entries` (high)
- ⛔ `/api/fba/fnskus` (critical)
- ⛔ `/api/fba/fnskus/[fnsku]` (critical)
- ⛔ `/api/fba/fnskus/bulk` (critical)
- ⛔ `/api/fba/fnskus/search` (high)
- ⛔ `/api/fba/fnskus/validate` (high)
- ⛔ `/api/fba/items/[id]/link-unit` (critical)
- ⛔ `/api/fba/items/queue` (high)
- ⛔ `/api/fba/items/scan` (medium)
- ⛔ `/api/fba/logs` (critical)
- ⛔ `/api/fba/logs/[id]` (critical)
- ⛔ `/api/fba/logs/summary` (high)
- ⛔ `/api/fba/print-queue` (high)
- ⛔ `/api/fba/shipments` (medium)
- ⛔ `/api/fba/shipments/[id]/items` (critical)
- ⛔ `/api/fba/shipments/[id]/items/[itemId]` (critical)
- ⛔ `/api/fba/shipments/[id]/ship-units` (critical)
- ⛔ `/api/fba/shipments/active-with-details` (high)
- ⛔ `/api/fba/shipments/today` (high)
- ⛔ `/api/fba/shipments/today/duplicate-yesterday` (medium)
- ⛔ `/api/fba/shipments/today/items` (medium)
- ⛔ `/api/get-title-by-sku` (high)
- ⛔ `/api/global-search` (high)
- ⛔ `/api/google-sheets/sync-shipstation-orders` (critical)
- ⛔ `/api/import-orders` (medium)
- ⛔ `/api/inventory-events` (high)
- ⛔ `/api/inventory-photos` (critical)
- ⛔ `/api/inventory/alerts` (high)
- ⛔ `/api/inventory/alerts/[id]/ack` (critical)
- ⛔ `/api/inventory/sku-search` (high)
- ⛔ `/api/inventory/units` (high)
- ⛔ `/api/labels/recent` (high)
- ⛔ `/api/local-pickup-orders` (critical)
- ⛔ `/api/local-pickup-orders/[id]` (critical)
- ⛔ `/api/local-pickup-orders/[id]/finalize` (critical)
- ⛔ `/api/local-pickup-orders/[id]/items` (critical)
- ⛔ `/api/local-pickup-orders/[id]/items/[itemId]` (critical)
- ⛔ `/api/local-pickups` (critical)
- ⛔ `/api/locations/[barcode]` (medium)
- ⛔ `/api/locations/[barcode]/swap` (medium)
- ⛔ `/api/manuals/recent` (high)
- ⛔ `/api/manuals/resolve` (high)
- ⛔ `/api/manuals/upsert` (critical)
- ⛔ `/api/need-to-order` (high)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders/[id]/allocate` (critical)
- ⛔ `/api/orders/[id]/release` (critical)
- ⛔ `/api/orders/add` (critical)
- ⛔ `/api/orders/assign` (medium)
- ⛔ `/api/orders/backfill/ebay` (critical)
- ⛔ `/api/orders/backfill/ecwid` (critical)
- ⛔ `/api/orders/batch` (critical)
- ⛔ `/api/orders/delete` (critical)
- ⛔ `/api/orders/integrity-check` (critical)
- ⛔ `/api/orders/lookup/[orderId]` (high)
- ⛔ `/api/orders/next` (high)
- ⛔ `/api/orders/recent` (high)
- ⛔ `/api/pack/ship` (critical)
- ⛔ `/api/packerlogs` (medium)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/packing-logs/history` (high)
- ⛔ `/api/packing-logs/last-order` (high)
- ⛔ `/api/packing-logs/update` (medium)
- ⛔ `/api/part-compatibility` (critical)
- ⛔ `/api/pick/scan` (critical)
- ⛔ `/api/post-multi-sn` (critical)
- ⛔ `/api/print/dispatch` (critical)
- ⛔ `/api/product-manuals` (critical)
- ⛔ `/api/product-manuals/by-category` (high)
- ⛔ `/api/product-manuals/search` (high)
- ⛔ `/api/product-manuals/upload` (critical)
- ⛔ `/api/products/[sku]` (high)
- ⛔ `/api/quality/dashboard` (high)
- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/receiving-lines/[id]/qc-checks` (critical)
- ⛔ `/api/receiving-lines/[id]/testing-bundle` (high)
- ⛔ `/api/receiving-lines/incoming/delivered-unscanned` (high)
- ⛔ `/api/receiving-lines/incoming/details` (high)
- ⛔ `/api/receiving/[id]` (critical)
- ⛔ `/api/receiving/add-unmatched-line` (critical)
- ⛔ `/api/receiving/lines/[id]/move` (critical)
- ⛔ `/api/receiving/lines/[id]/putaway` (critical)
- ⛔ `/api/receiving/lines/[id]/status` (critical)
- ⛔ `/api/receiving/lines/[id]/timeline` (high)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/mark-received` (critical)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ⛔ `/api/receiving/match` (critical)
- ⛔ `/api/receiving/pending-check` (medium)
- ⛔ `/api/receiving/pending-unboxing` (high)
- ⛔ `/api/receiving/po/[poId]` (high)
- ⛔ `/api/receiving/po/list` (high)
- ⛔ `/api/receiving/scan-serial` (medium)
- ⛔ `/api/receiving/visual-identify` (critical)
- ⛔ `/api/repair-service/next` (high)
- ⛔ `/api/repair/ecwid-products` (high)
- ⛔ `/api/repair/square-payment-link` (critical)
- ⛔ `/api/replenish/shipped-fifo` (high)
- ⛔ `/api/reports/dead-stock` (high)
- ⛔ `/api/reports/velocity` (high)
- ⛔ `/api/scan/resolve` (critical)
- ⛔ `/api/serial-units/[id]` (high)
- ⛔ `/api/serial-units/[id]/allocate` (critical)
- ⛔ `/api/serial-units/[id]/checklist` (critical)
- ⛔ `/api/serial-units/[id]/grade` (critical)
- ⛔ `/api/serial-units/[id]/move` (critical)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/serial-units/lookup` (medium)
- ⛔ `/api/shipped` (medium)
- ⛔ `/api/shipped/submit` (critical)
- ⛔ `/api/sku` (high)
- ⛔ `/api/sku-catalog` (critical)
- ⛔ `/api/sku-catalog/[id]` (critical)
- ⛔ `/api/sku-catalog/[id]/manuals` (critical)
- ⛔ `/api/sku-catalog/[id]/platform-ids` (critical)
- ⛔ `/api/sku-catalog/[id]/qc-checks` (critical)
- ⛔ `/api/sku-catalog/[id]/similar` (high)
- ⛔ `/api/sku-catalog/graph/[skuId]/children` (high)
- ⛔ `/api/sku-catalog/graph/[skuId]/parents` (high)
- ⛔ `/api/sku-catalog/graph/[skuId]/tree` (high)
- ⛔ `/api/sku-catalog/graph/relationships` (critical)
- ⛔ `/api/sku-catalog/graph/relationships/[id]` (critical)
- ⛔ `/api/sku-catalog/pair` (critical)
- ⛔ `/api/sku-catalog/pair-batch` (critical)
- ⛔ `/api/sku-catalog/pair-ecwid` (critical)
- ⛔ `/api/sku-catalog/pair-suggestions` (high)
- ⛔ `/api/sku-catalog/pairing-queue` (high)
- ⛔ `/api/sku-catalog/pairing-queue/count` (high)
- ⛔ `/api/sku-catalog/resolve` (high)
- ⛔ `/api/sku-catalog/run-migration` (critical)
- ⛔ `/api/sku-catalog/search` (high)
- ⛔ `/api/sku-catalog/search-unmatched` (high)
- ⛔ `/api/sku-catalog/suggest-for-item` (high)
- ⛔ `/api/sku-catalog/suggest-pairings` (critical)
- ⛔ `/api/sku-catalog/sync-ecwid-products` (critical)
- ⛔ `/api/sku-catalog/sync-ecwid-titles` (critical)
- ⛔ `/api/sku-catalog/unpaired` (high)
- ⛔ `/api/sku-catalog/unpaired-ecwid` (high)
- ⛔ `/api/sku-stock` (high)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ⛔ `/api/sku-stock/[sku]/bins` (high)
- ⛔ `/api/sku/[id]/photos` (critical)
- ⛔ `/api/sku/by-tracking` (critical)
- ⛔ `/api/sku/lookup` (high)
- ⛔ `/api/sku/serials-from-code` (high)
- ⛔ `/api/stock-alerts` (high)
- ⛔ `/api/sync-sheets` (medium)
- ⛔ `/api/tech-logs/search` (high)
- ⛔ `/api/tech/logs` (high)
- ⛔ `/api/tech/orders-without-manual` (high)
- ⛔ `/api/tech/scan` (medium)
- ⛔ `/api/tech/scan-sku` (medium)
- ⛔ `/api/tech/test-result` (critical)
- ⛔ `/api/testing/recent` (high)
- ⛔ `/api/tracking-exceptions/[id]/refresh` (critical)
- ⛔ `/api/transfers` (critical)
- ⛔ `/api/units/next-id` (critical)
- ⛔ `/api/units/resolve-id` (critical)
- ⛔ `/api/update-sku-location` (critical)
- ⛔ `/api/walk-in/catalog` (high)
- ⛔ `/api/walk-in/sync` (critical)
- ⛔ `/api/warranty/claims` (medium)
- ⛔ `/api/warranty/claims/bulk` (medium)
- ⛔ `/api/warranty/lookup` (medium)
- ⛔ `/api/warranty/reports/export` (high)
- ⛔ `/api/webhooks/square` (critical)
- ⛔ `/api/webhooks/zoho/orders` (critical)
- ⛔ `/api/work-orders` (critical)
- ⛔ `/api/zoho/purchase-orders` (high)
- ⛔ `/api/zoho/purchase-orders/receive` (critical)

### `sku_catalog` — 46 routes, 46 not yet GUC-safe

- ⛔ `/api/cron/sku-catalog/refresh-suggestions` (high)
- ⛔ `/api/ecwid/recent-repair-orders` (high)
- ⛔ `/api/get-title-by-sku` (high)
- ⛔ `/api/inventory-events` (high)
- ⛔ `/api/inventory/units` (high)
- ⛔ `/api/labels/recent` (high)
- ⛔ `/api/local-pickup-orders/[id]` (critical)
- ⛔ `/api/local-pickups` (critical)
- ⛔ `/api/manuals/recent` (high)
- ⛔ `/api/manuals/resolve` (high)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders/add` (critical)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/products/[sku]` (high)
- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/receiving-lines/[id]/ensure-catalog` (critical)
- ⛔ `/api/receiving-lines/[id]/testing-bundle` (high)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/po/[poId]` (high)
- ⛔ `/api/receiving/visual-identify` (critical)
- ⛔ `/api/scan/resolve` (critical)
- ⛔ `/api/serial-units/[id]` (high)
- ⛔ `/api/serial-units/[id]/checklist` (critical)
- ⛔ `/api/serial-units/[id]/checklist/bulk` (critical)
- ⛔ `/api/shipped/submit` (critical)
- ⛔ `/api/sku` (high)
- ⛔ `/api/sku-catalog/[id]/similar` (high)
- ⛔ `/api/sku-catalog/graph/[skuId]/children` (high)
- ⛔ `/api/sku-catalog/graph/[skuId]/parents` (high)
- ⛔ `/api/sku-catalog/graph/[skuId]/tree` (high)
- ⛔ `/api/sku-catalog/pair` (critical)
- ⛔ `/api/sku-catalog/pair-suggestions` (high)
- ⛔ `/api/sku-catalog/pairing-queue` (high)
- ⛔ `/api/sku-catalog/pairing-queue/count` (high)
- ⛔ `/api/sku-catalog/resolve` (high)
- ⛔ `/api/sku-catalog/run-migration` (critical)
- ⛔ `/api/sku-catalog/search` (high)
- ⛔ `/api/sku-catalog/search-unmatched` (high)
- ⛔ `/api/sku-catalog/suggest-for-item` (high)
- ⛔ `/api/sku-catalog/sync-ecwid-titles` (critical)
- ⛔ `/api/sku-stock` (high)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ⛔ `/api/sku-stock/[sku]/bins` (high)
- ⛔ `/api/sync-sheets` (medium)
- ⛔ `/api/units/next-id` (critical)
- ⛔ `/api/units/resolve-id` (critical)

### `sku_management` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/sku-manager` (high)

### `sku_pairing_audit` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/sku-catalog/pair-batch` (critical)

### `sku_pairing_suggestions` — 4 routes, 4 not yet GUC-safe

- ⛔ `/api/cron/sku-catalog/refresh-suggestions` (high)
- ⛔ `/api/sku-catalog/pairing-queue` (high)
- ⛔ `/api/sku-catalog/pairing-queue/count` (high)
- ⛔ `/api/sku-catalog/suggest-for-item` (high)

### `sku_platform_ids` — 20 routes, 20 not yet GUC-safe

- ⛔ `/api/cron/sku-catalog/refresh-suggestions` (high)
- ⛔ `/api/ecwid/recent-repair-orders` (high)
- ⛔ `/api/get-title-by-sku` (high)
- ⛔ `/api/local-pickups` (critical)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/products/[sku]` (high)
- ⛔ `/api/receiving/add-unmatched-line` (critical)
- ⛔ `/api/receiving/pending-check` (medium)
- ⛔ `/api/sku` (high)
- ⛔ `/api/sku-catalog/pair` (critical)
- ⛔ `/api/sku-catalog/pair-suggestions` (high)
- ⛔ `/api/sku-catalog/pairing-queue` (high)
- ⛔ `/api/sku-catalog/resolve` (high)
- ⛔ `/api/sku-catalog/run-migration` (critical)
- ⛔ `/api/sku-catalog/search` (high)
- ⛔ `/api/sku-catalog/search-unmatched` (high)
- ⛔ `/api/sku-catalog/suggest-pairings` (critical)
- ⛔ `/api/sku-catalog/sync-ecwid-products` (critical)
- ⛔ `/api/sku-stock` (high)
- ⛔ `/api/sku-stock/[sku]/bins` (high)

### `sku_stock` — 86 routes, 86 not yet GUC-safe

- ⛔ `/api/assignments/sku-search` (medium)
- ⛔ `/api/cron/inventory/drift-check` (high)
- ⛔ `/api/cycle-counts/campaigns/[id]` (critical)
- ⛔ `/api/cycle-counts/lines/[id]` (critical)
- ⛔ `/api/ecwid/products/search` (high)
- ⛔ `/api/failure-modes` (critical)
- ⛔ `/api/failure-modes/[id]` (critical)
- ⛔ `/api/favorites` (critical)
- ⛔ `/api/favorites/[id]` (critical)
- ⛔ `/api/get-title-by-sku` (high)
- ⛔ `/api/inventory-events` (high)
- ⛔ `/api/inventory/alerts` (high)
- ⛔ `/api/inventory/bins-overview` (high)
- ⛔ `/api/inventory/sku-search` (high)
- ⛔ `/api/inventory/units` (high)
- ⛔ `/api/locations/[barcode]` (medium)
- ⛔ `/api/locations/[barcode]/properties` (critical)
- ⛔ `/api/locations/[barcode]/swap` (medium)
- ⛔ `/api/manual-server/assign` (critical)
- ⛔ `/api/manual-server/by-item` (high)
- ⛔ `/api/manual-server/unassigned` (high)
- ⛔ `/api/manuals/resolve` (high)
- ⛔ `/api/manuals/upsert` (critical)
- ⛔ `/api/need-to-order` (high)
- ⛔ `/api/orders/lookup/[orderId]` (high)
- ⛔ `/api/pack/ship` (critical)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/packing-logs/update` (medium)
- ⛔ `/api/photos/[id]` (critical)
- ⛔ `/api/product-manuals` (critical)
- ⛔ `/api/product-manuals/by-category` (high)
- ⛔ `/api/quality/dashboard` (high)
- ⛔ `/api/reason-codes` (critical)
- ⛔ `/api/reason-codes/[id]` (critical)
- ⛔ `/api/receiving-lines/[id]/qc-checks` (critical)
- ⛔ `/api/receiving/mark-received` (critical)
- ⛔ `/api/replenish/shipped-fifo` (high)
- ⛔ `/api/returns/intake` (medium)
- ⛔ `/api/rooms` (critical)
- ⛔ `/api/rooms/[room]` (critical)
- ⛔ `/api/rooms/reorder` (critical)
- ⛔ `/api/scan/history` (high)
- ⛔ `/api/scan/resolve` (critical)
- ⛔ `/api/serial-units/[id]` (high)
- ⛔ `/api/serial-units/[id]/failure-tags` (critical)
- ⛔ `/api/serial-units/[id]/hold` (critical)
- ⛔ `/api/serial-units/[id]/quality` (high)
- ⛔ `/api/serial-units/[id]/release` (critical)
- ⛔ `/api/sku` (high)
- ⛔ `/api/sku-catalog` (critical)
- ⛔ `/api/sku-catalog/[id]` (critical)
- ⛔ `/api/sku-catalog/[id]/manuals` (critical)
- ⛔ `/api/sku-catalog/[id]/platform-ids` (critical)
- ⛔ `/api/sku-catalog/[id]/qc-checks` (critical)
- ⛔ `/api/sku-catalog/[id]/similar` (high)
- ⛔ `/api/sku-catalog/graph/[skuId]/children` (high)
- ⛔ `/api/sku-catalog/graph/[skuId]/parents` (high)
- ⛔ `/api/sku-catalog/graph/[skuId]/tree` (high)
- ⛔ `/api/sku-catalog/graph/relationships` (critical)
- ⛔ `/api/sku-catalog/graph/relationships/[id]` (critical)
- ⛔ `/api/sku-catalog/pair` (critical)
- ⛔ `/api/sku-catalog/pair-batch` (critical)
- ⛔ `/api/sku-catalog/pair-ecwid` (critical)
- ⛔ `/api/sku-catalog/pair-suggestions` (high)
- ⛔ `/api/sku-catalog/pairing-queue` (high)
- ⛔ `/api/sku-catalog/pairing-queue/count` (high)
- ⛔ `/api/sku-catalog/search` (high)
- ⛔ `/api/sku-catalog/search-unmatched` (high)
- ⛔ `/api/sku-catalog/suggest-for-item` (high)
- ⛔ `/api/sku-catalog/suggest-pairings` (critical)
- ⛔ `/api/sku-catalog/unpaired` (high)
- ⛔ `/api/sku-catalog/unpaired-ecwid` (high)
- ⛔ `/api/sku-manager` (high)
- ⛔ `/api/sku-stock` (high)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ⛔ `/api/sku-stock/[sku]/bins` (high)
- ⛔ `/api/sku/[id]/photos` (critical)
- ⛔ `/api/sku/by-tracking` (critical)
- ⛔ `/api/sku/lookup` (high)
- ⛔ `/api/sku/serials-from-code` (high)
- ⛔ `/api/stock-alerts` (high)
- ⛔ `/api/tech/scan-sku` (medium)
- ⛔ `/api/update-sku-location` (critical)
- ⛔ `/api/warehouses` (high)
- ⛔ `/api/work-orders` (critical)
- ⛔ `/api/zoho/items/[id]/image` (high)

### `sku_stock_ledger` — 13 routes, 13 not yet GUC-safe

- ⛔ `/api/activity/feed` (high)
- ⛔ `/api/audit/sku/[sku]` (high)
- ⛔ `/api/cron/inventory/drift-check` (high)
- ⛔ `/api/fba/shipments/[id]/ship-units` (critical)
- ⛔ `/api/locations/[barcode]/swap` (medium)
- ⛔ `/api/pack/ship` (critical)
- ⛔ `/api/packing-logs/update` (medium)
- ⛔ `/api/receiving/mark-received` (critical)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ⛔ `/api/returns/intake` (medium)
- ⛔ `/api/serial-units/[id]/move` (critical)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ⛔ `/api/tech/scan-sku` (medium)

### `sourcing_alerts` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/sourcing/scan` (high)

### `square_transactions` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/walk-in/sales` (critical)
- ⛔ `/api/walk-in/sync` (critical)

### `staff` — 141 routes, 138 not yet GUC-safe

- ⛔ `/api/activity/feed` (high)
- ⛔ `/api/admin/audit` (high)
- ⛔ `/api/admin/features` (critical)
- ⛔ `/api/admin/features/[id]` (critical)
- ⛔ `/api/admin/integrations/list` (medium)
- ⛔ `/api/admin/logs` (high)
- ✅ `/api/admin/org/export` (low)
- ⛔ `/api/admin/roles/[id]` (critical)
- ⛔ `/api/admin/roles/[id]/mobile-defaults` (critical)
- ⛔ `/api/admin/sessions` (high)
- ⛔ `/api/admin/staff` (critical)
- ⛔ `/api/admin/staff/[id]` (critical)
- ⛔ `/api/admin/staff/[id]/detail` (high)
- ⛔ `/api/admin/staff/[id]/enroll-token` (critical)
- ⛔ `/api/admin/staff/[id]/mobile-display-config` (critical)
- ⛔ `/api/admin/staff/[id]/passkeys` (high)
- ⛔ `/api/admin/staff/[id]/passkeys/[pid]` (critical)
- ⛔ `/api/admin/staff/[id]/permissions` (critical)
- ⛔ `/api/admin/staff/[id]/reset-pin` (critical)
- ⛔ `/api/admin/staff/[id]/roles` (critical)
- ⛔ `/api/admin/staff/[id]/sessions` (critical)
- ⛔ `/api/admin/staff/[id]/set-pin` (critical)
- ⛔ `/api/admin/staff/[id]/stations` (critical)
- ✅ `/api/admin/staff/deactivate` (low)
- ✅ `/api/admin/staff/invite` (low)
- ⛔ `/api/admin/staff/list` (medium)
- ⛔ `/api/admin/staff/reorder` (critical)
- ⛔ `/api/admin/staff/update` (medium)
- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/ai/chat/stream` (medium)
- ⛔ `/api/assignments/sku-search` (medium)
- ⛔ `/api/audit-log/report` (high)
- ⛔ `/api/audit-log/staff` (high)
- ⛔ `/api/audit-log/staff-directory` (high)
- ⛔ `/api/auth/enroll/[token]` (critical)
- ⛔ `/api/auth/passkey/authenticate/begin` (critical)
- ⛔ `/api/auth/passkey/authenticate/finish` (critical)
- ⛔ `/api/auth/passkey/register/begin` (critical)
- ⛔ `/api/auth/passkey/register/finish` (critical)
- ⛔ `/api/auth/pin` (critical)
- ⛔ `/api/auth/pin/create` (critical)
- ⛔ `/api/auth/session` (high)
- ⛔ `/api/auth/signin` (critical)
- ⛔ `/api/auth/signout` (critical)
- ⛔ `/api/auth/signup` (critical)
- ⛔ `/api/auth/sso/callback` (medium)
- ⛔ `/api/auth/staff-picker` (high)
- ⛔ `/api/auth/switch` (critical)
- ⛔ `/api/cron/staff-goals/history` (high)
- ⛔ `/api/cycle-counts/campaigns` (critical)
- ⛔ `/api/dashboard/fba-shipments` (high)
- ⛔ `/api/dashboard/operations` (high)
- ⛔ `/api/fba/items/queue` (high)
- ⛔ `/api/fba/items/ready` (medium)
- ⛔ `/api/fba/items/scan` (medium)
- ⛔ `/api/fba/items/verify` (critical)
- ⛔ `/api/fba/labels/bind` (critical)
- ⛔ `/api/fba/logs` (critical)
- ⛔ `/api/fba/logs/[id]` (critical)
- ⛔ `/api/fba/shipments` (medium)
- ⛔ `/api/fba/shipments/[id]` (critical)
- ⛔ `/api/fba/shipments/[id]/items` (critical)
- ⛔ `/api/fba/shipments/[id]/items/[itemId]` (critical)
- ⛔ `/api/fba/shipments/active-with-details` (high)
- ⛔ `/api/fba/shipments/close` (critical)
- ⛔ `/api/fba/shipments/today` (high)
- ⛔ `/api/global-search` (high)
- ⛔ `/api/inbox/tech-queue` (high)
- ⛔ `/api/inventory-events` (high)
- ⛔ `/api/labels/recent` (high)
- ⛔ `/api/local-pickup-orders` (critical)
- ⛔ `/api/local-pickup-orders/[id]` (critical)
- ⛔ `/api/nas-dev/[[...path]]` (critical)
- ⛔ `/api/need-to-order/[id]` (critical)
- ⛔ `/api/operations/kpi-table` (high)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders-exceptions/sync` (critical)
- ⛔ `/api/orders/assign` (medium)
- ⛔ `/api/orders/batch` (critical)
- ⛔ `/api/orders/lookup/[orderId]` (high)
- ⛔ `/api/orders/missing-parts` (critical)
- ⛔ `/api/orders/next` (high)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/packing-logs/history` (high)
- ⛔ `/api/packing-logs/last-order` (high)
- ⛔ `/api/realtime/token` (critical)
- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/receiving-lines/incoming/email-rescan` (critical)
- ⛔ `/api/receiving/[id]` (critical)
- ⛔ `/api/receiving/lines/[id]/timeline` (high)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/mark-received` (critical)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ⛔ `/api/receiving/match` (critical)
- ⛔ `/api/receiving/pending-unboxing` (high)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]` (medium)
- ⛔ `/api/repair-service/next` (high)
- ⛔ `/api/repair/actions` (critical)
- ⛔ `/api/replenishment/tasks/[id]/cancel` (critical)
- ⛔ `/api/replenishment/tasks/[id]/claim` (critical)
- ⛔ `/api/replenishment/tasks/[id]/complete` (critical)
- ⛔ `/api/rma` (critical)
- ⛔ `/api/rma/[id]/close` (critical)
- ⛔ `/api/rma/[id]/disposition` (medium)
- ⛔ `/api/rma/[id]/mark-received` (critical)
- ⛔ `/api/scan/history` (high)
- ⛔ `/api/scan/resolve` (critical)
- ⛔ `/api/serial-units/[id]` (high)
- ⛔ `/api/serial-units/[id]/checklist` (critical)
- ⛔ `/api/serial-units/[id]/checklist/bulk` (critical)
- ⛔ `/api/serial-units/[id]/repairs` (critical)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/shifts` (high)
- ⛔ `/api/shifts/[id]/cover` (critical)
- ⛔ `/api/staff` (medium)
- ⛔ `/api/staff-goals` (critical)
- ⛔ `/api/staff-goals/history` (high)
- ⛔ `/api/staff-goals/me` (high)
- ⛔ `/api/staff-messages` (medium)
- ⛔ `/api/staff-todos` (critical)
- ⛔ `/api/staff/availability-rules` (critical)
- ⛔ `/api/staff/availability-today` (high)
- ⛔ `/api/staff/schedule` (critical)
- ⛔ `/api/staff/schedule/bulk` (critical)
- ⛔ `/api/staff/schedule/week` (critical)
- ⛔ `/api/staff/schedule/week/copy` (critical)
- ⛔ `/api/stations` (medium)
- ⛔ `/api/stations/publish` (medium)
- ⛔ `/api/tech/delete` (critical)
- ⛔ `/api/tech/logs` (high)
- ⛔ `/api/tech/scan` (medium)
- ⛔ `/api/tech/scan-repair-station` (critical)
- ⛔ `/api/tech/scan-sku` (medium)
- ⛔ `/api/testing/recent` (high)
- ⛔ `/api/tracking-exceptions` (high)
- ⛔ `/api/tracking-exceptions/[id]` (critical)
- ⛔ `/api/warranty/claims` (medium)
- ⛔ `/api/warranty/claims/[id]/quote` (critical)
- ⛔ `/api/warranty/claims/[id]/rma` (critical)
- ⛔ `/api/warranty/claims/bulk` (medium)
- ⛔ `/api/work-orders` (critical)

### `staff_availability_rules` — 7 routes, 7 not yet GUC-safe

- ⛔ `/api/staff` (medium)
- ⛔ `/api/staff/availability-rules` (critical)
- ⛔ `/api/staff/availability-today` (high)
- ⛔ `/api/staff/schedule` (critical)
- ⛔ `/api/staff/schedule/bulk` (critical)
- ⛔ `/api/staff/schedule/week` (critical)
- ⛔ `/api/staff/schedule/week/copy` (critical)

### `staff_enrollments` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/admin/staff/invite` (low)

### `staff_goal_history` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/staff-goals/history` (high)

### `staff_goals` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/cron/staff-goals/history` (high)
- ⛔ `/api/staff-goals` (critical)

### `staff_passkeys` — 4 routes, 4 not yet GUC-safe

- ⛔ `/api/admin/staff` (critical)
- ⛔ `/api/admin/staff/[id]/detail` (high)
- ⛔ `/api/admin/staff/[id]/passkeys` (high)
- ⛔ `/api/admin/staff/[id]/passkeys/[pid]` (critical)

### `staff_schedule_overrides` — 6 routes, 6 not yet GUC-safe

- ⛔ `/api/staff` (medium)
- ⛔ `/api/staff/availability-today` (high)
- ⛔ `/api/staff/schedule` (critical)
- ⛔ `/api/staff/schedule/bulk` (critical)
- ⛔ `/api/staff/schedule/week` (critical)
- ⛔ `/api/staff/schedule/week/copy` (critical)

### `staff_sessions` — 7 routes, 5 not yet GUC-safe

- ⛔ `/api/admin/org/delete` (medium)
- ✅ `/api/admin/org/export` (low)
- ⛔ `/api/admin/sessions` (high)
- ⛔ `/api/admin/staff/[id]/detail` (high)
- ⛔ `/api/admin/staff/[id]/sessions` (critical)
- ✅ `/api/admin/staff/deactivate` (low)
- ⛔ `/api/shifts/[id]/cover` (critical)

### `staff_todo_completions` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/staff-todos` (critical)

### `staff_week_plans` — 6 routes, 6 not yet GUC-safe

- ⛔ `/api/staff` (medium)
- ⛔ `/api/staff/availability-today` (high)
- ⛔ `/api/staff/schedule` (critical)
- ⛔ `/api/staff/schedule/bulk` (critical)
- ⛔ `/api/staff/schedule/week` (critical)
- ⛔ `/api/staff/schedule/week/copy` (critical)

### `staff_weekly_schedule` — 6 routes, 6 not yet GUC-safe

- ⛔ `/api/staff` (medium)
- ⛔ `/api/staff/availability-today` (high)
- ⛔ `/api/staff/schedule` (critical)
- ⛔ `/api/staff/schedule/bulk` (critical)
- ⛔ `/api/staff/schedule/week` (critical)
- ⛔ `/api/staff/schedule/week/copy` (critical)

### `station_activity_logs` — 24 routes, 24 not yet GUC-safe

- ⛔ `/api/activity/feed` (high)
- ⛔ `/api/admin/logs` (high)
- ⛔ `/api/audit-log/report` (high)
- ⛔ `/api/audit-log/staff-directory` (high)
- ⛔ `/api/dashboard/operations` (high)
- ⛔ `/api/labels/recent` (high)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders/check-shipped` (critical)
- ⛔ `/api/orders/next` (high)
- ⛔ `/api/pack/ship` (critical)
- ⛔ `/api/packerlogs` (medium)
- ⛔ `/api/post-multi-sn` (critical)
- ⛔ `/api/replenish/shipped-fifo` (high)
- ⛔ `/api/serial-units/[id]` (high)
- ⛔ `/api/staff-goals` (critical)
- ⛔ `/api/tech/add-serial` (critical)
- ⛔ `/api/tech/add-serial-to-last` (critical)
- ⛔ `/api/tech/delete` (critical)
- ⛔ `/api/tech/delete-tracking` (critical)
- ⛔ `/api/tech/logs` (high)
- ⛔ `/api/tech/serial` (medium)
- ⛔ `/api/tech/undo-last` (critical)
- ⛔ `/api/tech/update-serials` (critical)
- ⛔ `/api/work-orders` (critical)

### `station_definitions` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/stations` (medium)
- ⛔ `/api/stations/publish` (medium)

### `station_scan_sessions` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/receiving-lines` (critical)

### `stock_alerts` — 5 routes, 5 not yet GUC-safe

- ⛔ `/api/cron/inventory/drift-check` (high)
- ⛔ `/api/cron/stock-alerts` (high)
- ⛔ `/api/inventory/alerts` (high)
- ⛔ `/api/inventory/alerts/[id]/ack` (critical)
- ⛔ `/api/stock-alerts` (high)

### `suppliers` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/suppliers` (critical)
- ⛔ `/api/suppliers/[id]` (critical)

### `sync_cursors` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/admin/po-mirror/health` (high)
- ⛔ `/api/cron/zoho/incoming-po-sync` (high)

### `tech_serial_numbers` — 23 routes, 23 not yet GUC-safe

- ⛔ `/api/admin/logs` (high)
- ⛔ `/api/audit-log/report` (high)
- ⛔ `/api/ebay/search` (high)
- ⛔ `/api/fba/logs/summary` (high)
- ⛔ `/api/google-sheets/execute-script` (critical)
- ⛔ `/api/labels/recent` (high)
- ⛔ `/api/orders/batch` (critical)
- ⛔ `/api/orders/lookup/[orderId]` (high)
- ⛔ `/api/orders/start` (critical)
- ⛔ `/api/post-multi-sn` (critical)
- ⛔ `/api/receiving/scan-serial` (medium)
- ⛔ `/api/receiving/serials` (critical)
- ⛔ `/api/scan/resolve` (critical)
- ⛔ `/api/serial-units/[id]` (high)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/serial-units/lookup` (medium)
- ⛔ `/api/sync-sheets` (medium)
- ⛔ `/api/tech/delete` (critical)
- ⛔ `/api/tech/delete-tracking` (critical)
- ⛔ `/api/tech/logs` (high)
- ⛔ `/api/tech/orders-without-manual` (high)
- ⛔ `/api/tech/scan` (medium)
- ⛔ `/api/tech/serial` (medium)

### `tech_verifications` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/serial-units/[id]/checklist` (critical)
- ⛔ `/api/serial-units/[id]/checklist/bulk` (critical)

### `testing_results` — 4 routes, 4 not yet GUC-safe

- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/serial-units/[id]/checklist` (critical)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/testing/recent` (high)

### `ticket_links` — 5 routes, 5 not yet GUC-safe

- ⛔ `/api/receiving/zendesk-claim` (medium)
- ⛔ `/api/receiving/zendesk-claim/link` (medium)
- ⛔ `/api/warranty/claims/[id]/zendesk` (medium)
- ⛔ `/api/zendesk/tickets` (medium)
- ⛔ `/api/zendesk/tickets/[id]/photos` (medium)

### `tracking_exceptions` — 4 routes, 4 not yet GUC-safe

- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/tracking-exceptions` (high)
- ⛔ `/api/tracking-exceptions/[id]` (critical)
- ⛔ `/api/tracking-exceptions/[id]/refresh` (critical)

### `unfound_overlay` — 4 routes, 4 not yet GUC-safe

- ⛔ `/api/receiving/unfound-queue/[kind]/[id]` (medium)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk` (medium)
- ⛔ `/api/receiving/zendesk-claim/link` (medium)
- ⛔ `/api/zendesk/tickets/[id]/photos` (medium)

### `unit_failure_tags` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/quality/dashboard` (high)

### `unit_quality_scores` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/quality/dashboard` (high)

### `unit_repairs` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/quality/dashboard` (high)

### `warehouses` — 3 routes, 3 not yet GUC-safe

- ⛔ `/api/warehouses` (high)
- ⛔ `/api/zoho/oauth/authorize` (high)
- ⛔ `/api/zoho/warehouses` (high)

### `warranty_claims` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/warranty/claims/[id]/rma` (critical)

### `work_assignments` — 33 routes, 33 not yet GUC-safe

- ⛔ `/api/assignments/next` (high)
- ⛔ `/api/assignments/sku-search` (medium)
- ⛔ `/api/check-tracking` (high)
- ⛔ `/api/dashboard/operations` (high)
- ⛔ `/api/debug-tracking` (high)
- ⛔ `/api/ebay/search` (high)
- ⛔ `/api/fba/shipments` (medium)
- ⛔ `/api/fba/shipments/today/duplicate-yesterday` (medium)
- ⛔ `/api/fba/shipments/today/items` (medium)
- ⛔ `/api/google-sheets/sync-shipstation-orders` (critical)
- ⛔ `/api/import-orders` (medium)
- ⛔ `/api/local-pickups` (critical)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders/assign` (medium)
- ⛔ `/api/orders/lookup/[orderId]` (high)
- ⛔ `/api/orders/next` (high)
- ⛔ `/api/orders/recent` (high)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/packing-logs/update` (medium)
- ⛔ `/api/receiving-entry` (critical)
- ⛔ `/api/receiving-logs` (medium)
- ⛔ `/api/receiving/match` (critical)
- ⛔ `/api/repair-service/next` (high)
- ⛔ `/api/repair-service/out-of-stock` (critical)
- ⛔ `/api/repair-service/pickup` (critical)
- ⛔ `/api/repair-service/repaired` (critical)
- ⛔ `/api/repair/submit` (medium)
- ⛔ `/api/sync-sheets` (medium)
- ⛔ `/api/tech/logs` (high)
- ⛔ `/api/tech/orders-without-manual` (high)
- ⛔ `/api/tech/scan` (medium)
- ⛔ `/api/work-orders` (critical)
- ⛔ `/api/zoho/purchase-orders/receive` (critical)

### `workflow_definitions` — 4 routes, 4 not yet GUC-safe

- ⛔ `/api/stations/publish` (medium)
- ⛔ `/api/studio/definitions/[id]/graph` (medium)
- ⛔ `/api/studio/definitions/[id]/publish` (medium)
- ⛔ `/api/studio/definitions/draft` (medium)

### `workflow_edges` — 3 routes, 3 not yet GUC-safe

- ⛔ `/api/studio/definitions/[id]/graph` (medium)
- ⛔ `/api/studio/definitions/[id]/publish` (medium)
- ⛔ `/api/studio/definitions/draft` (medium)

### `workflow_node_stats` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/workflow-node-stats` (high)

### `workflow_nodes` — 3 routes, 3 not yet GUC-safe

- ⛔ `/api/studio/definitions/[id]/graph` (medium)
- ⛔ `/api/studio/definitions/[id]/publish` (medium)
- ⛔ `/api/studio/definitions/draft` (medium)

### `zoho_fulfillment_sync` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/cron/zoho/fulfillment-sync` (high)
- ⛔ `/api/zoho/fulfillment-sync` (critical)

### `zoho_item_images` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/zoho/items/[id]/image` (high)

### `zoho_po_mirror` — 12 routes, 12 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/triage/[id]/detail` (high)
- ⛔ `/api/admin/po-mirror/health` (high)
- ⛔ `/api/cron/zoho/incoming-po-sync` (high)
- ⛔ `/api/cron/zoho/po-sync` (high)
- ⛔ `/api/receiving-lines` (critical)
- ⛔ `/api/receiving-lines/incoming/delivered-unscanned` (high)
- ⛔ `/api/receiving-lines/incoming/details` (high)
- ⛔ `/api/receiving-lines/incoming/refresh/stream` (critical)
- ⛔ `/api/receiving-lines/incoming/summary` (high)
- ⛔ `/api/receiving-lines/incoming/zoho-refresh` (critical)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/po/[poId]/attach-box` (critical)
