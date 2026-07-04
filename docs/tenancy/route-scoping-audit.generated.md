# Route scoping audit — GENERATED

> Static scan of `src/app/api/**/route.ts`. Regenerate: `node scripts/tenancy-route-audit.mjs`.
> "touches tenant table" = the handler body word-matches a non-system table from the coverage doc.
> Risk: **critical** = mutates a tenant table with no org filter & no GUC; **high** = reads one with no
> org filter & no GUC; **medium** = has an org filter but no GUC/RLS backstop; **low** = GUC-wrapped.

## Summary

| metric | count |
|---|---|
| total route files | 755 |
| withAuth | 575 |
| GUC-wrapped (tenantQuery/withTenantConnection/withTenantTransaction) | 357 |
| references organizationId | 643 |
| raw @/lib/db pool import | 192 |
| drizzle / neon-http | 21 |
| uses USAV_ORG_ID / transitionalUsavOrgId | 40 |
| cron routes | 32 |

| risk | count |
|---|---|
| critical | 22 |
| high | 36 |
| medium | 252 |
| low | 350 |
| info | 95 |

## Routes by risk (critical + high first)

| risk | route | methods | auth | orgRef | GUC | tables touched |
|---|---|---|:-:|:-:|:-:|---|
| critical | `/api/ai/search` | POST | ✅ | — | — | messages |
| critical | `/api/auth/account/passkey/[id]` | DELETE | — | — | — | memberships |
| critical | `/api/auth/account/passkey/register/begin` | POST | — | — | — | memberships, accounts |
| critical | `/api/auth/account/passkey/register/finish` | POST | — | — | — | memberships, types |
| critical | `/api/auth/email-login/request` | POST | ✅ | — | — | email_login_tokens, staff |
| critical | `/api/auth/enroll/[token]` | GET/POST | — | — | — | staff |
| critical | `/api/auth/passkey/authenticate/begin` | POST | — | — | — | staff |
| critical | `/api/auth/passkey/authenticate/finish` | POST | — | — | — | staff, types |
| critical | `/api/auth/passkey/register/begin` | POST | — | — | — | staff |
| critical | `/api/auth/passkey/register/finish` | POST | — | — | — | staff, types |
| critical | `/api/auth/pin/create` | POST | — | — | — | staff |
| critical | `/api/auth/signin` | POST | — | — | — | staff |
| critical | `/api/auth/signout` | POST | — | — | — | staff |
| critical | `/api/auth/step-up` | POST | — | — | — | types |
| critical | `/api/beta/waitlist` | POST | — | — | — | beta_waitlist |
| critical | `/api/nas-dev/[[...path]]` | GET/PUT | — | — | — | receiving, packages, photos, staff |
| critical | `/api/orders/skip` | POST | ✅ | — | — | orders |
| critical | `/api/orders/start` | POST | ✅ | — | — | tech_serial_numbers, orders |
| critical | `/api/receiving/disposition-suggest` | POST | ✅ | — | — | receiving |
| critical | `/api/receiving/zendesk-claim/classify` | POST | ✅ | — | — | receiving |
| critical | `/api/webhooks/square` | POST/GET | — | — | — | square_transactions, orders, items, sku |
| critical | `/api/webhooks/ups` | POST/GET | — | — | — | shipping_tracking_numbers, shipment_tracking_events, packages |
| high | `/api/admin/po-gmail/connect` | GET | ✅ | — | — | accounts |
| high | `/api/auth/account/passkey` | GET | — | — | — | memberships, staff |
| high | `/api/auth/email-login/verify` | GET | ✅ | — | — | email_login_tokens |
| high | `/api/auth/staff-picker` | GET | — | — | — | staff |
| high | `/api/auth/verify-email` | GET | ✅ | — | — | email_login_tokens, account_emails, staff |
| high | `/api/beta/spots` | GET | — | — | — | beta_waitlist |
| high | `/api/cron/amazon/orders-sync` | GET | — | — | — | amazon_accounts, accounts, orders |
| high | `/api/cron/cleanup` | GET | — | — | — | api_idempotency_responses, entity_search_outbox |
| high | `/api/cron/ebay/purchase-sync` | GET | — | — | — | accounts |
| high | `/api/cron/feed-membership-projection` | GET | — | — | — | feed_memberships, receiving |
| high | `/api/cron/integrations/sync` | GET | — | — | — | orders |
| high | `/api/cron/inventory/drift-check` | GET | — | — | — | sku_stock_ledger, stock_alerts, sku_stock, sku |
| high | `/api/cron/receiving/incoming-tracking-sync` | GET | — | — | — | receiving |
| high | `/api/cron/search-outbox` | GET | — | — | — | entity_search_outbox, entity_search_docs, staff |
| high | `/api/cron/shipping/reconcile-delivered` | GET | — | — | — | warranty_claims, receiving |
| high | `/api/cron/shipping/sync-due` | GET | — | — | — | shipping_tracking_numbers, receiving |
| high | `/api/cron/signal-insight-rollup` | GET | — | — | — | entity_signals, insight_links |
| high | `/api/cron/signals/buyer-notes-heal` | GET | — | — | — | entity_signals, ebay_accounts, orders |
| high | `/api/cron/sku-catalog/refresh-suggestions` | GET | — | — | — | sku_pairing_suggestions, sku_platform_ids, sku_catalog, sku |
| high | `/api/cron/sourcing/scan` | GET | — | — | — | sourcing_alerts |
| high | `/api/cron/staff-goals/history` | GET | — | — | — | staff_goals, staff |
| high | `/api/cron/stock-alerts` | GET | — | — | — | bin_contents, stock_alerts, sku |
| high | `/api/cron/workflow-node-stats` | GET | — | — | — | item_workflow_state, workflow_node_stats |
| high | `/api/cron/zoho/fulfillment-sync` | GET | — | — | — | zoho_fulfillment_sync, orders |
| high | `/api/cron/zoho/orders-ingest-drain` | GET | — | — | — | order_ingest_queue, orders |
| high | `/api/desktop-app/release` | GET | — | — | — | orders |
| high | `/api/ecwid/order-search` | GET | ✅ | — | — | orders, items, types, sku |
| high | `/api/ecwid/products/search` | GET | ✅ | — | — | sku_stock, items, sku |
| high | `/api/manual-server/by-item` | GET | ✅ | — | — | sku_stock |
| high | `/api/manual-server/unassigned` | GET | ✅ | — | — | sku_stock |
| high | `/api/repair/ecwid-categories` | GET | ✅ | — | — | items |
| high | `/api/repair/ecwid-products` | GET | ✅ | — | — | items, sku |
| high | `/api/studio/templates` | GET | ✅ | — | — | types |
| high | `/api/studio/templates/[id]` | GET | ✅ | — | — | types |
| high | `/api/vision-config` | GET | ✅ | — | — | receiving |
| high | `/api/zoho/oauth/authorize` | GET | ✅ | — | — | warehouses, receiving, accounts, items |
| medium | `/api/admin/org/delete` | POST | ✅ | ✅ | — | staff_sessions |
| medium | `/api/admin/organization/settings` | GET/PATCH | ✅ | ✅ | — | receiving |
| medium | `/api/admin/photos/mirror` | POST | ✅ | ✅ | — | photos |
| medium | `/api/admin/po-gmail/disconnect` | POST | ✅ | ✅ | — | google_oauth_tokens |
| medium | `/api/admin/po-gmail/oauth-callback` | GET | ✅ | ✅ | — | google_oauth_tokens |
| medium | `/api/admin/po-gmail/preview-unread` | GET | ✅ | ✅ | — | messages, items |
| medium | `/api/admin/po-gmail/reconcile` | GET | ✅ | ✅ | — | email_missing_purchase_orders, receiving_lines, receiving, messages |
| medium | `/api/admin/po-gmail/status` | GET | ✅ | ✅ | — | google_oauth_tokens |
| medium | `/api/admin/staff/[id]/enroll-token` | POST | ✅ | ✅ | — | staff_enrollments, staff |
| medium | `/api/ai/chat` | POST | ✅ | ✅ | — | platforms, receiving, messages, orders, staff, types |
| medium | `/api/ai/chat/stream` | POST | ✅ | ✅ | — | receiving, messages, orders, staff, types |
| medium | `/api/ai/retrieve` | GET/POST | ✅ | ✅ | — | types |
| medium | `/api/amazon/health` | GET | ✅ | ✅ | — | accounts |
| medium | `/api/amazon/sync` | POST | ✅ | ✅ | — | accounts |
| medium | `/api/assistant/chat` | POST | ✅ | ✅ | — | staff, types |
| medium | `/api/assistant/mutations/[id]/revert` | POST | — | ✅ | — | staff |
| medium | `/api/assistant/mutations/stats` | GET | ✅ | ✅ | — | agent_mutations |
| medium | `/api/audit-log/packing` | GET | ✅ | ✅ | — | items, sku |
| medium | `/api/audit-log/receiving` | GET | ✅ | ✅ | — | receiving, items, sku |
| medium | `/api/audit-log/sku` | GET | ✅ | ✅ | — | items, sku |
| medium | `/api/audit-log/staff` | GET | ✅ | ✅ | — | staff |
| medium | `/api/audit-log/tech` | GET | ✅ | ✅ | — | items |
| medium | `/api/audit-log/trace` | GET | ✅ | ✅ | — | receiving |
| medium | `/api/audit/bin/[id]` | GET | — | ✅ | — | inventory_events, audit_logs, locations |
| medium | `/api/audit/sku/[sku]` | GET | — | ✅ | — | inventory_events, sku_stock_ledger, audit_logs, sku |
| medium | `/api/auth/account/passkey/authenticate/finish` | POST | — | ✅ | — | memberships, accounts, types |
| medium | `/api/auth/account/signin` | POST | — | ✅ | — | memberships, accounts |
| medium | `/api/auth/invitation/accept` | GET/POST | — | ✅ | — | memberships, staff |
| medium | `/api/auth/pin` | POST | — | ✅ | — | staff |
| medium | `/api/auth/session` | GET | — | ✅ | — | memberships, staff |
| medium | `/api/auth/signup` | POST | ✅ | ✅ | — | email_login_tokens, account_emails, memberships, accounts, staff |
| medium | `/api/auth/switch` | POST | — | ✅ | — | staff |
| medium | `/api/auth/switch-org` | POST | — | ✅ | — | auth_events, memberships, staff |
| medium | `/api/billing/portal` | POST | ✅ | ✅ | — | invoices |
| medium | `/api/billing/webhook` | POST | — | ✅ | — | invoices, items |
| medium | `/api/bose-models` | GET/POST | ✅ | ✅ | — | items |
| medium | `/api/call-events` | GET | ✅ | ✅ | — | items |
| medium | `/api/catalog/platform-accounts` | GET/POST | ✅ | ✅ | — | receiving, accounts |
| medium | `/api/catalog/platform-accounts/[id]` | PATCH/DELETE | — | ✅ | — | accounts |
| medium | `/api/catalog/platforms` | GET/POST | ✅ | ✅ | — | platforms, receiving |
| medium | `/api/catalog/platforms/[id]` | PATCH/DELETE | — | ✅ | — | platforms |
| medium | `/api/catalog/types` | GET/POST | ✅ | ✅ | — | receiving, types |
| medium | `/api/catalog/types/[id]` | PATCH/DELETE | — | ✅ | — | types |
| medium | `/api/checklists` | GET/POST/PUT/DELETE | ✅ | ✅ | — | checklist_templates, receiving, sku_stock, items |
| medium | `/api/cron/photos/analyze` | GET/POST | — | ✅ | — | photo_jobs, photos, staff |
| medium | `/api/cron/photos/drive-mirror` | GET | — | ✅ | — | photos |
| medium | `/api/cron/photos/nas-mirror` | GET | — | ✅ | — | photos |
| medium | `/api/documents/[id]` | DELETE | — | ✅ | — | document_entity_links, documents, orders |
| medium | `/api/documents/download-zip` | GET | — | ✅ | — | documents, orders |
| medium | `/api/ebay/connect` | GET | ✅ | ✅ | — | ebay_accounts |
| medium | `/api/ebay/health` | GET | ✅ | ✅ | — | accounts |
| medium | `/api/ebay/refresh-tokens` | POST/GET | ✅ | ✅ | — | accounts |
| medium | `/api/ebay/sync` | POST/GET | ✅ | ✅ | — | accounts |
| medium | `/api/ecwid/transfer-orders` | POST | ✅ | ✅ | — | orders |
| medium | `/api/entity-signals` | GET | ✅ | ✅ | — | entity_signals |
| medium | `/api/failure-modes` | GET/POST | ✅ | ✅ | — | sku_stock |
| medium | `/api/failure-modes/[id]` | PATCH/DELETE | ✅ | ✅ | — | sku_stock |
| medium | `/api/favorites` | GET/POST | ✅ | ✅ | — | sku_stock, sku |
| medium | `/api/favorites/[id]` | PATCH/DELETE | — | ✅ | — | sku_stock, sku |
| medium | `/api/global-search` | GET | ✅ | ✅ | — | receiving, orders, staff, sku |
| medium | `/api/google-sheets/transfer-orders` | POST/GET | ✅ | ✅ | — | orders |
| medium | `/api/handling-units` | GET/POST | ✅ | ✅ | — | handling_units, items |
| medium | `/api/inbox/support` | GET | ✅ | ✅ | — | support_ticket_assignments, items |
| medium | `/api/integrations/[provider]/sync` | POST | ✅ | ✅ | — | orders |
| medium | `/api/integrations/google-drive/callback` | GET | — | ✅ | — | photos |
| medium | `/api/integrations/google-drive/connect` | GET | ✅ | ✅ | — | accounts, photos |
| medium | `/api/integrations/google-drive/health` | GET | ✅ | ✅ | — | photos |
| medium | `/api/integrations/nextiva/webhook/[token]` | POST | ✅ | ✅ | — | voicemails |
| medium | `/api/inventory/bins-overview` | GET | ✅ | ✅ | — | sku_stock |
| medium | `/api/locations` | GET/POST | — | ✅ | — | locations |
| medium | `/api/locations/[barcode]` | GET/PATCH/DELETE | — | ✅ | — | reason_codes, locations, sku_stock, sku |
| medium | `/api/locations/[barcode]/properties` | PATCH | — | ✅ | — | locations, sku_stock |
| medium | `/api/locations/bulk` | POST | ✅ | ✅ | — | locations |
| medium | `/api/locations/register` | POST | ✅ | ✅ | — | locations |
| medium | `/api/manual-server/assign` | POST | ✅ | ✅ | — | sku_stock |
| medium | `/api/mcp` | GET/POST | ✅ | ✅ | — | messages |
| medium | `/api/nas-config` | GET | ✅ | ✅ | — | receiving, photos |
| medium | `/api/nas-target/[target]/[[...path]]` | GET/PUT/DELETE | — | ✅ | — | receiving, orders |
| medium | `/api/nas/[[...path]]` | GET/PUT/DELETE | ✅ | ✅ | — | receiving, photos |
| medium | `/api/need-to-order` | GET | ✅ | ✅ | — | replenishment_requests, item_stock_cache, sku_stock, sku |
| medium | `/api/need-to-order/[id]` | PATCH/DELETE | — | ✅ | — | replenishment_status_log, replenishment_requests, staff |
| medium | `/api/operations/benchmarks` | GET | ✅ | ✅ | — | inventory_events, insight_links, orders |
| medium | `/api/operations/saved-views` | GET/POST | ✅ | ✅ | — | staff |
| medium | `/api/order-amendments/[id]/decision` | POST | ✅ | ✅ | — | orders |
| medium | `/api/order-labels` | GET/POST/DELETE | ✅ | ✅ | — | documents, orders, types |
| medium | `/api/orders/[id]` | GET/PATCH/DELETE | — | ✅ | — | orders |
| medium | `/api/orders/[id]/allocate` | POST | ✅ | ✅ | — | order_unit_allocations, serial_units, orders, sku |
| medium | `/api/orders/[id]/documents` | GET/POST | — | ✅ | — | documents, orders |
| medium | `/api/orders/[id]/tracking` | POST/PATCH/DELETE | — | ✅ | — | shipping_tracking_numbers, orders |
| medium | `/api/orders/import-csv` | POST | ✅ | ✅ | — | orders, sku |
| medium | `/api/org/accounts/merge` | POST | ✅ | ✅ | — | memberships, accounts, staff |
| medium | `/api/org/invitations` | POST/GET | ✅ | ✅ | — | memberships |
| medium | `/api/outbound/mark-staged` | POST | ✅ | ✅ | — | packages, orders |
| medium | `/api/packerlogs/for-order` | GET | ✅ | ✅ | — | photos |
| medium | `/api/packing-logs/save-photo` | POST | ✅ | ✅ | — | photos |
| medium | `/api/packing-photos` | GET/DELETE | ✅ | ✅ | — | photo_entity_links, packer_logs, receiving, photos |
| medium | `/api/packing/policy` | GET | ✅ | ✅ | — | sku_stock, sku |
| medium | `/api/part-compatibility` | GET/POST | ✅ | ✅ | — | part_compatibility, sku_catalog, items, sku |
| medium | `/api/photos/[id]/labels` | GET/PUT | ✅ | ✅ | — | photos |
| medium | `/api/photos/[id]/reassign` | PATCH | — | ✅ | — | receiving, photos |
| medium | `/api/photos/analyze` | POST | ✅ | ✅ | — | photos |
| medium | `/api/photos/drive-backup` | GET/POST | ✅ | ✅ | — | photos |
| medium | `/api/photos/image-types` | GET/POST | ✅ | ✅ | — | photos, types |
| medium | `/api/photos/labels` | GET/POST | ✅ | ✅ | — | photos |
| medium | `/api/photos/labels/[id]` | PATCH/DELETE | ✅ | ✅ | — | photos |
| medium | `/api/photos/labels/bulk-apply` | POST | ✅ | ✅ | — | photos |
| medium | `/api/photos/library` | GET | ✅ | ✅ | — | documents, photos, items |
| medium | `/api/photos/library/ids` | GET | ✅ | ✅ | — | photos |
| medium | `/api/photos/links` | POST | ✅ | ✅ | — | photos, types |
| medium | `/api/photos/listing-gallery` | GET/POST/PATCH/DELETE | ✅ | ✅ | — | photos, items, sku |
| medium | `/api/photos/nas-backup` | GET/POST | ✅ | ✅ | — | photos |
| medium | `/api/photos/saved-views` | GET/POST | ✅ | ✅ | — | photos, staff |
| medium | `/api/photos/saved-views/[id]` | PATCH/DELETE | — | ✅ | — | photos |
| medium | `/api/photos/share` | POST | ✅ | ✅ | — | photos |
| medium | `/api/photos/share-packs` | POST | ✅ | ✅ | — | photos |
| medium | `/api/photos/share-packs/[token]` | GET | — | ✅ | — | photos |
| medium | `/api/photos/share-packs/[token]/zip` | GET | — | ✅ | — | photos |
| medium | `/api/picking/session` | POST | ✅ | ✅ | — | orders |
| medium | `/api/picking/session/[id]/complete` | POST | ✅ | ✅ | — | picking_sessions, orders |
| medium | `/api/picking/session/[id]/confirm-pick` | POST | ✅ | ✅ | — | order_unit_allocations, serial_units, orders |
| medium | `/api/picking/session/[id]/short-pick` | POST | ✅ | ✅ | — | order_unit_allocations, inventory_events, serial_units, orders |
| medium | `/api/product-manuals` | GET/POST/PATCH/DELETE | ✅ | ✅ | — | product_manuals, sku_stock, sku |
| medium | `/api/product-manuals/assign` | POST | ✅ | ✅ | — | product_manuals, sku_catalog |
| medium | `/api/product-manuals/sync` | POST | ✅ | ✅ | — | product_manuals, items |
| medium | `/api/product-manuals/thumbnail` | POST | ✅ | ✅ | — | product_manuals |
| medium | `/api/product-manuals/upload` | POST | ✅ | ✅ | — | product_manuals, sku |
| medium | `/api/product-manuals/upsert` | POST | ✅ | ✅ | — | product_manuals, sku_catalog |
| medium | `/api/realtime/token` | GET/POST | ✅ | ✅ | — | staff |
| medium | `/api/reason-codes` | GET/POST | ✅ | ✅ | — | reason_codes, sku_stock |
| medium | `/api/reason-codes/[id]` | GET/PATCH/DELETE | — | ✅ | — | sku_stock |
| medium | `/api/receiving-lines/[id]/ensure-catalog` | POST | ✅ | ✅ | — | receiving_lines, serial_units, sku_catalog, receiving |
| medium | `/api/receiving-lines/incoming/email-rescan` | POST | ✅ | ✅ | — | receiving, items, staff |
| medium | `/api/receiving-lines/incoming/refresh` | POST | ✅ | ✅ | — | receiving_lines, receiving, packages |
| medium | `/api/receiving-lines/incoming/zoho-refresh` | POST | ✅ | ✅ | — | receiving_lines, zoho_po_mirror, receiving |
| medium | `/api/receiving-tasks` | GET/POST/PUT/DELETE | ✅ | ✅ | — | receiving |
| medium | `/api/receiving/[id]/attach-box` | POST | — | ✅ | — | receiving |
| medium | `/api/receiving/[id]/unpair` | POST | — | ✅ | — | receiving |
| medium | `/api/receiving/identify-label` | POST | ✅ | ✅ | — | sku_catalog, receiving, items, sku |
| medium | `/api/receiving/import-sales-order` | POST | ✅ | ✅ | — | receiving |
| medium | `/api/receiving/inbound/import-ebay` | POST | ✅ | ✅ | — | receiving, orders, sku |
| medium | `/api/receiving/lines/[id]/advance` | POST | — | ✅ | — | receiving_exceptions, inventory_events, receiving |
| medium | `/api/receiving/nas-archive-test` | POST | ✅ | ✅ | — | receiving, photos |
| medium | `/api/receiving/pending-check` | GET | ✅ | ✅ | — | sku_platform_ids, pending_skus, receiving, orders, sku |
| medium | `/api/receiving/rail-exclusions` | GET/POST/DELETE | ✅ | ✅ | — | staff_rail_exclusions, receiving, items, staff |
| medium | `/api/receiving/relink` | POST | ✅ | ✅ | — | receiving, sku |
| medium | `/api/receiving/triage/complete` | POST | ✅ | ✅ | — | receiving |
| medium | `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk/draft` | POST | ✅ | ✅ | — | receiving |
| medium | `/api/receiving/visual-identify` | POST | ✅ | ✅ | — | sku_catalog, receiving, sku |
| medium | `/api/receiving/zendesk-claim/archive-only` | POST | ✅ | ✅ | — | receiving, photos |
| medium | `/api/receiving/zendesk-claim/assist` | POST | ✅ | ✅ | — | receiving, messages, photos |
| medium | `/api/receiving/zendesk-claim/assist-seller` | POST | ✅ | ✅ | — | receiving |
| medium | `/api/receiving/zendesk-claim/draft` | POST | ✅ | ✅ | — | receiving_lines, receiving, photos |
| medium | `/api/receiving/zendesk-claim/preview` | POST | ✅ | ✅ | — | receiving_lines, receiving, photos |
| medium | `/api/receiving/zendesk-claim/seller-message` | GET/PATCH/DELETE | ✅ | ✅ | — | receiving_claim_seller_messages, receiving |
| medium | `/api/receiving/zendesk-claim/thread` | GET/POST | ✅ | ✅ | — | receiving |
| medium | `/api/repair-service` | GET/PATCH/POST | ✅ | ✅ | — | types |
| medium | `/api/repair-service/[id]` | GET/DELETE | — | ✅ | — | customers, documents |
| medium | `/api/repair-service/[id]/link` | POST/DELETE | — | ✅ | — | repair_service |
| medium | `/api/repair/customers` | GET | ✅ | ✅ | — | customers |
| medium | `/api/repair/square-payment-link` | POST | ✅ | ✅ | — | types, sku |
| medium | `/api/replenish/bulk-create-po` | POST | ✅ | ✅ | — | orders |
| medium | `/api/replenishment/tasks/[id]/cancel` | POST | ✅ | ✅ | — | staff |
| medium | `/api/replenishment/tasks/[id]/claim` | POST | ✅ | ✅ | — | staff |
| medium | `/api/replenishment/tasks/[id]/complete` | POST | ✅ | ✅ | — | inventory_events, bin_contents, staff |
| medium | `/api/returns/intake` | POST | ✅ | ✅ | — | inventory_events, sku_stock_ledger, serial_units, receiving, sku_stock |
| medium | `/api/rma` | GET/POST | ✅ | ✅ | — | staff |
| medium | `/api/rma/[id]/close` | POST | ✅ | ✅ | — | staff |
| medium | `/api/rma/[id]/disposition` | POST | ✅ | ✅ | — | return_dispositions, inventory_events, staff |
| medium | `/api/rma/[id]/mark-received` | POST | ✅ | ✅ | — | staff |
| medium | `/api/rma/backlog` | GET | ✅ | ✅ | — | return_dispositions |
| medium | `/api/rma/disposition` | POST | ✅ | ✅ | — | return_dispositions, rma_authorizations, staff |
| medium | `/api/rooms/[room]` | PATCH/DELETE | — | ✅ | — | sku_stock |
| medium | `/api/rooms/reorder` | POST | ✅ | ✅ | — | sku_stock |
| medium | `/api/serial-units/[id]/data-wipe` | POST | ✅ | ✅ | — | serial_units, audit_logs, sku |
| medium | `/api/serial-units/[id]/list` | POST | ✅ | ✅ | — | serial_unit_listings, serial_units |
| medium | `/api/serial-units/[id]/repairs` | GET/POST | ✅ | ✅ | — | serial_units, unit_repairs, staff |
| medium | `/api/serial-units/[id]/test` | POST | ✅ | ✅ | — | tech_serial_numbers, inventory_events, testing_results, audit_logs, receiving, staff +1 |
| medium | `/api/serial-units/lookup` | GET | ✅ | ✅ | — | order_unit_allocations, tech_serial_numbers, serial_units, receiving, orders, sku |
| medium | `/api/settings` | GET/PUT | ✅ | ✅ | — | receiving, items, staff |
| medium | `/api/shipments/[id]/documents` | GET | — | ✅ | — | shipping_tracking_numbers, documents |
| medium | `/api/shipped` | GET/PATCH | ✅ | ✅ | — | packer_logs, orders, staff, sku |
| medium | `/api/shipped/[id]` | GET | — | ✅ | — | orders |
| medium | `/api/shipped/search` | GET/POST | ✅ | ✅ | — | orders |
| medium | `/api/shipping/track/[id]` | GET | — | ✅ | — | shipping_tracking_numbers, shipment_tracking_events |
| medium | `/api/shipping/track/register` | POST | ✅ | ✅ | — | types |
| medium | `/api/shipping/track/sync-one` | POST | ✅ | ✅ | — | types |
| medium | `/api/sku-catalog` | GET/POST | ✅ | ✅ | — | sku_stock, items, sku |
| medium | `/api/sku-catalog/[id]/platform-ids` | POST/PUT/DELETE | — | ✅ | — | sku_stock, sku |
| medium | `/api/sku-catalog/graph/[skuId]/children` | GET | — | ✅ | — | sku_catalog, sku_stock, sku |
| medium | `/api/sku-catalog/graph/[skuId]/parents` | GET | — | ✅ | — | sku_catalog, sku_stock, sku |
| medium | `/api/sku-catalog/graph/[skuId]/tree` | GET | — | ✅ | — | sku_catalog, sku_stock, sku |
| medium | `/api/sku-catalog/pair-batch` | POST | ✅ | ✅ | — | sku_pairing_audit, product_manuals, sku_stock, orders, sku |
| medium | `/api/sku-catalog/pair-ecwid` | POST | ✅ | ✅ | — | sku_stock, sku |
| medium | `/api/sku-catalog/suggest-pairings` | GET/POST | ✅ | ✅ | — | sku_platform_ids, sku_stock, sku |
| medium | `/api/sku-catalog/unpaired-ecwid` | GET | ✅ | ✅ | — | sku_stock, items, sku |
| medium | `/api/sourcing/alerts` | GET/POST/PATCH | ✅ | ✅ | — | items |
| medium | `/api/sourcing/candidates` | GET/POST | ✅ | ✅ | — | items |
| medium | `/api/sourcing/candidates/[id]/import` | POST | — | ✅ | — | part_acquisitions, receiving |
| medium | `/api/sourcing/saved-searches` | GET/POST | ✅ | ✅ | — | items |
| medium | `/api/sourcing/saved-searches/[id]/run` | POST | — | ✅ | — | sku |
| medium | `/api/sourcing/search` | POST | ✅ | ✅ | — | ebay_api_calls |
| medium | `/api/staff-goals/me` | GET | ✅ | ✅ | — | station_activity_logs, staff_stations, staff_goals, staff |
| medium | `/api/staff-messages` | GET/POST/PATCH | ✅ | ✅ | — | messages, items, staff |
| medium | `/api/staff-preferences` | GET/PUT | ✅ | ✅ | — | staff |
| medium | `/api/staff-todos` | GET/POST/PATCH/DELETE | ✅ | ✅ | — | staff_todo_completions, items, staff |
| medium | `/api/staff/schedule/bulk` | POST | ✅ | ✅ | — | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| medium | `/api/studio/graph` | GET | ✅ | ✅ | — | types |
| medium | `/api/studio/items/[id]/recover` | POST | ✅ | ✅ | — | item_workflow_state, workflow_runs, audit_logs, items |
| medium | `/api/suppliers` | GET/POST | ✅ | ✅ | — | suppliers, items |
| medium | `/api/suppliers/[id]` | GET/PATCH/DELETE | — | ✅ | — | suppliers |
| medium | `/api/support/overview` | GET | ✅ | ✅ | — | messages |
| medium | `/api/support/tickets/by-entity` | GET | ✅ | ✅ | — | receiving |
| medium | `/api/tech/scan-repair-station` | POST | ✅ | ✅ | — | staff |
| medium | `/api/units/next-id` | POST | ✅ | ✅ | — | unit_id_sequences, sku_catalog, sku |
| medium | `/api/units/resolve-id` | POST | ✅ | ✅ | — | serial_units, sku_catalog, sku |
| medium | `/api/voicemails/[id]` | GET | ✅ | ✅ | — | voicemails |
| medium | `/api/voicemails/[id]/followup` | PATCH | ✅ | ✅ | — | voicemails, messages, staff |
| medium | `/api/voicemails/[id]/link` | POST | ✅ | ✅ | — | ticket_links, voicemails |
| medium | `/api/voicemails/[id]/recording` | GET | ✅ | ✅ | — | voicemails |
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
| medium | `/api/work-orders/calendar` | GET | ✅ | ✅ | — | work_assignments, orders |
| medium | `/api/zendesk/photo-ticket` | POST | ✅ | ✅ | — | ticket_links, photos |
| medium | `/api/zendesk/tickets` | GET/POST | ✅ | ✅ | — | ticket_links, photos |
| medium | `/api/zendesk/tickets/[id]/assign` | GET/POST | ✅ | ✅ | — | messages, staff |
| medium | `/api/zendesk/tickets/[id]/comments` | GET/POST | ✅ | ✅ | — | zendesk_users |
| medium | `/api/zendesk/tickets/[id]/photos` | GET | ✅ | ✅ | — | unfound_overlay, ticket_links, photos |
| medium | `/api/zoho/find-po` | POST | ✅ | ✅ | — | receiving |
| medium | `/api/zoho/health` | GET | ✅ | ✅ | — | accounts |
| medium | `/api/zoho/items/sync` | POST/GET | ✅ | ✅ | — | items |
| medium | `/api/zoho/oauth/callback` | GET | — | ✅ | — | accounts |
| medium | `/api/zoho/purchase-orders` | GET | ✅ | ✅ | — | receiving, orders, items, sku |
| medium | `/api/zoho/purchase-orders/sync` | POST | ✅ | ✅ | — | receiving_lines, receiving, orders |
| medium | `/api/zoho/purchase-receives` | GET | ✅ | ✅ | — | receiving |
| medium | `/api/zoho/purchase-receives/import` | POST | ✅ | ✅ | — | receiving |
| medium | `/api/zoho/purchase-receives/sync` | POST | ✅ | ✅ | — | receiving_lines, receiving, orders |
| medium | `/api/zoho/warehouses` | GET | ✅ | ✅ | — | warehouses |
| low | `/api/activity/feed` | GET | ✅ | ✅ | ✅ | station_activity_logs, sku_stock_ledger, staff, sku |
| low | `/api/admin/audit` | GET | ✅ | ✅ | ✅ | auth_audit, staff |
| low | `/api/admin/fba-fnskus` | GET/POST | ✅ | ✅ | ✅ | fba_fnskus, sku |
| low | `/api/admin/fba-fnskus/[fnsku]` | GET/PATCH/DELETE | — | ✅ | ✅ | fba_shipment_items, fba_fnsku_logs, fba_fnskus, sku |
| low | `/api/admin/fba-fnskus/upload` | POST | ✅ | ✅ | ✅ | fba_fnskus, sku |
| low | `/api/admin/features` | GET/POST | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/features/[id]` | GET/PATCH/DELETE | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/fix-status` | POST | ✅ | ✅ | ✅ | orders |
| low | `/api/admin/integrations/list` | GET | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/logs` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, station_activity_logs, tech_serial_numbers, packer_logs, audit_logs, staff |
| low | `/api/admin/org/export` | POST | ✅ | ✅ | ✅ | organization_feature_flags, staff_sessions, staff |
| low | `/api/admin/photos/stats` | GET | ✅ | ✅ | ✅ | photo_analysis, photo_storage, photo_jobs, photos |
| low | `/api/admin/po-gmail/create-zoho-draft/[id]` | POST | ✅ | ✅ | ✅ | email_missing_purchase_orders, items |
| low | `/api/admin/po-gmail/missing-orders` | GET/PATCH | ✅ | ✅ | ✅ | email_missing_purchase_orders, orders, items |
| low | `/api/admin/po-gmail/triage` | GET | ✅ | ✅ | ✅ | email_missing_purchase_orders, orders, items |
| low | `/api/admin/po-gmail/triage/[id]` | PATCH | — | ✅ | ✅ | email_missing_purchase_orders |
| low | `/api/admin/po-gmail/triage/[id]/detail` | GET | — | ✅ | ✅ | email_missing_purchase_orders, zoho_po_mirror, messages |
| low | `/api/admin/po-gmail/triage/[id]/extract` | POST | — | ✅ | ✅ | email_missing_purchase_orders, messages |
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
| low | `/api/admin/staff/list` | GET | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/staff/reorder` | PATCH | ✅ | ✅ | ✅ | staff |
| low | `/api/admin/staff/update` | POST | ✅ | ✅ | ✅ | staff |
| low | `/api/ai/chat-sessions/[sessionId]/messages` | GET | — | ✅ | ✅ | ai_chat_messages, messages |
| low | `/api/amazon/accounts` | GET/DELETE | ✅ | ✅ | ✅ | amazon_accounts, accounts |
| low | `/api/amazon/connect` | POST | ✅ | ✅ | ✅ | amazon_accounts, accounts |
| low | `/api/amazon/oauth/callback` | GET | — | ✅ | ✅ | amazon_accounts, accounts |
| low | `/api/assignments/next` | GET | ✅ | ✅ | ✅ | work_assignments |
| low | `/api/assignments/sku-search` | GET/POST | ✅ | ✅ | ✅ | work_assignments, sku_stock, items, staff, sku |
| low | `/api/assistant/mutations` | GET | ✅ | ✅ | ✅ | agent_mutation_affects, agent_mutations |
| low | `/api/audit-log/report` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, replenishment_requests, station_activity_logs, tech_serial_numbers, inventory_events, receiving_lines +5 |
| low | `/api/audit-log/staff-directory` | GET | ✅ | ✅ | ✅ | station_activity_logs, audit_logs, staff |
| low | `/api/auth/sso/callback` | GET | ✅ | ✅ | ✅ | auth_events, memberships, accounts, staff |
| low | `/api/catalog/workflow-nodes` | GET | ✅ | ✅ | ✅ | workflow_nodes, receiving, items, types |
| low | `/api/check-tracking` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, work_assignments, packer_logs, orders |
| low | `/api/cron/google-sheets/transfer-orders` | GET | — | — | ✅ | orders |
| low | `/api/cron/zoho/incoming-po-sync` | GET | — | — | ✅ | receiving_lines, zoho_po_mirror, sync_cursors, receiving, orders, items |
| low | `/api/cron/zoho/po-sync` | GET | — | — | ✅ | email_missing_purchase_orders, receiving_lines, zoho_po_mirror, receiving, orders |
| low | `/api/customers/[id]` | GET | ✅ | ✅ | ✅ | customers, orders |
| low | `/api/cycle-counts/campaigns` | GET/POST | ✅ | ✅ | ✅ | cycle_count_campaigns, cycle_count_lines, bin_contents, locations, staff, sku |
| low | `/api/cycle-counts/campaigns/[id]` | GET/PATCH | — | ✅ | ✅ | cycle_count_campaigns, cycle_count_lines, locations, sku_stock, sku |
| low | `/api/cycle-counts/lines/[id]` | PATCH | — | ✅ | ✅ | cycle_count_campaigns, cycle_count_lines, bin_contents, sku_stock, sku |
| low | `/api/dashboard/fba-shipments` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, fba_shipment_items, fba_shipments, receiving, staff |
| low | `/api/dashboard/operations` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, station_activity_logs, work_assignments, repair_service, orders, staff |
| low | `/api/debug-tracking` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, work_assignments, packer_logs, orders |
| low | `/api/documents/[id]/content` | GET | — | ✅ | ✅ | documents, orders, photos, types |
| low | `/api/ebay/accounts` | GET/PUT/DELETE | ✅ | ✅ | ✅ | ebay_accounts, accounts |
| low | `/api/ebay/callback` | GET | — | ✅ | ✅ | platform_accounts, ebay_accounts |
| low | `/api/ebay/refresh-token` | POST | ✅ | ✅ | ✅ | ebay_accounts |
| low | `/api/ebay/search` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, work_assignments, accounts, orders, sku |
| low | `/api/ecwid/recent-repair-orders` | GET | ✅ | ✅ | ✅ | sku_platform_ids, sku_catalog, receiving, orders, items, sku |
| low | `/api/ecwid/sync-exception-tracking` | POST | ✅ | ✅ | ✅ | orders_exceptions, orders, items, sku |
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
| low | `/api/fba/shipments/[id]/trace` | GET | — | ✅ | ✅ | fba_shipment_item_units, fba_shipment_tracking, fba_shipment_items, inventory_events, fba_shipments, serial_units +5 |
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
| low | `/api/google-sheets/execute-script` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, orders_exceptions, packer_logs, fba_fnskus, orders |
| low | `/api/google-sheets/sync-shipstation-orders` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, orders_exceptions, work_assignments, orders, shifts |
| low | `/api/handling-units/[id]` | GET/DELETE | ✅ | ✅ | ✅ | handling_units |
| low | `/api/import-orders` | POST | ✅ | ✅ | ✅ | work_assignments, orders, sku |
| low | `/api/inbox/tech-queue` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving_line_testing, receiving_lines, receiving, items, staff +1 |
| low | `/api/inventory-events` | GET | ✅ | ✅ | ✅ | serial_units, sku_catalog, locations, sku_stock, staff, sku |
| low | `/api/inventory-photos` | POST | ✅ | ✅ | ✅ | inventory_events, photos, sku |
| low | `/api/inventory/alerts` | GET | ✅ | ✅ | ✅ | stock_alerts, locations, sku_stock, items, sku |
| low | `/api/inventory/alerts/[id]/ack` | POST | ✅ | ✅ | ✅ | stock_alerts, sku |
| low | `/api/inventory/counts` | GET | ✅ | ✅ | ✅ | cycle_count_campaigns, cycle_count_lines, items |
| low | `/api/inventory/items/search` | GET | ✅ | ✅ | ✅ | sku_catalog, sku_stock, items, sku |
| low | `/api/inventory/parts-graph` | GET | ✅ | ✅ | ✅ | sku_catalog, part_links, sku_stock, items, sku |
| low | `/api/inventory/parts/links` | POST | ✅ | ✅ | ✅ | sku_stock, items |
| low | `/api/inventory/parts/links/[id]` | DELETE | — | ✅ | ✅ | sku_stock |
| low | `/api/inventory/parts/links/not-a-part` | POST | ✅ | ✅ | ✅ | sku_stock |
| low | `/api/inventory/sku-search` | GET | ✅ | ✅ | ✅ | bin_contents, sku_stock, sku |
| low | `/api/inventory/units` | GET | ✅ | ✅ | ✅ | serial_units, sku_catalog, sku_stock, items, sku |
| low | `/api/labels` | GET/PUT/DELETE | ✅ | ✅ | ✅ | reason_codes, types |
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
| low | `/api/operations/journey` | GET | ✅ | ✅ | ✅ | types |
| low | `/api/operations/kpi-table` | GET | — | ✅ | ✅ | operations_kpi_rollups_hourly, operations_kpi_rollups_daily, station_activity_logs, audit_logs, staff |
| low | `/api/operations/roi` | GET | ✅ | ✅ | ✅ | workflow_node_stats, workflow_runs, orders |
| low | `/api/orders` | GET | ✅ | ✅ | ✅ | replenishment_order_lines, shipping_tracking_numbers, replenishment_requests, station_activity_logs, work_assignments, shipment_links +5 |
| low | `/api/orders-exceptions/delete` | POST | ✅ | ✅ | ✅ | orders_exceptions, orders |
| low | `/api/orders-exceptions/sync` | POST | ✅ | ✅ | ✅ | orders_exceptions, packer_logs, receiving, orders, staff |
| low | `/api/orders/[id]/amendments` | GET | ✅ | ✅ | ✅ | order_unit_amendments, serial_units, orders, staff |
| low | `/api/orders/[id]/documents/fetch` | POST | — | ✅ | ✅ | documents, orders, types |
| low | `/api/orders/[id]/pick-tasks` | GET | ✅ | ✅ | ✅ | sku_platform_ids, sku_catalog, locations, orders |
| low | `/api/orders/[id]/release` | POST | ✅ | ✅ | ✅ | order_unit_allocations, inventory_events, serial_units, orders, sku |
| low | `/api/orders/[id]/substitute` | POST | ✅ | ✅ | ✅ | order_unit_amendments, serial_units, orders, sku |
| low | `/api/orders/[id]/timeline` | GET | — | ✅ | ✅ | order_unit_allocations, station_activity_logs, tech_serial_numbers, inventory_events, audit_logs, receiving +2 |
| low | `/api/orders/add` | POST | ✅ | ✅ | ✅ | sku_catalog, orders, sku |
| low | `/api/orders/assign` | POST | ✅ | ✅ | ✅ | work_assignments, sku_catalog, audit_logs, orders, staff, sku |
| low | `/api/orders/backfill/ebay` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, ebay_accounts, accounts, orders, sku |
| low | `/api/orders/backfill/ecwid` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, orders, items, sku |
| low | `/api/orders/batch` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, packer_logs, orders, staff, sku |
| low | `/api/orders/check-shipped` | POST | ✅ | ✅ | ✅ | station_activity_logs, orders |
| low | `/api/orders/delete` | POST | ✅ | ✅ | ✅ | orders, sku |
| low | `/api/orders/integrity-check` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, orders, sku |
| low | `/api/orders/lookup/[orderId]` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, work_assignments, customers, receiving, sku_stock +3 |
| low | `/api/orders/missing-parts` | POST | ✅ | ✅ | ✅ | orders, staff |
| low | `/api/orders/next` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, station_activity_logs, work_assignments, orders, staff, sku |
| low | `/api/orders/recent` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, work_assignments, product_manuals, sku_catalog, orders, sku |
| low | `/api/orders/set-item-number` | POST | ✅ | ✅ | ✅ | orders |
| low | `/api/orders/verify` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, packer_logs, orders |
| low | `/api/outbound/labels/purchase` | POST | ✅ | ✅ | ✅ | customers, documents, orders, types, sku |
| low | `/api/outbound/labels/void` | POST | ✅ | ✅ | ✅ | documents, orders |
| low | `/api/outbound/rates` | POST | ✅ | ✅ | ✅ | customers, orders, types |
| low | `/api/pack/ship` | POST | ✅ | ✅ | ✅ | order_unit_allocations, order_unit_amendments, station_activity_logs, inventory_events, sku_stock_ledger, serial_units +5 |
| low | `/api/packerlogs` | GET/POST/PUT/DELETE | ✅ | ✅ | ✅ | packer_log_enrichment, station_activity_logs, packer_logs, orders, photos, staff +1 |
| low | `/api/packing-logs` | GET/POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, fba_shipment_tracking, fba_shipment_items, sku_platform_ids, work_assignments, fba_shipments +8 |
| low | `/api/packing-logs/history` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, photo_entity_links, packer_logs, orders, photos, staff +1 |
| low | `/api/packing-logs/update` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, photo_entity_links, sku_stock_ledger, work_assignments, packer_logs, sku_stock +3 |
| low | `/api/payroll/settings` | GET/PATCH | ✅ | ✅ | ✅ | payroll_settings |
| low | `/api/pending-skus` | GET/PATCH | ✅ | — | ✅ | pending_skus, sku_catalog, sku_stock, sku |
| low | `/api/photos/[id]` | DELETE | — | ✅ | ✅ | photo_entity_links, receiving, sku_stock, photos |
| low | `/api/photos/[id]/content` | GET | — | ✅ | ✅ | photos |
| low | `/api/photos/download-zip` | GET | — | ✅ | ✅ | photo_entity_links, photos |
| low | `/api/photos/upload` | POST | ✅ | ✅ | ✅ | receiving_lines, receiving, photos, types |
| low | `/api/pick/queue` | GET | ✅ | ✅ | ✅ | order_unit_allocations, picking_sessions, work_assignments, customers, orders |
| low | `/api/pick/scan` | POST | ✅ | ✅ | ✅ | order_unit_allocations, inventory_events, serial_units, orders, sku |
| low | `/api/pick/unscan` | POST | ✅ | ✅ | ✅ | order_unit_allocations, serial_units, orders |
| low | `/api/post-multi-sn` | POST | ✅ | ✅ | ✅ | station_activity_logs, tech_serial_numbers, inventory_events, serial_units, receiving, sku |
| low | `/api/print/dispatch` | POST | ✅ | ✅ | ✅ | printer_profiles, orders, sku |
| low | `/api/product-manuals/bulk` | POST | ✅ | ✅ | ✅ | product_manuals, sku_catalog |
| low | `/api/product-manuals/by-category` | GET | ✅ | ✅ | ✅ | product_manuals, sku_catalog, sku_stock, sku |
| low | `/api/product-manuals/rename-folder` | POST | ✅ | ✅ | ✅ | product_manuals, sku_catalog |
| low | `/api/product-manuals/search` | GET | — | ✅ | ✅ | product_manuals, sku_catalog, sku |
| low | `/api/products/[sku]` | GET | — | ✅ | ✅ | sku_platform_ids, bin_contents, serial_units, sku_catalog, platforms, sku_stock +1 |
| low | `/api/quality/dashboard` | GET | ✅ | ✅ | ✅ | unit_quality_scores, unit_failure_tags, failure_modes, serial_units, unit_repairs, sku_stock +1 |
| low | `/api/rag/documents` | POST | ✅ | ✅ | ✅ | rag_document_chunks, rag_documents, documents |
| low | `/api/rag/search` | POST | ✅ | ✅ | ✅ | rag_document_chunks |
| low | `/api/receiving-entry` | POST/GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, work_assignments, receiving_lines, receiving |
| low | `/api/receiving-lines` | GET/POST/PATCH/DELETE | ✅ | ✅ | ✅ | fba_tracking_item_allocations, shipping_tracking_numbers, local_pickup_order_items, shipment_tracking_events, email_delivery_signals, serial_unit_provenance +16 |
| low | `/api/receiving-lines/[id]/manuals` | POST/DELETE | ✅ | ✅ | ✅ | product_manuals, sku_catalog, receiving |
| low | `/api/receiving-lines/[id]/qc-checks` | POST/PUT/DELETE | ✅ | ✅ | ✅ | qc_check_templates, sku_catalog, receiving, sku_stock, sku |
| low | `/api/receiving-lines/[id]/testing-bundle` | GET | ✅ | ✅ | ✅ | product_manuals, sku_catalog, receiving, sku |
| low | `/api/receiving-lines/incoming/delivered-unscanned` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving_lines, receiving_scans, zoho_po_mirror, receiving, items +1 |
| low | `/api/receiving-lines/incoming/details` | GET | ✅ | ✅ | ✅ | email_missing_purchase_orders, shipping_tracking_numbers, shipment_tracking_events, email_delivery_signals, inventory_events, receiving_lines +6 |
| low | `/api/receiving-lines/incoming/refresh/stream` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving_lines, zoho_po_mirror, receiving, packages, orders +1 |
| low | `/api/receiving-lines/incoming/summary` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving_lines, receiving_scans, zoho_po_mirror, receiving, packages +1 |
| low | `/api/receiving-lines/incoming/sync-one` | POST | ✅ | ✅ | ✅ | receiving |
| low | `/api/receiving-lines/incoming/todo` | GET/PATCH | ✅ | ✅ | ✅ | email_missing_purchase_orders, receiving, items, staff |
| low | `/api/receiving-lines/view` | POST | ✅ | ✅ | ✅ | receiving_line_views, receiving, staff |
| low | `/api/receiving-logs` | GET/DELETE/PATCH | ✅ | ✅ | ✅ | shipping_tracking_numbers, work_assignments, receiving_scans, receiving |
| low | `/api/receiving-logs/search` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving |
| low | `/api/receiving-photos` | GET/POST/DELETE | ✅ | ✅ | ✅ | receiving_lines, receiving_scans, receiving, photos |
| low | `/api/receiving/[id]` | GET/PATCH | — | ✅ | ✅ | shipping_tracking_numbers, receiving_line_testing, serial_unit_provenance, local_pickup_orders, inventory_events, receiving_lines +7 |
| low | `/api/receiving/[id]/zoho-sync` | POST | — | ✅ | ✅ | receiving_lines, receiving |
| low | `/api/receiving/add-unmatched-line` | POST | ✅ | ✅ | ✅ | api_idempotency_responses, sku_platform_ids, receiving_lines, receiving, orders, items +1 |
| low | `/api/receiving/email-po` | GET/PATCH | ✅ | ✅ | ✅ | email_missing_purchase_orders, receiving |
| low | `/api/receiving/lines/[id]/condition` | PATCH | ✅ | ✅ | ✅ | receiving_lines, receiving |
| low | `/api/receiving/lines/[id]/move` | POST | — | ✅ | ✅ | inventory_events, receiving_lines, serial_units, locations, receiving, sku |
| low | `/api/receiving/lines/[id]/putaway` | POST | — | ✅ | ✅ | inventory_events, receiving_lines, serial_units, locations, receiving, sku |
| low | `/api/receiving/lines/[id]/putaway/reverse` | POST | — | ✅ | ✅ | inventory_events, serial_units, receiving, sku |
| low | `/api/receiving/lines/[id]/status` | POST | — | ✅ | ✅ | inventory_events, receiving_lines, serial_units, receiving, sku |
| low | `/api/receiving/lines/[id]/timeline` | GET | — | ✅ | ✅ | inventory_events, serial_units, locations, receiving, staff, sku |
| low | `/api/receiving/lines/[id]/zoho-note` | PATCH | — | ✅ | ✅ | receiving_lines, receiving, items, sku |
| low | `/api/receiving/lookup-po` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, tracking_exceptions, receiving_lines, receiving_scans, support_tickets, zoho_po_mirror +7 |
| low | `/api/receiving/mark-received` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, inventory_events, sku_stock_ledger, receiving_lines, serial_units, audit_logs +6 |
| low | `/api/receiving/mark-received-po` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, serial_unit_provenance, inventory_events, sku_stock_ledger, receiving_lines, serial_units +6 |
| low | `/api/receiving/match` | POST/GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, work_assignments, receiving_lines, receiving, staff, sku |
| low | `/api/receiving/pending-unboxing` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving_line_testing, receiving_lines, receiving, staff, sku |
| low | `/api/receiving/po-search` | GET | ✅ | ✅ | ✅ | zoho_po_mirror, receiving |
| low | `/api/receiving/po/[poId]` | GET | ✅ | ✅ | ✅ | receiving_line_testing, receiving_lines, sku_catalog, receiving, photos, items +1 |
| low | `/api/receiving/po/[poId]/attach-box` | GET/POST | — | ✅ | ✅ | receiving_lines, zoho_po_mirror, receiving |
| low | `/api/receiving/po/list` | GET | ✅ | ✅ | ✅ | receiving_lines, receiving, photos, items, sku |
| low | `/api/receiving/scan-serial` | POST/DELETE | ✅ | ✅ | ✅ | tech_serial_numbers, receiving_lines, serial_units, receiving, sku |
| low | `/api/receiving/serials` | GET/POST/DELETE | ✅ | ✅ | ✅ | tech_serial_numbers, receiving_lines, serial_units, receiving |
| low | `/api/receiving/touch-scan` | POST | ✅ | ✅ | ✅ | receiving_scans, receiving |
| low | `/api/receiving/triage/done` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving_lines, receiving, photos, sku |
| low | `/api/receiving/triage/metrics` | GET | ✅ | ✅ | ✅ | receiving |
| low | `/api/receiving/triage/staging-map` | GET | ✅ | ✅ | ✅ | locations, receiving |
| low | `/api/receiving/unfound-queue` | GET | ✅ | ✅ | ✅ | ops_events, receiving, photos |
| low | `/api/receiving/unfound-queue/[kind]/[id]` | PATCH/DELETE | ✅ | ✅ | ✅ | email_missing_purchase_orders, orders_exceptions, unfound_overlay, serial_units, receiving, staff |
| low | `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk` | POST | ✅ | ✅ | ✅ | unfound_overlay, receiving |
| low | `/api/receiving/unfound-queue/retry-pair` | POST | ✅ | ✅ | ✅ | receiving |
| low | `/api/receiving/zendesk-claim` | POST | ✅ | ✅ | ✅ | receiving_lines, ticket_links, receiving, photos, staff |
| low | `/api/receiving/zendesk-claim/link` | GET/POST/DELETE | ✅ | ✅ | ✅ | receiving_lines, unfound_overlay, ticket_links, receiving |
| low | `/api/repair-service/document/[id]` | GET | — | ✅ | ✅ | repair_service, documents |
| low | `/api/repair-service/next` | GET | ✅ | ✅ | ✅ | work_assignments, repair_service, staff, sku |
| low | `/api/repair-service/out-of-stock` | POST | ✅ | ✅ | ✅ | work_assignments, repair_service |
| low | `/api/repair-service/pickup` | POST | ✅ | ✅ | ✅ | work_assignments, repair_service, documents |
| low | `/api/repair-service/repaired` | POST | ✅ | ✅ | ✅ | work_assignments, repair_service |
| low | `/api/repair/actions` | GET/POST | ✅ | ✅ | ✅ | repair_actions, unit_repairs, staff |
| low | `/api/repair/actions/[id]` | PATCH/DELETE | ✅ | ✅ | ✅ | repair_actions |
| low | `/api/repair/submit` | POST | ✅ | ✅ | ✅ | work_assignments, documents |
| low | `/api/replenish/shipped-fifo` | GET | ✅ | ✅ | ✅ | replenishment_requests, station_activity_logs, item_stock_cache, sku_stock, orders, items +1 |
| low | `/api/reports/bin-utilization` | GET | ✅ | ✅ | ✅ | locations |
| low | `/api/reports/dead-stock` | GET | ✅ | ✅ | ✅ | sku_platform_ids, sku_stock_ledger, sku_catalog, sku_stock, sku |
| low | `/api/reports/velocity` | GET | ✅ | ✅ | ✅ | sku_platform_ids, sku_stock_ledger, sku_catalog, sku_stock, sku |
| low | `/api/returns/undo` | POST | ✅ | ✅ | ✅ | order_unit_allocations, inventory_events, sku_stock_ledger, serial_units, receiving, sku_stock +1 |
| low | `/api/rooms` | GET/POST | ✅ | ✅ | ✅ | locations, sku_stock |
| low | `/api/scan-tracking` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, orders_exceptions, orders |
| low | `/api/scan/history` | GET | ✅ | ✅ | ✅ | mobile_scan_events, receiving, sku_stock, staff |
| low | `/api/scan/resolve` | GET/POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, mobile_scan_events, serial_units, sku_catalog, receiving +4 |
| low | `/api/serial-units/[id]` | GET | — | ✅ | ✅ | serial_unit_condition_history, order_unit_allocations, station_activity_logs, tech_serial_numbers, inventory_events, serial_units +7 |
| low | `/api/serial-units/[id]/allocate` | POST | ✅ | ✅ | ✅ | order_unit_allocations, inventory_events, serial_units, orders, sku |
| low | `/api/serial-units/[id]/checklist` | GET/POST | ✅ | ✅ | ✅ | qc_check_templates, tech_verifications, testing_results, serial_units, sku_catalog, staff +1 |
| low | `/api/serial-units/[id]/checklist/bulk` | POST | ✅ | ✅ | ✅ | qc_check_templates, tech_verifications, serial_units, sku_catalog, staff |
| low | `/api/serial-units/[id]/failure-tags` | GET/POST/PATCH | ✅ | ✅ | ✅ | unit_failure_tags, serial_units, sku_stock |
| low | `/api/serial-units/[id]/grade` | POST | ✅ | ✅ | ✅ | serial_unit_condition_history, inventory_events, serial_units, types, sku |
| low | `/api/serial-units/[id]/hold` | POST | ✅ | ✅ | ✅ | inventory_events, serial_units, sku_stock |
| low | `/api/serial-units/[id]/move` | POST | ✅ | ✅ | ✅ | inventory_events, sku_stock_ledger, bin_contents, serial_units, locations, sku |
| low | `/api/serial-units/[id]/photos` | GET/POST | ✅ | ✅ | ✅ | photo_entity_links, inventory_events, serial_units, receiving, sku_stock, photos +1 |
| low | `/api/serial-units/[id]/quality` | GET | ✅ | ✅ | ✅ | serial_units, sku_stock |
| low | `/api/serial-units/[id]/release` | POST | ✅ | ✅ | ✅ | serial_units, sku_stock |
| low | `/api/shifts` | GET | ✅ | ✅ | ✅ | shifts, staff |
| low | `/api/shifts/[id]/cover` | POST | — | ✅ | ✅ | staff_sessions, shifts, staff |
| low | `/api/shipped/debug` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, packer_logs, orders |
| low | `/api/shipped/lookup-order` | GET | — | ✅ | ✅ | shipping_tracking_numbers, orders |
| low | `/api/shipped/scan-out` | POST/DELETE | ✅ | ✅ | ✅ | shipping_tracking_numbers, station_activity_logs, orders_exceptions, audit_logs, orders |
| low | `/api/shipped/submit` | POST | ✅ | ✅ | ✅ | sku_catalog, orders, sku |
| low | `/api/sku` | GET | ✅ | ✅ | ✅ | sku_platform_ids, serial_units, sku_catalog, sku_stock, sku |
| low | `/api/sku-catalog/[id]` | GET/PATCH/DELETE | — | ✅ | ✅ | bin_contents, sku_stock, sku |
| low | `/api/sku-catalog/[id]/kit-parts` | GET/POST/PUT/DELETE | ✅ | ✅ | ✅ | sku_kit_parts, sku_stock, sku |
| low | `/api/sku-catalog/[id]/manuals` | POST/PUT/DELETE | — | ✅ | ✅ | product_manuals, sku_catalog, sku_stock, sku |
| low | `/api/sku-catalog/[id]/qc-checks` | GET/POST/PUT/DELETE | ✅ | ✅ | ✅ | qc_check_templates, sku_stock, sku |
| low | `/api/sku-catalog/[id]/similar` | GET | — | ✅ | ✅ | sku_catalog, sku_stock, items, sku |
| low | `/api/sku-catalog/flag-missing` | POST | ✅ | ✅ | ✅ | pending_skus, sku_stock, sku |
| low | `/api/sku-catalog/graph/relationships` | POST | ✅ | ✅ | ✅ | sku_stock, sku |
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
| low | `/api/sku-stock/[sku]` | GET/PATCH | ✅ | ✅ | ✅ | location_transfers, photo_entity_links, inventory_events, sku_stock_ledger, serial_units, sku_catalog +5 |
| low | `/api/sku-stock/[sku]/bins` | GET | — | ✅ | ✅ | sku_platform_ids, sku_catalog, sku_stock, sku |
| low | `/api/sku/[id]/photos` | GET/POST | — | ✅ | ✅ | receiving, sku_stock, photos, sku |
| low | `/api/sku/by-tracking` | GET/DELETE | ✅ | ✅ | ✅ | serial_unit_provenance, photo_entity_links, serial_units, sku_stock, photos, sku |
| low | `/api/sku/lookup` | GET | ✅ | ✅ | ✅ | serial_units, sku_stock, sku |
| low | `/api/sku/serials-from-code` | GET | ✅ | ✅ | ✅ | serial_units, sku_stock, sku |
| low | `/api/staff` | GET/POST/PUT/DELETE | ✅ | ✅ | ✅ | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| low | `/api/staff-goals` | GET/PUT | ✅ | ✅ | ✅ | station_activity_logs, staff_goals, staff |
| low | `/api/staff-goals/history` | GET | ✅ | ✅ | ✅ | staff_goal_history, staff |
| low | `/api/staff/availability-rules` | GET/POST/PUT/DELETE | ✅ | ✅ | ✅ | staff_availability_rules, staff |
| low | `/api/staff/availability-today` | GET | ✅ | ✅ | ✅ | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| low | `/api/staff/schedule` | GET/PUT | ✅ | ✅ | ✅ | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| low | `/api/staff/schedule/week` | GET/PUT | ✅ | ✅ | ✅ | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| low | `/api/staff/schedule/week/copy` | POST | ✅ | ✅ | ✅ | staff_availability_rules, staff_schedule_overrides, staff_weekly_schedule, staff_week_plans, staff |
| low | `/api/stations` | GET/POST | ✅ | ✅ | ✅ | station_definitions, receiving, staff |
| low | `/api/stations/publish` | POST | ✅ | ✅ | ✅ | workflow_definitions, station_definitions, staff |
| low | `/api/stock-alerts` | GET | ✅ | ✅ | ✅ | bin_contents, stock_alerts, locations, sku_stock, sku |
| low | `/api/studio/definitions/[id]/discard` | DELETE | ✅ | ✅ | ✅ | workflow_definitions, item_workflow_state, workflow_edges, workflow_nodes, items |
| low | `/api/studio/definitions/[id]/graph` | PUT | ✅ | ✅ | ✅ | workflow_definitions, workflow_edges, workflow_nodes, types |
| low | `/api/studio/definitions/[id]/publish` | POST | ✅ | ✅ | ✅ | items, types |
| low | `/api/studio/flow` | GET | ✅ | ✅ | ✅ | workflow_node_stats, workflow_edges, workflow_nodes, workflow_runs |
| low | `/api/studio/items/stuck` | GET | ✅ | ✅ | ✅ | item_workflow_state, items, sku |
| low | `/api/studio/live` | GET | ✅ | ✅ | ✅ | item_workflow_state |
| low | `/api/studio/nodes/[id]/station` | GET/PUT | ✅ | ✅ | ✅ | station_definitions |
| low | `/api/studio/nodes/[id]/station/publish` | POST | ✅ | ✅ | ✅ | station_definitions |
| low | `/api/studio/people` | GET | ✅ | ✅ | ✅ | staff_stations, staff |
| low | `/api/sync-sheets` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, work_assignments, packer_logs, sku_catalog, fba_fnskus +2 |
| low | `/api/tech-logs/search` | GET | ✅ | ✅ | ✅ | orders, sku |
| low | `/api/tech/add-serial` | POST | ✅ | ✅ | ✅ | station_activity_logs |
| low | `/api/tech/add-serial-to-last` | POST | ✅ | ✅ | ✅ | station_activity_logs |
| low | `/api/tech/delete` | POST | ✅ | ✅ | ✅ | station_activity_logs, tech_serial_numbers, fba_fnsku_logs, orders, staff |
| low | `/api/tech/delete-tracking` | POST | ✅ | ✅ | ✅ | station_activity_logs, tech_serial_numbers, fba_fnsku_logs |
| low | `/api/tech/logs` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, station_activity_logs, tech_serial_numbers, work_assignments, fba_fnsku_logs, shipment_links +4 |
| low | `/api/tech/orders-without-manual` | GET | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, work_assignments, product_manuals, sku_catalog, fba_fnskus +2 |
| low | `/api/tech/scan` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, tech_serial_numbers, fba_shipment_items, orders_exceptions, work_assignments, fba_fnsku_logs +6 |
| low | `/api/tech/scan-sku` | POST | ✅ | ✅ | ✅ | sku_stock_ledger, serial_units, sku_stock, orders, staff, sku |
| low | `/api/tech/serial` | POST | ✅ | ✅ | ✅ | station_activity_logs, tech_serial_numbers, orders |
| low | `/api/tech/test-result` | POST | ✅ | ✅ | ✅ | serial_unit_condition_history, serial_units, sku |
| low | `/api/tech/undo-last` | POST | ✅ | ✅ | ✅ | station_activity_logs |
| low | `/api/tech/update-serials` | POST | ✅ | ✅ | ✅ | shipping_tracking_numbers, station_activity_logs, fba_fnsku_logs |
| low | `/api/testing/recent` | GET | ✅ | ✅ | ✅ | testing_results, serial_units, staff, sku |
| low | `/api/tracking-exceptions` | GET | ✅ | ✅ | ✅ | tracking_exceptions, receiving, orders, staff |
| low | `/api/tracking-exceptions/[id]` | GET/PATCH/DELETE | — | ✅ | ✅ | tracking_exceptions, receiving, staff |
| low | `/api/tracking-exceptions/[id]/refresh` | POST | — | ✅ | ✅ | tracking_exceptions, receiving_lines, receiving_scans, receiving, orders, sku |
| low | `/api/transfers` | POST | ✅ | ✅ | ✅ | inventory_events, bin_contents, locations, sku |
| low | `/api/update-sku-location` | POST | ✅ | ✅ | ✅ | location_transfers, sku_stock, sku |
| low | `/api/voicemails` | GET | ✅ | ✅ | ✅ | voicemails, items |
| low | `/api/warehouses` | GET | ✅ | ✅ | ✅ | warehouses, sku_stock |
| low | `/api/warranty/claims/[id]/restore` | POST | ✅ | ✅ | ✅ | warranty_claims |
| low | `/api/warranty/claims/bulk/restore` | POST | ✅ | ✅ | ✅ | warranty_claims |
| low | `/api/webhooks/zoho/orders` | POST/GET | — | — | ✅ | order_unit_allocations, orders, items, sku |
| low | `/api/work-orders` | GET/PATCH | ✅ | ✅ | ✅ | shipping_tracking_numbers, receiving_line_testing, work_assignments, receiving_lines, repair_service, fba_shipments +6 |
| low | `/api/work-orders/mine` | GET | ✅ | ✅ | ✅ | orders |
| low | `/api/workflow/flow-audit` | GET | ✅ | ✅ | ✅ | inventory_events, serial_units |
| low | `/api/zoho/fulfillment-sync` | POST | ✅ | ✅ | ✅ | zoho_fulfillment_sync, audit_logs, invoices, packages, orders |
| low | `/api/zoho/items/[id]/image` | GET | — | ✅ | ✅ | zoho_item_images, sku_stock, photos, items |
| low | `/api/zoho/orders/ingest` | POST | ✅ | ✅ | ✅ | order_ingest_queue, orders |
| low | `/api/zoho/purchase-orders/receive` | POST | ✅ | ✅ | ✅ | work_assignments, receiving_lines, receiving, orders, items, sku |

