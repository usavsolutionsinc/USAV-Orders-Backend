# Route scoping audit — GENERATED

> Static scan of `src/app/api/**/route.ts`. Regenerate: `node scripts/tenancy-route-audit.mjs`.
> "touches tenant table" = the handler body word-matches a non-system table from the coverage doc.
> Risk: **critical** = mutates a tenant table with no org filter & no GUC; **high** = reads one with no
> org filter & no GUC; **medium** = has an org filter but no GUC/RLS backstop; **low** = GUC-wrapped.

## Summary

| metric | count |
|---|---|
| total route files | 606 |
| withAuth | 462 |
| GUC-wrapped (tenantQuery/withTenantConnection/withTenantTransaction) | 242 |
| references organizationId | 484 |
| raw @/lib/db pool import | 182 |
| drizzle / neon-http | 14 |
| uses USAV_ORG_ID / transitionalUsavOrgId | 11 |
| cron routes | 30 |

| risk | count |
|---|---|
| critical | 29 |
| high | 29 |
| medium | 213 |
| low | 240 |
| info | 95 |

## Routes by risk (critical + high first)

| risk | route | methods | auth | orgRef | GUC | tables touched |
|---|---|---|:-:|:-:|:-:|---|
| critical | `/api/ai/search` | POST | ✅ | — | — | messages |
| critical | `/api/auth/enroll/[token]` | GET/POST | — | — | — | staff |
| critical | `/api/auth/passkey/authenticate/begin` | POST | — | — | — | staff |
| critical | `/api/auth/passkey/authenticate/finish` | POST | — | — | — | staff, types |
| critical | `/api/auth/passkey/register/begin` | POST | — | — | — | staff |
| critical | `/api/auth/passkey/register/finish` | POST | — | — | — | staff, types |
| critical | `/api/auth/pin` | POST | — | — | — | staff |
| critical | `/api/auth/pin/create` | POST | — | — | — | staff |
| critical | `/api/auth/signin` | POST | — | — | — | staff |
| critical | `/api/auth/signout` | POST | — | — | — | staff |
| critical | `/api/auth/signup` | POST | ✅ | — | — | staff |
| critical | `/api/auth/step-up` | POST | — | — | — | types |
| critical | `/api/auth/switch` | POST | — | — | — | staff |
| critical | `/api/bose-models` | GET/POST | ✅ | — | — | items |
| critical | `/api/manual-server/assign` | POST | ✅ | — | — | sku_stock |
| critical | `/api/nas-dev/[[...path]]` | GET/PUT | — | — | — | photos, staff |
| critical | `/api/orders/skip` | POST | ✅ | — | — | orders |
| critical | `/api/orders/start` | POST | ✅ | — | — | tech_serial_numbers, orders |
| critical | `/api/receiving-lines/incoming/zoho-refresh` | POST | ✅ | — | — | receiving_lines, zoho_po_mirror, receiving |
| critical | `/api/receiving/disposition-suggest` | POST | ✅ | — | — | receiving |
| critical | `/api/receiving/nas-archive-test` | POST | ✅ | — | — | receiving, photos |
| critical | `/api/receiving/zendesk-claim/classify` | POST | ✅ | — | — | receiving |
| critical | `/api/shipping/track/register` | POST | ✅ | — | — | types |
| critical | `/api/webhooks/square` | POST/GET | — | — | — | square_transactions, orders, items, sku |
| critical | `/api/webhooks/ups` | POST/GET | — | — | — | shipping_tracking_numbers, shipment_tracking_events, packages |
| critical | `/api/zoho/purchase-orders/sync` | POST | ✅ | — | — | receiving_lines, receiving, orders |
| critical | `/api/zoho/purchase-receives/import` | POST | ✅ | — | — | receiving |
| critical | `/api/zoho/purchase-receives/sync` | POST | ✅ | — | — | receiving_lines, receiving, orders |
| critical | `/api/zoho/webhooks` | POST/GET | — | — | — | types |
| high | `/api/auth/staff-picker` | GET | — | — | — | staff |
| high | `/api/cron/amazon/orders-sync` | GET | — | — | — | amazon_accounts, orders |
| high | `/api/cron/cleanup` | GET | — | — | — | api_idempotency_responses |
| high | `/api/cron/google-sheets/transfer-orders` | GET | — | — | — | orders |
| high | `/api/cron/integrations/sync` | GET | — | — | — | orders |
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
| high | `/api/desktop-app/release` | GET | — | — | — | orders |
| high | `/api/ecwid/products/search` | GET | ✅ | — | — | sku_stock, items, sku |
| high | `/api/manual-server/by-item` | GET | ✅ | — | — | sku_stock |
| high | `/api/manual-server/unassigned` | GET | ✅ | — | — | sku_stock |
| high | `/api/repair/ecwid-categories` | GET | ✅ | — | — | items |
| high | `/api/repair/ecwid-products` | GET | ✅ | — | — | items, sku |
| high | `/api/support/overview` | GET | — | — | — | messages |
| high | `/api/vision-config` | GET | ✅ | — | — | receiving |
| high | `/api/zoho/oauth/authorize` | GET | ✅ | — | — | warehouses, receiving, items |
| medium | `/api/admin/integrations/list` | GET | ✅ | ✅ | — | staff |
| medium | `/api/admin/org/delete` | POST | ✅ | ✅ | — | staff_sessions |
| medium | `/api/admin/po-gmail/create-zoho-draft/[id]` | POST | ✅ | ✅ | — | email_missing_purchase_orders, items |
| medium | `/api/admin/po-gmail/disconnect` | POST | ✅ | ✅ | — | google_oauth_tokens |
| medium | `/api/admin/po-gmail/oauth-callback` | GET | ✅ | ✅ | — | google_oauth_tokens |
| medium | `/api/admin/po-gmail/preview-unread` | GET | ✅ | ✅ | — | messages, items |
| medium | `/api/admin/po-gmail/reconcile` | GET | ✅ | ✅ | — | email_missing_purchase_orders, receiving_lines, receiving, messages |
| medium | `/api/admin/po-gmail/status` | GET | ✅ | ✅ | — | google_oauth_tokens |
| medium | `/api/admin/po-gmail/triage/[id]/detail` | GET | — | ✅ | — | email_missing_purchase_orders, zoho_po_mirror, messages |
| medium | `/api/admin/po-gmail/triage/[id]/extract` | POST | — | ✅ | — | email_missing_purchase_orders, messages |
| medium | `/api/admin/staff/[id]/enroll-token` | POST | ✅ | ✅ | — | staff_enrollments, staff |
| medium | `/api/admin/staff/list` | GET | ✅ | ✅ | — | staff |
| medium | `/api/admin/staff/update` | POST | ✅ | ✅ | — | staff |
| medium | `/api/ai/chat` | POST | ✅ | ✅ | — | platforms, receiving, messages, orders, staff, types |
| medium | `/api/ai/chat/stream` | POST | ✅ | ✅ | — | receiving, messages, orders, staff, types |
| medium | `/api/assignments/sku-search` | GET/POST | ✅ | ✅ | — | work_assignments, sku_stock, items, staff, sku |
| medium | `/api/audit-log/packing` | GET | ✅ | ✅ | — | items, sku |
| medium | `/api/audit-log/receiving` | GET | ✅ | ✅ | — | receiving, items, sku |
| medium | `/api/audit-log/sku` | GET | ✅ | ✅ | — | items, sku |
| medium | `/api/audit-log/staff` | GET | ✅ | ✅ | — | staff |
| medium | `/api/audit-log/tech` | GET | ✅ | ✅ | — | items |
| medium | `/api/audit/bin/[id]` | GET | — | ✅ | — | inventory_events, audit_logs, locations |
| medium | `/api/audit/sku/[sku]` | GET | — | ✅ | — | inventory_events, sku_stock_ledger, audit_logs, sku |
| medium | `/api/auth/session` | GET | — | ✅ | — | staff |
| medium | `/api/auth/sso/callback` | GET | ✅ | ✅ | — | staff |
| medium | `/api/billing/portal` | POST | ✅ | ✅ | — | invoices |
| medium | `/api/billing/webhook` | POST | — | ✅ | — | items |
| medium | `/api/catalog/platform-accounts` | GET/POST | ✅ | ✅ | — | receiving |
| medium | `/api/catalog/platforms` | GET/POST | ✅ | ✅ | — | platforms, receiving |
| medium | `/api/catalog/platforms/[id]` | PATCH/DELETE | — | ✅ | — | platforms |
| medium | `/api/catalog/types` | GET/POST | ✅ | ✅ | — | receiving, types |
| medium | `/api/catalog/types/[id]` | PATCH/DELETE | — | ✅ | — | types |
| medium | `/api/catalog/workflow-nodes` | GET | ✅ | ✅ | — | receiving, items, types |
| medium | `/api/ecwid/sync-exception-tracking` | POST | ✅ | ✅ | — | orders_exceptions, orders, items, sku |
| medium | `/api/ecwid/transfer-orders` | POST | ✅ | ✅ | — | orders |
| medium | `/api/failure-modes` | GET/POST | ✅ | ✅ | — | sku_stock |
| medium | `/api/failure-modes/[id]` | PATCH/DELETE | ✅ | ✅ | — | sku_stock |
| medium | `/api/favorites` | GET/POST | ✅ | ✅ | — | sku_stock, sku |
| medium | `/api/favorites/[id]` | PATCH/DELETE | — | ✅ | — | sku_stock, sku |
| medium | `/api/google-sheets/transfer-orders` | POST/GET | ✅ | ✅ | — | orders |
| medium | `/api/handling-units` | GET/POST | ✅ | ✅ | — | handling_units, items |
| medium | `/api/import-orders` | POST | ✅ | ✅ | — | work_assignments, orders, sku |
| medium | `/api/integrations/[provider]/sync` | POST | ✅ | ✅ | — | orders |
| medium | `/api/inventory/bins-overview` | GET | ✅ | ✅ | — | sku_stock |
| medium | `/api/locations` | GET/POST | — | ✅ | — | locations |
| medium | `/api/locations/[barcode]` | GET/PATCH/DELETE | — | ✅ | — | reason_codes, locations, sku_stock, sku |
| medium | `/api/locations/[barcode]/properties` | PATCH | — | ✅ | — | locations, sku_stock |
| medium | `/api/locations/bulk` | POST | ✅ | ✅ | — | locations |
| medium | `/api/locations/register` | POST | ✅ | ✅ | — | locations |
| medium | `/api/nas-config` | GET | ✅ | ✅ | — | receiving, photos |
| medium | `/api/nas/[[...path]]` | GET/PUT/DELETE | ✅ | ✅ | — | receiving, photos |
| medium | `/api/need-to-order` | GET | ✅ | ✅ | — | replenishment_requests, item_stock_cache, sku_stock, sku |
| medium | `/api/need-to-order/[id]` | PATCH/DELETE | — | ✅ | — | replenishment_status_log, replenishment_requests, staff |
| medium | `/api/order-labels` | GET/POST/DELETE | ✅ | ✅ | — | audit_logs, documents, receiving, orders, photos |
| medium | `/api/orders` | GET | ✅ | ✅ | — | replenishment_order_lines, shipping_tracking_numbers, replenishment_requests, station_activity_logs, order_shipment_links, work_assignments +5 |
| medium | `/api/orders/[id]` | GET/PATCH/DELETE | — | ✅ | — | orders |
| medium | `/api/orders/[id]/allocate` | POST | ✅ | ✅ | — | order_unit_allocations, serial_units, orders, sku |
| medium | `/api/orders/[id]/timeline` | GET | — | ✅ | — | order_unit_allocations, station_activity_logs, inventory_events, audit_logs, orders, staff |
| medium | `/api/orders/[id]/tracking` | POST/PATCH/DELETE | — | ✅ | — | shipping_tracking_numbers, order_shipment_links, orders |
| medium | `/api/orders/add` | POST | ✅ | ✅ | — | sku_catalog, orders, sku |
| medium | `/api/orders/assign` | POST | ✅ | ✅ | — | order_shipment_links, work_assignments, sku_catalog, audit_logs, orders, staff +1 |
| medium | `/api/orders/check-shipped` | POST | ✅ | ✅ | — | station_activity_logs, orders |
| medium | `/api/orders/delete` | POST | ✅ | ✅ | — | orders, sku |
| medium | `/api/orders/missing-parts` | POST | ✅ | ✅ | — | orders, staff |
| medium | `/api/orders/set-item-number` | POST | ✅ | ✅ | — | orders |
| medium | `/api/pack/ship` | POST | ✅ | ✅ | — | order_unit_allocations, station_activity_logs, inventory_events, sku_stock_ledger, serial_units, packer_logs +3 |
| medium | `/api/packerlogs` | GET/POST/PUT/DELETE | ✅ | ✅ | — | station_activity_logs, packer_logs, orders, photos, sku |
| medium | `/api/packing-logs` | GET/POST | ✅ | ✅ | — | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, sku_platform_ids, work_assignments, fba_shipments +8 |
| medium | `/api/packing-logs/update` | POST | ✅ | ✅ | — | shipping_tracking_numbers, sku_stock_ledger, work_assignments, packer_logs, sku_stock, orders +2 |
| medium | `/api/part-compatibility` | GET/POST | ✅ | ✅ | — | part_compatibility, sku_catalog, items, sku |
| medium | `/api/picking/session` | POST | ✅ | ✅ | — | orders |
| medium | `/api/picking/session/[id]/complete` | POST | ✅ | ✅ | — | picking_sessions, orders |
| medium | `/api/picking/session/[id]/confirm-pick` | POST | ✅ | ✅ | — | order_unit_allocations, serial_units, orders |
| medium | `/api/picking/session/[id]/short-pick` | POST | ✅ | ✅ | — | order_unit_allocations, inventory_events, serial_units, orders |
| medium | `/api/post-multi-sn` | POST | ✅ | ✅ | — | station_activity_logs, tech_serial_numbers, inventory_events, serial_units, receiving, sku |
| medium | `/api/product-manuals` | GET/POST/PATCH/DELETE | ✅ | ✅ | — | product_manuals, sku_stock, sku |
| medium | `/api/product-manuals/assign` | POST | ✅ | ✅ | — | product_manuals, sku_catalog |
| medium | `/api/product-manuals/sync` | POST | ✅ | ✅ | — | product_manuals, items |
| medium | `/api/product-manuals/thumbnail` | POST | ✅ | ✅ | — | product_manuals |
| medium | `/api/product-manuals/upload` | POST | ✅ | ✅ | — | product_manuals, sku |
| medium | `/api/product-manuals/upsert` | POST | ✅ | ✅ | — | product_manuals, sku_catalog |
| medium | `/api/realtime/token` | GET/POST | ✅ | ✅ | — | staff |
| medium | `/api/reason-codes/[id]` | GET/PATCH/DELETE | — | ✅ | — | sku_stock |
| medium | `/api/receiving-entry` | POST/GET | ✅ | ✅ | — | shipping_tracking_numbers, work_assignments, receiving_lines, receiving |
| medium | `/api/receiving-lines/[id]/ensure-catalog` | POST | ✅ | ✅ | — | receiving_lines, serial_units, sku_catalog, receiving |
| medium | `/api/receiving-lines/incoming/email-rescan` | POST | ✅ | ✅ | — | receiving, items, staff |
| medium | `/api/receiving-lines/incoming/refresh` | POST | ✅ | ✅ | — | receiving_lines, receiving, packages |
| medium | `/api/receiving-lines/view` | POST | ✅ | ✅ | — | receiving_line_views, receiving, staff |
| medium | `/api/receiving-logs` | GET/DELETE/PATCH | ✅ | ✅ | — | shipping_tracking_numbers, work_assignments, receiving_scans, receiving |
| medium | `/api/receiving-photos` | GET/POST/DELETE | ✅ | ✅ | — | receiving_lines, receiving_scans, receiving, photos |
| medium | `/api/receiving-tasks` | GET/POST/PUT/DELETE | ✅ | ✅ | — | receiving |
| medium | `/api/receiving/[id]` | GET/PATCH | — | ✅ | — | shipping_tracking_numbers, local_pickup_orders, inventory_events, receiving_lines, receiving_scans, serial_units +5 |
| medium | `/api/receiving/[id]/attach-box` | POST | — | ✅ | — | receiving |
| medium | `/api/receiving/add-unmatched-line` | POST | ✅ | ✅ | — | api_idempotency_responses, sku_platform_ids, receiving_lines, receiving, orders, items +1 |
| medium | `/api/receiving/identify-label` | POST | ✅ | ✅ | — | sku_catalog, receiving, items, sku |
| medium | `/api/receiving/lines/[id]/condition` | PATCH | ✅ | ✅ | — | receiving_lines, receiving |
| medium | `/api/receiving/lines/[id]/putaway` | POST | — | ✅ | — | inventory_events, receiving_lines, serial_units, locations, receiving, sku |
| medium | `/api/receiving/lines/[id]/status` | POST | — | ✅ | — | receiving_lines, serial_units, receiving, sku |
| medium | `/api/receiving/lookup-po` | POST | ✅ | ✅ | — | shipping_tracking_numbers, tracking_exceptions, receiving_lines, receiving_scans, zoho_po_mirror, sku_catalog +5 |
| medium | `/api/receiving/mark-received` | POST | ✅ | ✅ | — | shipping_tracking_numbers, inventory_events, sku_stock_ledger, receiving_lines, serial_units, audit_logs +6 |
| medium | `/api/receiving/mark-received-po` | POST | ✅ | ✅ | — | shipping_tracking_numbers, inventory_events, sku_stock_ledger, receiving_lines, serial_units, audit_logs +4 |
| medium | `/api/receiving/pending-check` | GET | ✅ | ✅ | — | sku_platform_ids, pending_skus, receiving, orders, sku |
| medium | `/api/receiving/po/[poId]/attach-box` | GET/POST | — | ✅ | — | receiving_lines, zoho_po_mirror, receiving |
| medium | `/api/receiving/scan-serial` | POST/DELETE | ✅ | ✅ | — | tech_serial_numbers, receiving_lines, serial_units, receiving, sku |
| medium | `/api/receiving/serials` | GET/POST/DELETE | ✅ | ✅ | — | tech_serial_numbers, receiving_lines, serial_units, receiving |
| medium | `/api/receiving/unfound-queue` | GET | ✅ | ✅ | — | receiving |
| medium | `/api/receiving/unfound-queue/[kind]/[id]` | PATCH/DELETE | ✅ | ✅ | — | email_missing_purchase_orders, orders_exceptions, unfound_overlay, serial_units, receiving, staff |
| medium | `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk` | POST | ✅ | ✅ | — | unfound_overlay, receiving |
| medium | `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk/draft` | POST | ✅ | ✅ | — | receiving |
| medium | `/api/receiving/visual-identify` | POST | ✅ | ✅ | — | sku_catalog, receiving, sku |
| medium | `/api/receiving/zendesk-claim` | POST | ✅ | ✅ | — | receiving_lines, ticket_links, receiving, photos |
| medium | `/api/receiving/zendesk-claim/draft` | POST | ✅ | ✅ | — | receiving_lines, receiving, photos |
| medium | `/api/receiving/zendesk-claim/link` | GET/POST/DELETE | ✅ | ✅ | — | receiving_lines, unfound_overlay, ticket_links, receiving |
| medium | `/api/receiving/zendesk-claim/preview` | POST | ✅ | ✅ | — | receiving_lines, receiving, photos |
| medium | `/api/receiving/zendesk-claim/thread` | GET | ✅ | ✅ | — | receiving |
| medium | `/api/repair-service/[id]` | GET/DELETE | — | ✅ | — | customers, documents |
| medium | `/api/repair-service/pickup` | POST | ✅ | ✅ | — | work_assignments, repair_service, documents |
| medium | `/api/repair-service/repaired` | POST | ✅ | ✅ | — | work_assignments, repair_service |
| medium | `/api/repair/actions` | GET/POST | ✅ | ✅ | — | repair_actions, unit_repairs, staff |
| medium | `/api/repair/actions/[id]` | PATCH/DELETE | ✅ | ✅ | — | repair_actions |
| medium | `/api/repair/customers` | GET | ✅ | ✅ | — | customers |
| medium | `/api/repair/square-payment-link` | POST | ✅ | ✅ | — | types, sku |
| medium | `/api/repair/submit` | POST | ✅ | ✅ | — | work_assignments, documents |
| medium | `/api/replenish/bulk-create-po` | POST | ✅ | ✅ | — | orders |
| medium | `/api/replenishment/tasks/[id]/cancel` | POST | ✅ | ✅ | — | staff |
| medium | `/api/replenishment/tasks/[id]/claim` | POST | ✅ | ✅ | — | staff |
| medium | `/api/replenishment/tasks/[id]/complete` | POST | ✅ | ✅ | — | inventory_events, bin_contents, staff |
| medium | `/api/returns/intake` | POST | ✅ | ✅ | — | inventory_events, sku_stock_ledger, serial_units, receiving, sku_stock |
| medium | `/api/rma` | GET/POST | ✅ | ✅ | — | orders, staff |
| medium | `/api/rma/[id]` | GET/PATCH/DELETE | — | ✅ | — | orders |
| medium | `/api/rma/[id]/close` | POST | ✅ | ✅ | — | orders, staff |
| medium | `/api/rma/[id]/disposition` | POST | ✅ | ✅ | — | return_dispositions, inventory_events, orders, staff |
| medium | `/api/rma/[id]/mark-received` | POST | ✅ | ✅ | — | orders, staff |
| medium | `/api/rma/by-number/[number]` | GET | ✅ | ✅ | — | orders |
| medium | `/api/rooms/[room]` | PATCH/DELETE | — | ✅ | — | sku_stock |
| medium | `/api/rooms/reorder` | POST | ✅ | ✅ | — | sku_stock |
| medium | `/api/scan-tracking` | POST | ✅ | ✅ | — | shipping_tracking_numbers, orders_exceptions, orders |
| medium | `/api/scan/resolve` | GET/POST | ✅ | ✅ | — | shipping_tracking_numbers, tech_serial_numbers, mobile_scan_events, serial_units, sku_catalog, receiving +4 |
| medium | `/api/serial-units/[id]/photos` | GET/POST | ✅ | ✅ | — | inventory_events, serial_units, receiving, sku_stock, photos, sku |
| medium | `/api/serial-units/[id]/repairs` | GET/POST | ✅ | ✅ | — | serial_units, unit_repairs, staff |
| medium | `/api/serial-units/[id]/test` | POST | ✅ | ✅ | — | tech_serial_numbers, inventory_events, testing_results, audit_logs, receiving, staff +1 |
| medium | `/api/serial-units/lookup` | GET | ✅ | ✅ | — | order_unit_allocations, tech_serial_numbers, serial_units, receiving, orders, sku |
| medium | `/api/shipped` | GET/PATCH | ✅ | ✅ | — | packer_logs, orders, sku |
| medium | `/api/shipped/[id]` | GET | — | ✅ | — | orders |
| medium | `/api/shipped/scan-out` | POST/DELETE | ✅ | ✅ | — | shipping_tracking_numbers, station_activity_logs, orders_exceptions, audit_logs, orders |
| medium | `/api/shipped/search` | GET/POST | ✅ | ✅ | — | orders |
| medium | `/api/shipping/track/sync-one` | POST | ✅ | ✅ | — | types |
| medium | `/api/sku-catalog` | GET/POST | ✅ | ✅ | — | sku_stock, items, sku |
| medium | `/api/sku-catalog/[id]/platform-ids` | POST/PUT/DELETE | — | ✅ | — | sku_stock, sku |
| medium | `/api/sku-catalog/graph/[skuId]/children` | GET | — | ✅ | — | sku_catalog, sku_stock, sku |
| medium | `/api/sku-catalog/graph/[skuId]/parents` | GET | — | ✅ | — | sku_catalog, sku_stock, sku |
| medium | `/api/sku-catalog/graph/[skuId]/tree` | GET | — | ✅ | — | sku_catalog, sku_stock, sku |
| medium | `/api/sku-catalog/graph/relationships` | POST | ✅ | ✅ | — | sku_stock, sku |
| medium | `/api/sku-catalog/pair-batch` | POST | ✅ | ✅ | — | sku_pairing_audit, product_manuals, sku_stock, orders, sku |
| medium | `/api/sku-catalog/pair-ecwid` | POST | ✅ | ✅ | — | sku_stock, sku |
| medium | `/api/sku-catalog/suggest-pairings` | GET/POST | ✅ | ✅ | — | sku_platform_ids, sku_stock, sku |
| medium | `/api/sku-catalog/unpaired-ecwid` | GET | ✅ | ✅ | — | sku_stock, items, sku |
| medium | `/api/sku-stock/[sku]` | GET/PATCH | ✅ | ✅ | — | inventory_events, sku_stock_ledger, sku_catalog, locations, sku_stock, photos +2 |
| medium | `/api/sourcing/alerts` | GET/POST/PATCH | ✅ | ✅ | — | items |
| medium | `/api/sourcing/candidates` | GET/POST | ✅ | ✅ | — | items |
| medium | `/api/sourcing/candidates/[id]/import` | POST | — | ✅ | — | part_acquisitions, receiving |
| medium | `/api/sourcing/saved-searches` | GET/POST | ✅ | ✅ | — | items |
| medium | `/api/sourcing/saved-searches/[id]/run` | POST | — | ✅ | — | sku |
| medium | `/api/sourcing/search` | POST | ✅ | ✅ | — | ebay_api_calls |
| medium | `/api/staff` | GET/POST/PUT/DELETE | ✅ | ✅ | — | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| medium | `/api/staff-goals/me` | GET | ✅ | ✅ | — | station_activity_logs, staff_stations, staff_goals, staff |
| medium | `/api/staff-messages` | GET/POST/PATCH | ✅ | ✅ | — | messages, items, staff |
| medium | `/api/staff-todos` | GET/POST/PATCH/DELETE | ✅ | ✅ | — | staff_todo_completions, items, staff |
| medium | `/api/staff/schedule` | GET/PUT | ✅ | ✅ | — | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| medium | `/api/staff/schedule/bulk` | POST | ✅ | ✅ | — | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| medium | `/api/staff/schedule/week` | GET/PUT | ✅ | ✅ | — | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| medium | `/api/staff/schedule/week/copy` | POST | ✅ | ✅ | — | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| medium | `/api/stations` | GET/POST | ✅ | ✅ | — | station_definitions, receiving, staff |
| medium | `/api/studio/graph` | GET | ✅ | ✅ | — | types |
| medium | `/api/studio/live` | GET | ✅ | ✅ | — | item_workflow_state |
| medium | `/api/studio/nodes/[id]/station` | GET | ✅ | ✅ | — | station_definitions |
| medium | `/api/suppliers` | GET/POST | ✅ | ✅ | — | suppliers, items |
| medium | `/api/suppliers/[id]` | GET/PATCH/DELETE | — | ✅ | — | suppliers |
| medium | `/api/sync-sheets` | POST | ✅ | ✅ | — | shipping_tracking_numbers, tech_serial_numbers, work_assignments, packer_logs, sku_catalog, fba_fnskus +2 |
| medium | `/api/tech/delete` | POST | ✅ | ✅ | — | station_activity_logs, tech_serial_numbers, fba_fnsku_logs, orders, staff |
| medium | `/api/tech/scan-repair-station` | POST | ✅ | ✅ | — | staff |
| medium | `/api/tech/scan-sku` | POST | ✅ | ✅ | — | sku_stock_ledger, serial_units, sku_stock, orders, staff, sku |
| medium | `/api/tech/serial` | POST | ✅ | ✅ | — | station_activity_logs, tech_serial_numbers, orders |
| medium | `/api/tracking-exceptions/[id]/refresh` | POST | — | ✅ | — | tracking_exceptions, receiving_lines, receiving_scans, receiving, orders, sku |
| medium | `/api/units/next-id` | POST | ✅ | ✅ | — | unit_id_sequences, sku_catalog, sku |
| medium | `/api/units/resolve-id` | POST | ✅ | ✅ | — | serial_units, sku_catalog, sku |
| medium | `/api/walk-in/catalog` | GET | ✅ | ✅ | — | items, sku |
| medium | `/api/walk-in/customers` | GET/POST | ✅ | ✅ | — | customers |
| medium | `/api/walk-in/orders` | POST | ✅ | ✅ | — | orders |
| medium | `/api/walk-in/sales` | GET/DELETE | ✅ | ✅ | — | square_transactions, orders |
| medium | `/api/walk-in/status` | GET | ✅ | ✅ | — | customers, locations |
| medium | `/api/walk-in/sync` | POST | ✅ | ✅ | — | square_transactions, orders, sku |
| medium | `/api/warranty/claims` | GET/POST | ✅ | ✅ | — | staff, sku |
| medium | `/api/warranty/claims/[id]/quote` | POST | ✅ | ✅ | — | staff |
| medium | `/api/warranty/claims/[id]/repair` | POST | ✅ | ✅ | — | photos |
| medium | `/api/warranty/claims/[id]/repair-handoff` | POST/DELETE | ✅ | ✅ | — | repair_service |
| medium | `/api/warranty/claims/[id]/rma` | POST/DELETE | ✅ | ✅ | — | rma_authorizations, warranty_claims, staff |
| medium | `/api/warranty/claims/[id]/zendesk` | GET/POST | ✅ | ✅ | — | ticket_links, receiving |
| medium | `/api/warranty/claims/[id]/zendesk/link` | GET/POST/DELETE | ✅ | ✅ | — | warranty_claims, ticket_links, receiving |
| medium | `/api/warranty/claims/bulk` | POST/DELETE | ✅ | ✅ | — | items, staff, sku |
| medium | `/api/warranty/lookup` | GET | ✅ | ✅ | — | sku |
| medium | `/api/warranty/quotes/[id]` | PATCH | ✅ | ✅ | — | repair_service |
| medium | `/api/warranty/reports/export` | GET | ✅ | ✅ | — | reason_codes, sku |
| medium | `/api/work-orders` | GET/PATCH | ✅ | ✅ | — | shipping_tracking_numbers, station_activity_logs, order_shipment_links, work_assignments, receiving_lines, repair_service +6 |
| medium | `/api/zendesk/tickets` | GET/POST | ✅ | ✅ | — | ticket_links, photos |
| medium | `/api/zendesk/tickets/[id]/photos` | GET | ✅ | ✅ | — | unfound_overlay, ticket_links, photos |
| medium | `/api/zoho/find-po` | POST | ✅ | ✅ | — | receiving |
| medium | `/api/zoho/items/sync` | POST/GET | ✅ | ✅ | — | items |
| medium | `/api/zoho/orders/ingest` | POST | ✅ | ✅ | — | order_ingest_queue, orders |
| medium | `/api/zoho/purchase-orders` | GET | ✅ | ✅ | — | receiving, orders, items, sku |
| medium | `/api/zoho/purchase-orders/receive` | POST | ✅ | ✅ | — | work_assignments, receiving_lines, receiving, orders, items, sku |
| medium | `/api/zoho/purchase-receives` | GET | ✅ | ✅ | — | receiving |
| medium | `/api/zoho/warehouses` | GET | ✅ | ✅ | — | warehouses |
| low | `/api/activity/feed` | GET | ✅ | ✅ | ✅ | station_activity_logs, sku_stock_ledger, staff, sku |
| low | `/api/admin/audit` | GET | ✅ | ✅ | ✅ | auth_audit, staff |
| low | `/api/admin/fba-fnskus` | GET/POST | ✅ | ✅ | ✅ | fba_fnskus, sku |
| low | `/api/admin/fba-fnskus/[fnsku]` | GET/PATCH/DELETE | — | ✅ | ✅ | fba_shipment_items, fba_fnsku_logs, fba_fnskus, sku |
| low | `/api/admin/fba-fnskus/upload` | POST | ✅ | ✅ | ✅ | fba_fnskus, sku |
| low | `/api/admin/features` | GET/POST | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/features/[id]` | GET/PATCH/DELETE | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/fix-status` | POST | ✅ | ✅ | ✅ | orders |
| low | `/api/admin/logs` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, station_activity_logs, tech_serial_numbers, packer_logs, audit_logs, staff |
| low | `/api/admin/org/export` | POST | ✅ | ✅ | ✅ | staff_sessions, staff |
| low | `/api/admin/po-gmail/missing-orders` | GET/PATCH | ✅ | ✅ | ✅ | email_missing_purchase_orders, orders, items |
| low | `/api/admin/po-gmail/triage` | GET | ✅ | ✅ | ✅ | email_missing_purchase_orders, orders, items |
| low | `/api/admin/po-gmail/triage/[id]` | PATCH | — | ✅ | ✅ | email_missing_purchase_orders |
| low | `/api/admin/po-mirror/health` | GET | ✅ | ✅ | ✅ | email_missing_purchase_orders, receiving_lines, zoho_po_mirror, sync_cursors |
| low | `/api/admin/roles` | GET/POST | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/roles/[id]` | GET/PATCH/DELETE | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/roles/[id]/mobile-defaults` | PATCH | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/sessions` | GET | ✅ | ✅ | ✅ | staff_sessions, staff |
| low | `/api/admin/staff` | GET/POST | ✅ | ✅ | ✅ | staff_passkeys, staff |
| low | `/api/admin/staff/[id]` | PATCH/DELETE | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/staff/[id]/detail` | GET | ✅ | ✅ | ✅ | staff_passkeys, staff_sessions, auth_audit, staff |
| low | `/api/admin/staff/[id]/mobile-display-config` | PATCH | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/staff/[id]/passkeys` | GET | ✅ | ✅ | ✅ | staff_passkeys, staff |
| low | `/api/admin/staff/[id]/passkeys/[pid]` | DELETE | ✅ | ✅ | ✅ | staff_passkeys, staff |
| low | `/api/admin/staff/[id]/permissions` | PATCH | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/staff/[id]/reset-pin` | POST | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/staff/[id]/roles` | GET/PUT | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/staff/[id]/sessions` | GET/DELETE | ✅ | ✅ | ✅ | staff_sessions, staff |
| low | `/api/admin/staff/[id]/set-pin` | POST | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/staff/[id]/stations` | GET/PUT | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/staff/deactivate` | POST | ✅ | ✅ | ✅ | staff_sessions, staff |
| low | `/api/admin/staff/invite` | POST | ✅ | ✅ | ✅ | staff_enrollments, staff |
| low | `/api/admin/staff/reorder` | PATCH | ✅ | ✅ | ✅ | staff |
| low | `/api/ai/chat-sessions/[sessionId]/messages` | GET | — | ✅ | ✅ | ai_chat_messages, messages |
| low | `/api/amazon/accounts` | GET/DELETE | ✅ | ✅ | ✅ | amazon_accounts |
| low | `/api/amazon/connect` | POST | ✅ | ✅ | ✅ | amazon_accounts |
| low | `/api/amazon/oauth/callback` | GET | — | ✅ | ✅ | amazon_accounts |
| low | `/api/assignments/next` | GET | ✅ | ✅ | ✅ | work_assignments |
| low | `/api/audit-log/report` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, replenishment_requests, station_activity_logs, tech_serial_numbers, inventory_events, receiving_lines +5 |
| low | `/api/audit-log/staff-directory` | GET | ✅ | ✅ | ✅ | station_activity_logs, audit_logs, staff |
| low | `/api/check-tracking` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, work_assignments, packer_logs, orders |
| low | `/api/customers/[id]` | GET | ✅ | ✅ | ✅ | customers, orders |
| low | `/api/cycle-counts/campaigns` | GET/POST | ✅ | ✅ | ✅ | cycle_count_campaigns, cycle_count_lines, bin_contents, locations, staff, sku |
| low | `/api/cycle-counts/campaigns/[id]` | GET/PATCH | — | ✅ | ✅ | cycle_count_campaigns, cycle_count_lines, locations, sku_stock, sku |
| low | `/api/cycle-counts/lines/[id]` | PATCH | — | ✅ | ✅ | cycle_count_campaigns, cycle_count_lines, bin_contents, sku_stock, sku |
| low | `/api/dashboard/fba-shipments` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, fba_shipment_items, fba_shipments, receiving, staff |
| low | `/api/dashboard/operations` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, station_activity_logs, work_assignments, repair_service, orders, staff |
| low | `/api/debug-tracking` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, work_assignments, packer_logs, orders |
| low | `/api/ebay/accounts` | GET/PUT/DELETE | ✅ | ✅ | ✅ | ebay_accounts |
| low | `/api/ebay/callback` | GET | — | ✅ | ✅ | ebay_accounts |
| low | `/api/ebay/refresh-token` | POST | ✅ | ✅ | ✅ | ebay_accounts |
| low | `/api/ebay/search` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, work_assignments, orders, sku |
| low | `/api/ecwid/recent-repair-orders` | GET | ✅ | ✅ | ✅ | sku_platform_ids, sku_catalog, receiving, orders, items, sku |
| low | `/api/fba/board` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, fba_fnskus, sku |
| low | `/api/fba/board/[fnsku]/entries` | GET | — | ✅ | ✅ | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, fba_fnskus, sku |
| low | `/api/fba/fnskus` | POST | ✅ | ✅ | ✅ | fba_fnskus, sku |
| low | `/api/fba/fnskus/[fnsku]` | PATCH/GET | — | ✅ | ✅ | fba_fnskus, sku |
| low | `/api/fba/fnskus/bulk` | POST | ✅ | ✅ | ✅ | fba_fnskus, sku |
| low | `/api/fba/fnskus/search` | GET | ✅ | ✅ | ✅ | fba_fnskus, items, sku |
| low | `/api/fba/fnskus/validate` | GET | ✅ | ✅ | ✅ | fba_fnskus, sku |
| low | `/api/fba/items/[id]/link-unit` | POST | ✅ | ✅ | ✅ | fba_shipment_item_units, fba_shipment_items, inventory_events, serial_units, fba_fnskus, items +1 |
| low | `/api/fba/items/queue` | GET | ✅ | ✅ | ✅ | fba_shipment_items, fba_shipments, fba_fnskus, items, staff, sku |
| low | `/api/fba/items/ready` | POST | ✅ | ✅ | ✅ | fba_shipment_items, fba_fnsku_logs, fba_shipments, items, staff |
| low | `/api/fba/items/scan` | POST | ✅ | ✅ | ✅ | fba_shipment_items, fba_fnsku_logs, fba_shipments, items, staff, sku |
| low | `/api/fba/items/verify` | POST | ✅ | ✅ | ✅ | fba_shipment_items, fba_fnsku_logs, items, staff |
| low | `/api/fba/labels/bind` | POST | ✅ | ✅ | ✅ | fba_shipment_items, fba_fnsku_logs, fba_shipments, items, staff |
| low | `/api/fba/logs` | GET/POST | ✅ | ✅ | ✅ | fba_fnsku_logs, fba_shipments, fba_fnskus, staff, sku |
| low | `/api/fba/logs/[id]` | GET/DELETE | — | ✅ | ✅ | fba_fnsku_logs, fba_shipments, fba_fnskus, staff, sku |
| low | `/api/fba/logs/summary` | GET | ✅ | ✅ | ✅ | tech_serial_numbers, fba_shipment_items, fba_fnsku_logs, fba_shipments, fba_fnskus, sku |
| low | `/api/fba/print-queue` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, fba_fnskus, items +1 |
| low | `/api/fba/shipments` | GET/POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, work_assignments, fba_shipments, items +2 |
| low | `/api/fba/shipments/[id]` | GET/PATCH/DELETE | — | ✅ | ✅ | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, items, staff |
| low | `/api/fba/shipments/[id]/items` | GET/POST | — | ✅ | ✅ | fba_shipment_items, fba_shipments, fba_fnskus, items, staff, sku |
| low | `/api/fba/shipments/[id]/items/[itemId]` | GET/PATCH/DELETE | — | ✅ | ✅ | fba_tracking_item_allocations, fba_shipment_items, fba_fnsku_logs, fba_shipments, items, staff +1 |
| low | `/api/fba/shipments/[id]/items/[itemId]/reassign` | PATCH | — | ✅ | ✅ | fba_shipment_items, fba_shipments, items |
| low | `/api/fba/shipments/[id]/ship-units` | POST | ✅ | ✅ | ✅ | fba_shipment_item_units, fba_shipment_items, inventory_events, sku_stock_ledger, serial_units, fba_fnskus +1 |
| low | `/api/fba/shipments/[id]/tracking` | GET/POST/PATCH/DELETE | — | ✅ | ✅ | fba_tracking_item_allocations, shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items |
| low | `/api/fba/shipments/active-with-details` | GET | ✅ | ✅ | ✅ | fba_tracking_item_allocations, shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, fba_fnskus +3 |
| low | `/api/fba/shipments/close` | POST | ✅ | ✅ | ✅ | fba_shipment_items, fba_fnsku_logs, fba_shipments, items, staff |
| low | `/api/fba/shipments/mark-shipped` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, items |
| low | `/api/fba/shipments/split-for-paired-review` | POST | ✅ | ✅ | ✅ | fba_tracking_item_allocations, shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments |
| low | `/api/fba/shipments/today` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, fba_shipments, fba_fnskus, items +2 |
| low | `/api/fba/shipments/today/duplicate-yesterday` | POST | ✅ | ✅ | ✅ | fba_shipment_items, work_assignments, fba_shipments, items, sku |
| low | `/api/fba/shipments/today/items` | POST | ✅ | ✅ | ✅ | fba_shipment_items, work_assignments, fba_shipments, fba_fnskus, items, sku |
| low | `/api/fba/stage-counts` | GET | ✅ | ✅ | ✅ | fba_shipment_items |
| low | `/api/get-title-by-sku` | GET | ✅ | ✅ | ✅ | sku_platform_ids, sku_catalog, sku_stock, items, sku |
| low | `/api/global-search` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, repair_service, fba_shipments, receiving, orders, staff +1 |
| low | `/api/google-sheets/execute-script` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, orders_exceptions, packer_logs, fba_fnskus, orders |
| low | `/api/google-sheets/sync-shipstation-orders` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, orders_exceptions, work_assignments, orders, shifts |
| low | `/api/handling-units/[id]` | GET/DELETE | ✅ | ✅ | ✅ | handling_units |
| low | `/api/inbox/tech-queue` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving_lines, receiving, items, staff |
| low | `/api/inventory-events` | GET | ✅ | ✅ | ✅ | serial_units, sku_catalog, locations, sku_stock, staff, sku |
| low | `/api/inventory-photos` | POST | ✅ | ✅ | ✅ | inventory_events, photos, sku |
| low | `/api/inventory/alerts` | GET | ✅ | ✅ | ✅ | stock_alerts, locations, sku_stock, items, sku |
| low | `/api/inventory/alerts/[id]/ack` | POST | ✅ | ✅ | ✅ | stock_alerts, sku |
| low | `/api/inventory/counts` | GET | ✅ | ✅ | ✅ | cycle_count_campaigns, cycle_count_lines, items |
| low | `/api/inventory/sku-search` | GET | ✅ | ✅ | ✅ | bin_contents, sku_stock, sku |
| low | `/api/inventory/units` | GET | ✅ | ✅ | ✅ | serial_units, sku_catalog, sku_stock, items, sku |
| low | `/api/labels/recent` | GET | ✅ | ✅ | ✅ | station_activity_logs, tech_serial_numbers, serial_units, sku_catalog, items, staff +1 |
| low | `/api/local-pickup-orders` | GET/POST | ✅ | ✅ | ✅ | local_pickup_order_items, local_pickup_orders, orders, items, staff, sku |
| low | `/api/local-pickup-orders/[id]` | GET/PATCH/DELETE | — | ✅ | ✅ | local_pickup_order_items, local_pickup_orders, sku_catalog, orders, items, staff +1 |
| low | `/api/local-pickup-orders/[id]/complete` | POST | — | ✅ | ✅ | local_pickup_orders, orders |
| low | `/api/local-pickup-orders/[id]/finalize` | POST | — | ✅ | ✅ | local_pickup_order_items, local_pickup_orders, receiving, orders, items, sku |
| low | `/api/local-pickup-orders/[id]/items` | POST | — | ✅ | ✅ | local_pickup_order_items, local_pickup_orders, orders, items, sku |
| low | `/api/local-pickup-orders/[id]/items/[itemId]` | PATCH/DELETE | — | ✅ | ✅ | local_pickup_order_items, local_pickup_orders, orders, items, sku |
| low | `/api/local-pickup-orders/[id]/reopen` | POST | — | ✅ | ✅ | local_pickup_orders, orders |
| low | `/api/local-pickup-orders/[id]/void` | POST | — | ✅ | ✅ | local_pickup_orders, orders |
| low | `/api/local-pickups` | GET/POST/PATCH/DELETE | ✅ | ✅ | ✅ | local_pickup_items, sku_platform_ids, work_assignments, sku_catalog, receiving, sku |
| low | `/api/locations/[barcode]/swap` | POST | — | ✅ | ✅ | inventory_events, sku_stock_ledger, bin_contents, locations, sku_stock, sku |
| low | `/api/manuals/recent` | GET | — | ✅ | ✅ | sku_platform_ids, product_manuals, sku_catalog, sku |
| low | `/api/manuals/resolve` | GET | ✅ | ✅ | ✅ | sku_platform_ids, product_manuals, sku_catalog, sku_stock, sku |
| low | `/api/manuals/upsert` | POST | ✅ | ✅ | ✅ | sku_platform_ids, product_manuals, sku_catalog, sku_stock, sku |
| low | `/api/operations/kpi-table` | GET | — | ✅ | ✅ | operations_kpi_rollups_hourly, operations_kpi_rollups_daily, station_activity_logs, audit_logs, staff |
| low | `/api/orders-exceptions/delete` | POST | ✅ | ✅ | ✅ | orders_exceptions, orders |
| low | `/api/orders-exceptions/sync` | POST | ✅ | ✅ | ✅ | orders_exceptions, packer_logs, receiving, orders, staff |
| low | `/api/orders/[id]/pick-tasks` | GET | ✅ | ✅ | ✅ | orders, sku |
| low | `/api/orders/[id]/release` | POST | ✅ | ✅ | ✅ | order_unit_allocations, inventory_events, serial_units, orders, sku |
| low | `/api/orders/backfill/ebay` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, ebay_accounts, orders, sku |
| low | `/api/orders/backfill/ecwid` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, orders, items, sku |
| low | `/api/orders/batch` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, packer_logs, orders, staff, sku |
| low | `/api/orders/integrity-check` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, orders, sku |
| low | `/api/orders/lookup/[orderId]` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, work_assignments, customers, receiving, sku_stock +3 |
| low | `/api/orders/next` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, station_activity_logs, work_assignments, orders, staff, sku |
| low | `/api/orders/recent` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, work_assignments, product_manuals, sku_catalog, orders, sku |
| low | `/api/orders/verify` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, packer_logs, orders |
| low | `/api/packing-logs/history` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, packer_logs, orders, photos, staff, sku |
| low | `/api/packing-logs/save-photo` | POST | ✅ | ✅ | ✅ | photos |
| low | `/api/payroll/settings` | GET/PATCH | ✅ | ✅ | ✅ | payroll_settings |
| low | `/api/photos/[id]` | DELETE | — | ✅ | ✅ | receiving, sku_stock, photos |
| low | `/api/pick/queue` | GET | ✅ | ✅ | ✅ | order_unit_allocations, picking_sessions, work_assignments, customers, orders |
| low | `/api/pick/scan` | POST | ✅ | ✅ | ✅ | order_unit_allocations, inventory_events, serial_units, orders, sku |
| low | `/api/pick/unscan` | POST | ✅ | ✅ | ✅ | order_unit_allocations, serial_units, orders |
| low | `/api/print/dispatch` | POST | ✅ | ✅ | ✅ | printer_profiles, orders, sku |
| low | `/api/product-manuals/bulk` | POST | ✅ | ✅ | ✅ | product_manuals, sku_catalog |
| low | `/api/product-manuals/by-category` | GET | ✅ | ✅ | ✅ | product_manuals, sku_catalog, sku_stock, sku |
| low | `/api/product-manuals/rename-folder` | POST | ✅ | ✅ | ✅ | product_manuals, sku_catalog |
| low | `/api/product-manuals/search` | GET | — | ✅ | ✅ | product_manuals, sku_catalog, sku |
| low | `/api/products/[sku]` | GET | — | ✅ | ✅ | sku_platform_ids, bin_contents, serial_units, sku_catalog, platforms, sku_stock +1 |
| low | `/api/quality/dashboard` | GET | ✅ | ✅ | ✅ | unit_quality_scores, unit_failure_tags, failure_modes, serial_units, unit_repairs, sku_stock +1 |
| low | `/api/rag/documents` | POST | ✅ | ✅ | ✅ | rag_document_chunks, rag_documents, documents |
| low | `/api/rag/search` | POST | ✅ | ✅ | ✅ | rag_document_chunks |
| low | `/api/reason-codes` | GET/POST | ✅ | ✅ | ✅ | reason_codes, sku_stock |
| low | `/api/receiving-lines` | GET/POST/PATCH/DELETE | ✅ | ✅ | ✅ | fba_tracking_item_allocations, shipping_tracking_numbers, local_pickup_order_items, shipment_tracking_events, email_delivery_signals, station_scan_sessions +12 |
| low | `/api/receiving-lines/[id]/manuals` | POST/DELETE | ✅ | ✅ | ✅ | product_manuals, sku_catalog, receiving |
| low | `/api/receiving-lines/[id]/qc-checks` | POST/PUT/DELETE | ✅ | ✅ | ✅ | qc_check_templates, sku_catalog, receiving, sku_stock, sku |
| low | `/api/receiving-lines/[id]/testing-bundle` | GET | ✅ | ✅ | ✅ | product_manuals, sku_catalog, receiving, sku |
| low | `/api/receiving-lines/incoming/delivered-unscanned` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving_lines, receiving_scans, zoho_po_mirror, receiving, items +1 |
| low | `/api/receiving-lines/incoming/details` | GET | ✅ | ✅ | ✅ | email_missing_purchase_orders, shipping_tracking_numbers, shipment_tracking_events, email_delivery_signals, inventory_events, receiving_lines +6 |
| low | `/api/receiving-lines/incoming/refresh/stream` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving_lines, zoho_po_mirror, receiving, packages, orders +1 |
| low | `/api/receiving-lines/incoming/summary` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving_lines, receiving_scans, zoho_po_mirror, receiving, packages +1 |
| low | `/api/receiving-lines/incoming/sync-one` | POST | ✅ | ✅ | ✅ | receiving |
| low | `/api/receiving-logs/search` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving |
| low | `/api/receiving/lines/[id]/move` | POST | — | ✅ | ✅ | inventory_events, receiving_lines, serial_units, locations, receiving, sku |
| low | `/api/receiving/lines/[id]/putaway/reverse` | POST | — | ✅ | ✅ | inventory_events, serial_units, receiving, sku |
| low | `/api/receiving/lines/[id]/timeline` | GET | — | ✅ | ✅ | inventory_events, serial_units, locations, receiving, staff, sku |
| low | `/api/receiving/match` | POST/GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, work_assignments, receiving_lines, receiving, staff, sku |
| low | `/api/receiving/pending-unboxing` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving_lines, receiving, staff, sku |
| low | `/api/receiving/po/[poId]` | GET | ✅ | ✅ | ✅ | receiving_lines, sku_catalog, receiving, photos, items, sku |
| low | `/api/receiving/po/list` | GET | ✅ | ✅ | ✅ | receiving_lines, receiving, photos, items, sku |
| low | `/api/repair-service/document/[id]` | GET | — | ✅ | ✅ | repair_service, documents |
| low | `/api/repair-service/next` | GET | ✅ | ✅ | ✅ | work_assignments, repair_service, staff, sku |
| low | `/api/repair-service/out-of-stock` | POST | ✅ | ✅ | ✅ | work_assignments, repair_service |
| low | `/api/replenish/shipped-fifo` | GET | ✅ | ✅ | ✅ | replenishment_requests, station_activity_logs, item_stock_cache, sku_stock, orders, items +1 |
| low | `/api/reports/dead-stock` | GET | ✅ | ✅ | ✅ | sku_platform_ids, sku_stock_ledger, sku_catalog, sku_stock, sku |
| low | `/api/reports/velocity` | GET | ✅ | ✅ | ✅ | sku_platform_ids, sku_stock_ledger, sku_catalog, sku_stock, sku |
| low | `/api/returns/undo` | POST | ✅ | ✅ | ✅ | order_unit_allocations, inventory_events, sku_stock_ledger, serial_units, receiving, sku_stock +1 |
| low | `/api/rooms` | GET/POST | ✅ | ✅ | ✅ | locations, sku_stock |
| low | `/api/scan/history` | GET | ✅ | ✅ | ✅ | mobile_scan_events, receiving, sku_stock, staff |
| low | `/api/serial-units/[id]` | GET | — | ✅ | ✅ | serial_unit_condition_history, order_unit_allocations, station_activity_logs, tech_serial_numbers, inventory_events, serial_units +6 |
| low | `/api/serial-units/[id]/allocate` | POST | ✅ | ✅ | ✅ | order_unit_allocations, inventory_events, serial_units, orders, sku |
| low | `/api/serial-units/[id]/checklist` | GET/POST | ✅ | ✅ | ✅ | qc_check_templates, tech_verifications, testing_results, serial_units, sku_catalog, staff +1 |
| low | `/api/serial-units/[id]/checklist/bulk` | POST | ✅ | ✅ | ✅ | qc_check_templates, tech_verifications, serial_units, sku_catalog, staff |
| low | `/api/serial-units/[id]/failure-tags` | GET/POST/PATCH | ✅ | ✅ | ✅ | unit_failure_tags, serial_units, sku_stock |
| low | `/api/serial-units/[id]/grade` | POST | ✅ | ✅ | ✅ | serial_unit_condition_history, inventory_events, serial_units, types, sku |
| low | `/api/serial-units/[id]/hold` | POST | ✅ | ✅ | ✅ | inventory_events, serial_units, sku_stock |
| low | `/api/serial-units/[id]/move` | POST | ✅ | ✅ | ✅ | inventory_events, sku_stock_ledger, bin_contents, serial_units, locations, sku |
| low | `/api/serial-units/[id]/quality` | GET | ✅ | ✅ | ✅ | serial_units, sku_stock |
| low | `/api/serial-units/[id]/release` | POST | ✅ | ✅ | ✅ | serial_units, sku_stock |
| low | `/api/shifts` | GET | ✅ | ✅ | ✅ | shifts, staff |
| low | `/api/shifts/[id]/cover` | POST | — | ✅ | ✅ | staff_sessions, shifts, staff |
| low | `/api/shipped/debug` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, packer_logs, orders |
| low | `/api/shipped/lookup-order` | GET | — | ✅ | ✅ | shipping_tracking_numbers, orders |
| low | `/api/shipped/submit` | POST | ✅ | ✅ | ✅ | sku_catalog, orders, sku |
| low | `/api/sku` | GET | ✅ | ✅ | ✅ | sku_platform_ids, serial_units, sku_catalog, sku_stock, sku |
| low | `/api/sku-catalog/[id]` | GET/PATCH/DELETE | — | ✅ | ✅ | bin_contents, sku_stock, sku |
| low | `/api/sku-catalog/[id]/manuals` | POST/PUT/DELETE | — | ✅ | ✅ | product_manuals, sku_catalog, sku_stock, sku |
| low | `/api/sku-catalog/[id]/qc-checks` | GET/POST/PUT/DELETE | ✅ | ✅ | ✅ | qc_check_templates, sku_stock, sku |
| low | `/api/sku-catalog/[id]/similar` | GET | — | ✅ | ✅ | sku_catalog, sku_stock, items, sku |
| low | `/api/sku-catalog/graph/relationships/[id]` | PATCH/DELETE | — | ✅ | ✅ | sku_relationships, sku_stock, sku |
| low | `/api/sku-catalog/pair` | POST/DELETE | ✅ | ✅ | ✅ | sku_platform_ids, sku_catalog, sku_stock, sku |
| low | `/api/sku-catalog/pair-suggestions` | GET | ✅ | ✅ | ✅ | sku_platform_ids, sku_catalog, sku_stock, items, sku |
| low | `/api/sku-catalog/pairing-queue` | GET | ✅ | ✅ | ✅ | sku_pairing_suggestions, sku_platform_ids, sku_catalog, platforms, sku_stock, orders +2 |
| low | `/api/sku-catalog/pairing-queue/count` | GET | ✅ | ✅ | ✅ | sku_pairing_suggestions, sku_catalog, sku_stock, sku |
| low | `/api/sku-catalog/resolve` | GET | ✅ | ✅ | ✅ | sku_platform_ids, sku_catalog, platforms, orders, sku |
| low | `/api/sku-catalog/run-migration` | POST | ✅ | ✅ | ✅ | sku_platform_ids, sku_catalog, sku |
| low | `/api/sku-catalog/search` | GET | ✅ | ✅ | ✅ | qc_check_templates, sku_platform_ids, sku_catalog, sku_stock, items, sku |
| low | `/api/sku-catalog/search-unmatched` | GET | ✅ | ✅ | ✅ | sku_platform_ids, sku_catalog, sku_stock, orders, sku |
| low | `/api/sku-catalog/suggest-for-item` | GET | ✅ | ✅ | ✅ | sku_pairing_suggestions, sku_catalog, sku_stock, sku |
| low | `/api/sku-catalog/sync-ecwid-products` | POST | ✅ | ✅ | ✅ | sku_platform_ids, items, sku |
| low | `/api/sku-catalog/sync-ecwid-titles` | POST | ✅ | ✅ | ✅ | sku_catalog, items, sku |
| low | `/api/sku-catalog/unpaired` | GET | ✅ | ✅ | ✅ | sku_stock, orders, items, sku |
| low | `/api/sku-manager` | GET | ✅ | ✅ | ✅ | sku_management, sku_stock |
| low | `/api/sku-stock` | GET | ✅ | ✅ | ✅ | sku_platform_ids, sku_catalog, sku_stock, sku |
| low | `/api/sku-stock/[sku]/bins` | GET | — | ✅ | ✅ | sku_platform_ids, sku_catalog, sku_stock, sku |
| low | `/api/sku/[id]/photos` | GET/POST | — | ✅ | ✅ | receiving, sku_stock, photos, sku |
| low | `/api/sku/by-tracking` | GET/DELETE | ✅ | ✅ | ✅ | serial_units, sku_stock, photos, sku |
| low | `/api/sku/lookup` | GET | ✅ | ✅ | ✅ | serial_units, sku_stock, sku |
| low | `/api/sku/serials-from-code` | GET | ✅ | ✅ | ✅ | serial_units, sku_stock, sku |
| low | `/api/staff-goals` | GET/PUT | ✅ | ✅ | ✅ | station_activity_logs, staff_goals, staff |
| low | `/api/staff-goals/history` | GET | ✅ | ✅ | ✅ | staff_goal_history, staff |
| low | `/api/staff/availability-rules` | GET/POST/PUT/DELETE | ✅ | ✅ | ✅ | staff_availability_rules, staff |
| low | `/api/staff/availability-today` | GET | ✅ | ✅ | ✅ | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| low | `/api/stations/publish` | POST | ✅ | ✅ | ✅ | workflow_definitions, station_definitions, staff |
| low | `/api/stock-alerts` | GET | ✅ | ✅ | ✅ | bin_contents, stock_alerts, locations, sku_stock, sku |
| low | `/api/studio/definitions/[id]/discard` | DELETE | ✅ | ✅ | ✅ | workflow_definitions, item_workflow_state, workflow_edges, workflow_nodes, items |
| low | `/api/studio/definitions/[id]/graph` | PUT | ✅ | ✅ | ✅ | workflow_definitions, workflow_edges, workflow_nodes, types |
| low | `/api/studio/definitions/[id]/publish` | POST | ✅ | ✅ | ✅ | workflow_definitions, station_definitions, workflow_edges, workflow_nodes, items |
| low | `/api/studio/definitions/draft` | POST | ✅ | ✅ | ✅ | workflow_definitions, workflow_edges, workflow_nodes |
| low | `/api/tech-logs/search` | GET | ✅ | ✅ | ✅ | orders, sku |
| low | `/api/tech/add-serial` | POST | ✅ | ✅ | ✅ | station_activity_logs |
| low | `/api/tech/add-serial-to-last` | POST | ✅ | ✅ | ✅ | station_activity_logs |
| low | `/api/tech/delete-tracking` | POST | ✅ | ✅ | ✅ | station_activity_logs, tech_serial_numbers, fba_fnsku_logs |
| low | `/api/tech/logs` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, station_activity_logs, order_shipment_links, tech_serial_numbers, work_assignments, fba_fnsku_logs +4 |
| low | `/api/tech/orders-without-manual` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, work_assignments, product_manuals, sku_catalog, fba_fnskus +2 |
| low | `/api/tech/scan` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, fba_shipment_items, orders_exceptions, work_assignments, fba_fnsku_logs +6 |
| low | `/api/tech/test-result` | POST | ✅ | ✅ | ✅ | serial_unit_condition_history, serial_units, sku |
| low | `/api/tech/undo-last` | POST | ✅ | ✅ | ✅ | station_activity_logs |
| low | `/api/tech/update-serials` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, station_activity_logs, fba_fnsku_logs |
| low | `/api/testing/recent` | GET | ✅ | ✅ | ✅ | testing_results, serial_units, staff, sku |
| low | `/api/tracking-exceptions` | GET | ✅ | ✅ | ✅ | tracking_exceptions, receiving, orders, staff |
| low | `/api/tracking-exceptions/[id]` | GET/PATCH/DELETE | — | ✅ | ✅ | tracking_exceptions, receiving, staff |
| low | `/api/transfers` | POST | ✅ | ✅ | ✅ | inventory_events, bin_contents, locations, sku |
| low | `/api/update-sku-location` | POST | ✅ | ✅ | ✅ | location_transfers, sku_stock, sku |
| low | `/api/warehouses` | GET | ✅ | ✅ | ✅ | warehouses, sku_stock |
| low | `/api/warranty/claims/[id]/restore` | POST | ✅ | ✅ | ✅ | warranty_claims |
| low | `/api/warranty/claims/bulk/restore` | POST | ✅ | ✅ | ✅ | warranty_claims |
| low | `/api/webhooks/zoho/orders` | POST/GET | — | — | ✅ | order_unit_allocations, orders, items, types, sku |
| low | `/api/workflow/flow-audit` | GET | ✅ | ✅ | ✅ | inventory_events, serial_units |
| low | `/api/zoho/fulfillment-sync` | POST | ✅ | ✅ | ✅ | zoho_fulfillment_sync, audit_logs, invoices, packages, orders |
| low | `/api/zoho/items/[id]/image` | GET | — | ✅ | ✅ | zoho_item_images, sku_stock, photos, items |

