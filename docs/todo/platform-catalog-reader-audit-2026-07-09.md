# Platform-catalog Phase-3 reader-migration audit — 2026-07-09

Audit of every meaningful read of the three legacy text columns
(`receiving.source_platform`, `orders.account_source`, `receiving.intake_type` /
`receiving_lines.receiving_type` string literals) across `src/`, per
`docs/todo/platform-account-type-catalog-plan.md` Phase 3 (reader migration) and the
Phase-6 gate. Grep basis: literal equality / fuzzy-match / label-map sites over the
~150 files that mention the columns; pure pass-through fields (SELECT lists, type
defs, Drizzle schema, writer routes that SET the columns) are out of scope — they are
the dual-write cache the plan keeps.

**Categories**
- **(a) SAFE** — display/label lookup the org-catalog / source-platform SoT already serves; migrated now, behavior-identical.
- **(b) HOT-PATH / BEHAVIORAL** — comparison drives business branching (fba routing, shipstation rating, return classification, priority ranking, sync upsert keys). NOT changed; Phase-6 wave items.
- **(c) DO-NOT-EDIT** — in the in-flight uncommitted file list; untouchable this pass regardless of category.
- **(done)** — already reads through the SoT/catalog layer; no action needed (listed so the ~40-site count reconciles).

## State of the read layer (context)

The catalog-aware read layer is fully built and already adopted by the major surfaces:

- Server: `src/lib/catalog/org-catalog.ts` (`resolveOrderChannel`, `resolveReceivingTypeId`, `resolveType`).
- Client: `src/hooks/useCatalog.ts` — `usePlatformMeta()` (catalog label/tone over `sourcePlatformMeta`), `useReceivingTypeLabel()`, `useOrderChannelLabel()` (catalog over `getOrderPlatformLabel`).
- Built-in SoTs the hooks fall back to: `src/lib/source-platform.ts` (`SOURCE_PLATFORMS`, `sourcePlatformMeta`), `src/utils/order-platform.ts` (`getOrderPlatformLabel`/`isFbaOrder` + `PLATFORM_COLORS`), `src/components/sidebar/receiving/receiving-sidebar-shared.ts` (`SOURCE_PLATFORM_OPTS`/`SOURCE_PLATFORM_LABELS` derive from `SOURCE_PLATFORMS`).

## Audit table