## Reverse index — routes per tenant table (the Phase E enforcement gate)

> A table may be `enforce_tenant_isolation()`-d only once **every** route below it is GUC-wrapped (low risk).

### `account_emails` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/auth/signup` (medium)
- ⛔ `/api/auth/verify-email` (high)

### `accounts` — 26 routes, 19 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/connect` (high)
- ✅ `/api/amazon/accounts` (low)
- ✅ `/api/amazon/connect` (low)
- ⛔ `/api/amazon/health` (medium)
- ✅ `/api/amazon/oauth/callback` (low)
- ⛔ `/api/amazon/sync` (medium)
- ⛔ `/api/auth/account/passkey/authenticate/finish` (medium)
- ⛔ `/api/auth/account/passkey/register/begin` (critical)
- ⛔ `/api/auth/account/signin` (medium)
- ⛔ `/api/auth/signup` (medium)
- ✅ `/api/auth/sso/callback` (low)
- ⛔ `/api/catalog/platform-accounts` (medium)
- ⛔ `/api/catalog/platform-accounts/[id]` (medium)
- ⛔ `/api/cron/amazon/orders-sync` (high)
- ⛔ `/api/cron/ebay/purchase-sync` (high)
- ✅ `/api/ebay/accounts` (low)
- ⛔ `/api/ebay/health` (medium)
- ⛔ `/api/ebay/refresh-tokens` (medium)
- ✅ `/api/ebay/search` (low)
- ⛔ `/api/ebay/sync` (medium)
- ⛔ `/api/integrations/google-drive/connect` (medium)
- ✅ `/api/orders/backfill/ebay` (low)
- ⛔ `/api/org/accounts/merge` (medium)
- ⛔ `/api/zoho/health` (medium)
- ⛔ `/api/zoho/oauth/authorize` (high)
- ⛔ `/api/zoho/oauth/callback` (medium)