## Reverse index — routes per tenant table (the Phase E enforcement gate)

> A table may be `enforce_tenant_isolation()`-d only once **every** route below it is GUC-wrapped (low risk).

### `ai_chat_messages` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/ai/chat-sessions/[sessionId]/messages` (low)

### `amazon_accounts` — 4 routes, 1 not yet GUC-safe

- ✅ `/api/amazon/accounts` (low)
- ✅ `/api/amazon/connect` (low)
- ✅ `/api/amazon/oauth/callback` (low)
- ⛔ `/api/cron/amazon/orders-sync` (high)

### `api_idempotency_responses` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/cron/cleanup` (high)
- ⛔ `/api/receiving/add-unmatched-line` (medium)

### `audit_logs` — 13 routes, 9 not yet GUC-safe

- ✅ `/api/admin/logs` (low)
- ✅ `/api/audit-log/staff-directory` (low)
- ⛔ `/api/audit/bin/[id]` (medium)
- ⛔ `/api/audit/sku/[sku]` (medium)
- ✅ `/api/operations/kpi-table` (low)
- ⛔ `/api/order-labels` (medium)
- ⛔ `/api/orders/[id]/timeline` (medium)
- ⛔ `/api/orders/assign` (medium)
- ⛔ `/api/receiving/mark-received` (medium)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/shipped/scan-out` (medium)
- ✅ `/api/zoho/fulfillment-sync` (low)

### `auth_audit` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/admin/audit` (low)
- ✅ `/api/admin/staff/[id]/detail` (low)