| # | Site | Read | Category | Action | Evidence |
|---|------|------|----------|--------|----------|
| 1 | `src/app/m/(shell)/r/[id]/page.tsx:135-147` | inline `SOURCE_LABEL` map over `source_platform` | **(a) SAFE — MIGRATED** | Replaced the inline duplicate map with `sourcePlatformMeta()`; kept page-only `zoho` label + raw-slug fallback (never 'Unknown'). Note: `fba`/`ecwid`/`square` now render their canonical SoT labels ('FBA'/'ECWID-RS'/'Square') instead of raw slugs — the exact drift the SoT exists to close; all other outputs byte-identical. | This was the only surviving inline duplicate of the `SOURCE_PLATFORMS` label map (grep: `AliExpress|Goodwill|ECWID-RS` outside SoT/seed). |
| 2 | `src/components/search/SearchResultRow.tsx:141` | renders raw `facets.source_platform` slug in a chip | (a)-eligible, **deferred** | No change — swapping to `sourcePlatformLabel` changes visible chip text ('ebay'→'eBay'); needs a product decision, not a mechanical migration. Phase-6 display item. | `<Chip label={platform} tone="gray" />` |
| 3 | `src/utils/copy-all-receiving.ts:106-107` | raw `source_platform` slug into clipboard text | (a)-eligible, **deferred** | No change — alters copied output. Phase 6. | `Platform: ${carton?.source_platform …}` |
| 4 | `src/components/mobile/feed/rows/PendingOrderRow.tsx:68-71` | renders raw `account_source` chip | (a)-eligible, **deferred** | No change — raw storefront slug ('ebay-mk') may be intentional storefront-grain display; `useOrderChannelLabel` would collapse it to platform label. Phase-6 decision. | chip renders `row.account_source` |
| 5 | `src/components/station/upnext/order-row-vm.tsx:89`, `OrderRailPopover.tsx:31` | `order.account_source \|\| 'Order'` channel text | (a)-eligible, **deferred** | No change — same storefront-grain display question as #4. | `const channel = order.account_source \|\| 'Order'` |
| 6 | `src/design-system/components/PlatformBadge.tsx:19-23` | `getOrderPlatformLabel`+color (built-in SoT) | (done)/deferred | Already on the built-in SoT; catalog overlay would require hookifying a design-system primitive (QueryClient context). Phase 6. | encapsulates order-platform helpers |
| 7 | `src/utils/order-links.ts:15-17` (`getAccountSourceLabel`) | thin wrapper over `getOrderPlatformLabel` | (done) | Already SoT; only consumer is #23 (do-not-edit). | |
| 8 | `src/design-system/components/work-order-assignment/work-order-assignment-shared.ts:49` | `getOrderPlatformLabel` in pure mapper | (done)/deferred | Built-in SoT; non-hook context, catalog overlay = Phase 6. | |
| 9 | `src/components/inventory/SkuIdentity.tsx:60-75` + `src/components/products/pairing/platform-style.ts:16` | inline listing-platform label/chip maps (ebay/ecwid/mercari/shopify…) | **different vocabulary** — deferred | No change — these are LISTING platforms (ecwid→'Ecwid', not 'ECWID-RS'; includes mercari/shopify absent from `SOURCE_PLATFORMS`). Consolidating them into catalog `platforms` is a Phase-6+ modeling decision. | maps keyed by listing platform, not `source_platform` |
| 10 | `src/utils/order-platform.ts` (`isFbaOrder`, `getOrderPlatformLabel` pattern-match, `PLATFORM_COLORS`) | `account_source === 'fba'` + order-id regexes | **(b)** — it IS the built-in SoT | No change — this module is the sanctioned fallback the catalog overlays (`resolveOrderChannel` doc). Phase 6 may absorb `PLATFORM_COLORS` into catalog `tone`. | plan §"Read / cache layer" |
| 11 | `src/utils/source-dot.ts` (`getSourceDotType`) | FBA dot via `isFbaOrder` | (b) | No change — routing/tone triage keyed on fba grain. | |
| 12 | `src/components/station/TechRecordRow.tsx:34`, `src/lib/station/tech-board-lanes.ts:61` | `record.account_source === 'fba'` lane/row branching | (b) | No change — board-lane routing. Phase-6: replace with `type_id`→platform resolution. | |
| 13 | `src/lib/tech/insertTechSerialForTracking.ts:220,252` | `account_source === 'fba'` duplicate-serial policy | (b) | No change — business rule (FBA allows duplicate serials). | |
| 14 | `src/app/api/outbound/rates/route.ts:100`, `src/app/api/outbound/labels/purchase/route.ts:97` | `account_source === 'shipstation'` | (b) | No change — selects ShipStation rating/purchase path. | |
| 15 | `src/lib/zoho/fulfillment-source.ts:128` | SQL `LOWER(account_source) <> 'fba'` + `order_id NOT ILIKE 'FBA%'` | (b) | No change — Zoho fulfillment exclusion filter. | |
| 16 | `src/app/api/ebay/search/route.ts:72`, `src/lib/ebay/sync.ts:134,158`, `src/lib/amazon/order-sync.ts:262`, `src/app/api/ecwid/sync-exception-tracking/route.ts:213`, `src/app/api/orders/backfill/{ebay,ecwid}/route.ts` | `account_source` as sync upsert key + fuzzy account matching (`accountsForSource`) | (b) | No change — `account_source` is the marketplace-sync natural key; the plan explicitly calls out the eBay-backfill fuzzy matching as the blast-radius reason to keep the text cache. | plan §"Prerequisites & risks" |
| 17 | `src/lib/documents/marketplace/ebay-documents.ts:96`, `platform-documents.ts:65` | `accountSource.toLowerCase().includes('ebay'/token)` | (b) | No change — document-eligibility branching. | |
| 18 | `src/lib/receiving/carton-source-link.ts:56` | `source_platform === 'ecwid' && !zoho_purchaseorder_id` | (b) | No change — Ecwid-derived carton link/unlink invariant. | |
| 19 | `src/lib/receiving/intake-classification.ts` | `source_platform`/`return_platform` → `IntakeClassification` | (b) — classifier SoT | No change — this module is itself the intake-classification SoT (writer side of the enum collapse). | |
| 20 | `src/lib/receiving/display/precedence.ts:50-84` | platform → priority rank (TS + SQL CASE) | (b) | No change — priority ranking SoT (`receiving-priority-triage`); Phase-6: rank could hang off catalog rows. | |
| 21 | `src/app/api/receiving/add-unmatched-line/route.ts:176` | `intakeType === 'return' ? 'USED_A' : 'BRAND_NEW'` | (b) | No change — condition-grade default policy. | |
| 22 | `src/components/receiving/workspace/claim/hooks/useReceivingClaimController.ts:75-76`, `src/components/receiving/triage/triage-types.ts:97` | `intake_type === 'return'/'RETURN'` gating claim/triage flows | (b) | No change — return-flow gating. | |
| 23 | `src/components/shipped/**` (`ShippingInformationSection.tsx:53`, `ProductDetailsSection.tsx:47`, `shipped-details-logic.ts`, `OrderFullPageView.tsx`, `shipped-record-mappers.ts`) | account_source label + platform chip maps | **(c) do-not-edit** | Untouched (in-flight files). `ShippedRecordRow` already uses `useOrderChannelLabel`. | task exclusion list |
| 24 | `src/hooks/station/**` (`useTechTableController.ts:25`, `handleTrackingScan.ts`, `handleFnskuScan.ts`, `useUpNextController.ts`, `usePackerTableController.ts`) | fba checks + channel labels | **(c) do-not-edit** (and (b)-shaped) | Untouched. | task exclusion list |
| 25 | `src/app/api/receiving/lookup-po/route.ts`, `src/lib/dashboard-table-data.ts`, `src/lib/queries/dashboard-queries.ts`, `src/lib/neon/packer-logs-week.ts`, `src/components/station/StationTesting.tsx`, `src/lib/barcode-routing.ts` | assorted reads | **(c) do-not-edit** | Untouched. | task exclusion list |
| 26 | Rails/pills/tables already on the catalog hooks: `RecentActivityRailBase`, `ReceivingPoSummary`, `CartonContextCard`, `useCartonLabelEditor`, `useUnboxLineController`, `OrdersQueueTableRow`, `OrderGroupSummary`, `ShippedRecordRow`, `PackerRecordRow`, `TechRecordRow` (label path), `station-chip-columns`, `AddTrackingPopover`, `cartonLabelPayload`, `LabelEditPopover`, `PlatformAccountsManager`, `TypeBindingsEditor`, `receiving-sidebar-shared` (`SOURCE_PLATFORM_OPTS` derives from `SOURCE_PLATFORMS`), `zendesk-claim-template`, `listing-links`, `OutboundDocumentsPrintView`, `api/receiving/[id]` | display reads | **(done)** | No action — Phase 3 already landed here via `usePlatformMeta`/`useReceivingTypeLabel`/`useOrderChannelLabel`/`sourcePlatformMeta`. | grep `usePlatformMeta\|useOrderChannelLabel\|sourcePlatformMeta` consumers |
| 27 | Pass-through/plumbing (SELECT lists, type defs, Zod schemas, Drizzle, event-detail merge): `picking/queue.ts`, `warranty/coverage.ts`, `receiving-lines-table-helpers.ts`, `receiving-line-row.ts`, `search/{build-search-text,hybrid-retrieval,search-outbox-worker,search-hit}.ts`, `resolve-testing-scan.ts`, `facts/registry.ts`, `orders-queries.ts`, etc. | column carried, no literal branching/labeling | out of scope | No action — this is the denormalized cache the plan keeps until Phase 6. | plan §"Linkage columns" |
| 28 | `src/app/api/sync-sheets/route.ts:207` | `getOrderPlatformLabel(orderId, null)` written into sheet export | (b) | No change — write-side derived value persisted to Sheets; changing source alters exported data. | |

## Phase-6 wave list (behavioral sites to revisit once `type_id` is authoritative)

Items **10–22, 28** above plus the (c) files (23–25) and the deferred display-normalization
decisions (2–5, 9). The FBA-grain checks (12–15) should become
`resolveType`/`resolveOrderChannel` platform-slug checks; the sync natural keys (16) must
keep a stable identifier (likely `platform_accounts.slug`) before `account_source` can drop.

## Verification

- `npx tsc --noEmit` — clean for the touched files (pre-existing repo errors unrelated; see run notes).
- Adjacent tests run: `src/lib/receiving/po-group-title.test.ts`, `src/lib/receiving/intake-classification.test.ts`, `src/lib/receiving/display/precedence.test.ts` (no behavior in them touched; regression guard).
- The one migrated site is display-only (mobile carton header label); no route, SQL, or branching change anywhere in this pass.
- **Phase-6 drop migration NOT authored** — blocked on owner confirmation of applied-migration state (per task + plan header).