### `agent_mutation_affects` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/assistant/mutations` (low)

### `agent_mutations` — 2 routes, 1 not yet GUC-safe

- ✅ `/api/assistant/mutations` (low)
- ⛔ `/api/assistant/mutations/stats` (medium)

### `ai_chat_messages` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/ai/chat-sessions/[sessionId]/messages` (low)

### `amazon_accounts` — 4 routes, 1 not yet GUC-safe

- ✅ `/api/amazon/accounts` (low)
- ✅ `/api/amazon/connect` (low)
- ✅ `/api/amazon/oauth/callback` (low)
- ⛔ `/api/cron/amazon/orders-sync` (high)

### `api_idempotency_responses` — 2 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/cleanup` (high)
- ✅ `/api/receiving/add-unmatched-line` (low)

### `audit_logs` — 15 routes, 5 not yet GUC-safe

- ✅ `/api/admin/logs` (low)
- ✅ `/api/audit-log/staff-directory` (low)
- ⛔ `/api/audit/bin/[id]` (medium)
- ⛔ `/api/audit/sku/[sku]` (medium)
- ✅ `/api/operations/kpi-table` (low)
- ✅ `/api/orders/[id]/timeline` (low)
- ✅ `/api/orders/assign` (low)
- ✅ `/api/pack/ship` (low)
- ✅ `/api/receiving/mark-received` (low)
- ✅ `/api/receiving/mark-received-po` (low)
- ⛔ `/api/serial-units/[id]/data-wipe` (medium)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ✅ `/api/shipped/scan-out` (low)
- ⛔ `/api/studio/items/[id]/recover` (medium)
- ✅ `/api/zoho/fulfillment-sync` (low)