### `bin_contents` — 11 routes, 2 not yet GUC-safe

- ⛔ `/api/cron/stock-alerts` (high)
- ✅ `/api/cycle-counts/campaigns` (low)
- ✅ `/api/cycle-counts/lines/[id]` (low)
- ✅ `/api/inventory/sku-search` (low)
- ✅ `/api/locations/[barcode]/swap` (low)
- ✅ `/api/products/[sku]` (low)
- ⛔ `/api/replenishment/tasks/[id]/complete` (medium)
- ✅ `/api/serial-units/[id]/move` (low)
- ✅ `/api/sku-catalog/[id]` (low)
- ✅ `/api/stock-alerts` (low)
- ✅ `/api/transfers` (low)

### `customers` — 7 routes, 4 not yet GUC-safe

- ✅ `/api/customers/[id]` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ✅ `/api/pick/queue` (low)
- ⛔ `/api/repair-service/[id]` (medium)
- ⛔ `/api/repair/customers` (medium)
- ⛔ `/api/walk-in/customers` (medium)
- ⛔ `/api/walk-in/status` (medium)

### `cycle_count_campaigns` — 4 routes, 0 not yet GUC-safe

- ✅ `/api/cycle-counts/campaigns` (low)
- ✅ `/api/cycle-counts/campaigns/[id]` (low)
- ✅ `/api/cycle-counts/lines/[id]` (low)
- ✅ `/api/inventory/counts` (low)