### `auth_audit` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/admin/audit` (low)
- ✅ `/api/admin/staff/[id]/detail` (low)

### `auth_events` — 2 routes, 1 not yet GUC-safe

- ✅ `/api/auth/sso/callback` (low)
- ⛔ `/api/auth/switch-org` (medium)

### `beta_waitlist` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/beta/spots` (high)
- ⛔ `/api/beta/waitlist` (critical)

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

### `checklist_templates` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/checklists` (medium)

### `customers` — 9 routes, 4 not yet GUC-safe

- ✅ `/api/customers/[id]` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ✅ `/api/outbound/labels/purchase` (low)
- ✅ `/api/outbound/rates` (low)
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

### `document_entity_links` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/documents/[id]` (medium)

### `documents` — 15 routes, 7 not yet GUC-safe

- ⛔ `/api/documents/[id]` (medium)
- ✅ `/api/documents/[id]/content` (low)
- ⛔ `/api/documents/download-zip` (medium)
- ⛔ `/api/order-labels` (medium)
- ⛔ `/api/orders/[id]/documents` (medium)
- ✅ `/api/orders/[id]/documents/fetch` (low)
- ✅ `/api/outbound/labels/purchase` (low)
- ✅ `/api/outbound/labels/void` (low)
- ⛔ `/api/photos/library` (medium)
- ✅ `/api/rag/documents` (low)
- ⛔ `/api/repair-service/[id]` (medium)
- ✅ `/api/repair-service/document/[id]` (low)
- ✅ `/api/repair-service/pickup` (low)
- ✅ `/api/repair/submit` (low)
- ⛔ `/api/shipments/[id]/documents` (medium)

### `ebay_accounts` — 6 routes, 2 not yet GUC-safe

- ⛔ `/api/cron/signals/buyer-notes-heal` (high)
- ✅ `/api/ebay/accounts` (low)
- ✅ `/api/ebay/callback` (low)
- ⛔ `/api/ebay/connect` (medium)
- ✅ `/api/ebay/refresh-token` (low)
- ✅ `/api/orders/backfill/ebay` (low)

### `ebay_api_calls` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/sourcing/search` (medium)

### `email_delivery_signals` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)

### `email_login_tokens` — 4 routes, 4 not yet GUC-safe

- ⛔ `/api/auth/email-login/request` (critical)
- ⛔ `/api/auth/email-login/verify` (high)
- ⛔ `/api/auth/signup` (medium)
- ⛔ `/api/auth/verify-email` (high)

### `email_missing_purchase_orders` — 13 routes, 1 not yet GUC-safe

- ✅ `/api/admin/po-gmail/create-zoho-draft/[id]` (low)
- ✅ `/api/admin/po-gmail/missing-orders` (low)
- ⛔ `/api/admin/po-gmail/reconcile` (medium)
- ✅ `/api/admin/po-gmail/triage` (low)
- ✅ `/api/admin/po-gmail/triage/[id]` (low)
- ✅ `/api/admin/po-gmail/triage/[id]/detail` (low)
- ✅ `/api/admin/po-gmail/triage/[id]/extract` (low)
- ✅ `/api/admin/po-mirror/health` (low)
- ✅ `/api/cron/zoho/po-sync` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ✅ `/api/receiving-lines/incoming/todo` (low)
- ✅ `/api/receiving/email-po` (low)
- ✅ `/api/receiving/unfound-queue/[kind]/[id]` (low)

### `entity_search_docs` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/search-outbox` (high)

### `entity_search_outbox` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/cron/cleanup` (high)
- ⛔ `/api/cron/search-outbox` (high)

### `entity_signals` — 3 routes, 3 not yet GUC-safe

- ⛔ `/api/cron/signal-insight-rollup` (high)
- ⛔ `/api/cron/signals/buyer-notes-heal` (high)
- ⛔ `/api/entity-signals` (medium)

### `failure_modes` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/quality/dashboard` (low)

### `fba_fnsku_logs` — 15 routes, 0 not yet GUC-safe

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
- ✅ `/api/tech/delete` (low)
- ✅ `/api/tech/delete-tracking` (low)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/scan` (low)
- ✅ `/api/tech/update-serials` (low)

### `fba_fnskus` — 28 routes, 0 not yet GUC-safe

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
- ✅ `/api/fba/shipments/[id]/trace` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/today` (low)
- ✅ `/api/fba/shipments/today/items` (low)
- ✅ `/api/google-sheets/execute-script` (low)
- ✅ `/api/packing-logs` (low)
- ✅ `/api/sync-sheets` (low)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/orders-without-manual` (low)
- ✅ `/api/tech/scan` (low)

### `fba_shipment_item_units` — 3 routes, 0 not yet GUC-safe

- ✅ `/api/fba/items/[id]/link-unit` (low)
- ✅ `/api/fba/shipments/[id]/ship-units` (low)
- ✅ `/api/fba/shipments/[id]/trace` (low)

### `fba_shipment_items` — 30 routes, 0 not yet GUC-safe

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
- ✅ `/api/fba/shipments/[id]/trace` (low)
- ✅ `/api/fba/shipments/[id]/tracking` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/close` (low)
- ✅ `/api/fba/shipments/mark-shipped` (low)
- ✅ `/api/fba/shipments/split-for-paired-review` (low)
- ✅ `/api/fba/shipments/today` (low)
- ✅ `/api/fba/shipments/today/duplicate-yesterday` (low)
- ✅ `/api/fba/shipments/today/items` (low)
- ✅ `/api/fba/stage-counts` (low)
- ✅ `/api/packing-logs` (low)
- ✅ `/api/tech/scan` (low)

### `fba_shipment_tracking` — 12 routes, 0 not yet GUC-safe

- ✅ `/api/fba/board` (low)
- ✅ `/api/fba/board/[fnsku]/entries` (low)
- ✅ `/api/fba/print-queue` (low)
- ✅ `/api/fba/shipments` (low)
- ✅ `/api/fba/shipments/[id]` (low)
- ✅ `/api/fba/shipments/[id]/trace` (low)
- ✅ `/api/fba/shipments/[id]/tracking` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/mark-shipped` (low)
- ✅ `/api/fba/shipments/split-for-paired-review` (low)
- ✅ `/api/fba/shipments/today` (low)
- ✅ `/api/packing-logs` (low)

### `fba_shipments` — 27 routes, 0 not yet GUC-safe

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
- ✅ `/api/fba/shipments/[id]/trace` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/close` (low)
- ✅ `/api/fba/shipments/mark-shipped` (low)
- ✅ `/api/fba/shipments/split-for-paired-review` (low)
- ✅ `/api/fba/shipments/today` (low)
- ✅ `/api/fba/shipments/today/duplicate-yesterday` (low)
- ✅ `/api/fba/shipments/today/items` (low)
- ✅ `/api/packing-logs` (low)
- ✅ `/api/tech/scan` (low)
- ✅ `/api/work-orders` (low)

### `fba_tracking_item_allocations` — 5 routes, 0 not yet GUC-safe

- ✅ `/api/fba/shipments/[id]/items/[itemId]` (low)
- ✅ `/api/fba/shipments/[id]/tracking` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/split-for-paired-review` (low)
- ✅ `/api/receiving-lines` (low)

### `feed_memberships` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/feed-membership-projection` (high)

### `google_oauth_tokens` — 3 routes, 3 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/disconnect` (medium)
- ⛔ `/api/admin/po-gmail/oauth-callback` (medium)
- ⛔ `/api/admin/po-gmail/status` (medium)

### `handling_units` — 2 routes, 1 not yet GUC-safe

- ⛔ `/api/handling-units` (medium)
- ✅ `/api/handling-units/[id]` (low)

### `insight_links` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/cron/signal-insight-rollup` (high)
- ⛔ `/api/operations/benchmarks` (medium)

### `inventory_events` — 40 routes, 9 not yet GUC-safe

- ✅ `/api/audit-log/report` (low)
- ⛔ `/api/audit/bin/[id]` (medium)
- ⛔ `/api/audit/sku/[sku]` (medium)
- ✅ `/api/fba/items/[id]/link-unit` (low)
- ✅ `/api/fba/shipments/[id]/ship-units` (low)
- ✅ `/api/fba/shipments/[id]/trace` (low)
- ✅ `/api/inventory-photos` (low)
- ✅ `/api/locations/[barcode]/swap` (low)
- ⛔ `/api/operations/benchmarks` (medium)
- ✅ `/api/orders/[id]/release` (low)
- ✅ `/api/orders/[id]/timeline` (low)
- ✅ `/api/pack/ship` (low)
- ✅ `/api/pick/scan` (low)
- ⛔ `/api/picking/session/[id]/short-pick` (medium)
- ✅ `/api/post-multi-sn` (low)
- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ✅ `/api/receiving/[id]` (low)
- ⛔ `/api/receiving/lines/[id]/advance` (medium)
- ✅ `/api/receiving/lines/[id]/move` (low)
- ✅ `/api/receiving/lines/[id]/putaway` (low)
- ✅ `/api/receiving/lines/[id]/putaway/reverse` (low)
- ✅ `/api/receiving/lines/[id]/status` (low)
- ✅ `/api/receiving/lines/[id]/timeline` (low)
- ✅ `/api/receiving/mark-received` (low)
- ✅ `/api/receiving/mark-received-po` (low)
- ⛔ `/api/replenishment/tasks/[id]/complete` (medium)
- ⛔ `/api/returns/intake` (medium)
- ✅ `/api/returns/undo` (low)
- ⛔ `/api/rma/[id]/disposition` (medium)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/allocate` (low)
- ✅ `/api/serial-units/[id]/grade` (low)
- ✅ `/api/serial-units/[id]/hold` (low)
- ✅ `/api/serial-units/[id]/move` (low)
- ✅ `/api/serial-units/[id]/photos` (low)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ✅ `/api/sku-stock/[sku]` (low)
- ✅ `/api/transfers` (low)
- ✅ `/api/workflow/flow-audit` (low)

### `invoices` — 3 routes, 2 not yet GUC-safe

- ⛔ `/api/billing/portal` (medium)
- ⛔ `/api/billing/webhook` (medium)
- ✅ `/api/zoho/fulfillment-sync` (low)

### `item_stock_cache` — 2 routes, 1 not yet GUC-safe

- ⛔ `/api/need-to-order` (medium)
- ✅ `/api/replenish/shipped-fifo` (low)

### `item_workflow_state` — 5 routes, 2 not yet GUC-safe

- ⛔ `/api/cron/workflow-node-stats` (high)
- ✅ `/api/studio/definitions/[id]/discard` (low)
- ⛔ `/api/studio/items/[id]/recover` (medium)
- ✅ `/api/studio/items/stuck` (low)
- ✅ `/api/studio/live` (low)

### `items` — 109 routes, 38 not yet GUC-safe

- ✅ `/api/admin/po-gmail/create-zoho-draft/[id]` (low)
- ✅ `/api/admin/po-gmail/missing-orders` (low)
- ⛔ `/api/admin/po-gmail/preview-unread` (medium)
- ✅ `/api/admin/po-gmail/triage` (low)
- ✅ `/api/assignments/sku-search` (low)
- ⛔ `/api/audit-log/packing` (medium)
- ⛔ `/api/audit-log/receiving` (medium)
- ⛔ `/api/audit-log/sku` (medium)
- ⛔ `/api/audit-log/tech` (medium)
- ⛔ `/api/billing/webhook` (medium)
- ⛔ `/api/bose-models` (medium)
- ⛔ `/api/call-events` (medium)
- ✅ `/api/catalog/workflow-nodes` (low)
- ⛔ `/api/checklists` (medium)
- ✅ `/api/cron/zoho/incoming-po-sync` (low)
- ⛔ `/api/ecwid/order-search` (high)
- ⛔ `/api/ecwid/products/search` (high)
- ✅ `/api/ecwid/recent-repair-orders` (low)
- ✅ `/api/ecwid/sync-exception-tracking` (low)
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
- ✅ `/api/fba/shipments/[id]/trace` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/close` (low)
- ✅ `/api/fba/shipments/mark-shipped` (low)
- ✅ `/api/fba/shipments/today` (low)
- ✅ `/api/fba/shipments/today/duplicate-yesterday` (low)
- ✅ `/api/fba/shipments/today/items` (low)
- ✅ `/api/get-title-by-sku` (low)
- ⛔ `/api/handling-units` (medium)
- ⛔ `/api/inbox/support` (medium)
- ✅ `/api/inbox/tech-queue` (low)
- ✅ `/api/inventory/alerts` (low)
- ✅ `/api/inventory/counts` (low)
- ✅ `/api/inventory/items/search` (low)
- ✅ `/api/inventory/parts-graph` (low)
- ✅ `/api/inventory/parts/links` (low)
- ✅ `/api/inventory/units` (low)
- ✅ `/api/labels/recent` (low)
- ✅ `/api/local-pickup-orders` (low)
- ✅ `/api/local-pickup-orders/[id]` (low)
- ✅ `/api/local-pickup-orders/[id]/finalize` (low)
- ✅ `/api/local-pickup-orders/[id]/items` (low)
- ✅ `/api/local-pickup-orders/[id]/items/[itemId]` (low)
- ✅ `/api/orders/backfill/ecwid` (low)
- ⛔ `/api/part-compatibility` (medium)
- ⛔ `/api/photos/library` (medium)
- ⛔ `/api/photos/listing-gallery` (medium)
- ⛔ `/api/product-manuals/sync` (medium)
- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/delivered-unscanned` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ⛔ `/api/receiving-lines/incoming/email-rescan` (medium)
- ✅ `/api/receiving-lines/incoming/todo` (low)
- ✅ `/api/receiving/add-unmatched-line` (low)
- ⛔ `/api/receiving/identify-label` (medium)
- ✅ `/api/receiving/lines/[id]/zoho-note` (low)
- ✅ `/api/receiving/lookup-po` (low)
- ✅ `/api/receiving/mark-received` (low)
- ✅ `/api/receiving/mark-received-po` (low)
- ✅ `/api/receiving/po/[poId]` (low)
- ✅ `/api/receiving/po/list` (low)
- ⛔ `/api/receiving/rail-exclusions` (medium)
- ⛔ `/api/repair/ecwid-categories` (high)
- ⛔ `/api/repair/ecwid-products` (high)
- ✅ `/api/replenish/shipped-fifo` (low)
- ⛔ `/api/settings` (medium)
- ⛔ `/api/sku-catalog` (medium)
- ✅ `/api/sku-catalog/[id]/similar` (low)
- ✅ `/api/sku-catalog/pair-suggestions` (low)
- ✅ `/api/sku-catalog/pairing-queue` (low)
- ✅ `/api/sku-catalog/search` (low)
- ✅ `/api/sku-catalog/sync-ecwid-products` (low)
- ✅ `/api/sku-catalog/sync-ecwid-titles` (low)
- ✅ `/api/sku-catalog/unpaired` (low)
- ⛔ `/api/sku-catalog/unpaired-ecwid` (medium)
- ✅ `/api/sku-stock/[sku]` (low)
- ⛔ `/api/sourcing/alerts` (medium)
- ⛔ `/api/sourcing/candidates` (medium)
- ⛔ `/api/sourcing/saved-searches` (medium)
- ⛔ `/api/staff-messages` (medium)
- ⛔ `/api/staff-todos` (medium)
- ✅ `/api/studio/definitions/[id]/discard` (low)
- ✅ `/api/studio/definitions/[id]/publish` (low)
- ⛔ `/api/studio/items/[id]/recover` (medium)
- ✅ `/api/studio/items/stuck` (low)
- ⛔ `/api/suppliers` (medium)
- ✅ `/api/tech/scan` (low)
- ✅ `/api/voicemails` (low)
- ⛔ `/api/walk-in/catalog` (medium)
- ⛔ `/api/warranty/claims/bulk` (medium)
- ⛔ `/api/webhooks/square` (critical)
- ✅ `/api/webhooks/zoho/orders` (low)
- ✅ `/api/zoho/items/[id]/image` (low)
- ⛔ `/api/zoho/items/sync` (medium)
- ⛔ `/api/zoho/oauth/authorize` (high)
- ⛔ `/api/zoho/purchase-orders` (medium)
- ✅ `/api/zoho/purchase-orders/receive` (low)

### `local_pickup_items` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/local-pickups` (low)

### `local_pickup_order_items` — 6 routes, 0 not yet GUC-safe

- ✅ `/api/local-pickup-orders` (low)
- ✅ `/api/local-pickup-orders/[id]` (low)
- ✅ `/api/local-pickup-orders/[id]/finalize` (low)
- ✅ `/api/local-pickup-orders/[id]/items` (low)
- ✅ `/api/local-pickup-orders/[id]/items/[itemId]` (low)
- ✅ `/api/receiving-lines` (low)

### `local_pickup_orders` — 9 routes, 0 not yet GUC-safe

- ✅ `/api/local-pickup-orders` (low)
- ✅ `/api/local-pickup-orders/[id]` (low)
- ✅ `/api/local-pickup-orders/[id]/complete` (low)
- ✅ `/api/local-pickup-orders/[id]/finalize` (low)
- ✅ `/api/local-pickup-orders/[id]/items` (low)
- ✅ `/api/local-pickup-orders/[id]/items/[itemId]` (low)
- ✅ `/api/local-pickup-orders/[id]/reopen` (low)
- ✅ `/api/local-pickup-orders/[id]/void` (low)
- ✅ `/api/receiving/[id]` (low)

### `location_transfers` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/sku-stock/[sku]` (low)
- ✅ `/api/update-sku-location` (low)

### `locations` — 26 routes, 7 not yet GUC-safe

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
- ✅ `/api/orders/[id]/pick-tasks` (low)
- ✅ `/api/receiving/[id]` (low)
- ✅ `/api/receiving/lines/[id]/move` (low)
- ✅ `/api/receiving/lines/[id]/putaway` (low)
- ✅ `/api/receiving/lines/[id]/timeline` (low)
- ✅ `/api/receiving/mark-received` (low)
- ✅ `/api/receiving/triage/staging-map` (low)
- ✅ `/api/reports/bin-utilization` (low)
- ✅ `/api/rooms` (low)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/move` (low)
- ✅ `/api/sku-stock/[sku]` (low)
- ✅ `/api/stock-alerts` (low)
- ✅ `/api/transfers` (low)
- ⛔ `/api/walk-in/status` (medium)

### `memberships` — 13 routes, 12 not yet GUC-safe

- ⛔ `/api/auth/account/passkey` (high)
- ⛔ `/api/auth/account/passkey/[id]` (critical)
- ⛔ `/api/auth/account/passkey/authenticate/finish` (medium)
- ⛔ `/api/auth/account/passkey/register/begin` (critical)
- ⛔ `/api/auth/account/passkey/register/finish` (critical)
- ⛔ `/api/auth/account/signin` (medium)
- ⛔ `/api/auth/invitation/accept` (medium)
- ⛔ `/api/auth/session` (medium)
- ⛔ `/api/auth/signup` (medium)
- ✅ `/api/auth/sso/callback` (low)
- ⛔ `/api/auth/switch-org` (medium)
- ⛔ `/api/org/accounts/merge` (medium)
- ⛔ `/api/org/invitations` (medium)

### `messages` — 14 routes, 11 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/preview-unread` (medium)
- ⛔ `/api/admin/po-gmail/reconcile` (medium)
- ✅ `/api/admin/po-gmail/triage/[id]/detail` (low)
- ✅ `/api/admin/po-gmail/triage/[id]/extract` (low)
- ⛔ `/api/ai/chat` (medium)
- ✅ `/api/ai/chat-sessions/[sessionId]/messages` (low)
- ⛔ `/api/ai/chat/stream` (medium)
- ⛔ `/api/ai/search` (critical)
- ⛔ `/api/mcp` (medium)
- ⛔ `/api/receiving/zendesk-claim/assist` (medium)
- ⛔ `/api/staff-messages` (medium)
- ⛔ `/api/support/overview` (medium)
- ⛔ `/api/voicemails/[id]/followup` (medium)
- ⛔ `/api/zendesk/tickets/[id]/assign` (medium)

### `mobile_scan_events` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/scan/history` (low)
- ✅ `/api/scan/resolve` (low)

### `operations_kpi_rollups_daily` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/operations/kpi-table` (low)

### `operations_kpi_rollups_hourly` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/operations/kpi-table` (low)

### `ops_events` — 3 routes, 0 not yet GUC-safe

- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving/mark-received-po` (low)
- ✅ `/api/receiving/unfound-queue` (low)

### `order_ingest_queue` — 2 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/zoho/orders-ingest-drain` (high)
- ✅ `/api/zoho/orders/ingest` (low)

### `order_unit_allocations` — 14 routes, 4 not yet GUC-safe

- ⛔ `/api/orders/[id]/allocate` (medium)
- ✅ `/api/orders/[id]/release` (low)
- ✅ `/api/orders/[id]/timeline` (low)
- ✅ `/api/pack/ship` (low)
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

### `order_unit_amendments` — 3 routes, 0 not yet GUC-safe

- ✅ `/api/orders/[id]/amendments` (low)
- ✅ `/api/orders/[id]/substitute` (low)
- ✅ `/api/pack/ship` (low)

### `orders` — 141 routes, 47 not yet GUC-safe

- ✅ `/api/admin/fix-status` (low)
- ✅ `/api/admin/po-gmail/missing-orders` (low)
- ✅ `/api/admin/po-gmail/triage` (low)
- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/ai/chat/stream` (medium)
- ✅ `/api/audit-log/report` (low)
- ✅ `/api/check-tracking` (low)
- ⛔ `/api/cron/amazon/orders-sync` (high)
- ✅ `/api/cron/google-sheets/transfer-orders` (low)
- ⛔ `/api/cron/integrations/sync` (high)
- ⛔ `/api/cron/signals/buyer-notes-heal` (high)
- ⛔ `/api/cron/zoho/fulfillment-sync` (high)
- ✅ `/api/cron/zoho/incoming-po-sync` (low)
- ⛔ `/api/cron/zoho/orders-ingest-drain` (high)
- ✅ `/api/cron/zoho/po-sync` (low)
- ✅ `/api/customers/[id]` (low)
- ✅ `/api/dashboard/operations` (low)
- ✅ `/api/debug-tracking` (low)
- ⛔ `/api/desktop-app/release` (high)
- ⛔ `/api/documents/[id]` (medium)
- ✅ `/api/documents/[id]/content` (low)
- ⛔ `/api/documents/download-zip` (medium)
- ✅ `/api/ebay/search` (low)
- ⛔ `/api/ecwid/order-search` (high)
- ✅ `/api/ecwid/recent-repair-orders` (low)
- ✅ `/api/ecwid/sync-exception-tracking` (low)
- ⛔ `/api/ecwid/transfer-orders` (medium)
- ⛔ `/api/global-search` (medium)
- ✅ `/api/google-sheets/execute-script` (low)
- ✅ `/api/google-sheets/sync-shipstation-orders` (low)
- ⛔ `/api/google-sheets/transfer-orders` (medium)
- ✅ `/api/import-orders` (low)
- ⛔ `/api/integrations/[provider]/sync` (medium)
- ✅ `/api/local-pickup-orders` (low)
- ✅ `/api/local-pickup-orders/[id]` (low)
- ✅ `/api/local-pickup-orders/[id]/complete` (low)
- ✅ `/api/local-pickup-orders/[id]/finalize` (low)
- ✅ `/api/local-pickup-orders/[id]/items` (low)
- ✅ `/api/local-pickup-orders/[id]/items/[itemId]` (low)
- ✅ `/api/local-pickup-orders/[id]/reopen` (low)
- ✅ `/api/local-pickup-orders/[id]/void` (low)
- ⛔ `/api/nas-target/[target]/[[...path]]` (medium)
- ⛔ `/api/operations/benchmarks` (medium)
- ✅ `/api/operations/roi` (low)
- ⛔ `/api/order-amendments/[id]/decision` (medium)
- ⛔ `/api/order-labels` (medium)
- ✅ `/api/orders` (low)
- ✅ `/api/orders-exceptions/delete` (low)
- ✅ `/api/orders-exceptions/sync` (low)
- ⛔ `/api/orders/[id]` (medium)
- ⛔ `/api/orders/[id]/allocate` (medium)
- ✅ `/api/orders/[id]/amendments` (low)
- ⛔ `/api/orders/[id]/documents` (medium)
- ✅ `/api/orders/[id]/documents/fetch` (low)
- ✅ `/api/orders/[id]/pick-tasks` (low)
- ✅ `/api/orders/[id]/release` (low)
- ✅ `/api/orders/[id]/substitute` (low)
- ✅ `/api/orders/[id]/timeline` (low)
- ⛔ `/api/orders/[id]/tracking` (medium)
- ✅ `/api/orders/add` (low)
- ✅ `/api/orders/assign` (low)
- ✅ `/api/orders/backfill/ebay` (low)
- ✅ `/api/orders/backfill/ecwid` (low)
- ✅ `/api/orders/batch` (low)
- ✅ `/api/orders/check-shipped` (low)
- ✅ `/api/orders/delete` (low)
- ⛔ `/api/orders/import-csv` (medium)
- ✅ `/api/orders/integrity-check` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ✅ `/api/orders/missing-parts` (low)
- ✅ `/api/orders/next` (low)
- ✅ `/api/orders/recent` (low)
- ✅ `/api/orders/set-item-number` (low)
- ⛔ `/api/orders/skip` (critical)
- ⛔ `/api/orders/start` (critical)
- ✅ `/api/orders/verify` (low)
- ✅ `/api/outbound/labels/purchase` (low)
- ✅ `/api/outbound/labels/void` (low)
- ⛔ `/api/outbound/mark-staged` (medium)
- ✅ `/api/outbound/rates` (low)
- ✅ `/api/pack/ship` (low)
- ✅ `/api/packerlogs` (low)
- ✅ `/api/packing-logs` (low)
- ✅ `/api/packing-logs/history` (low)
- ✅ `/api/packing-logs/update` (low)
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
- ✅ `/api/receiving/add-unmatched-line` (low)
- ⛔ `/api/receiving/inbound/import-ebay` (medium)
- ✅ `/api/receiving/lookup-po` (low)
- ⛔ `/api/receiving/pending-check` (medium)
- ⛔ `/api/replenish/bulk-create-po` (medium)
- ✅ `/api/replenish/shipped-fifo` (low)
- ✅ `/api/scan-tracking` (low)
- ✅ `/api/scan/resolve` (low)
- ✅ `/api/serial-units/[id]/allocate` (low)
- ⛔ `/api/serial-units/lookup` (medium)
- ⛔ `/api/shipped` (medium)
- ⛔ `/api/shipped/[id]` (medium)
- ✅ `/api/shipped/debug` (low)
- ✅ `/api/shipped/lookup-order` (low)
- ✅ `/api/shipped/scan-out` (low)
- ⛔ `/api/shipped/search` (medium)
- ✅ `/api/shipped/submit` (low)
- ⛔ `/api/sku-catalog/pair-batch` (medium)
- ✅ `/api/sku-catalog/pairing-queue` (low)
- ✅ `/api/sku-catalog/resolve` (low)
- ✅ `/api/sku-catalog/search-unmatched` (low)
- ✅ `/api/sku-catalog/unpaired` (low)
- ✅ `/api/sync-sheets` (low)
- ✅ `/api/tech-logs/search` (low)
- ✅ `/api/tech/delete` (low)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/orders-without-manual` (low)
- ✅ `/api/tech/scan` (low)
- ✅ `/api/tech/scan-sku` (low)
- ✅ `/api/tech/serial` (low)
- ✅ `/api/tracking-exceptions` (low)
- ✅ `/api/tracking-exceptions/[id]/refresh` (low)
- ⛔ `/api/walk-in/orders` (medium)
- ⛔ `/api/walk-in/sales` (medium)
- ⛔ `/api/walk-in/sync` (medium)
- ⛔ `/api/webhooks/square` (critical)
- ✅ `/api/webhooks/zoho/orders` (low)
- ✅ `/api/work-orders` (low)
- ⛔ `/api/work-orders/calendar` (medium)
- ✅ `/api/work-orders/mine` (low)
- ✅ `/api/zoho/fulfillment-sync` (low)
- ✅ `/api/zoho/orders/ingest` (low)
- ⛔ `/api/zoho/purchase-orders` (medium)
- ✅ `/api/zoho/purchase-orders/receive` (low)
- ⛔ `/api/zoho/purchase-orders/sync` (medium)
- ⛔ `/api/zoho/purchase-receives/sync` (medium)

### `orders_exceptions` — 9 routes, 0 not yet GUC-safe

- ✅ `/api/ecwid/sync-exception-tracking` (low)
- ✅ `/api/google-sheets/execute-script` (low)
- ✅ `/api/google-sheets/sync-shipstation-orders` (low)
- ✅ `/api/orders-exceptions/delete` (low)
- ✅ `/api/orders-exceptions/sync` (low)
- ✅ `/api/receiving/unfound-queue/[kind]/[id]` (low)
- ✅ `/api/scan-tracking` (low)
- ✅ `/api/shipped/scan-out` (low)
- ✅ `/api/tech/scan` (low)

### `organization_feature_flags` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/admin/org/export` (low)

### `packages` — 7 routes, 4 not yet GUC-safe

- ⛔ `/api/nas-dev/[[...path]]` (critical)
- ⛔ `/api/outbound/mark-staged` (medium)
- ⛔ `/api/receiving-lines/incoming/refresh` (medium)
- ✅ `/api/receiving-lines/incoming/refresh/stream` (low)
- ✅ `/api/receiving-lines/incoming/summary` (low)
- ⛔ `/api/webhooks/ups` (critical)
- ✅ `/api/zoho/fulfillment-sync` (low)

### `packer_log_enrichment` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/packerlogs` (low)

### `packer_logs` — 18 routes, 2 not yet GUC-safe

- ✅ `/api/admin/logs` (low)
- ✅ `/api/audit-log/report` (low)
- ✅ `/api/check-tracking` (low)
- ✅ `/api/debug-tracking` (low)
- ✅ `/api/google-sheets/execute-script` (low)
- ✅ `/api/orders` (low)
- ✅ `/api/orders-exceptions/sync` (low)
- ✅ `/api/orders/batch` (low)
- ✅ `/api/orders/verify` (low)
- ✅ `/api/pack/ship` (low)
- ✅ `/api/packerlogs` (low)
- ✅ `/api/packing-logs` (low)
- ✅ `/api/packing-logs/history` (low)
- ✅ `/api/packing-logs/update` (low)
- ⛔ `/api/packing-photos` (medium)
- ⛔ `/api/shipped` (medium)
- ✅ `/api/shipped/debug` (low)
- ✅ `/api/sync-sheets` (low)

### `part_acquisitions` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/sourcing/candidates/[id]/import` (medium)

### `part_compatibility` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/part-compatibility` (medium)

### `part_links` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/inventory/parts-graph` (low)

### `payroll_settings` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/payroll/settings` (low)

### `pending_skus` — 3 routes, 1 not yet GUC-safe

- ✅ `/api/pending-skus` (low)
- ⛔ `/api/receiving/pending-check` (medium)
- ✅ `/api/sku-catalog/flag-missing` (low)

### `photo_analysis` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/admin/photos/stats` (low)

### `photo_entity_links` — 8 routes, 1 not yet GUC-safe

- ✅ `/api/packing-logs/history` (low)
- ✅ `/api/packing-logs/update` (low)
- ⛔ `/api/packing-photos` (medium)
- ✅ `/api/photos/[id]` (low)
- ✅ `/api/photos/download-zip` (low)
- ✅ `/api/serial-units/[id]/photos` (low)
- ✅ `/api/sku-stock/[sku]` (low)
- ✅ `/api/sku/by-tracking` (low)

### `photo_jobs` — 2 routes, 1 not yet GUC-safe

- ✅ `/api/admin/photos/stats` (low)
- ⛔ `/api/cron/photos/analyze` (medium)

### `photo_storage` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/admin/photos/stats` (low)

### `photos` — 65 routes, 41 not yet GUC-safe