### `cycle_count_lines` — 4 routes, 0 not yet GUC-safe

- ✅ `/api/cycle-counts/campaigns` (low)
- ✅ `/api/cycle-counts/campaigns/[id]` (low)
- ✅ `/api/cycle-counts/lines/[id]` (low)
- ✅ `/api/inventory/counts` (low)

### `documents` — 6 routes, 4 not yet GUC-safe

- ⛔ `/api/order-labels` (medium)
- ✅ `/api/rag/documents` (low)
- ⛔ `/api/repair-service/[id]` (medium)
- ✅ `/api/repair-service/document/[id]` (low)
- ⛔ `/api/repair-service/pickup` (medium)
- ⛔ `/api/repair/submit` (medium)

### `ebay_accounts` — 4 routes, 0 not yet GUC-safe

- ✅ `/api/ebay/accounts` (low)
- ✅ `/api/ebay/callback` (low)
- ✅ `/api/ebay/refresh-token` (low)
- ✅ `/api/orders/backfill/ebay` (low)

### `ebay_api_calls` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/sourcing/search` (medium)

### `email_delivery_signals` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)

### `email_missing_purchase_orders` — 11 routes, 6 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/create-zoho-draft/[id]` (medium)
- ✅ `/api/admin/po-gmail/missing-orders` (low)
- ⛔ `/api/admin/po-gmail/reconcile` (medium)
- ✅ `/api/admin/po-gmail/triage` (low)
- ✅ `/api/admin/po-gmail/triage/[id]` (low)
- ⛔ `/api/admin/po-gmail/triage/[id]/detail` (medium)
- ⛔ `/api/admin/po-gmail/triage/[id]/extract` (medium)
- ✅ `/api/admin/po-mirror/health` (low)
- ⛔ `/api/cron/zoho/po-sync` (high)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]` (medium)

### `failure_modes` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/quality/dashboard` (low)

### `fba_fnsku_logs` — 15 routes, 1 not yet GUC-safe

- ✅ `/api/admin/fba-fnskus/[fnsku]` (low)
- ✅ `/api/fba/items/ready` (low)
- ✅ `/api/fba/items/scan` (low)
- ✅ `/api/fba/items/verify` (low)
- ✅ `/api/fba/labels/bind` (low)
- ✅ `/api/fba/logs` (low)
- ✅ `/api/fba/logs/[id]` (low)
- ✅ `/api/fba/logs/summary` (low)
- ✅ `/api/fba/shipments/[id]/items/[itemId]` (low)
- ✅ `/api/fba/shipments/close` (low)
- ⛔ `/api/tech/delete` (medium)
- ✅ `/api/tech/delete-tracking` (low)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/scan` (low)
- ✅ `/api/tech/update-serials` (low)

### `fba_fnskus` — 27 routes, 2 not yet GUC-safe

- ✅ `/api/admin/fba-fnskus` (low)
- ✅ `/api/admin/fba-fnskus/[fnsku]` (low)
- ✅ `/api/admin/fba-fnskus/upload` (low)
- ✅ `/api/fba/board` (low)
- ✅ `/api/fba/board/[fnsku]/entries` (low)
- ✅ `/api/fba/fnskus` (low)
- ✅ `/api/fba/fnskus/[fnsku]` (low)
- ✅ `/api/fba/fnskus/bulk` (low)
- ✅ `/api/fba/fnskus/search` (low)
- ✅ `/api/fba/fnskus/validate` (low)
- ✅ `/api/fba/items/[id]/link-unit` (low)
- ✅ `/api/fba/items/queue` (low)
- ✅ `/api/fba/logs` (low)
- ✅ `/api/fba/logs/[id]` (low)
- ✅ `/api/fba/logs/summary` (low)
- ✅ `/api/fba/print-queue` (low)
- ✅ `/api/fba/shipments/[id]/items` (low)
- ✅ `/api/fba/shipments/[id]/ship-units` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/today` (low)
- ✅ `/api/fba/shipments/today/items` (low)
- ✅ `/api/google-sheets/execute-script` (low)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/sync-sheets` (medium)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/orders-without-manual` (low)
- ✅ `/api/tech/scan` (low)

### `fba_shipment_item_units` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/fba/items/[id]/link-unit` (low)
- ✅ `/api/fba/shipments/[id]/ship-units` (low)

### `fba_shipment_items` — 29 routes, 1 not yet GUC-safe

- ✅ `/api/admin/fba-fnskus/[fnsku]` (low)
- ✅ `/api/dashboard/fba-shipments` (low)
- ✅ `/api/fba/board` (low)
- ✅ `/api/fba/board/[fnsku]/entries` (low)
- ✅ `/api/fba/items/[id]/link-unit` (low)
- ✅ `/api/fba/items/queue` (low)
- ✅ `/api/fba/items/ready` (low)
- ✅ `/api/fba/items/scan` (low)
- ✅ `/api/fba/items/verify` (low)
- ✅ `/api/fba/labels/bind` (low)
- ✅ `/api/fba/logs/summary` (low)
- ✅ `/api/fba/print-queue` (low)
- ✅ `/api/fba/shipments` (low)
- ✅ `/api/fba/shipments/[id]` (low)
- ✅ `/api/fba/shipments/[id]/items` (low)
- ✅ `/api/fba/shipments/[id]/items/[itemId]` (low)
- ✅ `/api/fba/shipments/[id]/items/[itemId]/reassign` (low)
- ✅ `/api/fba/shipments/[id]/ship-units` (low)
- ✅ `/api/fba/shipments/[id]/tracking` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/close` (low)
- ✅ `/api/fba/shipments/mark-shipped` (low)
- ✅ `/api/fba/shipments/split-for-paired-review` (low)
- ✅ `/api/fba/shipments/today` (low)
- ✅ `/api/fba/shipments/today/duplicate-yesterday` (low)
- ✅ `/api/fba/shipments/today/items` (low)
- ✅ `/api/fba/stage-counts` (low)
- ⛔ `/api/packing-logs` (medium)
- ✅ `/api/tech/scan` (low)

### `fba_shipment_tracking` — 11 routes, 1 not yet GUC-safe

- ✅ `/api/fba/board` (low)
- ✅ `/api/fba/board/[fnsku]/entries` (low)
- ✅ `/api/fba/print-queue` (low)
- ✅ `/api/fba/shipments` (low)
- ✅ `/api/fba/shipments/[id]` (low)
- ✅ `/api/fba/shipments/[id]/tracking` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/mark-shipped` (low)
- ✅ `/api/fba/shipments/split-for-paired-review` (low)
- ✅ `/api/fba/shipments/today` (low)
- ⛔ `/api/packing-logs` (medium)

### `fba_shipments` — 27 routes, 2 not yet GUC-safe

- ✅ `/api/dashboard/fba-shipments` (low)
- ✅ `/api/fba/board` (low)
- ✅ `/api/fba/board/[fnsku]/entries` (low)
- ✅ `/api/fba/items/queue` (low)
- ✅ `/api/fba/items/ready` (low)
- ✅ `/api/fba/items/scan` (low)
- ✅ `/api/fba/labels/bind` (low)
- ✅ `/api/fba/logs` (low)
- ✅ `/api/fba/logs/[id]` (low)
- ✅ `/api/fba/logs/summary` (low)
- ✅ `/api/fba/print-queue` (low)
- ✅ `/api/fba/shipments` (low)
- ✅ `/api/fba/shipments/[id]` (low)
- ✅ `/api/fba/shipments/[id]/items` (low)
- ✅ `/api/fba/shipments/[id]/items/[itemId]` (low)
- ✅ `/api/fba/shipments/[id]/items/[itemId]/reassign` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/close` (low)
- ✅ `/api/fba/shipments/mark-shipped` (low)
- ✅ `/api/fba/shipments/split-for-paired-review` (low)
- ✅ `/api/fba/shipments/today` (low)
- ✅ `/api/fba/shipments/today/duplicate-yesterday` (low)
- ✅ `/api/fba/shipments/today/items` (low)
- ✅ `/api/global-search` (low)
- ⛔ `/api/packing-logs` (medium)
- ✅ `/api/tech/scan` (low)
- ⛔ `/api/work-orders` (medium)

### `fba_tracking_item_allocations` — 5 routes, 0 not yet GUC-safe

- ✅ `/api/fba/shipments/[id]/items/[itemId]` (low)
- ✅ `/api/fba/shipments/[id]/tracking` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/split-for-paired-review` (low)
- ✅ `/api/receiving-lines` (low)

### `google_oauth_tokens` — 3 routes, 3 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/disconnect` (medium)
- ⛔ `/api/admin/po-gmail/oauth-callback` (medium)
- ⛔ `/api/admin/po-gmail/status` (medium)

### `handling_units` — 2 routes, 1 not yet GUC-safe

- ⛔ `/api/handling-units` (medium)
- ✅ `/api/handling-units/[id]` (low)

### `inventory_events` — 35 routes, 16 not yet GUC-safe

- ✅ `/api/audit-log/report` (low)
- ⛔ `/api/audit/bin/[id]` (medium)
- ⛔ `/api/audit/sku/[sku]` (medium)
- ✅ `/api/fba/items/[id]/link-unit` (low)
- ✅ `/api/fba/shipments/[id]/ship-units` (low)
- ✅ `/api/inventory-photos` (low)
- ✅ `/api/locations/[barcode]/swap` (low)
- ✅ `/api/orders/[id]/release` (low)
- ⛔ `/api/orders/[id]/timeline` (medium)
- ⛔ `/api/pack/ship` (medium)
- ✅ `/api/pick/scan` (low)
- ⛔ `/api/picking/session/[id]/short-pick` (medium)
- ⛔ `/api/post-multi-sn` (medium)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ⛔ `/api/receiving/[id]` (medium)
- ✅ `/api/receiving/lines/[id]/move` (low)
- ⛔ `/api/receiving/lines/[id]/putaway` (medium)
- ✅ `/api/receiving/lines/[id]/putaway/reverse` (low)
- ✅ `/api/receiving/lines/[id]/timeline` (low)
- ⛔ `/api/receiving/mark-received` (medium)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ⛔ `/api/replenishment/tasks/[id]/complete` (medium)
- ⛔ `/api/returns/intake` (medium)
- ✅ `/api/returns/undo` (low)
- ⛔ `/api/rma/[id]/disposition` (medium)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/allocate` (low)
- ✅ `/api/serial-units/[id]/grade` (low)
- ✅ `/api/serial-units/[id]/hold` (low)
- ✅ `/api/serial-units/[id]/move` (low)
- ⛔ `/api/serial-units/[id]/photos` (medium)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ✅ `/api/transfers` (low)
- ✅ `/api/workflow/flow-audit` (low)

### `invoices` — 2 routes, 1 not yet GUC-safe

- ⛔ `/api/billing/portal` (medium)
- ✅ `/api/zoho/fulfillment-sync` (low)

### `item_stock_cache` — 2 routes, 1 not yet GUC-safe

- ⛔ `/api/need-to-order` (medium)
- ✅ `/api/replenish/shipped-fifo` (low)

### `item_workflow_state` — 2 routes, 1 not yet GUC-safe

- ✅ `/api/studio/definitions/[id]/discard` (low)
- ⛔ `/api/studio/live` (medium)

### `items` — 92 routes, 40 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/create-zoho-draft/[id]` (medium)
- ✅ `/api/admin/po-gmail/missing-orders` (low)
- ⛔ `/api/admin/po-gmail/preview-unread` (medium)
- ✅ `/api/admin/po-gmail/triage` (low)
- ⛔ `/api/assignments/sku-search` (medium)
- ⛔ `/api/audit-log/packing` (medium)
- ⛔ `/api/audit-log/receiving` (medium)
- ⛔ `/api/audit-log/sku` (medium)
- ⛔ `/api/audit-log/tech` (medium)
- ⛔ `/api/billing/webhook` (medium)
- ⛔ `/api/bose-models` (critical)
- ⛔ `/api/catalog/workflow-nodes` (medium)
- ⛔ `/api/cron/zoho/incoming-po-sync` (high)
- ⛔ `/api/ecwid/products/search` (high)
- ✅ `/api/ecwid/recent-repair-orders` (low)
- ⛔ `/api/ecwid/sync-exception-tracking` (medium)
- ✅ `/api/fba/fnskus/search` (low)
- ✅ `/api/fba/items/[id]/link-unit` (low)
- ✅ `/api/fba/items/queue` (low)
- ✅ `/api/fba/items/ready` (low)
- ✅ `/api/fba/items/scan` (low)
- ✅ `/api/fba/items/verify` (low)
- ✅ `/api/fba/labels/bind` (low)
- ✅ `/api/fba/print-queue` (low)
- ✅ `/api/fba/shipments` (low)
- ✅ `/api/fba/shipments/[id]` (low)
- ✅ `/api/fba/shipments/[id]/items` (low)
- ✅ `/api/fba/shipments/[id]/items/[itemId]` (low)
- ✅ `/api/fba/shipments/[id]/items/[itemId]/reassign` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/close` (low)
- ✅ `/api/fba/shipments/mark-shipped` (low)
- ✅ `/api/fba/shipments/today` (low)
- ✅ `/api/fba/shipments/today/duplicate-yesterday` (low)
- ✅ `/api/fba/shipments/today/items` (low)
- ✅ `/api/get-title-by-sku` (low)
- ⛔ `/api/handling-units` (medium)
- ✅ `/api/inbox/tech-queue` (low)
- ✅ `/api/inventory/alerts` (low)
- ✅ `/api/inventory/counts` (low)
- ✅ `/api/inventory/units` (low)
- ✅ `/api/labels/recent` (low)
- ✅ `/api/local-pickup-orders` (low)
- ✅ `/api/local-pickup-orders/[id]` (low)
- ✅ `/api/local-pickup-orders/[id]/finalize` (low)
- ✅ `/api/local-pickup-orders/[id]/items` (low)
- ✅ `/api/local-pickup-orders/[id]/items/[itemId]` (low)
- ✅ `/api/orders/backfill/ecwid` (low)
- ⛔ `/api/part-compatibility` (medium)
- ⛔ `/api/product-manuals/sync` (medium)
- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/delivered-unscanned` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ⛔ `/api/receiving-lines/incoming/email-rescan` (medium)
- ⛔ `/api/receiving/add-unmatched-line` (medium)
- ⛔ `/api/receiving/identify-label` (medium)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/mark-received` (medium)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ✅ `/api/receiving/po/[poId]` (low)
- ✅ `/api/receiving/po/list` (low)
- ⛔ `/api/repair/ecwid-categories` (high)
- ⛔ `/api/repair/ecwid-products` (high)
- ✅ `/api/replenish/shipped-fifo` (low)
- ⛔ `/api/sku-catalog` (medium)
- ✅ `/api/sku-catalog/[id]/similar` (low)
- ✅ `/api/sku-catalog/pair-suggestions` (low)
- ✅ `/api/sku-catalog/pairing-queue` (low)
- ✅ `/api/sku-catalog/search` (low)
- ✅ `/api/sku-catalog/sync-ecwid-products` (low)
- ✅ `/api/sku-catalog/sync-ecwid-titles` (low)
- ✅ `/api/sku-catalog/unpaired` (low)
- ⛔ `/api/sku-catalog/unpaired-ecwid` (medium)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ⛔ `/api/sourcing/alerts` (medium)
- ⛔ `/api/sourcing/candidates` (medium)
- ⛔ `/api/sourcing/saved-searches` (medium)
- ⛔ `/api/staff-messages` (medium)
- ⛔ `/api/staff-todos` (medium)
- ✅ `/api/studio/definitions/[id]/discard` (low)
- ✅ `/api/studio/definitions/[id]/publish` (low)
- ⛔ `/api/suppliers` (medium)
- ✅ `/api/tech/scan` (low)
- ⛔ `/api/walk-in/catalog` (medium)
- ⛔ `/api/warranty/claims/bulk` (medium)
- ⛔ `/api/webhooks/square` (critical)
- ✅ `/api/webhooks/zoho/orders` (low)
- ✅ `/api/zoho/items/[id]/image` (low)
- ⛔ `/api/zoho/items/sync` (medium)
- ⛔ `/api/zoho/oauth/authorize` (high)
- ⛔ `/api/zoho/purchase-orders` (medium)
- ⛔ `/api/zoho/purchase-orders/receive` (medium)

### `local_pickup_items` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/local-pickups` (low)