- ⛔ `/api/admin/photos/mirror` (medium)
- ✅ `/api/admin/photos/stats` (low)
- ⛔ `/api/cron/photos/analyze` (medium)
- ⛔ `/api/cron/photos/drive-mirror` (medium)
- ⛔ `/api/cron/photos/nas-mirror` (medium)
- ✅ `/api/documents/[id]/content` (low)
- ⛔ `/api/integrations/google-drive/callback` (medium)
- ⛔ `/api/integrations/google-drive/connect` (medium)
- ⛔ `/api/integrations/google-drive/health` (medium)
- ✅ `/api/inventory-photos` (low)
- ⛔ `/api/nas-config` (medium)
- ⛔ `/api/nas-dev/[[...path]]` (critical)
- ⛔ `/api/nas/[[...path]]` (medium)
- ✅ `/api/packerlogs` (low)
- ⛔ `/api/packerlogs/for-order` (medium)
- ✅ `/api/packing-logs` (low)
- ✅ `/api/packing-logs/history` (low)
- ⛔ `/api/packing-logs/save-photo` (medium)
- ✅ `/api/packing-logs/update` (low)
- ⛔ `/api/packing-photos` (medium)
- ✅ `/api/photos/[id]` (low)
- ✅ `/api/photos/[id]/content` (low)
- ⛔ `/api/photos/[id]/labels` (medium)
- ⛔ `/api/photos/[id]/reassign` (medium)
- ⛔ `/api/photos/analyze` (medium)
- ✅ `/api/photos/download-zip` (low)
- ⛔ `/api/photos/drive-backup` (medium)
- ⛔ `/api/photos/image-types` (medium)
- ⛔ `/api/photos/labels` (medium)
- ⛔ `/api/photos/labels/[id]` (medium)
- ⛔ `/api/photos/labels/bulk-apply` (medium)
- ⛔ `/api/photos/library` (medium)
- ⛔ `/api/photos/library/ids` (medium)
- ⛔ `/api/photos/links` (medium)
- ⛔ `/api/photos/listing-gallery` (medium)
- ⛔ `/api/photos/nas-backup` (medium)
- ⛔ `/api/photos/saved-views` (medium)
- ⛔ `/api/photos/saved-views/[id]` (medium)
- ⛔ `/api/photos/share` (medium)
- ⛔ `/api/photos/share-packs` (medium)
- ⛔ `/api/photos/share-packs/[token]` (medium)
- ⛔ `/api/photos/share-packs/[token]/zip` (medium)
- ✅ `/api/photos/upload` (low)
- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-photos` (low)
- ⛔ `/api/receiving/nas-archive-test` (medium)
- ✅ `/api/receiving/po/[poId]` (low)
- ✅ `/api/receiving/po/list` (low)
- ✅ `/api/receiving/triage/done` (low)
- ✅ `/api/receiving/unfound-queue` (low)
- ✅ `/api/receiving/zendesk-claim` (low)
- ⛔ `/api/receiving/zendesk-claim/archive-only` (medium)
- ⛔ `/api/receiving/zendesk-claim/assist` (medium)
- ⛔ `/api/receiving/zendesk-claim/draft` (medium)
- ⛔ `/api/receiving/zendesk-claim/preview` (medium)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/photos` (low)
- ✅ `/api/sku-stock/[sku]` (low)
- ✅ `/api/sku/[id]/photos` (low)
- ✅ `/api/sku/by-tracking` (low)
- ⛔ `/api/warranty/claims/[id]/repair` (medium)
- ⛔ `/api/zendesk/photo-ticket` (medium)
- ⛔ `/api/zendesk/tickets` (medium)
- ⛔ `/api/zendesk/tickets/[id]/photos` (medium)
- ✅ `/api/zoho/items/[id]/image` (low)

### `picking_sessions` — 2 routes, 1 not yet GUC-safe

- ✅ `/api/pick/queue` (low)
- ⛔ `/api/picking/session/[id]/complete` (medium)

### `platform_accounts` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/ebay/callback` (low)
- ✅ `/api/receiving-lines` (low)

### `platforms` — 7 routes, 3 not yet GUC-safe

- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/catalog/platforms` (medium)
- ⛔ `/api/catalog/platforms/[id]` (medium)
- ✅ `/api/products/[sku]` (low)
- ✅ `/api/receiving/[id]` (low)
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

### `reason_codes` — 4 routes, 3 not yet GUC-safe

- ✅ `/api/labels` (low)
- ⛔ `/api/locations/[barcode]` (medium)
- ⛔ `/api/reason-codes` (medium)
- ⛔ `/api/warranty/reports/export` (medium)

### `receiving` — 138 routes, 64 not yet GUC-safe

- ⛔ `/api/admin/organization/settings` (medium)
- ⛔ `/api/admin/po-gmail/reconcile` (medium)
- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/ai/chat/stream` (medium)
- ⛔ `/api/audit-log/receiving` (medium)
- ✅ `/api/audit-log/report` (low)
- ⛔ `/api/audit-log/trace` (medium)
- ⛔ `/api/catalog/platform-accounts` (medium)
- ⛔ `/api/catalog/platforms` (medium)
- ⛔ `/api/catalog/types` (medium)
- ✅ `/api/catalog/workflow-nodes` (low)
- ⛔ `/api/checklists` (medium)
- ⛔ `/api/cron/feed-membership-projection` (high)
- ⛔ `/api/cron/receiving/incoming-tracking-sync` (high)
- ⛔ `/api/cron/shipping/reconcile-delivered` (high)
- ⛔ `/api/cron/shipping/sync-due` (high)
- ✅ `/api/cron/zoho/incoming-po-sync` (low)
- ✅ `/api/cron/zoho/po-sync` (low)
- ✅ `/api/dashboard/fba-shipments` (low)
- ✅ `/api/ecwid/recent-repair-orders` (low)
- ⛔ `/api/global-search` (medium)
- ✅ `/api/inbox/tech-queue` (low)
- ✅ `/api/local-pickup-orders/[id]/finalize` (low)
- ✅ `/api/local-pickups` (low)
- ⛔ `/api/nas-config` (medium)
- ⛔ `/api/nas-dev/[[...path]]` (critical)
- ⛔ `/api/nas-target/[target]/[[...path]]` (medium)
- ⛔ `/api/nas/[[...path]]` (medium)
- ✅ `/api/orders-exceptions/sync` (low)
- ✅ `/api/orders/[id]/timeline` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ⛔ `/api/packing-photos` (medium)
- ✅ `/api/photos/[id]` (low)
- ⛔ `/api/photos/[id]/reassign` (medium)
- ✅ `/api/photos/upload` (low)
- ✅ `/api/post-multi-sn` (low)
- ✅ `/api/receiving-entry` (low)
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
- ✅ `/api/receiving-lines/incoming/todo` (low)
- ⛔ `/api/receiving-lines/incoming/zoho-refresh` (medium)
- ✅ `/api/receiving-lines/view` (low)
- ✅ `/api/receiving-logs` (low)
- ✅ `/api/receiving-logs/search` (low)
- ✅ `/api/receiving-photos` (low)
- ⛔ `/api/receiving-tasks` (medium)
- ✅ `/api/receiving/[id]` (low)
- ⛔ `/api/receiving/[id]/attach-box` (medium)
- ⛔ `/api/receiving/[id]/unpair` (medium)
- ✅ `/api/receiving/[id]/zoho-sync` (low)
- ✅ `/api/receiving/add-unmatched-line` (low)
- ⛔ `/api/receiving/disposition-suggest` (critical)
- ✅ `/api/receiving/email-po` (low)
- ⛔ `/api/receiving/identify-label` (medium)
- ⛔ `/api/receiving/import-sales-order` (medium)
- ⛔ `/api/receiving/inbound/import-ebay` (medium)
- ⛔ `/api/receiving/lines/[id]/advance` (medium)
- ✅ `/api/receiving/lines/[id]/condition` (low)
- ✅ `/api/receiving/lines/[id]/move` (low)
- ✅ `/api/receiving/lines/[id]/putaway` (low)
- ✅ `/api/receiving/lines/[id]/putaway/reverse` (low)
- ✅ `/api/receiving/lines/[id]/status` (low)
- ✅ `/api/receiving/lines/[id]/timeline` (low)
- ✅ `/api/receiving/lines/[id]/zoho-note` (low)
- ✅ `/api/receiving/lookup-po` (low)
- ✅ `/api/receiving/mark-received` (low)
- ✅ `/api/receiving/mark-received-po` (low)
- ✅ `/api/receiving/match` (low)
- ⛔ `/api/receiving/nas-archive-test` (medium)
- ⛔ `/api/receiving/pending-check` (medium)
- ✅ `/api/receiving/pending-unboxing` (low)
- ✅ `/api/receiving/po-search` (low)
- ✅ `/api/receiving/po/[poId]` (low)
- ✅ `/api/receiving/po/[poId]/attach-box` (low)
- ✅ `/api/receiving/po/list` (low)
- ⛔ `/api/receiving/rail-exclusions` (medium)
- ⛔ `/api/receiving/relink` (medium)
- ✅ `/api/receiving/scan-serial` (low)
- ✅ `/api/receiving/serials` (low)
- ✅ `/api/receiving/touch-scan` (low)
- ⛔ `/api/receiving/triage/complete` (medium)
- ✅ `/api/receiving/triage/done` (low)
- ✅ `/api/receiving/triage/metrics` (low)
- ✅ `/api/receiving/triage/staging-map` (low)
- ✅ `/api/receiving/unfound-queue` (low)
- ✅ `/api/receiving/unfound-queue/[kind]/[id]` (low)
- ✅ `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk` (low)
- ⛔ `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk/draft` (medium)
- ✅ `/api/receiving/unfound-queue/retry-pair` (low)
- ⛔ `/api/receiving/visual-identify` (medium)
- ✅ `/api/receiving/zendesk-claim` (low)
- ⛔ `/api/receiving/zendesk-claim/archive-only` (medium)
- ⛔ `/api/receiving/zendesk-claim/assist` (medium)
- ⛔ `/api/receiving/zendesk-claim/assist-seller` (medium)
- ⛔ `/api/receiving/zendesk-claim/classify` (critical)
- ⛔ `/api/receiving/zendesk-claim/draft` (medium)
- ✅ `/api/receiving/zendesk-claim/link` (low)
- ⛔ `/api/receiving/zendesk-claim/preview` (medium)
- ⛔ `/api/receiving/zendesk-claim/seller-message` (medium)
- ⛔ `/api/receiving/zendesk-claim/thread` (medium)
- ⛔ `/api/returns/intake` (medium)
- ✅ `/api/returns/undo` (low)
- ✅ `/api/scan/history` (low)
- ✅ `/api/scan/resolve` (low)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/photos` (low)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/serial-units/lookup` (medium)
- ⛔ `/api/settings` (medium)
- ✅ `/api/sku/[id]/photos` (low)
- ⛔ `/api/sourcing/candidates/[id]/import` (medium)
- ✅ `/api/stations` (low)
- ⛔ `/api/support/tickets/by-entity` (medium)
- ✅ `/api/tracking-exceptions` (low)
- ✅ `/api/tracking-exceptions/[id]` (low)
- ✅ `/api/tracking-exceptions/[id]/refresh` (low)
- ⛔ `/api/vision-config` (high)
- ⛔ `/api/warranty/claims/[id]/zendesk` (medium)
- ⛔ `/api/warranty/claims/[id]/zendesk/link` (medium)
- ✅ `/api/work-orders` (low)
- ⛔ `/api/zoho/find-po` (medium)
- ⛔ `/api/zoho/oauth/authorize` (high)
- ⛔ `/api/zoho/purchase-orders` (medium)
- ✅ `/api/zoho/purchase-orders/receive` (low)
- ⛔ `/api/zoho/purchase-orders/sync` (medium)
- ⛔ `/api/zoho/purchase-receives` (medium)
- ⛔ `/api/zoho/purchase-receives/import` (medium)
- ⛔ `/api/zoho/purchase-receives/sync` (medium)

### `receiving_claim_seller_messages` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/receiving/zendesk-claim/seller-message` (medium)

### `receiving_exceptions` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/receiving/lines/[id]/advance` (medium)

### `receiving_line_testing` — 5 routes, 0 not yet GUC-safe

- ✅ `/api/inbox/tech-queue` (low)
- ✅ `/api/receiving/[id]` (low)
- ✅ `/api/receiving/pending-unboxing` (low)
- ✅ `/api/receiving/po/[poId]` (low)
- ✅ `/api/work-orders` (low)

### `receiving_line_views` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/view` (low)

### `receiving_lines` — 45 routes, 8 not yet GUC-safe

- ⛔ `/api/admin/po-gmail/reconcile` (medium)
- ✅ `/api/admin/po-mirror/health` (low)
- ✅ `/api/audit-log/report` (low)
- ✅ `/api/cron/zoho/incoming-po-sync` (low)
- ✅ `/api/cron/zoho/po-sync` (low)
- ✅ `/api/inbox/tech-queue` (low)
- ✅ `/api/photos/upload` (low)
- ✅ `/api/receiving-entry` (low)
- ✅ `/api/receiving-lines` (low)
- ⛔ `/api/receiving-lines/[id]/ensure-catalog` (medium)
- ✅ `/api/receiving-lines/incoming/delivered-unscanned` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ⛔ `/api/receiving-lines/incoming/refresh` (medium)
- ✅ `/api/receiving-lines/incoming/refresh/stream` (low)
- ✅ `/api/receiving-lines/incoming/summary` (low)
- ⛔ `/api/receiving-lines/incoming/zoho-refresh` (medium)
- ✅ `/api/receiving-photos` (low)
- ✅ `/api/receiving/[id]` (low)
- ✅ `/api/receiving/[id]/zoho-sync` (low)
- ✅ `/api/receiving/add-unmatched-line` (low)
- ✅ `/api/receiving/lines/[id]/condition` (low)
- ✅ `/api/receiving/lines/[id]/move` (low)
- ✅ `/api/receiving/lines/[id]/putaway` (low)
- ✅ `/api/receiving/lines/[id]/status` (low)
- ✅ `/api/receiving/lines/[id]/zoho-note` (low)
- ✅ `/api/receiving/lookup-po` (low)
- ✅ `/api/receiving/mark-received` (low)
- ✅ `/api/receiving/mark-received-po` (low)
- ✅ `/api/receiving/match` (low)
- ✅ `/api/receiving/pending-unboxing` (low)
- ✅ `/api/receiving/po/[poId]` (low)
- ✅ `/api/receiving/po/[poId]/attach-box` (low)
- ✅ `/api/receiving/po/list` (low)
- ✅ `/api/receiving/scan-serial` (low)
- ✅ `/api/receiving/serials` (low)
- ✅ `/api/receiving/triage/done` (low)
- ✅ `/api/receiving/zendesk-claim` (low)
- ⛔ `/api/receiving/zendesk-claim/draft` (medium)
- ✅ `/api/receiving/zendesk-claim/link` (low)
- ⛔ `/api/receiving/zendesk-claim/preview` (medium)
- ✅ `/api/tracking-exceptions/[id]/refresh` (low)
- ✅ `/api/work-orders` (low)
- ✅ `/api/zoho/purchase-orders/receive` (low)
- ⛔ `/api/zoho/purchase-orders/sync` (medium)
- ⛔ `/api/zoho/purchase-receives/sync` (medium)

### `receiving_scans` — 9 routes, 0 not yet GUC-safe

- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/delivered-unscanned` (low)
- ✅ `/api/receiving-lines/incoming/summary` (low)
- ✅ `/api/receiving-logs` (low)
- ✅ `/api/receiving-photos` (low)
- ✅ `/api/receiving/[id]` (low)
- ✅ `/api/receiving/lookup-po` (low)
- ✅ `/api/receiving/touch-scan` (low)
- ✅ `/api/tracking-exceptions/[id]/refresh` (low)

### `repair_actions` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/repair/actions` (low)
- ✅ `/api/repair/actions/[id]` (low)

### `repair_service` — 10 routes, 3 not yet GUC-safe

- ✅ `/api/dashboard/operations` (low)
- ⛔ `/api/repair-service/[id]/link` (medium)
- ✅ `/api/repair-service/document/[id]` (low)
- ✅ `/api/repair-service/next` (low)
- ✅ `/api/repair-service/out-of-stock` (low)
- ✅ `/api/repair-service/pickup` (low)
- ✅ `/api/repair-service/repaired` (low)
- ⛔ `/api/warranty/claims/[id]/repair-handoff` (medium)
- ⛔ `/api/warranty/quotes/[id]` (medium)
- ✅ `/api/work-orders` (low)

### `replenishment_order_lines` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/orders` (low)

### `replenishment_requests` — 5 routes, 2 not yet GUC-safe

- ✅ `/api/audit-log/report` (low)
- ⛔ `/api/need-to-order` (medium)
- ⛔ `/api/need-to-order/[id]` (medium)
- ✅ `/api/orders` (low)
- ✅ `/api/replenish/shipped-fifo` (low)

### `replenishment_status_log` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/need-to-order/[id]` (medium)

### `return_dispositions` — 3 routes, 3 not yet GUC-safe

- ⛔ `/api/rma/[id]/disposition` (medium)
- ⛔ `/api/rma/backlog` (medium)
- ⛔ `/api/rma/disposition` (medium)

### `rma_authorizations` — 2 routes, 2 not yet GUC-safe

- ⛔ `/api/rma/disposition` (medium)
- ⛔ `/api/warranty/claims/[id]/rma` (medium)

### `serial_unit_condition_history` — 3 routes, 0 not yet GUC-safe

- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/grade` (low)
- ✅ `/api/tech/test-result` (low)

### `serial_unit_listings` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/serial-units/[id]/list` (medium)

### `serial_unit_provenance` — 4 routes, 0 not yet GUC-safe

- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving/[id]` (low)
- ✅ `/api/receiving/mark-received-po` (low)
- ✅ `/api/sku/by-tracking` (low)

### `serial_units` — 60 routes, 10 not yet GUC-safe

- ✅ `/api/fba/items/[id]/link-unit` (low)
- ✅ `/api/fba/shipments/[id]/ship-units` (low)
- ✅ `/api/fba/shipments/[id]/trace` (low)
- ✅ `/api/inventory-events` (low)
- ✅ `/api/inventory/units` (low)
- ✅ `/api/labels/recent` (low)
- ⛔ `/api/orders/[id]/allocate` (medium)
- ✅ `/api/orders/[id]/amendments` (low)
- ✅ `/api/orders/[id]/release` (low)
- ✅ `/api/orders/[id]/substitute` (low)
- ✅ `/api/pack/ship` (low)
- ✅ `/api/pick/scan` (low)
- ✅ `/api/pick/unscan` (low)
- ⛔ `/api/picking/session/[id]/confirm-pick` (medium)
- ⛔ `/api/picking/session/[id]/short-pick` (medium)
- ✅ `/api/post-multi-sn` (low)
- ✅ `/api/products/[sku]` (low)
- ✅ `/api/quality/dashboard` (low)
- ✅ `/api/receiving-lines` (low)
- ⛔ `/api/receiving-lines/[id]/ensure-catalog` (medium)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ✅ `/api/receiving/[id]` (low)
- ✅ `/api/receiving/lines/[id]/move` (low)
- ✅ `/api/receiving/lines/[id]/putaway` (low)
- ✅ `/api/receiving/lines/[id]/putaway/reverse` (low)
- ✅ `/api/receiving/lines/[id]/status` (low)
- ✅ `/api/receiving/lines/[id]/timeline` (low)
- ✅ `/api/receiving/mark-received` (low)
- ✅ `/api/receiving/mark-received-po` (low)
- ✅ `/api/receiving/scan-serial` (low)
- ✅ `/api/receiving/serials` (low)
- ✅ `/api/receiving/unfound-queue/[kind]/[id]` (low)
- ⛔ `/api/returns/intake` (medium)
- ✅ `/api/returns/undo` (low)
- ✅ `/api/scan/resolve` (low)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/allocate` (low)
- ✅ `/api/serial-units/[id]/checklist` (low)
- ✅ `/api/serial-units/[id]/checklist/bulk` (low)
- ⛔ `/api/serial-units/[id]/data-wipe` (medium)
- ✅ `/api/serial-units/[id]/failure-tags` (low)
- ✅ `/api/serial-units/[id]/grade` (low)
- ✅ `/api/serial-units/[id]/hold` (low)
- ⛔ `/api/serial-units/[id]/list` (medium)
- ✅ `/api/serial-units/[id]/move` (low)
- ✅ `/api/serial-units/[id]/photos` (low)
- ✅ `/api/serial-units/[id]/quality` (low)
- ✅ `/api/serial-units/[id]/release` (low)
- ⛔ `/api/serial-units/[id]/repairs` (medium)
- ⛔ `/api/serial-units/lookup` (medium)
- ✅ `/api/sku` (low)
- ✅ `/api/sku-stock/[sku]` (low)
- ✅ `/api/sku/by-tracking` (low)
- ✅ `/api/sku/lookup` (low)
- ✅ `/api/sku/serials-from-code` (low)
- ✅ `/api/tech/scan-sku` (low)
- ✅ `/api/tech/test-result` (low)
- ✅ `/api/testing/recent` (low)
- ⛔ `/api/units/resolve-id` (medium)
- ✅ `/api/workflow/flow-audit` (low)

### `shifts` — 3 routes, 0 not yet GUC-safe

- ✅ `/api/google-sheets/sync-shipstation-orders` (low)
- ✅ `/api/shifts` (low)
- ✅ `/api/shifts/[id]/cover` (low)

### `shipment_links` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/orders` (low)
- ✅ `/api/tech/logs` (low)

### `shipment_tracking_events` — 4 routes, 2 not yet GUC-safe

- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ⛔ `/api/shipping/track/[id]` (medium)
- ⛔ `/api/webhooks/ups` (critical)

### `shipping_tracking_numbers` — 63 routes, 5 not yet GUC-safe

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
- ✅ `/api/google-sheets/execute-script` (low)
- ✅ `/api/google-sheets/sync-shipstation-orders` (low)
- ✅ `/api/inbox/tech-queue` (low)
- ✅ `/api/orders` (low)
- ⛔ `/api/orders/[id]/tracking` (medium)
- ✅ `/api/orders/backfill/ebay` (low)
- ✅ `/api/orders/backfill/ecwid` (low)
- ✅ `/api/orders/batch` (low)
- ✅ `/api/orders/integrity-check` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ✅ `/api/orders/next` (low)
- ✅ `/api/orders/recent` (low)
- ✅ `/api/orders/verify` (low)
- ✅ `/api/packing-logs` (low)
- ✅ `/api/packing-logs/history` (low)
- ✅ `/api/packing-logs/update` (low)
- ✅ `/api/receiving-entry` (low)
- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/delivered-unscanned` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ✅ `/api/receiving-lines/incoming/refresh/stream` (low)
- ✅ `/api/receiving-lines/incoming/summary` (low)
- ✅ `/api/receiving-logs` (low)
- ✅ `/api/receiving-logs/search` (low)
- ✅ `/api/receiving/[id]` (low)
- ✅ `/api/receiving/lookup-po` (low)
- ✅ `/api/receiving/mark-received` (low)
- ✅ `/api/receiving/mark-received-po` (low)
- ✅ `/api/receiving/match` (low)
- ✅ `/api/receiving/pending-unboxing` (low)
- ✅ `/api/receiving/triage/done` (low)
- ✅ `/api/scan-tracking` (low)
- ✅ `/api/scan/resolve` (low)
- ⛔ `/api/shipments/[id]/documents` (medium)
- ✅ `/api/shipped/debug` (low)
- ✅ `/api/shipped/lookup-order` (low)
- ✅ `/api/shipped/scan-out` (low)
- ⛔ `/api/shipping/track/[id]` (medium)
- ✅ `/api/sync-sheets` (low)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/orders-without-manual` (low)
- ✅ `/api/tech/scan` (low)
- ✅ `/api/tech/update-serials` (low)
- ⛔ `/api/webhooks/ups` (critical)
- ✅ `/api/work-orders` (low)

### `sku` — 215 routes, 52 not yet GUC-safe

- ✅ `/api/activity/feed` (low)
- ✅ `/api/admin/fba-fnskus` (low)
- ✅ `/api/admin/fba-fnskus/[fnsku]` (low)
- ✅ `/api/admin/fba-fnskus/upload` (low)
- ✅ `/api/assignments/sku-search` (low)
- ⛔ `/api/audit-log/packing` (medium)
- ⛔ `/api/audit-log/receiving` (medium)
- ✅ `/api/audit-log/report` (low)
- ⛔ `/api/audit-log/sku` (medium)
- ⛔ `/api/audit/sku/[sku]` (medium)
- ⛔ `/api/cron/inventory/drift-check` (high)
- ⛔ `/api/cron/sku-catalog/refresh-suggestions` (high)
- ⛔ `/api/cron/stock-alerts` (high)
- ✅ `/api/cycle-counts/campaigns` (low)
- ✅ `/api/cycle-counts/campaigns/[id]` (low)
- ✅ `/api/cycle-counts/lines/[id]` (low)
- ✅ `/api/ebay/search` (low)
- ⛔ `/api/ecwid/order-search` (high)
- ⛔ `/api/ecwid/products/search` (high)
- ✅ `/api/ecwid/recent-repair-orders` (low)
- ✅ `/api/ecwid/sync-exception-tracking` (low)
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
- ✅ `/api/fba/shipments/[id]/trace` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/today` (low)
- ✅ `/api/fba/shipments/today/duplicate-yesterday` (low)
- ✅ `/api/fba/shipments/today/items` (low)
- ✅ `/api/get-title-by-sku` (low)
- ⛔ `/api/global-search` (medium)
- ✅ `/api/import-orders` (low)
- ✅ `/api/inbox/tech-queue` (low)
- ✅ `/api/inventory-events` (low)
- ✅ `/api/inventory-photos` (low)
- ✅ `/api/inventory/alerts` (low)
- ✅ `/api/inventory/alerts/[id]/ack` (low)
- ✅ `/api/inventory/items/search` (low)
- ✅ `/api/inventory/parts-graph` (low)
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
- ✅ `/api/orders` (low)
- ⛔ `/api/orders/[id]/allocate` (medium)
- ✅ `/api/orders/[id]/release` (low)
- ✅ `/api/orders/[id]/substitute` (low)
- ✅ `/api/orders/add` (low)
- ✅ `/api/orders/assign` (low)
- ✅ `/api/orders/backfill/ebay` (low)
- ✅ `/api/orders/backfill/ecwid` (low)
- ✅ `/api/orders/batch` (low)
- ✅ `/api/orders/delete` (low)
- ⛔ `/api/orders/import-csv` (medium)
- ✅ `/api/orders/integrity-check` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ✅ `/api/orders/next` (low)
- ✅ `/api/orders/recent` (low)
- ✅ `/api/outbound/labels/purchase` (low)
- ✅ `/api/pack/ship` (low)
- ✅ `/api/packerlogs` (low)
- ✅ `/api/packing-logs` (low)
- ✅ `/api/packing-logs/history` (low)
- ✅ `/api/packing-logs/update` (low)
- ⛔ `/api/packing/policy` (medium)
- ⛔ `/api/part-compatibility` (medium)
- ✅ `/api/pending-skus` (low)
- ⛔ `/api/photos/listing-gallery` (medium)
- ✅ `/api/pick/scan` (low)
- ✅ `/api/post-multi-sn` (low)
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
- ✅ `/api/receiving/[id]` (low)
- ✅ `/api/receiving/add-unmatched-line` (low)
- ⛔ `/api/receiving/identify-label` (medium)
- ⛔ `/api/receiving/inbound/import-ebay` (medium)
- ✅ `/api/receiving/lines/[id]/move` (low)
- ✅ `/api/receiving/lines/[id]/putaway` (low)
- ✅ `/api/receiving/lines/[id]/putaway/reverse` (low)
- ✅ `/api/receiving/lines/[id]/status` (low)
- ✅ `/api/receiving/lines/[id]/timeline` (low)
- ✅ `/api/receiving/lines/[id]/zoho-note` (low)
- ✅ `/api/receiving/lookup-po` (low)
- ✅ `/api/receiving/mark-received` (low)
- ✅ `/api/receiving/mark-received-po` (low)
- ✅ `/api/receiving/match` (low)
- ⛔ `/api/receiving/pending-check` (medium)
- ✅ `/api/receiving/pending-unboxing` (low)
- ✅ `/api/receiving/po/[poId]` (low)
- ✅ `/api/receiving/po/list` (low)
- ⛔ `/api/receiving/relink` (medium)
- ✅ `/api/receiving/scan-serial` (low)
- ✅ `/api/receiving/triage/done` (low)
- ⛔ `/api/receiving/visual-identify` (medium)
- ✅ `/api/repair-service/next` (low)
- ⛔ `/api/repair/ecwid-products` (high)
- ⛔ `/api/repair/square-payment-link` (medium)
- ✅ `/api/replenish/shipped-fifo` (low)
- ✅ `/api/reports/dead-stock` (low)
- ✅ `/api/reports/velocity` (low)
- ✅ `/api/returns/undo` (low)
- ✅ `/api/scan/resolve` (low)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/allocate` (low)
- ✅ `/api/serial-units/[id]/checklist` (low)
- ⛔ `/api/serial-units/[id]/data-wipe` (medium)
- ✅ `/api/serial-units/[id]/grade` (low)
- ✅ `/api/serial-units/[id]/move` (low)
- ✅ `/api/serial-units/[id]/photos` (low)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/serial-units/lookup` (medium)
- ⛔ `/api/shipped` (medium)
- ✅ `/api/shipped/submit` (low)
- ✅ `/api/sku` (low)
- ⛔ `/api/sku-catalog` (medium)
- ✅ `/api/sku-catalog/[id]` (low)
- ✅ `/api/sku-catalog/[id]/kit-parts` (low)
- ✅ `/api/sku-catalog/[id]/manuals` (low)
- ⛔ `/api/sku-catalog/[id]/platform-ids` (medium)
- ✅ `/api/sku-catalog/[id]/qc-checks` (low)
- ✅ `/api/sku-catalog/[id]/similar` (low)
- ✅ `/api/sku-catalog/flag-missing` (low)
- ⛔ `/api/sku-catalog/graph/[skuId]/children` (medium)
- ⛔ `/api/sku-catalog/graph/[skuId]/parents` (medium)
- ⛔ `/api/sku-catalog/graph/[skuId]/tree` (medium)
- ✅ `/api/sku-catalog/graph/relationships` (low)
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
- ✅ `/api/sku-stock/[sku]` (low)
- ✅ `/api/sku-stock/[sku]/bins` (low)
- ✅ `/api/sku/[id]/photos` (low)
- ✅ `/api/sku/by-tracking` (low)
- ✅ `/api/sku/lookup` (low)
- ✅ `/api/sku/serials-from-code` (low)
- ⛔ `/api/sourcing/saved-searches/[id]/run` (medium)
- ✅ `/api/stock-alerts` (low)
- ✅ `/api/studio/items/stuck` (low)
- ✅ `/api/sync-sheets` (low)
- ✅ `/api/tech-logs/search` (low)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/orders-without-manual` (low)
- ✅ `/api/tech/scan` (low)
- ✅ `/api/tech/scan-sku` (low)
- ✅ `/api/tech/test-result` (low)
- ✅ `/api/testing/recent` (low)
- ✅ `/api/tracking-exceptions/[id]/refresh` (low)
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
- ✅ `/api/work-orders` (low)
- ⛔ `/api/zoho/purchase-orders` (medium)
- ✅ `/api/zoho/purchase-orders/receive` (low)

### `sku_catalog` — 67 routes, 12 not yet GUC-safe

- ⛔ `/api/cron/sku-catalog/refresh-suggestions` (high)
- ✅ `/api/ecwid/recent-repair-orders` (low)
- ✅ `/api/get-title-by-sku` (low)
- ✅ `/api/inventory-events` (low)
- ✅ `/api/inventory/items/search` (low)
- ✅ `/api/inventory/parts-graph` (low)
- ✅ `/api/inventory/units` (low)
- ✅ `/api/labels/recent` (low)
- ✅ `/api/local-pickup-orders/[id]` (low)
- ✅ `/api/local-pickups` (low)
- ✅ `/api/manuals/recent` (low)
- ✅ `/api/manuals/resolve` (low)
- ✅ `/api/manuals/upsert` (low)
- ✅ `/api/orders` (low)
- ✅ `/api/orders/[id]/pick-tasks` (low)
- ✅ `/api/orders/add` (low)
- ✅ `/api/orders/assign` (low)
- ✅ `/api/orders/recent` (low)
- ✅ `/api/packing-logs` (low)
- ⛔ `/api/part-compatibility` (medium)
- ✅ `/api/pending-skus` (low)
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
- ✅ `/api/receiving/lookup-po` (low)
- ✅ `/api/receiving/po/[poId]` (low)
- ⛔ `/api/receiving/visual-identify` (medium)
- ✅ `/api/reports/dead-stock` (low)
- ✅ `/api/reports/velocity` (low)
- ✅ `/api/scan/resolve` (low)
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
- ✅ `/api/sku-stock/[sku]` (low)
- ✅ `/api/sku-stock/[sku]/bins` (low)
- ✅ `/api/sync-sheets` (low)
- ✅ `/api/tech/orders-without-manual` (low)
- ⛔ `/api/units/next-id` (medium)
- ⛔ `/api/units/resolve-id` (medium)

### `sku_kit_parts` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/sku-catalog/[id]/kit-parts` (low)

### `sku_management` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/sku-manager` (low)

### `sku_pairing_audit` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/sku-catalog/pair-batch` (medium)

### `sku_pairing_suggestions` — 4 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/sku-catalog/refresh-suggestions` (high)
- ✅ `/api/sku-catalog/pairing-queue` (low)
- ✅ `/api/sku-catalog/pairing-queue/count` (low)
- ✅ `/api/sku-catalog/suggest-for-item` (low)

### `sku_platform_ids` — 26 routes, 3 not yet GUC-safe

- ⛔ `/api/cron/sku-catalog/refresh-suggestions` (high)
- ✅ `/api/ecwid/recent-repair-orders` (low)
- ✅ `/api/get-title-by-sku` (low)
- ✅ `/api/local-pickups` (low)
- ✅ `/api/manuals/recent` (low)
- ✅ `/api/manuals/resolve` (low)
- ✅ `/api/manuals/upsert` (low)
- ✅ `/api/orders/[id]/pick-tasks` (low)
- ✅ `/api/packing-logs` (low)
- ✅ `/api/products/[sku]` (low)
- ✅ `/api/receiving/add-unmatched-line` (low)
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

### `sku_stock` — 101 routes, 30 not yet GUC-safe

- ✅ `/api/assignments/sku-search` (low)
- ⛔ `/api/checklists` (medium)
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
- ✅ `/api/inventory/items/search` (low)
- ✅ `/api/inventory/parts-graph` (low)
- ✅ `/api/inventory/parts/links` (low)
- ✅ `/api/inventory/parts/links/[id]` (low)
- ✅ `/api/inventory/parts/links/not-a-part` (low)
- ✅ `/api/inventory/sku-search` (low)
- ✅ `/api/inventory/units` (low)
- ⛔ `/api/locations/[barcode]` (medium)
- ⛔ `/api/locations/[barcode]/properties` (medium)
- ✅ `/api/locations/[barcode]/swap` (low)
- ⛔ `/api/manual-server/assign` (medium)
- ⛔ `/api/manual-server/by-item` (high)
- ⛔ `/api/manual-server/unassigned` (high)
- ✅ `/api/manuals/resolve` (low)
- ✅ `/api/manuals/upsert` (low)
- ⛔ `/api/need-to-order` (medium)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ✅ `/api/pack/ship` (low)
- ✅ `/api/packing-logs` (low)
- ✅ `/api/packing-logs/update` (low)
- ⛔ `/api/packing/policy` (medium)
- ✅ `/api/pending-skus` (low)
- ✅ `/api/photos/[id]` (low)
- ⛔ `/api/product-manuals` (medium)
- ✅ `/api/product-manuals/by-category` (low)
- ✅ `/api/products/[sku]` (low)
- ✅ `/api/quality/dashboard` (low)
- ⛔ `/api/reason-codes` (medium)
- ⛔ `/api/reason-codes/[id]` (medium)
- ✅ `/api/receiving-lines/[id]/qc-checks` (low)
- ✅ `/api/receiving/mark-received` (low)
- ✅ `/api/replenish/shipped-fifo` (low)
- ✅ `/api/reports/dead-stock` (low)
- ✅ `/api/reports/velocity` (low)
- ⛔ `/api/returns/intake` (medium)
- ✅ `/api/returns/undo` (low)
- ✅ `/api/rooms` (low)
- ⛔ `/api/rooms/[room]` (medium)
- ⛔ `/api/rooms/reorder` (medium)
- ✅ `/api/scan/history` (low)
- ✅ `/api/scan/resolve` (low)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/failure-tags` (low)
- ✅ `/api/serial-units/[id]/hold` (low)
- ✅ `/api/serial-units/[id]/photos` (low)
- ✅ `/api/serial-units/[id]/quality` (low)
- ✅ `/api/serial-units/[id]/release` (low)
- ✅ `/api/sku` (low)
- ⛔ `/api/sku-catalog` (medium)
- ✅ `/api/sku-catalog/[id]` (low)
- ✅ `/api/sku-catalog/[id]/kit-parts` (low)
- ✅ `/api/sku-catalog/[id]/manuals` (low)
- ⛔ `/api/sku-catalog/[id]/platform-ids` (medium)
- ✅ `/api/sku-catalog/[id]/qc-checks` (low)
- ✅ `/api/sku-catalog/[id]/similar` (low)
- ✅ `/api/sku-catalog/flag-missing` (low)
- ⛔ `/api/sku-catalog/graph/[skuId]/children` (medium)
- ⛔ `/api/sku-catalog/graph/[skuId]/parents` (medium)
- ⛔ `/api/sku-catalog/graph/[skuId]/tree` (medium)
- ✅ `/api/sku-catalog/graph/relationships` (low)
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
- ✅ `/api/sku-stock/[sku]` (low)
- ✅ `/api/sku-stock/[sku]/bins` (low)
- ✅ `/api/sku/[id]/photos` (low)
- ✅ `/api/sku/by-tracking` (low)
- ✅ `/api/sku/lookup` (low)
- ✅ `/api/sku/serials-from-code` (low)
- ✅ `/api/stock-alerts` (low)
- ✅ `/api/tech/scan-sku` (low)
- ✅ `/api/update-sku-location` (low)
- ✅ `/api/warehouses` (low)
- ✅ `/api/work-orders` (low)
- ✅ `/api/zoho/items/[id]/image` (low)

### `sku_stock_ledger` — 16 routes, 3 not yet GUC-safe

- ✅ `/api/activity/feed` (low)
- ⛔ `/api/audit/sku/[sku]` (medium)
- ⛔ `/api/cron/inventory/drift-check` (high)
- ✅ `/api/fba/shipments/[id]/ship-units` (low)
- ✅ `/api/locations/[barcode]/swap` (low)
- ✅ `/api/pack/ship` (low)
- ✅ `/api/packing-logs/update` (low)
- ✅ `/api/receiving/mark-received` (low)
- ✅ `/api/receiving/mark-received-po` (low)
- ✅ `/api/reports/dead-stock` (low)
- ✅ `/api/reports/velocity` (low)
- ⛔ `/api/returns/intake` (medium)
- ✅ `/api/returns/undo` (low)
- ✅ `/api/serial-units/[id]/move` (low)
- ✅ `/api/sku-stock/[sku]` (low)
- ✅ `/api/tech/scan-sku` (low)

### `sourcing_alerts` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/sourcing/scan` (high)

### `square_transactions` — 3 routes, 3 not yet GUC-safe

- ⛔ `/api/walk-in/sales` (medium)
- ⛔ `/api/walk-in/sync` (medium)
- ⛔ `/api/webhooks/square` (critical)

### `staff` — 169 routes, 60 not yet GUC-safe