### `local_pickup_order_items` — 6 routes, 0 not yet GUC-safe

- ✅ `/api/local-pickup-orders` (low)
- ✅ `/api/local-pickup-orders/[id]` (low)
- ✅ `/api/local-pickup-orders/[id]/finalize` (low)
- ✅ `/api/local-pickup-orders/[id]/items` (low)
- ✅ `/api/local-pickup-orders/[id]/items/[itemId]` (low)
- ✅ `/api/receiving-lines` (low)

### `local_pickup_orders` — 9 routes, 1 not yet GUC-safe

- ✅ `/api/local-pickup-orders` (low)
- ✅ `/api/local-pickup-orders/[id]` (low)
- ✅ `/api/local-pickup-orders/[id]/complete` (low)
- ✅ `/api/local-pickup-orders/[id]/finalize` (low)
- ✅ `/api/local-pickup-orders/[id]/items` (low)
- ✅ `/api/local-pickup-orders/[id]/items/[itemId]` (low)
- ✅ `/api/local-pickup-orders/[id]/reopen` (low)
- ✅ `/api/local-pickup-orders/[id]/void` (low)
- ⛔ `/api/receiving/[id]` (medium)

### `location_transfers` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/update-sku-location` (low)

### `locations` — 23 routes, 11 not yet GUC-safe

- ⛔ `/api/audit/bin/[id]` (medium)
- ✅ `/api/cycle-counts/campaigns` (low)
- ✅ `/api/cycle-counts/campaigns/[id]` (low)
- ✅ `/api/inventory-events` (low)
- ✅ `/api/inventory/alerts` (low)
- ⛔ `/api/locations` (medium)
- ⛔ `/api/locations/[barcode]` (medium)
- ⛔ `/api/locations/[barcode]/properties` (medium)
- ✅ `/api/locations/[barcode]/swap` (low)
- ⛔ `/api/locations/bulk` (medium)
- ⛔ `/api/locations/register` (medium)
- ⛔ `/api/receiving/[id]` (medium)
- ✅ `/api/receiving/lines/[id]/move` (low)
- ⛔ `/api/receiving/lines/[id]/putaway` (medium)
- ✅ `/api/receiving/lines/[id]/timeline` (low)
- ⛔ `/api/receiving/mark-received` (medium)
- ✅ `/api/rooms` (low)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/move` (low)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ✅ `/api/stock-alerts` (low)
- ✅ `/api/transfers` (low)
- ⛔ `/api/walk-in/status` (medium)

### `messages` — 10 routes, 9 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/preview-unread` (medium)
- ⛔ `/api/admin/po-gmail/reconcile` (medium)
- ⛔ `/api/admin/po-gmail/triage/[id]/detail` (medium)
- ⛔ `/api/admin/po-gmail/triage/[id]/extract` (medium)
- ⛔ `/api/ai/chat` (medium)
- ✅ `/api/ai/chat-sessions/[sessionId]/messages` (low)
- ⛔ `/api/ai/chat/stream` (medium)
- ⛔ `/api/ai/search` (critical)
- ⛔ `/api/staff-messages` (medium)
- ⛔ `/api/support/overview` (high)

### `mobile_scan_events` — 2 routes, 1 not yet GUC-safe

- ✅ `/api/scan/history` (low)
- ⛔ `/api/scan/resolve` (medium)

### `operations_kpi_rollups_daily` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/operations/kpi-table` (low)

### `operations_kpi_rollups_hourly` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/operations/kpi-table` (low)

### `order_ingest_queue` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/cron/zoho/orders-ingest-drain` (high)
- ⛔ `/api/zoho/orders/ingest` (medium)

### `order_shipment_links` — 5 routes, 4 not yet GUC-safe

- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders/[id]/tracking` (medium)
- ⛔ `/api/orders/assign` (medium)
- ✅ `/api/tech/logs` (low)
- ⛔ `/api/work-orders` (medium)

### `order_unit_allocations` — 14 routes, 6 not yet GUC-safe

- ⛔ `/api/orders/[id]/allocate` (medium)
- ✅ `/api/orders/[id]/release` (low)
- ⛔ `/api/orders/[id]/timeline` (medium)
- ⛔ `/api/pack/ship` (medium)
- ✅ `/api/pick/queue` (low)
- ✅ `/api/pick/scan` (low)
- ✅ `/api/pick/unscan` (low)
- ⛔ `/api/picking/session/[id]/confirm-pick` (medium)
- ⛔ `/api/picking/session/[id]/short-pick` (medium)
- ✅ `/api/returns/undo` (low)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/allocate` (low)
- ⛔ `/api/serial-units/lookup` (medium)
- ✅ `/api/webhooks/zoho/orders` (low)

### `orders` — 126 routes, 70 not yet GUC-safe

- ✅ `/api/admin/fix-status` (low)
- ✅ `/api/admin/po-gmail/missing-orders` (low)
- ✅ `/api/admin/po-gmail/triage` (low)
- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/ai/chat/stream` (medium)
- ✅ `/api/audit-log/report` (low)
- ✅ `/api/check-tracking` (low)
- ⛔ `/api/cron/amazon/orders-sync` (high)
- ⛔ `/api/cron/google-sheets/transfer-orders` (high)
- ⛔ `/api/cron/integrations/sync` (high)
- ⛔ `/api/cron/zoho/fulfillment-sync` (high)
- ⛔ `/api/cron/zoho/incoming-po-sync` (high)
- ⛔ `/api/cron/zoho/orders-ingest-drain` (high)
- ⛔ `/api/cron/zoho/po-sync` (high)
- ✅ `/api/customers/[id]` (low)
- ✅ `/api/dashboard/operations` (low)
- ✅ `/api/debug-tracking` (low)
- ⛔ `/api/desktop-app/release` (high)
- ✅ `/api/ebay/search` (low)
- ✅ `/api/ecwid/recent-repair-orders` (low)
- ⛔ `/api/ecwid/sync-exception-tracking` (medium)
- ⛔ `/api/ecwid/transfer-orders` (medium)
- ✅ `/api/global-search` (low)
- ✅ `/api/google-sheets/execute-script` (low)
- ✅ `/api/google-sheets/sync-shipstation-orders` (low)
- ⛔ `/api/google-sheets/transfer-orders` (medium)
- ⛔ `/api/import-orders` (medium)
- ⛔ `/api/integrations/[provider]/sync` (medium)
- ✅ `/api/local-pickup-orders` (low)
- ✅ `/api/local-pickup-orders/[id]` (low)
- ✅ `/api/local-pickup-orders/[id]/complete` (low)
- ✅ `/api/local-pickup-orders/[id]/finalize` (low)
- ✅ `/api/local-pickup-orders/[id]/items` (low)
- ✅ `/api/local-pickup-orders/[id]/items/[itemId]` (low)
- ✅ `/api/local-pickup-orders/[id]/reopen` (low)
- ✅ `/api/local-pickup-orders/[id]/void` (low)
- ⛔ `/api/order-labels` (medium)
- ⛔ `/api/orders` (medium)
- ✅ `/api/orders-exceptions/delete` (low)
- ✅ `/api/orders-exceptions/sync` (low)
- ⛔ `/api/orders/[id]` (medium)
- ⛔ `/api/orders/[id]/allocate` (medium)
- ✅ `/api/orders/[id]/pick-tasks` (low)
- ✅ `/api/orders/[id]/release` (low)
- ⛔ `/api/orders/[id]/timeline` (medium)
- ⛔ `/api/orders/[id]/tracking` (medium)
- ⛔ `/api/orders/add` (medium)
- ⛔ `/api/orders/assign` (medium)
- ✅ `/api/orders/backfill/ebay` (low)
- ✅ `/api/orders/backfill/ecwid` (low)
- ✅ `/api/orders/batch` (low)
- ⛔ `/api/orders/check-shipped` (medium)
- ⛔ `/api/orders/delete` (medium)
- ✅ `/api/orders/integrity-check` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ⛔ `/api/orders/missing-parts` (medium)
- ✅ `/api/orders/next` (low)
- ✅ `/api/orders/recent` (low)
- ⛔ `/api/orders/set-item-number` (medium)
- ⛔ `/api/orders/skip` (critical)
- ⛔ `/api/orders/start` (critical)
- ✅ `/api/orders/verify` (low)
- ⛔ `/api/pack/ship` (medium)
- ⛔ `/api/packerlogs` (medium)
- ⛔ `/api/packing-logs` (medium)
- ✅ `/api/packing-logs/history` (low)
- ⛔ `/api/packing-logs/update` (medium)
- ✅ `/api/pick/queue` (low)
- ✅ `/api/pick/scan` (low)
- ✅ `/api/pick/unscan` (low)
- ⛔ `/api/picking/session` (medium)
- ⛔ `/api/picking/session/[id]/complete` (medium)
- ⛔ `/api/picking/session/[id]/confirm-pick` (medium)
- ⛔ `/api/picking/session/[id]/short-pick` (medium)
- ✅ `/api/print/dispatch` (low)
- ✅ `/api/receiving-lines/incoming/refresh/stream` (low)
- ✅ `/api/receiving-lines/incoming/summary` (low)
- ⛔ `/api/receiving/add-unmatched-line` (medium)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/pending-check` (medium)
- ⛔ `/api/replenish/bulk-create-po` (medium)
- ✅ `/api/replenish/shipped-fifo` (low)
- ⛔ `/api/rma` (medium)
- ⛔ `/api/rma/[id]` (medium)
- ⛔ `/api/rma/[id]/close` (medium)
- ⛔ `/api/rma/[id]/disposition` (medium)
- ⛔ `/api/rma/[id]/mark-received` (medium)
- ⛔ `/api/rma/by-number/[number]` (medium)
- ⛔ `/api/scan-tracking` (medium)
- ⛔ `/api/scan/resolve` (medium)
- ✅ `/api/serial-units/[id]/allocate` (low)
- ⛔ `/api/serial-units/lookup` (medium)
- ⛔ `/api/shipped` (medium)
- ⛔ `/api/shipped/[id]` (medium)
- ✅ `/api/shipped/debug` (low)
- ✅ `/api/shipped/lookup-order` (low)
- ⛔ `/api/shipped/scan-out` (medium)
- ⛔ `/api/shipped/search` (medium)
- ✅ `/api/shipped/submit` (low)
- ⛔ `/api/sku-catalog/pair-batch` (medium)
- ✅ `/api/sku-catalog/pairing-queue` (low)
- ✅ `/api/sku-catalog/resolve` (low)
- ✅ `/api/sku-catalog/search-unmatched` (low)
- ✅ `/api/sku-catalog/unpaired` (low)
- ⛔ `/api/sync-sheets` (medium)
- ✅ `/api/tech-logs/search` (low)
- ⛔ `/api/tech/delete` (medium)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/orders-without-manual` (low)
- ✅ `/api/tech/scan` (low)
- ⛔ `/api/tech/scan-sku` (medium)
- ⛔ `/api/tech/serial` (medium)
- ✅ `/api/tracking-exceptions` (low)
- ⛔ `/api/tracking-exceptions/[id]/refresh` (medium)
- ⛔ `/api/walk-in/orders` (medium)
- ⛔ `/api/walk-in/sales` (medium)
- ⛔ `/api/walk-in/sync` (medium)
- ⛔ `/api/webhooks/square` (critical)
- ✅ `/api/webhooks/zoho/orders` (low)
- ⛔ `/api/work-orders` (medium)
- ✅ `/api/zoho/fulfillment-sync` (low)
- ⛔ `/api/zoho/orders/ingest` (medium)
- ⛔ `/api/zoho/purchase-orders` (medium)
- ⛔ `/api/zoho/purchase-orders/receive` (medium)
- ⛔ `/api/zoho/purchase-orders/sync` (critical)
- ⛔ `/api/zoho/purchase-receives/sync` (critical)

### `orders_exceptions` — 9 routes, 4 not yet GUC-safe

- ⛔ `/api/ecwid/sync-exception-tracking` (medium)
- ✅ `/api/google-sheets/execute-script` (low)
- ✅ `/api/google-sheets/sync-shipstation-orders` (low)
- ✅ `/api/orders-exceptions/delete` (low)
- ✅ `/api/orders-exceptions/sync` (low)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]` (medium)
- ⛔ `/api/scan-tracking` (medium)
- ⛔ `/api/shipped/scan-out` (medium)
- ✅ `/api/tech/scan` (low)

### `packages` — 5 routes, 2 not yet GUC-safe

- ⛔ `/api/receiving-lines/incoming/refresh` (medium)
- ✅ `/api/receiving-lines/incoming/refresh/stream` (low)
- ✅ `/api/receiving-lines/incoming/summary` (low)
- ⛔ `/api/webhooks/ups` (critical)
- ✅ `/api/zoho/fulfillment-sync` (low)

### `packer_logs` — 17 routes, 7 not yet GUC-safe

- ✅ `/api/admin/logs` (low)
- ✅ `/api/audit-log/report` (low)
- ✅ `/api/check-tracking` (low)
- ✅ `/api/debug-tracking` (low)
- ✅ `/api/google-sheets/execute-script` (low)
- ⛔ `/api/orders` (medium)
- ✅ `/api/orders-exceptions/sync` (low)
- ✅ `/api/orders/batch` (low)
- ✅ `/api/orders/verify` (low)
- ⛔ `/api/pack/ship` (medium)
- ⛔ `/api/packerlogs` (medium)
- ⛔ `/api/packing-logs` (medium)
- ✅ `/api/packing-logs/history` (low)
- ⛔ `/api/packing-logs/update` (medium)
- ⛔ `/api/shipped` (medium)
- ✅ `/api/shipped/debug` (low)
- ⛔ `/api/sync-sheets` (medium)

### `part_acquisitions` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/sourcing/candidates/[id]/import` (medium)

### `part_compatibility` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/part-compatibility` (medium)

### `payroll_settings` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/payroll/settings` (low)

### `pending_skus` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/receiving/pending-check` (medium)

### `photos` — 28 routes, 17 not yet GUC-safe

- ✅ `/api/inventory-photos` (low)
- ⛔ `/api/nas-config` (medium)
- ⛔ `/api/nas-dev/[[...path]]` (critical)
- ⛔ `/api/nas/[[...path]]` (medium)
- ⛔ `/api/order-labels` (medium)
- ⛔ `/api/packerlogs` (medium)
- ⛔ `/api/packing-logs` (medium)
- ✅ `/api/packing-logs/history` (low)
- ✅ `/api/packing-logs/save-photo` (low)
- ⛔ `/api/packing-logs/update` (medium)
- ✅ `/api/photos/[id]` (low)
- ✅ `/api/receiving-lines` (low)
- ⛔ `/api/receiving-photos` (medium)
- ⛔ `/api/receiving/nas-archive-test` (critical)
- ✅ `/api/receiving/po/[poId]` (low)
- ✅ `/api/receiving/po/list` (low)
- ⛔ `/api/receiving/zendesk-claim` (medium)
- ⛔ `/api/receiving/zendesk-claim/draft` (medium)
- ⛔ `/api/receiving/zendesk-claim/preview` (medium)
- ✅ `/api/serial-units/[id]` (low)
- ⛔ `/api/serial-units/[id]/photos` (medium)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ✅ `/api/sku/[id]/photos` (low)
- ✅ `/api/sku/by-tracking` (low)
- ⛔ `/api/warranty/claims/[id]/repair` (medium)
- ⛔ `/api/zendesk/tickets` (medium)
- ⛔ `/api/zendesk/tickets/[id]/photos` (medium)
- ✅ `/api/zoho/items/[id]/image` (low)

### `picking_sessions` — 2 routes, 1 not yet GUC-safe

- ✅ `/api/pick/queue` (low)
- ⛔ `/api/picking/session/[id]/complete` (medium)

### `platforms` — 7 routes, 4 not yet GUC-safe

- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/catalog/platforms` (medium)
- ⛔ `/api/catalog/platforms/[id]` (medium)
- ✅ `/api/products/[sku]` (low)
- ⛔ `/api/receiving/[id]` (medium)
- ✅ `/api/sku-catalog/pairing-queue` (low)
- ✅ `/api/sku-catalog/resolve` (low)

### `printer_profiles` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/print/dispatch` (low)

### `product_manuals` — 19 routes, 7 not yet GUC-safe

- ✅ `/api/manuals/recent` (low)
- ✅ `/api/manuals/resolve` (low)
- ✅ `/api/manuals/upsert` (low)
- ✅ `/api/orders/recent` (low)
- ⛔ `/api/product-manuals` (medium)
- ⛔ `/api/product-manuals/assign` (medium)
- ✅ `/api/product-manuals/bulk` (low)
- ✅ `/api/product-manuals/by-category` (low)
- ✅ `/api/product-manuals/rename-folder` (low)
- ✅ `/api/product-manuals/search` (low)
- ⛔ `/api/product-manuals/sync` (medium)
- ⛔ `/api/product-manuals/thumbnail` (medium)
- ⛔ `/api/product-manuals/upload` (medium)
- ⛔ `/api/product-manuals/upsert` (medium)
- ✅ `/api/receiving-lines/[id]/manuals` (low)
- ✅ `/api/receiving-lines/[id]/testing-bundle` (low)
- ✅ `/api/sku-catalog/[id]/manuals` (low)
- ⛔ `/api/sku-catalog/pair-batch` (medium)
- ✅ `/api/tech/orders-without-manual` (low)

### `qc_check_templates` — 5 routes, 0 not yet GUC-safe

- ✅ `/api/receiving-lines/[id]/qc-checks` (low)
- ✅ `/api/serial-units/[id]/checklist` (low)
- ✅ `/api/serial-units/[id]/checklist/bulk` (low)
- ✅ `/api/sku-catalog/[id]/qc-checks` (low)
- ✅ `/api/sku-catalog/search` (low)

### `rag_document_chunks` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/rag/documents` (low)
- ✅ `/api/rag/search` (low)

### `rag_documents` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/rag/documents` (low)

### `reason_codes` — 3 routes, 2 not yet GUC-safe

- ⛔ `/api/locations/[barcode]` (medium)
- ✅ `/api/reason-codes` (low)
- ⛔ `/api/warranty/reports/export` (medium)

### `receiving` — 106 routes, 74 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/reconcile` (medium)
- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/ai/chat/stream` (medium)
- ⛔ `/api/audit-log/receiving` (medium)
- ✅ `/api/audit-log/report` (low)
- ⛔ `/api/catalog/platform-accounts` (medium)
- ⛔ `/api/catalog/platforms` (medium)
- ⛔ `/api/catalog/types` (medium)
- ⛔ `/api/catalog/workflow-nodes` (medium)
- ⛔ `/api/cron/receiving/incoming-tracking-sync` (high)
- ⛔ `/api/cron/reconcile-unmatched` (high)
- ⛔ `/api/cron/shipping/reconcile-delivered` (high)
- ⛔ `/api/cron/shipping/sync-due` (high)
- ⛔ `/api/cron/zoho/incoming-po-sync` (high)
- ⛔ `/api/cron/zoho/po-sync` (high)
- ✅ `/api/dashboard/fba-shipments` (low)
- ✅ `/api/ecwid/recent-repair-orders` (low)
- ✅ `/api/global-search` (low)
- ✅ `/api/inbox/tech-queue` (low)
- ✅ `/api/local-pickup-orders/[id]/finalize` (low)
- ✅ `/api/local-pickups` (low)
- ⛔ `/api/nas-config` (medium)
- ⛔ `/api/nas/[[...path]]` (medium)
- ⛔ `/api/order-labels` (medium)
- ✅ `/api/orders-exceptions/sync` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ✅ `/api/photos/[id]` (low)
- ⛔ `/api/post-multi-sn` (medium)
- ⛔ `/api/receiving-entry` (medium)
- ✅ `/api/receiving-lines` (low)
- ⛔ `/api/receiving-lines/[id]/ensure-catalog` (medium)
- ✅ `/api/receiving-lines/[id]/manuals` (low)
- ✅ `/api/receiving-lines/[id]/qc-checks` (low)
- ✅ `/api/receiving-lines/[id]/testing-bundle` (low)
- ✅ `/api/receiving-lines/incoming/delivered-unscanned` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ⛔ `/api/receiving-lines/incoming/email-rescan` (medium)
- ⛔ `/api/receiving-lines/incoming/refresh` (medium)
- ✅ `/api/receiving-lines/incoming/refresh/stream` (low)
- ✅ `/api/receiving-lines/incoming/summary` (low)
- ✅ `/api/receiving-lines/incoming/sync-one` (low)
- ⛔ `/api/receiving-lines/incoming/zoho-refresh` (critical)
- ⛔ `/api/receiving-lines/view` (medium)
- ⛔ `/api/receiving-logs` (medium)
- ✅ `/api/receiving-logs/search` (low)
- ⛔ `/api/receiving-photos` (medium)
- ⛔ `/api/receiving-tasks` (medium)
- ⛔ `/api/receiving/[id]` (medium)
- ⛔ `/api/receiving/[id]/attach-box` (medium)
- ⛔ `/api/receiving/add-unmatched-line` (medium)
- ⛔ `/api/receiving/disposition-suggest` (critical)
- ⛔ `/api/receiving/identify-label` (medium)
- ⛔ `/api/receiving/lines/[id]/condition` (medium)
- ✅ `/api/receiving/lines/[id]/move` (low)
- ⛔ `/api/receiving/lines/[id]/putaway` (medium)
- ✅ `/api/receiving/lines/[id]/putaway/reverse` (low)
- ⛔ `/api/receiving/lines/[id]/status` (medium)
- ✅ `/api/receiving/lines/[id]/timeline` (low)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/mark-received` (medium)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ✅ `/api/receiving/match` (low)
- ⛔ `/api/receiving/nas-archive-test` (critical)
- ⛔ `/api/receiving/pending-check` (medium)
- ✅ `/api/receiving/pending-unboxing` (low)
- ✅ `/api/receiving/po/[poId]` (low)
- ⛔ `/api/receiving/po/[poId]/attach-box` (medium)
- ✅ `/api/receiving/po/list` (low)
- ⛔ `/api/receiving/scan-serial` (medium)
- ⛔ `/api/receiving/serials` (medium)
- ⛔ `/api/receiving/unfound-queue` (medium)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]` (medium)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk` (medium)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk/draft` (medium)
- ⛔ `/api/receiving/visual-identify` (medium)
- ⛔ `/api/receiving/zendesk-claim` (medium)
- ⛔ `/api/receiving/zendesk-claim/classify` (critical)
- ⛔ `/api/receiving/zendesk-claim/draft` (medium)
- ⛔ `/api/receiving/zendesk-claim/link` (medium)
- ⛔ `/api/receiving/zendesk-claim/preview` (medium)
- ⛔ `/api/receiving/zendesk-claim/thread` (medium)
- ⛔ `/api/returns/intake` (medium)
- ✅ `/api/returns/undo` (low)
- ✅ `/api/scan/history` (low)
- ⛔ `/api/scan/resolve` (medium)
- ⛔ `/api/serial-units/[id]/photos` (medium)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/serial-units/lookup` (medium)
- ✅ `/api/sku/[id]/photos` (low)
- ⛔ `/api/sourcing/candidates/[id]/import` (medium)
- ⛔ `/api/stations` (medium)
- ✅ `/api/tracking-exceptions` (low)
- ✅ `/api/tracking-exceptions/[id]` (low)
- ⛔ `/api/tracking-exceptions/[id]/refresh` (medium)
- ⛔ `/api/vision-config` (high)
- ⛔ `/api/warranty/claims/[id]/zendesk` (medium)
- ⛔ `/api/warranty/claims/[id]/zendesk/link` (medium)
- ⛔ `/api/work-orders` (medium)
- ⛔ `/api/zoho/find-po` (medium)
- ⛔ `/api/zoho/oauth/authorize` (high)
- ⛔ `/api/zoho/purchase-orders` (medium)
- ⛔ `/api/zoho/purchase-orders/receive` (medium)
- ⛔ `/api/zoho/purchase-orders/sync` (critical)
- ⛔ `/api/zoho/purchase-receives` (medium)
- ⛔ `/api/zoho/purchase-receives/import` (critical)
- ⛔ `/api/zoho/purchase-receives/sync` (critical)

### `receiving_line_views` — 2 routes, 1 not yet GUC-safe

- ✅ `/api/receiving-lines` (low)
- ⛔ `/api/receiving-lines/view` (medium)

### `receiving_lines` — 41 routes, 28 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/reconcile` (medium)
- ✅ `/api/admin/po-mirror/health` (low)
- ✅ `/api/audit-log/report` (low)
- ⛔ `/api/cron/zoho/incoming-po-sync` (high)
- ⛔ `/api/cron/zoho/po-sync` (high)
- ✅ `/api/inbox/tech-queue` (low)
- ⛔ `/api/receiving-entry` (medium)
- ✅ `/api/receiving-lines` (low)
- ⛔ `/api/receiving-lines/[id]/ensure-catalog` (medium)
- ✅ `/api/receiving-lines/incoming/delivered-unscanned` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ⛔ `/api/receiving-lines/incoming/refresh` (medium)
- ✅ `/api/receiving-lines/incoming/refresh/stream` (low)
- ✅ `/api/receiving-lines/incoming/summary` (low)
- ⛔ `/api/receiving-lines/incoming/zoho-refresh` (critical)
- ⛔ `/api/receiving-photos` (medium)
- ⛔ `/api/receiving/[id]` (medium)
- ⛔ `/api/receiving/add-unmatched-line` (medium)
- ⛔ `/api/receiving/lines/[id]/condition` (medium)
- ✅ `/api/receiving/lines/[id]/move` (low)
- ⛔ `/api/receiving/lines/[id]/putaway` (medium)
- ⛔ `/api/receiving/lines/[id]/status` (medium)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/mark-received` (medium)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ✅ `/api/receiving/match` (low)
- ✅ `/api/receiving/pending-unboxing` (low)
- ✅ `/api/receiving/po/[poId]` (low)
- ⛔ `/api/receiving/po/[poId]/attach-box` (medium)
- ✅ `/api/receiving/po/list` (low)
- ⛔ `/api/receiving/scan-serial` (medium)
- ⛔ `/api/receiving/serials` (medium)
- ⛔ `/api/receiving/zendesk-claim` (medium)
- ⛔ `/api/receiving/zendesk-claim/draft` (medium)
- ⛔ `/api/receiving/zendesk-claim/link` (medium)
- ⛔ `/api/receiving/zendesk-claim/preview` (medium)
- ⛔ `/api/tracking-exceptions/[id]/refresh` (medium)
- ⛔ `/api/work-orders` (medium)
- ⛔ `/api/zoho/purchase-orders/receive` (medium)
- ⛔ `/api/zoho/purchase-orders/sync` (critical)
- ⛔ `/api/zoho/purchase-receives/sync` (critical)

### `receiving_scans` — 8 routes, 5 not yet GUC-safe

- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/delivered-unscanned` (low)
- ✅ `/api/receiving-lines/incoming/summary` (low)
- ⛔ `/api/receiving-logs` (medium)
- ⛔ `/api/receiving-photos` (medium)
- ⛔ `/api/receiving/[id]` (medium)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/tracking-exceptions/[id]/refresh` (medium)

### `repair_actions` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/repair/actions` (medium)
- ⛔ `/api/repair/actions/[id]` (medium)

### `repair_service` — 10 routes, 5 not yet GUC-safe

- ✅ `/api/dashboard/operations` (low)
- ✅ `/api/global-search` (low)
- ✅ `/api/repair-service/document/[id]` (low)
- ✅ `/api/repair-service/next` (low)
- ✅ `/api/repair-service/out-of-stock` (low)
- ⛔ `/api/repair-service/pickup` (medium)
- ⛔ `/api/repair-service/repaired` (medium)
- ⛔ `/api/warranty/claims/[id]/repair-handoff` (medium)
- ⛔ `/api/warranty/quotes/[id]` (medium)
- ⛔ `/api/work-orders` (medium)

### `replenishment_order_lines` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/orders` (medium)

### `replenishment_requests` — 5 routes, 3 not yet GUC-safe

- ✅ `/api/audit-log/report` (low)
- ⛔ `/api/need-to-order` (medium)
- ⛔ `/api/need-to-order/[id]` (medium)
- ⛔ `/api/orders` (medium)
- ✅ `/api/replenish/shipped-fifo` (low)

### `replenishment_status_log` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/need-to-order/[id]` (medium)

### `replenishment_tasks` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/replenishment-detect` (high)

### `return_dispositions` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/rma/[id]/disposition` (medium)

### `rma_authorizations` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/warranty/claims/[id]/rma` (medium)

### `serial_unit_condition_history` — 3 routes, 0 not yet GUC-safe

- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/grade` (low)
- ✅ `/api/tech/test-result` (low)

### `serial_units` — 54 routes, 21 not yet GUC-safe

- ✅ `/api/fba/items/[id]/link-unit` (low)
- ✅ `/api/fba/shipments/[id]/ship-units` (low)
- ✅ `/api/inventory-events` (low)
- ✅ `/api/inventory/units` (low)
- ✅ `/api/labels/recent` (low)
- ⛔ `/api/orders/[id]/allocate` (medium)
- ✅ `/api/orders/[id]/release` (low)
- ⛔ `/api/pack/ship` (medium)
- ✅ `/api/pick/scan` (low)
- ✅ `/api/pick/unscan` (low)
- ⛔ `/api/picking/session/[id]/confirm-pick` (medium)
- ⛔ `/api/picking/session/[id]/short-pick` (medium)
- ⛔ `/api/post-multi-sn` (medium)
- ✅ `/api/products/[sku]` (low)
- ✅ `/api/quality/dashboard` (low)
- ✅ `/api/receiving-lines` (low)
- ⛔ `/api/receiving-lines/[id]/ensure-catalog` (medium)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ⛔ `/api/receiving/[id]` (medium)
- ✅ `/api/receiving/lines/[id]/move` (low)
- ⛔ `/api/receiving/lines/[id]/putaway` (medium)
- ✅ `/api/receiving/lines/[id]/putaway/reverse` (low)
- ⛔ `/api/receiving/lines/[id]/status` (medium)
- ✅ `/api/receiving/lines/[id]/timeline` (low)
- ⛔ `/api/receiving/mark-received` (medium)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ⛔ `/api/receiving/scan-serial` (medium)
- ⛔ `/api/receiving/serials` (medium)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]` (medium)
- ⛔ `/api/returns/intake` (medium)
- ✅ `/api/returns/undo` (low)
- ⛔ `/api/scan/resolve` (medium)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/allocate` (low)
- ✅ `/api/serial-units/[id]/checklist` (low)
- ✅ `/api/serial-units/[id]/checklist/bulk` (low)
- ✅ `/api/serial-units/[id]/failure-tags` (low)
- ✅ `/api/serial-units/[id]/grade` (low)
- ✅ `/api/serial-units/[id]/hold` (low)
- ✅ `/api/serial-units/[id]/move` (low)
- ⛔ `/api/serial-units/[id]/photos` (medium)
- ✅ `/api/serial-units/[id]/quality` (low)
- ✅ `/api/serial-units/[id]/release` (low)
- ⛔ `/api/serial-units/[id]/repairs` (medium)
- ⛔ `/api/serial-units/lookup` (medium)
- ✅ `/api/sku` (low)
- ✅ `/api/sku/by-tracking` (low)
- ✅ `/api/sku/lookup` (low)
- ✅ `/api/sku/serials-from-code` (low)
- ⛔ `/api/tech/scan-sku` (medium)
- ✅ `/api/tech/test-result` (low)
- ✅ `/api/testing/recent` (low)
- ⛔ `/api/units/resolve-id` (medium)
- ✅ `/api/workflow/flow-audit` (low)

### `shifts` — 3 routes, 0 not yet GUC-safe

- ✅ `/api/google-sheets/sync-shipstation-orders` (low)
- ✅ `/api/shifts` (low)
- ✅ `/api/shifts/[id]/cover` (low)

### `shipment_tracking_events` — 3 routes, 1 not yet GUC-safe

- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ⛔ `/api/webhooks/ups` (critical)

### `shipping_tracking_numbers` — 61 routes, 17 not yet GUC-safe

- ✅ `/api/admin/logs` (low)
- ✅ `/api/audit-log/report` (low)
- ✅ `/api/check-tracking` (low)
- ⛔ `/api/cron/shipping/sync-due` (high)
- ✅ `/api/dashboard/fba-shipments` (low)
- ✅ `/api/dashboard/operations` (low)
- ✅ `/api/debug-tracking` (low)
- ✅ `/api/ebay/search` (low)
- ✅ `/api/fba/board` (low)
- ✅ `/api/fba/board/[fnsku]/entries` (low)
- ✅ `/api/fba/print-queue` (low)
- ✅ `/api/fba/shipments` (low)
- ✅ `/api/fba/shipments/[id]` (low)
- ✅ `/api/fba/shipments/[id]/tracking` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/mark-shipped` (low)
- ✅ `/api/fba/shipments/split-for-paired-review` (low)
- ✅ `/api/fba/shipments/today` (low)
- ✅ `/api/global-search` (low)
- ✅ `/api/google-sheets/execute-script` (low)
- ✅ `/api/google-sheets/sync-shipstation-orders` (low)
- ✅ `/api/inbox/tech-queue` (low)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders/[id]/tracking` (medium)
- ✅ `/api/orders/backfill/ebay` (low)
- ✅ `/api/orders/backfill/ecwid` (low)
- ✅ `/api/orders/batch` (low)
- ✅ `/api/orders/integrity-check` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ✅ `/api/orders/next` (low)
- ✅ `/api/orders/recent` (low)
- ✅ `/api/orders/verify` (low)
- ⛔ `/api/packing-logs` (medium)
- ✅ `/api/packing-logs/history` (low)
- ⛔ `/api/packing-logs/update` (medium)
- ⛔ `/api/receiving-entry` (medium)
- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/delivered-unscanned` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ✅ `/api/receiving-lines/incoming/refresh/stream` (low)
- ✅ `/api/receiving-lines/incoming/summary` (low)
- ⛔ `/api/receiving-logs` (medium)
- ✅ `/api/receiving-logs/search` (low)
- ⛔ `/api/receiving/[id]` (medium)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/mark-received` (medium)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ✅ `/api/receiving/match` (low)
- ✅ `/api/receiving/pending-unboxing` (low)
- ⛔ `/api/scan-tracking` (medium)
- ⛔ `/api/scan/resolve` (medium)
- ✅ `/api/shipped/debug` (low)
- ✅ `/api/shipped/lookup-order` (low)
- ⛔ `/api/shipped/scan-out` (medium)
- ⛔ `/api/sync-sheets` (medium)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/orders-without-manual` (low)
- ✅ `/api/tech/scan` (low)
- ✅ `/api/tech/update-serials` (low)
- ⛔ `/api/webhooks/ups` (critical)
- ⛔ `/api/work-orders` (medium)

### `sku` — 198 routes, 74 not yet GUC-safe