- ✅ `/api/activity/feed` (low)
- ✅ `/api/admin/audit` (low)
- ✅ `/api/admin/features` (low)
- ✅ `/api/admin/features/[id]` (low)
- ✅ `/api/admin/integrations/list` (low)
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
- ✅ `/api/admin/staff/list` (low)
- ✅ `/api/admin/staff/reorder` (low)
- ✅ `/api/admin/staff/update` (low)
- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/ai/chat/stream` (medium)
- ✅ `/api/assignments/sku-search` (low)
- ⛔ `/api/assistant/chat` (medium)
- ⛔ `/api/assistant/mutations/[id]/revert` (medium)
- ✅ `/api/audit-log/report` (low)
- ⛔ `/api/audit-log/staff` (medium)
- ✅ `/api/audit-log/staff-directory` (low)
- ⛔ `/api/auth/account/passkey` (high)
- ⛔ `/api/auth/email-login/request` (critical)
- ⛔ `/api/auth/enroll/[token]` (critical)
- ⛔ `/api/auth/invitation/accept` (medium)
- ⛔ `/api/auth/passkey/authenticate/begin` (critical)
- ⛔ `/api/auth/passkey/authenticate/finish` (critical)
- ⛔ `/api/auth/passkey/register/begin` (critical)
- ⛔ `/api/auth/passkey/register/finish` (critical)
- ⛔ `/api/auth/pin` (medium)
- ⛔ `/api/auth/pin/create` (critical)
- ⛔ `/api/auth/session` (medium)
- ⛔ `/api/auth/signin` (critical)
- ⛔ `/api/auth/signout` (critical)
- ⛔ `/api/auth/signup` (medium)
- ✅ `/api/auth/sso/callback` (low)
- ⛔ `/api/auth/staff-picker` (high)
- ⛔ `/api/auth/switch` (medium)
- ⛔ `/api/auth/switch-org` (medium)
- ⛔ `/api/auth/verify-email` (high)
- ⛔ `/api/cron/photos/analyze` (medium)
- ⛔ `/api/cron/search-outbox` (high)
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
- ✅ `/api/fba/shipments/[id]/trace` (low)
- ✅ `/api/fba/shipments/active-with-details` (low)
- ✅ `/api/fba/shipments/close` (low)
- ✅ `/api/fba/shipments/today` (low)
- ⛔ `/api/global-search` (medium)
- ✅ `/api/inbox/tech-queue` (low)
- ✅ `/api/inventory-events` (low)
- ✅ `/api/labels/recent` (low)
- ✅ `/api/local-pickup-orders` (low)
- ✅ `/api/local-pickup-orders/[id]` (low)
- ⛔ `/api/nas-dev/[[...path]]` (critical)
- ⛔ `/api/need-to-order/[id]` (medium)
- ✅ `/api/operations/kpi-table` (low)
- ⛔ `/api/operations/saved-views` (medium)
- ✅ `/api/orders` (low)
- ✅ `/api/orders-exceptions/sync` (low)
- ✅ `/api/orders/[id]/amendments` (low)
- ✅ `/api/orders/[id]/timeline` (low)
- ✅ `/api/orders/assign` (low)
- ✅ `/api/orders/batch` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ✅ `/api/orders/missing-parts` (low)
- ✅ `/api/orders/next` (low)
- ⛔ `/api/org/accounts/merge` (medium)
- ✅ `/api/packerlogs` (low)
- ✅ `/api/packing-logs` (low)
- ✅ `/api/packing-logs/history` (low)
- ⛔ `/api/photos/saved-views` (medium)
- ⛔ `/api/realtime/token` (medium)
- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ⛔ `/api/receiving-lines/incoming/email-rescan` (medium)
- ✅ `/api/receiving-lines/incoming/todo` (low)
- ✅ `/api/receiving-lines/view` (low)
- ✅ `/api/receiving/[id]` (low)
- ✅ `/api/receiving/lines/[id]/timeline` (low)
- ✅ `/api/receiving/lookup-po` (low)
- ✅ `/api/receiving/mark-received` (low)
- ✅ `/api/receiving/mark-received-po` (low)
- ✅ `/api/receiving/match` (low)
- ✅ `/api/receiving/pending-unboxing` (low)
- ⛔ `/api/receiving/rail-exclusions` (medium)
- ✅ `/api/receiving/unfound-queue/[kind]/[id]` (low)
- ✅ `/api/receiving/zendesk-claim` (low)
- ✅ `/api/repair-service/next` (low)
- ✅ `/api/repair/actions` (low)
- ⛔ `/api/replenishment/tasks/[id]/cancel` (medium)
- ⛔ `/api/replenishment/tasks/[id]/claim` (medium)
- ⛔ `/api/replenishment/tasks/[id]/complete` (medium)
- ⛔ `/api/rma` (medium)
- ⛔ `/api/rma/[id]/close` (medium)
- ⛔ `/api/rma/[id]/disposition` (medium)
- ⛔ `/api/rma/[id]/mark-received` (medium)
- ⛔ `/api/rma/disposition` (medium)
- ✅ `/api/scan/history` (low)
- ✅ `/api/scan/resolve` (low)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/serial-units/[id]/checklist` (low)
- ✅ `/api/serial-units/[id]/checklist/bulk` (low)
- ⛔ `/api/serial-units/[id]/repairs` (medium)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/settings` (medium)
- ✅ `/api/shifts` (low)
- ✅ `/api/shifts/[id]/cover` (low)
- ⛔ `/api/shipped` (medium)
- ✅ `/api/staff` (low)
- ✅ `/api/staff-goals` (low)
- ✅ `/api/staff-goals/history` (low)
- ⛔ `/api/staff-goals/me` (medium)
- ⛔ `/api/staff-messages` (medium)
- ⛔ `/api/staff-preferences` (medium)
- ⛔ `/api/staff-todos` (medium)
- ✅ `/api/staff/availability-rules` (low)
- ✅ `/api/staff/availability-today` (low)
- ✅ `/api/staff/schedule` (low)
- ⛔ `/api/staff/schedule/bulk` (medium)
- ✅ `/api/staff/schedule/week` (low)
- ✅ `/api/staff/schedule/week/copy` (low)
- ✅ `/api/stations` (low)
- ✅ `/api/stations/publish` (low)
- ✅ `/api/studio/people` (low)
- ✅ `/api/tech/delete` (low)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/scan` (low)
- ⛔ `/api/tech/scan-repair-station` (medium)
- ✅ `/api/tech/scan-sku` (low)
- ✅ `/api/testing/recent` (low)
- ✅ `/api/tracking-exceptions` (low)
- ✅ `/api/tracking-exceptions/[id]` (low)
- ⛔ `/api/voicemails/[id]/followup` (medium)
- ⛔ `/api/warranty/claims` (medium)
- ⛔ `/api/warranty/claims/[id]/quote` (medium)
- ⛔ `/api/warranty/claims/[id]/rma` (medium)
- ⛔ `/api/warranty/claims/bulk` (medium)
- ✅ `/api/work-orders` (low)
- ⛔ `/api/zendesk/tickets/[id]/assign` (medium)

### `staff_availability_rules` — 7 routes, 1 not yet GUC-safe

- ✅ `/api/staff` (low)
- ✅ `/api/staff/availability-rules` (low)
- ✅ `/api/staff/availability-today` (low)
- ✅ `/api/staff/schedule` (low)
- ⛔ `/api/staff/schedule/bulk` (medium)
- ✅ `/api/staff/schedule/week` (low)
- ✅ `/api/staff/schedule/week/copy` (low)

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

### `staff_rail_exclusions` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/receiving/rail-exclusions` (medium)

### `staff_schedule_overrides` — 6 routes, 1 not yet GUC-safe

- ✅ `/api/staff` (low)
- ✅ `/api/staff/availability-today` (low)
- ✅ `/api/staff/schedule` (low)
- ⛔ `/api/staff/schedule/bulk` (medium)
- ✅ `/api/staff/schedule/week` (low)
- ✅ `/api/staff/schedule/week/copy` (low)

### `staff_sessions` — 7 routes, 1 not yet GUC-safe

- ⛔ `/api/admin/org/delete` (medium)
- ✅ `/api/admin/org/export` (low)
- ✅ `/api/admin/sessions` (low)
- ✅ `/api/admin/staff/[id]/detail` (low)
- ✅ `/api/admin/staff/[id]/sessions` (low)
- ✅ `/api/admin/staff/deactivate` (low)
- ✅ `/api/shifts/[id]/cover` (low)

### `staff_stations` — 2 routes, 1 not yet GUC-safe

- ⛔ `/api/staff-goals/me` (medium)
- ✅ `/api/studio/people` (low)

### `staff_todo_completions` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/staff-todos` (medium)

### `staff_week_plans` — 6 routes, 1 not yet GUC-safe

- ✅ `/api/staff` (low)
- ✅ `/api/staff/availability-today` (low)
- ✅ `/api/staff/schedule` (low)
- ⛔ `/api/staff/schedule/bulk` (medium)
- ✅ `/api/staff/schedule/week` (low)
- ✅ `/api/staff/schedule/week/copy` (low)

### `staff_weekly_schedule` — 6 routes, 1 not yet GUC-safe

- ✅ `/api/staff` (low)
- ✅ `/api/staff/availability-today` (low)
- ✅ `/api/staff/schedule` (low)
- ⛔ `/api/staff/schedule/bulk` (medium)
- ✅ `/api/staff/schedule/week` (low)
- ✅ `/api/staff/schedule/week/copy` (low)

### `station_activity_logs` — 27 routes, 1 not yet GUC-safe

- ✅ `/api/activity/feed` (low)
- ✅ `/api/admin/logs` (low)
- ✅ `/api/audit-log/report` (low)
- ✅ `/api/audit-log/staff-directory` (low)
- ✅ `/api/dashboard/operations` (low)
- ✅ `/api/labels/recent` (low)
- ✅ `/api/operations/kpi-table` (low)
- ✅ `/api/orders` (low)
- ✅ `/api/orders/[id]/timeline` (low)
- ✅ `/api/orders/check-shipped` (low)
- ✅ `/api/orders/next` (low)
- ✅ `/api/pack/ship` (low)
- ✅ `/api/packerlogs` (low)
- ✅ `/api/post-multi-sn` (low)
- ✅ `/api/replenish/shipped-fifo` (low)
- ✅ `/api/serial-units/[id]` (low)
- ✅ `/api/shipped/scan-out` (low)
- ✅ `/api/staff-goals` (low)
- ⛔ `/api/staff-goals/me` (medium)
- ✅ `/api/tech/add-serial` (low)
- ✅ `/api/tech/add-serial-to-last` (low)
- ✅ `/api/tech/delete` (low)
- ✅ `/api/tech/delete-tracking` (low)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/serial` (low)
- ✅ `/api/tech/undo-last` (low)
- ✅ `/api/tech/update-serials` (low)

### `station_definitions` — 4 routes, 0 not yet GUC-safe

- ✅ `/api/stations` (low)
- ✅ `/api/stations/publish` (low)
- ✅ `/api/studio/nodes/[id]/station` (low)
- ✅ `/api/studio/nodes/[id]/station/publish` (low)

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

### `support_ticket_assignments` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/inbox/support` (medium)

### `support_tickets` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/receiving/lookup-po` (low)

### `sync_cursors` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/admin/po-mirror/health` (low)
- ✅ `/api/cron/zoho/incoming-po-sync` (low)

### `tech_serial_numbers` — 24 routes, 3 not yet GUC-safe

- ✅ `/api/admin/logs` (low)
- ✅ `/api/audit-log/report` (low)
- ✅ `/api/ebay/search` (low)
- ✅ `/api/fba/logs/summary` (low)
- ✅ `/api/google-sheets/execute-script` (low)
- ✅ `/api/labels/recent` (low)
- ✅ `/api/orders/[id]/timeline` (low)
- ✅ `/api/orders/batch` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ⛔ `/api/orders/start` (critical)
- ✅ `/api/post-multi-sn` (low)
- ✅ `/api/receiving/scan-serial` (low)
- ✅ `/api/receiving/serials` (low)
- ✅ `/api/scan/resolve` (low)
- ✅ `/api/serial-units/[id]` (low)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ⛔ `/api/serial-units/lookup` (medium)
- ✅ `/api/sync-sheets` (low)
- ✅ `/api/tech/delete` (low)
- ✅ `/api/tech/delete-tracking` (low)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/orders-without-manual` (low)
- ✅ `/api/tech/scan` (low)
- ✅ `/api/tech/serial` (low)

### `tech_verifications` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/serial-units/[id]/checklist` (low)
- ✅ `/api/serial-units/[id]/checklist/bulk` (low)

### `testing_results` — 4 routes, 1 not yet GUC-safe

- ✅ `/api/receiving-lines` (low)
- ✅ `/api/serial-units/[id]/checklist` (low)
- ⛔ `/api/serial-units/[id]/test` (medium)
- ✅ `/api/testing/recent` (low)

### `ticket_links` — 9 routes, 6 not yet GUC-safe

- ✅ `/api/receiving/lookup-po` (low)
- ✅ `/api/receiving/zendesk-claim` (low)
- ✅ `/api/receiving/zendesk-claim/link` (low)
- ⛔ `/api/voicemails/[id]/link` (medium)
- ⛔ `/api/warranty/claims/[id]/zendesk` (medium)
- ⛔ `/api/warranty/claims/[id]/zendesk/link` (medium)
- ⛔ `/api/zendesk/photo-ticket` (medium)
- ⛔ `/api/zendesk/tickets` (medium)
- ⛔ `/api/zendesk/tickets/[id]/photos` (medium)

### `tracking_exceptions` — 4 routes, 0 not yet GUC-safe

- ✅ `/api/receiving/lookup-po` (low)
- ✅ `/api/tracking-exceptions` (low)
- ✅ `/api/tracking-exceptions/[id]` (low)
- ✅ `/api/tracking-exceptions/[id]/refresh` (low)

### `types` — 36 routes, 22 not yet GUC-safe

- ⛔ `/api/ai/chat` (medium)
- ⛔ `/api/ai/chat/stream` (medium)
- ⛔ `/api/ai/retrieve` (medium)
- ⛔ `/api/assistant/chat` (medium)
- ⛔ `/api/auth/account/passkey/authenticate/finish` (medium)
- ⛔ `/api/auth/account/passkey/register/finish` (critical)
- ⛔ `/api/auth/passkey/authenticate/finish` (critical)
- ⛔ `/api/auth/passkey/register/finish` (critical)
- ⛔ `/api/auth/step-up` (critical)
- ⛔ `/api/catalog/types` (medium)
- ⛔ `/api/catalog/types/[id]` (medium)
- ✅ `/api/catalog/workflow-nodes` (low)
- ✅ `/api/documents/[id]/content` (low)
- ⛔ `/api/ecwid/order-search` (high)
- ✅ `/api/fba/shipments/[id]/trace` (low)
- ✅ `/api/labels` (low)
- ✅ `/api/operations/journey` (low)
- ⛔ `/api/order-labels` (medium)
- ✅ `/api/orders/[id]/documents/fetch` (low)
- ✅ `/api/outbound/labels/purchase` (low)
- ✅ `/api/outbound/rates` (low)
- ⛔ `/api/photos/image-types` (medium)
- ⛔ `/api/photos/links` (medium)
- ✅ `/api/photos/upload` (low)
- ✅ `/api/receiving-lines/incoming/refresh/stream` (low)
- ⛔ `/api/repair-service` (medium)
- ⛔ `/api/repair/square-payment-link` (medium)
- ✅ `/api/serial-units/[id]/grade` (low)
- ⛔ `/api/shipping/track/register` (medium)
- ⛔ `/api/shipping/track/sync-one` (medium)
- ✅ `/api/studio/definitions/[id]/graph` (low)
- ✅ `/api/studio/definitions/[id]/publish` (low)
- ⛔ `/api/studio/graph` (medium)
- ⛔ `/api/studio/templates` (high)
- ⛔ `/api/studio/templates/[id]` (high)
- ✅ `/api/work-orders` (low)

### `unfound_overlay` — 4 routes, 1 not yet GUC-safe

- ✅ `/api/receiving/unfound-queue/[kind]/[id]` (low)
- ✅ `/api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk` (low)
- ✅ `/api/receiving/zendesk-claim/link` (low)
- ⛔ `/api/zendesk/tickets/[id]/photos` (medium)

### `unit_failure_tags` — 2 routes, 0 not yet GUC-safe

- ✅ `/api/quality/dashboard` (low)
- ✅ `/api/serial-units/[id]/failure-tags` (low)

### `unit_id_sequences` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/units/next-id` (medium)

### `unit_quality_scores` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/quality/dashboard` (low)

### `unit_repairs` — 3 routes, 1 not yet GUC-safe

- ✅ `/api/quality/dashboard` (low)
- ✅ `/api/repair/actions` (low)
- ⛔ `/api/serial-units/[id]/repairs` (medium)

### `voicemails` — 6 routes, 5 not yet GUC-safe

- ⛔ `/api/integrations/nextiva/webhook/[token]` (medium)
- ✅ `/api/voicemails` (low)
- ⛔ `/api/voicemails/[id]` (medium)
- ⛔ `/api/voicemails/[id]/followup` (medium)
- ⛔ `/api/voicemails/[id]/link` (medium)
- ⛔ `/api/voicemails/[id]/recording` (medium)

### `warehouses` — 3 routes, 2 not yet GUC-safe

- ✅ `/api/warehouses` (low)
- ⛔ `/api/zoho/oauth/authorize` (high)
- ⛔ `/api/zoho/warehouses` (medium)

### `warranty_claims` — 5 routes, 3 not yet GUC-safe

- ⛔ `/api/cron/shipping/reconcile-delivered` (high)
- ✅ `/api/warranty/claims/[id]/restore` (low)
- ⛔ `/api/warranty/claims/[id]/rma` (medium)
- ⛔ `/api/warranty/claims/[id]/zendesk/link` (medium)
- ✅ `/api/warranty/claims/bulk/restore` (low)

### `work_assignments` — 35 routes, 1 not yet GUC-safe

- ✅ `/api/assignments/next` (low)
- ✅ `/api/assignments/sku-search` (low)
- ✅ `/api/check-tracking` (low)
- ✅ `/api/dashboard/operations` (low)
- ✅ `/api/debug-tracking` (low)
- ✅ `/api/ebay/search` (low)
- ✅ `/api/fba/shipments` (low)
- ✅ `/api/fba/shipments/today/duplicate-yesterday` (low)
- ✅ `/api/fba/shipments/today/items` (low)
- ✅ `/api/google-sheets/sync-shipstation-orders` (low)
- ✅ `/api/import-orders` (low)
- ✅ `/api/local-pickups` (low)
- ✅ `/api/orders` (low)
- ✅ `/api/orders/assign` (low)
- ✅ `/api/orders/lookup/[orderId]` (low)
- ✅ `/api/orders/next` (low)
- ✅ `/api/orders/recent` (low)
- ✅ `/api/packing-logs` (low)
- ✅ `/api/packing-logs/update` (low)
- ✅ `/api/pick/queue` (low)
- ✅ `/api/receiving-entry` (low)
- ✅ `/api/receiving-logs` (low)
- ✅ `/api/receiving/match` (low)
- ✅ `/api/repair-service/next` (low)
- ✅ `/api/repair-service/out-of-stock` (low)
- ✅ `/api/repair-service/pickup` (low)
- ✅ `/api/repair-service/repaired` (low)
- ✅ `/api/repair/submit` (low)
- ✅ `/api/sync-sheets` (low)
- ✅ `/api/tech/logs` (low)
- ✅ `/api/tech/orders-without-manual` (low)
- ✅ `/api/tech/scan` (low)
- ✅ `/api/work-orders` (low)
- ⛔ `/api/work-orders/calendar` (medium)
- ✅ `/api/zoho/purchase-orders/receive` (low)

### `workflow_definitions` — 3 routes, 0 not yet GUC-safe

- ✅ `/api/stations/publish` (low)
- ✅ `/api/studio/definitions/[id]/discard` (low)
- ✅ `/api/studio/definitions/[id]/graph` (low)

### `workflow_edges` — 3 routes, 0 not yet GUC-safe

- ✅ `/api/studio/definitions/[id]/discard` (low)
- ✅ `/api/studio/definitions/[id]/graph` (low)
- ✅ `/api/studio/flow` (low)

### `workflow_node_stats` — 3 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/workflow-node-stats` (high)
- ✅ `/api/operations/roi` (low)
- ✅ `/api/studio/flow` (low)

### `workflow_nodes` — 4 routes, 0 not yet GUC-safe

- ✅ `/api/catalog/workflow-nodes` (low)
- ✅ `/api/studio/definitions/[id]/discard` (low)
- ✅ `/api/studio/definitions/[id]/graph` (low)
- ✅ `/api/studio/flow` (low)

### `workflow_runs` — 3 routes, 1 not yet GUC-safe

- ✅ `/api/operations/roi` (low)
- ✅ `/api/studio/flow` (low)
- ⛔ `/api/studio/items/[id]/recover` (medium)

### `zendesk_users` — 1 routes, 1 not yet GUC-safe

- ⛔ `/api/zendesk/tickets/[id]/comments` (medium)

### `zoho_fulfillment_sync` — 2 routes, 1 not yet GUC-safe

- ⛔ `/api/cron/zoho/fulfillment-sync` (high)
- ✅ `/api/zoho/fulfillment-sync` (low)

### `zoho_item_images` — 1 routes, 0 not yet GUC-safe

- ✅ `/api/zoho/items/[id]/image` (low)

### `zoho_po_mirror` — 13 routes, 1 not yet GUC-safe

- ✅ `/api/admin/po-gmail/triage/[id]/detail` (low)
- ✅ `/api/admin/po-mirror/health` (low)
- ✅ `/api/cron/zoho/incoming-po-sync` (low)
- ✅ `/api/cron/zoho/po-sync` (low)
- ✅ `/api/receiving-lines` (low)
- ✅ `/api/receiving-lines/incoming/delivered-unscanned` (low)
- ✅ `/api/receiving-lines/incoming/details` (low)
- ✅ `/api/receiving-lines/incoming/refresh/stream` (low)
- ✅ `/api/receiving-lines/incoming/summary` (low)
- ⛔ `/api/receiving-lines/incoming/zoho-refresh` (medium)
- ✅ `/api/receiving/lookup-po` (low)
- ✅ `/api/receiving/po-search` (low)
- ✅ `/api/receiving/po/[poId]/attach-box` (low)