- ✅ `/api/activity/feed` (low)
- ✅ `/api/admin/fba-fnskus` (low)
- ✅ `/api/admin/fba-fnskus/[fnsku]` (low)
- ✅ `/api/admin/fba-fnskus/upload` (low)
- ⛔ `/api/assignments/sku-search` (medium)
- ⛔ `/api/audit-log/packing` (medium)
- ⛔ `/api/audit-log/receiving` (medium)
- ✅ `/api/audit-log/report` (low)
- ⛔ `/api/audit-log/sku` (medium)
- ⛔ `/api/audit/sku/[sku]` (medium)
- ⛔ `/api/cron/inventory/drift-check` (high)
- ⛔ `/api/cron/replenishment-detect` (high)
- ⛔ `/api/cron/sku-catalog/refresh-suggestions` (high)
- ⛔ `/api/cron/stock-alerts` (high)
- ✅ `/api/cycle-counts/campaigns` (low)
- ✅ `/api/cycle-counts/campaigns/[id]` (low)
- ✅ `/api/cycle-counts/lines/[id]` (low)
- ✅ `/api/ebay/search` (low)
- ⛔ `/api/ecwid/products/search` (high)
- ✅ `/api/ecwid/recent-repair-orders` (low)
- ⛔ `/api/ecwid/sync-exception-tracking` (medium)
- ⛔ `/api/favorites` (medium)
- ⛔ `/api/favorites/[id]` (medium)
- ✅ `/api/fba/board` (low)
- ✅ `/api/fba/board/[fnsku]/entries` (low)
- ✅ `/api/fba/fnskus` (low)
- ✅ `/api/fba/fnskus/[fnsku]` (low)
- ✅ `/api/fba/fnskus/bulk` (low)
- ✅ `/api/fba/fnskus/search` (low)
- ✅ `/api/fba/fnskus/validate` (low)
- ✅ `/api/fba/items/[id]/link-unit` (low)
- ✅ `/api/fba/items/queue` (low)
- ✅ `/api/fba/items/scan` (low)
- ✅ `/api/fba/logs` (low)
- ✅ `/api/fba/logs/[id]` (low)
- ✅ `/api/fba/logs/summary` (low)
- ✅ `/api/fba/print-queue` (low)
- ✅ `/api/fba/shipments` (low)
- ✅ `/api/fba/shipments/[id]/items` (low)
- ✅ `/api/fba/shipments/[id]/items/[itemId]` (low)
- ✅ `/api/fba/shipments/[id]/ship-units` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/today` (low)
- ✅ `/api/fba/shipments/today/duplicate-yesterday` (low)
- ✅ `/api/fba/shipments/today/items` (low)
- ✅ `/api/get-title-by-sku` (low)
- ✅ `/api/global-search` (low)
- ⛔ `/api/import-orders` (medium)
- ✅ `/api/inventory-events` (low)
- ✅ `/api/inventory-photos` (low)
- ✅ `/api/inventory/alerts` (low)
- ✅ `/api/inventory/alerts/[id]/ack` (low)
- ✅ `/api/inventory/sku-search` (low)
- ✅ `/api/inventory/units` (low)
- ✅ `/api/labels/recent` (low)
- ✅ `/api/local-pickup-orders` (low)
- ✅ `/api/local-pickup-orders/[id]` (low)
- ✅ `/api/local-pickup-orders/[id]/finalize` (low)
- ✅ `/api/local-pickup-orders/[id]/items` (low)
- ✅ `/api/local-pickup-orders/[id]/items/[itemId]` (low)
- ✅ `/api/local-pickups` (low)
- ⛔ `/api/locations/[barcode]` (medium)
- ✅ `/api/locations/[barcode]/swap` (low)
- ✅ `/api/manuals/recent` (low)
- ✅ `/api/manuals/resolve` (low)
- ✅ `/api/manuals/upsert` (low)
- ⛔ `/api/need-to-order` (medium)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders/[id]/allocate` (medium)
- ✅ `/api/orders/[id]/pick-tasks` (low)
- ✅ `/api/orders/[id]/release` (low)
- ⛔ `/api/orders/add` (medium)
- ⛔ `/api/orders/assign` (medium)
- ✅ `/api/orders/backfill/ebay` (low)
- ✅ `/api/orders/backfill/ecwid` (low)
- ✅ `/api/orders/batch` (low)
- ⛔ `/api/orders/delete` (medium)
- ✅ `/api/orders/integrity-check` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ✅ `/api/orders/next` (low)
- ✅ `/api/orders/recent` (low)
- ⛔ `/api/pack/ship` (medium)
- ⛔ `/api/packerlogs` (medium)
- ⛔ `/api/packing-logs` (medium)
- ✅ `/api/packing-logs/history` (low)
- ⛔ `/api/packing-logs/update` (medium)
- ⛔ `/api/part-compatibility` (medium)
- ✅ `/api/pick/scan` (low)
- ⛔ `/api/post-multi-sn` (medium)
- ✅ `/api/print/dispatch` (low)
- ⛔ `/api/product-manuals` (medium)
- ✅ `/api/product-manuals/by-category` (low)
- ✅ `/api/product-manuals/search` (low)
- ⛔ `/api/product-manuals/upload` (medium)
- ✅ `/api/products/[sku]` (low)
- ✅ `/api/quality/dashboard` (low)
- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/[id]/qc-checks` (low)
- ✅ `/api/receiving-lines/[id]/testing-bundle` (low)
- ✅ `/api/receiving-lines/incoming/delivered-unscanned` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ⛔ `/api/receiving/[id]` (medium)
- ⛔ `/api/receiving/add-unmatched-line` (medium)
- ⛔ `/api/receiving/identify-label` (medium)
- ✅ `/api/receiving/lines/[id]/move` (low)
- ⛔ `/api/receiving/lines/[id]/putaway` (medium)
- ✅ `/api/receiving/lines/[id]/putaway/reverse` (low)
- ⛔ `/api/receiving/lines/[id]/status` (medium)
- ✅ `/api/receiving/lines/[id]/timeline` (low)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/mark-received` (medium)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ✅ `/api/receiving/match` (low)
- ⛔ `/api/receiving/pending-check` (medium)
- ✅ `/api/receiving/pending-unboxing` (low)
- ✅ `/api/receiving/po/[poId]` (low)
- ✅ `/api/receiving/po/list` (low)
- ⛔ `/api/receiving/scan-serial` (medium)
- ⛔ `/api/receiving/visual-identify` (medium)
- ✅ `/api/repair-service/next` (low)
- ⛔ `/api/repair/ecwid-products` (high)
- ⛔ `/api/repair/square-payment-link` (medium)
- ✅ `/api/replenish/shipped-fifo` (low)
- ✅ `/api/reports/dead-stock` (low)
- ✅ `/api/reports/velocity` (low)
- ✅ `/api/returns/undo` (low)
- ⛔ `/api/scan/resolve` (medium)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/allocate` (low)
- ✅ `/api/serial-units/[id]/checklist` (low)
- ✅ `/api/serial-units/[id]/grade` (low)
- ✅ `/api/serial-units/[id]/move` (low)
- ⛔ `/api/serial-units/[id]/photos` (medium)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/serial-units/lookup` (medium)
- ⛔ `/api/shipped` (medium)
- ✅ `/api/shipped/submit` (low)
- ✅ `/api/sku` (low)
- ⛔ `/api/sku-catalog` (medium)
- ✅ `/api/sku-catalog/[id]` (low)
- ✅ `/api/sku-catalog/[id]/manuals` (low)
- ⛔ `/api/sku-catalog/[id]/platform-ids` (medium)
- ✅ `/api/sku-catalog/[id]/qc-checks` (low)
- ✅ `/api/sku-catalog/[id]/similar` (low)
- ⛔ `/api/sku-catalog/graph/[skuId]/children` (medium)
- ⛔ `/api/sku-catalog/graph/[skuId]/parents` (medium)
- ⛔ `/api/sku-catalog/graph/[skuId]/tree` (medium)
- ⛔ `/api/sku-catalog/graph/relationships` (medium)
- ✅ `/api/sku-catalog/graph/relationships/[id]` (low)
- ✅ `/api/sku-catalog/pair` (low)
- ⛔ `/api/sku-catalog/pair-batch` (medium)
- ⛔ `/api/sku-catalog/pair-ecwid` (medium)
- ✅ `/api/sku-catalog/pair-suggestions` (low)
- ✅ `/api/sku-catalog/pairing-queue` (low)
- ✅ `/api/sku-catalog/pairing-queue/count` (low)
- ✅ `/api/sku-catalog/resolve` (low)
- ✅ `/api/sku-catalog/run-migration` (low)
- ✅ `/api/sku-catalog/search` (low)
- ✅ `/api/sku-catalog/search-unmatched` (low)
- ✅ `/api/sku-catalog/suggest-for-item` (low)
- ⛔ `/api/sku-catalog/suggest-pairings` (medium)
- ✅ `/api/sku-catalog/sync-ecwid-products` (low)
- ✅ `/api/sku-catalog/sync-ecwid-titles` (low)
- ✅ `/api/sku-catalog/unpaired` (low)
- ⛔ `/api/sku-catalog/unpaired-ecwid` (medium)
- ✅ `/api/sku-stock` (low)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ✅ `/api/sku-stock/[sku]/bins` (low)
- ✅ `/api/sku/[id]/photos` (low)
- ✅ `/api/sku/by-tracking` (low)
- ✅ `/api/sku/lookup` (low)
- ✅ `/api/sku/serials-from-code` (low)
- ⛔ `/api/sourcing/saved-searches/[id]/run` (medium)
- ✅ `/api/stock-alerts` (low)
- ⛔ `/api/sync-sheets` (medium)
- ✅ `/api/tech-logs/search` (low)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/orders-without-manual` (low)
- ✅ `/api/tech/scan` (low)
- ⛔ `/api/tech/scan-sku` (medium)
- ✅ `/api/tech/test-result` (low)
- ✅ `/api/testing/recent` (low)
- ⛔ `/api/tracking-exceptions/[id]/refresh` (medium)
- ✅ `/api/transfers` (low)
- ⛔ `/api/units/next-id` (medium)
- ⛔ `/api/units/resolve-id` (medium)
- ✅ `/api/update-sku-location` (low)
- ⛔ `/api/walk-in/catalog` (medium)
- ⛔ `/api/walk-in/sync` (medium)
- ⛔ `/api/warranty/claims` (medium)
- ⛔ `/api/warranty/claims/bulk` (medium)
- ⛔ `/api/warranty/lookup` (medium)
- ⛔ `/api/warranty/reports/export` (medium)
- ⛔ `/api/webhooks/square` (critical)
- ✅ `/api/webhooks/zoho/orders` (low)
- ⛔ `/api/work-orders` (medium)
- ⛔ `/api/zoho/purchase-orders` (medium)
- ⛔ `/api/zoho/purchase-orders/receive` (medium)

### `sku_catalog` — 63 routes, 20 not yet GUC-safe

- ⛔ `/api/cron/sku-catalog/refresh-suggestions` (high)
- ✅ `/api/ecwid/recent-repair-orders` (low)
- ✅ `/api/get-title-by-sku` (low)
- ✅ `/api/inventory-events` (low)
- ✅ `/api/inventory/units` (low)
- ✅ `/api/labels/recent` (low)
- ✅ `/api/local-pickup-orders/[id]` (low)
- ✅ `/api/local-pickups` (low)
- ✅ `/api/manuals/recent` (low)
- ✅ `/api/manuals/resolve` (low)
- ✅ `/api/manuals/upsert` (low)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders/add` (medium)
- ⛔ `/api/orders/assign` (medium)
- ✅ `/api/orders/recent` (low)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/part-compatibility` (medium)
- ⛔ `/api/product-manuals/assign` (medium)
- ✅ `/api/product-manuals/bulk` (low)
- ✅ `/api/product-manuals/by-category` (low)
- ✅ `/api/product-manuals/rename-folder` (low)
- ✅ `/api/product-manuals/search` (low)
- ⛔ `/api/product-manuals/upsert` (medium)
- ✅ `/api/products/[sku]` (low)
- ✅ `/api/receiving-lines` (low)
- ⛔ `/api/receiving-lines/[id]/ensure-catalog` (medium)
- ✅ `/api/receiving-lines/[id]/manuals` (low)
- ✅ `/api/receiving-lines/[id]/qc-checks` (low)
- ✅ `/api/receiving-lines/[id]/testing-bundle` (low)
- ⛔ `/api/receiving/identify-label` (medium)
- ⛔ `/api/receiving/lookup-po` (medium)
- ✅ `/api/receiving/po/[poId]` (low)
- ⛔ `/api/receiving/visual-identify` (medium)
- ✅ `/api/reports/dead-stock` (low)
- ✅ `/api/reports/velocity` (low)
- ⛔ `/api/scan/resolve` (medium)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/checklist` (low)
- ✅ `/api/serial-units/[id]/checklist/bulk` (low)
- ✅ `/api/shipped/submit` (low)
- ✅ `/api/sku` (low)
- ✅ `/api/sku-catalog/[id]/manuals` (low)
- ✅ `/api/sku-catalog/[id]/similar` (low)
- ⛔ `/api/sku-catalog/graph/[skuId]/children` (medium)
- ⛔ `/api/sku-catalog/graph/[skuId]/parents` (medium)
- ⛔ `/api/sku-catalog/graph/[skuId]/tree` (medium)
- ✅ `/api/sku-catalog/pair` (low)
- ✅ `/api/sku-catalog/pair-suggestions` (low)
- ✅ `/api/sku-catalog/pairing-queue` (low)
- ✅ `/api/sku-catalog/pairing-queue/count` (low)
- ✅ `/api/sku-catalog/resolve` (low)
- ✅ `/api/sku-catalog/run-migration` (low)
- ✅ `/api/sku-catalog/search` (low)
- ✅ `/api/sku-catalog/search-unmatched` (low)
- ✅ `/api/sku-catalog/suggest-for-item` (low)
- ✅ `/api/sku-catalog/sync-ecwid-titles` (low)
- ✅ `/api/sku-stock` (low)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ✅ `/api/sku-stock/[sku]/bins` (low)
- ⛔ `/api/sync-sheets` (medium)
- ✅ `/api/tech/orders-without-manual` (low)
- ⛔ `/api/units/next-id` (medium)
- ⛔ `/api/units/resolve-id` (medium)

### `sku_management` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/sku-manager` (low)

### `sku_pairing_audit` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/sku-catalog/pair-batch` (medium)

### `sku_pairing_suggestions` — 4 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/sku-catalog/refresh-suggestions` (high)
- ✅ `/api/sku-catalog/pairing-queue` (low)
- ✅ `/api/sku-catalog/pairing-queue/count` (low)
- ✅ `/api/sku-catalog/suggest-for-item` (low)

### `sku_platform_ids` — 25 routes, 5 not yet GUC-safe

- ⛔ `/api/cron/sku-catalog/refresh-suggestions` (high)
- ✅ `/api/ecwid/recent-repair-orders` (low)
- ✅ `/api/get-title-by-sku` (low)
- ✅ `/api/local-pickups` (low)
- ✅ `/api/manuals/recent` (low)
- ✅ `/api/manuals/resolve` (low)
- ✅ `/api/manuals/upsert` (low)
- ⛔ `/api/packing-logs` (medium)
- ✅ `/api/products/[sku]` (low)
- ⛔ `/api/receiving/add-unmatched-line` (medium)
- ⛔ `/api/receiving/pending-check` (medium)
- ✅ `/api/reports/dead-stock` (low)
- ✅ `/api/reports/velocity` (low)
- ✅ `/api/sku` (low)
- ✅ `/api/sku-catalog/pair` (low)
- ✅ `/api/sku-catalog/pair-suggestions` (low)
- ✅ `/api/sku-catalog/pairing-queue` (low)
- ✅ `/api/sku-catalog/resolve` (low)
- ✅ `/api/sku-catalog/run-migration` (low)
- ✅ `/api/sku-catalog/search` (low)
- ✅ `/api/sku-catalog/search-unmatched` (low)
- ⛔ `/api/sku-catalog/suggest-pairings` (medium)
- ✅ `/api/sku-catalog/sync-ecwid-products` (low)
- ✅ `/api/sku-stock` (low)
- ✅ `/api/sku-stock/[sku]/bins` (low)

### `sku_relationships` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/sku-catalog/graph/relationships/[id]` (low)

### `sku_stock` — 91 routes, 38 not yet GUC-safe

- ⛔ `/api/assignments/sku-search` (medium)
- ⛔ `/api/cron/inventory/drift-check` (high)
- ✅ `/api/cycle-counts/campaigns/[id]` (low)
- ✅ `/api/cycle-counts/lines/[id]` (low)
- ⛔ `/api/ecwid/products/search` (high)
- ⛔ `/api/failure-modes` (medium)
- ⛔ `/api/failure-modes/[id]` (medium)
- ⛔ `/api/favorites` (medium)
- ⛔ `/api/favorites/[id]` (medium)
- ✅ `/api/get-title-by-sku` (low)
- ✅ `/api/inventory-events` (low)
- ✅ `/api/inventory/alerts` (low)
- ⛔ `/api/inventory/bins-overview` (medium)
- ✅ `/api/inventory/sku-search` (low)
- ✅ `/api/inventory/units` (low)
- ⛔ `/api/locations/[barcode]` (medium)
- ⛔ `/api/locations/[barcode]/properties` (medium)
- ✅ `/api/locations/[barcode]/swap` (low)
- ⛔ `/api/manual-server/assign` (critical)
- ⛔ `/api/manual-server/by-item` (high)
- ⛔ `/api/manual-server/unassigned` (high)
- ✅ `/api/manuals/resolve` (low)
- ✅ `/api/manuals/upsert` (low)
- ⛔ `/api/need-to-order` (medium)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ⛔ `/api/pack/ship` (medium)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/packing-logs/update` (medium)
- ✅ `/api/photos/[id]` (low)
- ⛔ `/api/product-manuals` (medium)
- ✅ `/api/product-manuals/by-category` (low)
- ✅ `/api/products/[sku]` (low)
- ✅ `/api/quality/dashboard` (low)
- ✅ `/api/reason-codes` (low)
- ⛔ `/api/reason-codes/[id]` (medium)
- ✅ `/api/receiving-lines/[id]/qc-checks` (low)
- ⛔ `/api/receiving/mark-received` (medium)
- ✅ `/api/replenish/shipped-fifo` (low)
- ✅ `/api/reports/dead-stock` (low)
- ✅ `/api/reports/velocity` (low)
- ⛔ `/api/returns/intake` (medium)
- ✅ `/api/returns/undo` (low)
- ✅ `/api/rooms` (low)
- ⛔ `/api/rooms/[room]` (medium)
- ⛔ `/api/rooms/reorder` (medium)
- ✅ `/api/scan/history` (low)
- ⛔ `/api/scan/resolve` (medium)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/failure-tags` (low)
- ✅ `/api/serial-units/[id]/hold` (low)
- ⛔ `/api/serial-units/[id]/photos` (medium)
- ✅ `/api/serial-units/[id]/quality` (low)
- ✅ `/api/serial-units/[id]/release` (low)
- ✅ `/api/sku` (low)
- ⛔ `/api/sku-catalog` (medium)
- ✅ `/api/sku-catalog/[id]` (low)
- ✅ `/api/sku-catalog/[id]/manuals` (low)
- ⛔ `/api/sku-catalog/[id]/platform-ids` (medium)
- ✅ `/api/sku-catalog/[id]/qc-checks` (low)
- ✅ `/api/sku-catalog/[id]/similar` (low)
- ⛔ `/api/sku-catalog/graph/[skuId]/children` (medium)
- ⛔ `/api/sku-catalog/graph/[skuId]/parents` (medium)
- ⛔ `/api/sku-catalog/graph/[skuId]/tree` (medium)
- ⛔ `/api/sku-catalog/graph/relationships` (medium)
- ✅ `/api/sku-catalog/graph/relationships/[id]` (low)
- ✅ `/api/sku-catalog/pair` (low)
- ⛔ `/api/sku-catalog/pair-batch` (medium)
- ⛔ `/api/sku-catalog/pair-ecwid` (medium)
- ✅ `/api/sku-catalog/pair-suggestions` (low)
- ✅ `/api/sku-catalog/pairing-queue` (low)
- ✅ `/api/sku-catalog/pairing-queue/count` (low)
- ✅ `/api/sku-catalog/search` (low)
- ✅ `/api/sku-catalog/search-unmatched` (low)
- ✅ `/api/sku-catalog/suggest-for-item` (low)
- ⛔ `/api/sku-catalog/suggest-pairings` (medium)
- ✅ `/api/sku-catalog/unpaired` (low)
- ⛔ `/api/sku-catalog/unpaired-ecwid` (medium)
- ✅ `/api/sku-manager` (low)
- ✅ `/api/sku-stock` (low)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ✅ `/api/sku-stock/[sku]/bins` (low)
- ✅ `/api/sku/[id]/photos` (low)
- ✅ `/api/sku/by-tracking` (low)
- ✅ `/api/sku/lookup` (low)
- ✅ `/api/sku/serials-from-code` (low)
- ✅ `/api/stock-alerts` (low)
- ⛔ `/api/tech/scan-sku` (medium)
- ✅ `/api/update-sku-location` (low)
- ✅ `/api/warehouses` (low)
- ⛔ `/api/work-orders` (medium)
- ✅ `/api/zoho/items/[id]/image` (low)

### `sku_stock_ledger` — 16 routes, 9 not yet GUC-safe

- ✅ `/api/activity/feed` (low)
- ⛔ `/api/audit/sku/[sku]` (medium)
- ⛔ `/api/cron/inventory/drift-check` (high)
- ✅ `/api/fba/shipments/[id]/ship-units` (low)
- ✅ `/api/locations/[barcode]/swap` (low)
- ⛔ `/api/pack/ship` (medium)
- ⛔ `/api/packing-logs/update` (medium)
- ⛔ `/api/receiving/mark-received` (medium)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ✅ `/api/reports/dead-stock` (low)
- ✅ `/api/reports/velocity` (low)
- ⛔ `/api/returns/intake` (medium)
- ✅ `/api/returns/undo` (low)
- ✅ `/api/serial-units/[id]/move` (low)
- ⛔ `/api/sku-stock/[sku]` (medium)
- ⛔ `/api/tech/scan-sku` (medium)

### `sourcing_alerts` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/sourcing/scan` (high)

### `square_transactions` — 3 routes, 3 not yet GUC-safe

- ⛔ `/api/walk-in/sales` (medium)
- ⛔ `/api/walk-in/sync` (medium)
- ⛔ `/api/webhooks/square` (critical)

### `staff` — 144 routes, 66 not yet GUC-safe

- ✅ `/api/activity/feed` (low)
- ✅ `/api/admin/audit` (low)
- ✅ `/api/admin/features` (low)
- ✅ `/api/admin/features/[id]` (low)
- ⛔ `/api/admin/integrations/list` (medium)
- ✅ `/api/admin/logs` (low)
- ✅ `/api/admin/org/export` (low)
- ✅ `/api/admin/roles` (low)
- ✅ `/api/admin/roles/[id]` (low)
- ✅ `/api/admin/roles/[id]/mobile-defaults` (low)
- ✅ `/api/admin/sessions` (low)
- ✅ `/api/admin/staff` (low)
- ✅ `/api/admin/staff/[id]` (low)
- ✅ `/api/admin/staff/[id]/detail` (low)
- ⛔ `/api/admin/staff/[id]/enroll-token` (medium)
- ✅ `/api/admin/staff/[id]/mobile-display-config` (low)
- ✅ `/api/admin/staff/[id]/passkeys` (low)
- ✅ `/api/admin/staff/[id]/passkeys/[pid]` (low)
- ✅ `/api/admin/staff/[id]/permissions` (low)
- ✅ `/api/admin/staff/[id]/reset-pin` (low)
- ✅ `/api/admin/staff/[id]/roles` (low)
- ✅ `/api/admin/staff/[id]/sessions` (low)
- ✅ `/api/admin/staff/[id]/set-pin` (low)
- ✅ `/api/admin/staff/[id]/stations` (low)
- ✅ `/api/admin/staff/deactivate` (low)
- ✅ `/api/admin/staff/invite` (low)
- ⛔ `/api/admin/staff/list` (medium)
- ✅ `/api/admin/staff/reorder` (low)
- ⛔ `/api/admin/staff/update` (medium)
- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/ai/chat/stream` (medium)
- ⛔ `/api/assignments/sku-search` (medium)
- ✅ `/api/audit-log/report` (low)
- ⛔ `/api/audit-log/staff` (medium)
- ✅ `/api/audit-log/staff-directory` (low)
- ⛔ `/api/auth/enroll/[token]` (critical)
- ⛔ `/api/auth/passkey/authenticate/begin` (critical)
- ⛔ `/api/auth/passkey/authenticate/finish` (critical)
- ⛔ `/api/auth/passkey/register/begin` (critical)
- ⛔ `/api/auth/passkey/register/finish` (critical)
- ⛔ `/api/auth/pin` (critical)
- ⛔ `/api/auth/pin/create` (critical)
- ⛔ `/api/auth/session` (medium)
- ⛔ `/api/auth/signin` (critical)
- ⛔ `/api/auth/signout` (critical)
- ⛔ `/api/auth/signup` (critical)
- ⛔ `/api/auth/sso/callback` (medium)
- ⛔ `/api/auth/staff-picker` (high)
- ⛔ `/api/auth/switch` (critical)
- ⛔ `/api/cron/staff-goals/history` (high)
- ✅ `/api/cycle-counts/campaigns` (low)
- ✅ `/api/dashboard/fba-shipments` (low)
- ✅ `/api/dashboard/operations` (low)
- ✅ `/api/fba/items/queue` (low)
- ✅ `/api/fba/items/ready` (low)
- ✅ `/api/fba/items/scan` (low)
- ✅ `/api/fba/items/verify` (low)
- ✅ `/api/fba/labels/bind` (low)
- ✅ `/api/fba/logs` (low)
- ✅ `/api/fba/logs/[id]` (low)
- ✅ `/api/fba/shipments` (low)
- ✅ `/api/fba/shipments/[id]` (low)
- ✅ `/api/fba/shipments/[id]/items` (low)
- ✅ `/api/fba/shipments/[id]/items/[itemId]` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/close` (low)
- ✅ `/api/fba/shipments/today` (low)
- ✅ `/api/global-search` (low)
- ✅ `/api/inbox/tech-queue` (low)
- ✅ `/api/inventory-events` (low)
- ✅ `/api/labels/recent` (low)
- ✅ `/api/local-pickup-orders` (low)
- ✅ `/api/local-pickup-orders/[id]` (low)
- ⛔ `/api/nas-dev/[[...path]]` (critical)
- ⛔ `/api/need-to-order/[id]` (medium)
- ✅ `/api/operations/kpi-table` (low)
- ⛔ `/api/orders` (medium)
- ✅ `/api/orders-exceptions/sync` (low)
- ⛔ `/api/orders/[id]/timeline` (medium)
- ⛔ `/api/orders/assign` (medium)
- ✅ `/api/orders/batch` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ⛔ `/api/orders/missing-parts` (medium)
- ✅ `/api/orders/next` (low)
- ⛔ `/api/packing-logs` (medium)
- ✅ `/api/packing-logs/history` (low)
- ⛔ `/api/realtime/token` (medium)
- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ⛔ `/api/receiving-lines/incoming/email-rescan` (medium)
- ⛔ `/api/receiving-lines/view` (medium)
- ⛔ `/api/receiving/[id]` (medium)
- ✅ `/api/receiving/lines/[id]/timeline` (low)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/mark-received` (medium)
- ⛔ `/api/receiving/mark-received-po` (medium)
- ✅ `/api/receiving/match` (low)
- ✅ `/api/receiving/pending-unboxing` (low)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]` (medium)
- ✅ `/api/repair-service/next` (low)
- ⛔ `/api/repair/actions` (medium)
- ⛔ `/api/replenishment/tasks/[id]/cancel` (medium)
- ⛔ `/api/replenishment/tasks/[id]/claim` (medium)
- ⛔ `/api/replenishment/tasks/[id]/complete` (medium)
- ⛔ `/api/rma` (medium)
- ⛔ `/api/rma/[id]/close` (medium)
- ⛔ `/api/rma/[id]/disposition` (medium)
- ⛔ `/api/rma/[id]/mark-received` (medium)
- ✅ `/api/scan/history` (low)
- ⛔ `/api/scan/resolve` (medium)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/checklist` (low)
- ✅ `/api/serial-units/[id]/checklist/bulk` (low)
- ⛔ `/api/serial-units/[id]/repairs` (medium)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ✅ `/api/shifts` (low)
- ✅ `/api/shifts/[id]/cover` (low)
- ⛔ `/api/staff` (medium)
- ✅ `/api/staff-goals` (low)
- ✅ `/api/staff-goals/history` (low)
- ⛔ `/api/staff-goals/me` (medium)
- ⛔ `/api/staff-messages` (medium)
- ⛔ `/api/staff-todos` (medium)
- ✅ `/api/staff/availability-rules` (low)
- ✅ `/api/staff/availability-today` (low)
- ⛔ `/api/staff/schedule` (medium)
- ⛔ `/api/staff/schedule/bulk` (medium)
- ⛔ `/api/staff/schedule/week` (medium)
- ⛔ `/api/staff/schedule/week/copy` (medium)
- ⛔ `/api/stations` (medium)
- ✅ `/api/stations/publish` (low)
- ⛔ `/api/tech/delete` (medium)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/scan` (low)
- ⛔ `/api/tech/scan-repair-station` (medium)
- ⛔ `/api/tech/scan-sku` (medium)
- ✅ `/api/testing/recent` (low)
- ✅ `/api/tracking-exceptions` (low)
- ✅ `/api/tracking-exceptions/[id]` (low)
- ⛔ `/api/warranty/claims` (medium)
- ⛔ `/api/warranty/claims/[id]/quote` (medium)
- ⛔ `/api/warranty/claims/[id]/rma` (medium)
- ⛔ `/api/warranty/claims/bulk` (medium)
- ⛔ `/api/work-orders` (medium)

### `staff_availability_rules` — 7 routes, 5 not yet GUC-safe

- ⛔ `/api/staff` (medium)
- ✅ `/api/staff/availability-rules` (low)
- ✅ `/api/staff/availability-today` (low)
- ⛔ `/api/staff/schedule` (medium)
- ⛔ `/api/staff/schedule/bulk` (medium)
- ⛔ `/api/staff/schedule/week` (medium)
- ⛔ `/api/staff/schedule/week/copy` (medium)

### `staff_enrollments` — 2 routes, 1 not yet GUC-safe

- ⛔ `/api/admin/staff/[id]/enroll-token` (medium)
- ✅ `/api/admin/staff/invite` (low)

### `staff_goal_history` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/staff-goals/history` (low)

### `staff_goals` — 3 routes, 2 not yet GUC-safe

- ⛔ `/api/cron/staff-goals/history` (high)
- ✅ `/api/staff-goals` (low)
- ⛔ `/api/staff-goals/me` (medium)

### `staff_passkeys` — 4 routes, 0 not yet GUC-safe

- ✅ `/api/admin/staff` (low)
- ✅ `/api/admin/staff/[id]/detail` (low)
- ✅ `/api/admin/staff/[id]/passkeys` (low)
- ✅ `/api/admin/staff/[id]/passkeys/[pid]` (low)

### `staff_schedule_overrides` — 6 routes, 5 not yet GUC-safe

- ⛔ `/api/staff` (medium)
- ✅ `/api/staff/availability-today` (low)
- ⛔ `/api/staff/schedule` (medium)
- ⛔ `/api/staff/schedule/bulk` (medium)
- ⛔ `/api/staff/schedule/week` (medium)
- ⛔ `/api/staff/schedule/week/copy` (medium)

### `staff_sessions` — 7 routes, 1 not yet GUC-safe

- ⛔ `/api/admin/org/delete` (medium)
- ✅ `/api/admin/org/export` (low)
- ✅ `/api/admin/sessions` (low)
- ✅ `/api/admin/staff/[id]/detail` (low)
- ✅ `/api/admin/staff/[id]/sessions` (low)
- ✅ `/api/admin/staff/deactivate` (low)
- ✅ `/api/shifts/[id]/cover` (low)

### `staff_stations` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/staff-goals/me` (medium)

### `staff_todo_completions` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/staff-todos` (medium)

### `staff_week_plans` — 6 routes, 5 not yet GUC-safe

- ⛔ `/api/staff` (medium)
- ✅ `/api/staff/availability-today` (low)
- ⛔ `/api/staff/schedule` (medium)
- ⛔ `/api/staff/schedule/bulk` (medium)
- ⛔ `/api/staff/schedule/week` (medium)
- ⛔ `/api/staff/schedule/week/copy` (medium)

### `staff_weekly_schedule` — 6 routes, 5 not yet GUC-safe

- ⛔ `/api/staff` (medium)
- ✅ `/api/staff/availability-today` (low)
- ⛔ `/api/staff/schedule` (medium)
- ⛔ `/api/staff/schedule/bulk` (medium)
- ⛔ `/api/staff/schedule/week` (medium)
- ⛔ `/api/staff/schedule/week/copy` (medium)

### `station_activity_logs` — 28 routes, 11 not yet GUC-safe

- ✅ `/api/activity/feed` (low)
- ✅ `/api/admin/logs` (low)
- ✅ `/api/audit-log/report` (low)
- ✅ `/api/audit-log/staff-directory` (low)
- ✅ `/api/dashboard/operations` (low)
- ✅ `/api/labels/recent` (low)
- ✅ `/api/operations/kpi-table` (low)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders/[id]/timeline` (medium)
- ⛔ `/api/orders/check-shipped` (medium)
- ✅ `/api/orders/next` (low)
- ⛔ `/api/pack/ship` (medium)
- ⛔ `/api/packerlogs` (medium)
- ⛔ `/api/post-multi-sn` (medium)
- ✅ `/api/replenish/shipped-fifo` (low)
- ✅ `/api/serial-units/[id]` (low)
- ⛔ `/api/shipped/scan-out` (medium)
- ✅ `/api/staff-goals` (low)
- ⛔ `/api/staff-goals/me` (medium)
- ✅ `/api/tech/add-serial` (low)
- ✅ `/api/tech/add-serial-to-last` (low)
- ⛔ `/api/tech/delete` (medium)
- ✅ `/api/tech/delete-tracking` (low)
- ✅ `/api/tech/logs` (low)
- ⛔ `/api/tech/serial` (medium)
- ✅ `/api/tech/undo-last` (low)
- ✅ `/api/tech/update-serials` (low)
- ⛔ `/api/work-orders` (medium)

### `station_definitions` — 4 routes, 2 not yet GUC-safe

- ⛔ `/api/stations` (medium)
- ✅ `/api/stations/publish` (low)
- ✅ `/api/studio/definitions/[id]/publish` (low)
- ⛔ `/api/studio/nodes/[id]/station` (medium)

### `station_scan_sessions` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/receiving-lines` (low)

### `stock_alerts` — 5 routes, 2 not yet GUC-safe

- ⛔ `/api/cron/inventory/drift-check` (high)
- ⛔ `/api/cron/stock-alerts` (high)
- ✅ `/api/inventory/alerts` (low)
- ✅ `/api/inventory/alerts/[id]/ack` (low)
- ✅ `/api/stock-alerts` (low)

### `suppliers` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/suppliers` (medium)
- ⛔ `/api/suppliers/[id]` (medium)

### `sync_cursors` — 2 routes, 1 not yet GUC-safe

- ✅ `/api/admin/po-mirror/health` (low)
- ⛔ `/api/cron/zoho/incoming-po-sync` (high)

### `tech_serial_numbers` — 23 routes, 10 not yet GUC-safe

- ✅ `/api/admin/logs` (low)
- ✅ `/api/audit-log/report` (low)
- ✅ `/api/ebay/search` (low)
- ✅ `/api/fba/logs/summary` (low)
- ✅ `/api/google-sheets/execute-script` (low)
- ✅ `/api/labels/recent` (low)
- ✅ `/api/orders/batch` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ⛔ `/api/orders/start` (critical)
- ⛔ `/api/post-multi-sn` (medium)
- ⛔ `/api/receiving/scan-serial` (medium)
- ⛔ `/api/receiving/serials` (medium)
- ⛔ `/api/scan/resolve` (medium)
- ✅ `/api/serial-units/[id]` (low)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/serial-units/lookup` (medium)
- ⛔ `/api/sync-sheets` (medium)
- ⛔ `/api/tech/delete` (medium)
- ✅ `/api/tech/delete-tracking` (low)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/orders-without-manual` (low)
- ✅ `/api/tech/scan` (low)
- ⛔ `/api/tech/serial` (medium)

### `tech_verifications` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/serial-units/[id]/checklist` (low)
- ✅ `/api/serial-units/[id]/checklist/bulk` (low)

### `testing_results` — 4 routes, 1 not yet GUC-safe

- ✅ `/api/receiving-lines` (low)
- ✅ `/api/serial-units/[id]/checklist` (low)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ✅ `/api/testing/recent` (low)

### `ticket_links` — 6 routes, 6 not yet GUC-safe

- ⛔ `/api/receiving/zendesk-claim` (medium)
- ⛔ `/api/receiving/zendesk-claim/link` (medium)
- ⛔ `/api/warranty/claims/[id]/zendesk` (medium)
- ⛔ `/api/warranty/claims/[id]/zendesk/link` (medium)
- ⛔ `/api/zendesk/tickets` (medium)
- ⛔ `/api/zendesk/tickets/[id]/photos` (medium)

### `tracking_exceptions` — 4 routes, 2 not yet GUC-safe

- ⛔ `/api/receiving/lookup-po` (medium)
- ✅ `/api/tracking-exceptions` (low)
- ✅ `/api/tracking-exceptions/[id]` (low)
- ⛔ `/api/tracking-exceptions/[id]/refresh` (medium)

### `types` — 17 routes, 13 not yet GUC-safe

- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/ai/chat/stream` (medium)
- ⛔ `/api/auth/passkey/authenticate/finish` (critical)
- ⛔ `/api/auth/passkey/register/finish` (critical)
- ⛔ `/api/auth/step-up` (critical)
- ⛔ `/api/catalog/types` (medium)
- ⛔ `/api/catalog/types/[id]` (medium)
- ⛔ `/api/catalog/workflow-nodes` (medium)
- ✅ `/api/receiving-lines/incoming/refresh/stream` (low)
- ⛔ `/api/repair/square-payment-link` (medium)
- ✅ `/api/serial-units/[id]/grade` (low)
- ⛔ `/api/shipping/track/register` (critical)
- ⛔ `/api/shipping/track/sync-one` (medium)
- ✅ `/api/studio/definitions/[id]/graph` (low)
- ⛔ `/api/studio/graph` (medium)
- ✅ `/api/webhooks/zoho/orders` (low)
- ⛔ `/api/zoho/webhooks` (critical)

### `unfound_overlay` — 4 routes, 4 not yet GUC-safe

- ⛔ `/api/receiving/unfound-queue/[kind]/[id]` (medium)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk` (medium)
- ⛔ `/api/receiving/zendesk-claim/link` (medium)
- ⛔ `/api/zendesk/tickets/[id]/photos` (medium)

### `unit_failure_tags` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/quality/dashboard` (low)
- ✅ `/api/serial-units/[id]/failure-tags` (low)

### `unit_id_sequences` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/units/next-id` (medium)

### `unit_quality_scores` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/quality/dashboard` (low)

### `unit_repairs` — 3 routes, 2 not yet GUC-safe

- ✅ `/api/quality/dashboard` (low)
- ⛔ `/api/repair/actions` (medium)
- ⛔ `/api/serial-units/[id]/repairs` (medium)

### `warehouses` — 3 routes, 2 not yet GUC-safe

- ✅ `/api/warehouses` (low)
- ⛔ `/api/zoho/oauth/authorize` (high)
- ⛔ `/api/zoho/warehouses` (medium)

### `warranty_claims` — 4 routes, 2 not yet GUC-safe

- ✅ `/api/warranty/claims/[id]/restore` (low)
- ⛔ `/api/warranty/claims/[id]/rma` (medium)
- ⛔ `/api/warranty/claims/[id]/zendesk/link` (medium)
- ✅ `/api/warranty/claims/bulk/restore` (low)

### `work_assignments` — 34 routes, 14 not yet GUC-safe

- ✅ `/api/assignments/next` (low)
- ⛔ `/api/assignments/sku-search` (medium)
- ✅ `/api/check-tracking` (low)
- ✅ `/api/dashboard/operations` (low)
- ✅ `/api/debug-tracking` (low)
- ✅ `/api/ebay/search` (low)
- ✅ `/api/fba/shipments` (low)
- ✅ `/api/fba/shipments/today/duplicate-yesterday` (low)
- ✅ `/api/fba/shipments/today/items` (low)
- ✅ `/api/google-sheets/sync-shipstation-orders` (low)
- ⛔ `/api/import-orders` (medium)
- ✅ `/api/local-pickups` (low)
- ⛔ `/api/orders` (medium)
- ⛔ `/api/orders/assign` (medium)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ✅ `/api/orders/next` (low)
- ✅ `/api/orders/recent` (low)
- ⛔ `/api/packing-logs` (medium)
- ⛔ `/api/packing-logs/update` (medium)
- ✅ `/api/pick/queue` (low)
- ⛔ `/api/receiving-entry` (medium)
- ⛔ `/api/receiving-logs` (medium)
- ✅ `/api/receiving/match` (low)
- ✅ `/api/repair-service/next` (low)
- ✅ `/api/repair-service/out-of-stock` (low)
- ⛔ `/api/repair-service/pickup` (medium)
- ⛔ `/api/repair-service/repaired` (medium)
- ⛔ `/api/repair/submit` (medium)
- ⛔ `/api/sync-sheets` (medium)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/orders-without-manual` (low)
- ✅ `/api/tech/scan` (low)
- ⛔ `/api/work-orders` (medium)
- ⛔ `/api/zoho/purchase-orders/receive` (medium)

### `workflow_definitions` — 5 routes, 0 not yet GUC-safe

- ✅ `/api/stations/publish` (low)
- ✅ `/api/studio/definitions/[id]/discard` (low)
- ✅ `/api/studio/definitions/[id]/graph` (low)
- ✅ `/api/studio/definitions/[id]/publish` (low)
- ✅ `/api/studio/definitions/draft` (low)

### `workflow_edges` — 4 routes, 0 not yet GUC-safe

- ✅ `/api/studio/definitions/[id]/discard` (low)
- ✅ `/api/studio/definitions/[id]/graph` (low)
- ✅ `/api/studio/definitions/[id]/publish` (low)
- ✅ `/api/studio/definitions/draft` (low)

### `workflow_node_stats` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/workflow-node-stats` (high)

### `workflow_nodes` — 4 routes, 0 not yet GUC-safe

- ✅ `/api/studio/definitions/[id]/discard` (low)
- ✅ `/api/studio/definitions/[id]/graph` (low)
- ✅ `/api/studio/definitions/[id]/publish` (low)
- ✅ `/api/studio/definitions/draft` (low)

### `zoho_fulfillment_sync` — 2 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/zoho/fulfillment-sync` (high)
- ✅ `/api/zoho/fulfillment-sync` (low)

### `zoho_item_images` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/zoho/items/[id]/image` (low)

### `zoho_po_mirror` — 12 routes, 6 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/triage/[id]/detail` (medium)
- ✅ `/api/admin/po-mirror/health` (low)
- ⛔ `/api/cron/zoho/incoming-po-sync` (high)
- ⛔ `/api/cron/zoho/po-sync` (high)
- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/delivered-unscanned` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ✅ `/api/receiving-lines/incoming/refresh/stream` (low)
- ✅ `/api/receiving-lines/incoming/summary` (low)
- ⛔ `/api/receiving-lines/incoming/zoho-refresh` (critical)
- ⛔ `/api/receiving/lookup-po` (medium)
- ⛔ `/api/receiving/po/[poId]/attach-box` (medium)
