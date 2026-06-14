# Outbound Ship‑Confirm & Staging Reconciliation — Findings & Plan

**Module:** Pack‑Out → Scan‑Out (label out) → Cross‑Reference
**Surface:** `src/components/shipped/DashboardShippedTable.tsx` (+ a scan‑out mode on the shipped page)
**Scale:** small business (~5 people). Keep it lean — **no new tables, derived state only.**
**Status:** ✅ BUILT (2026-06-13) — v1 shipped. No migration. Gated on full-project `tsc` (0 errors) + lint.

### What shipped (v1)
- `src/lib/outbound-state.ts` — `OutboundState` enum + `deriveOutboundState()` / `hasLeftWarehouse()` / `effectiveShipTime()` + `OUTBOUND_STATE_META` (pure, isomorphic).
- `src/lib/station-activity.ts` — `SHIP_CONFIRM` activity type + `OUTBOUND` station (free-text columns → no migration).
- `src/lib/neon/packer-logs-week.ts` — lateral join emits `ship_confirmed_at` / `shipped_out_by` / `shipped_out_by_name`; cache bumped v5→v6. (`PackerRecord` extended in `src/hooks/usePackerLogs.ts`.)
- `POST /api/shipped/scan-out` — `withAuth('shipping.mark_shipped')`; `resolveShipmentId` → idempotent `SHIP_CONFIRM` insert; emits `shipment.scan_out` audit; busts `packing-logs`/`shipped` cache.
- `DashboardShippedTable.tsx` — dedup now keyed by `(order_id, shipment_id)` (multi-package orders no longer collapse); grouped/sorted by effective ship time; `OutboundStatePill` per row. Right pane is always the plain day-grouped list (one shared `renderRecordRow`).
- **Split layout (final):** the List / Scan-Out switch is a `HorizontalButtonSlider` (`variant="nav"`, blue, with `List`/`Barcode` icons) in `SidebarShell.headerRows` — right below the search bar, like every other display (`?shippedView=scanout`). The sidebar body swaps: list → search results; scan-out → `ShippedScanOutSidebar` (`StationScanBar` scan-out + running counter + feedback + 6 `MetricLineRow` cross-reference tiles).
- Shared: `src/lib/shipped-records.ts` (`dedupeShippedRecords`/`deriveShippedRecord`), `src/lib/shipped-dashboard-params.ts` (`resolveShippedQueryArgs` — one query key shared by table + sidebar), `src/hooks/useShippedScanOutData.ts` (tile counts), `OutboundStatePill.tsx`.

### Known v1 limitations (by design)
- Search-path rows (`/api/shipped` → orders-queries) don't carry `ship_confirmed_at`, so a searched row derives state from carrier signals only (no internal scan-out nuance). The scan-out view runs off the default week query, which is fully enriched.
- `PROCESS_GAP`/`ORPHAN` only surface where the PACK row exists; a true "scanned out, never packed" sweep needs the dedicated cross-ref query (future).

> This is the reconciled output of a Phase‑0 discovery against the live repo. It replaces the
> generic "outbound scan verification" brief's assumptions with what actually exists here, then
> scopes the smallest build that delivers the requested behavior.

---

## 1. What's actually wanted (clarified)

A package is **packed at one time** and **leaves the building at another time**, and the dashboard
should make both moments first‑class:

1. **Packed scan** stamps a "packed" event onto the tracking number's timeline and moves the package
   into an **invisible staging** state (packed, but not yet physically gone).
2. A **`StationScanBar`** (`src/components/station/StationScanBar.tsx`) is rendered on the shipped page
   for **scanning out labels** — the dock/handoff scan. This stamps a **"left the warehouse"** time
   onto the same tracking number's timeline.
3. A **cross‑reference report** compares *packed* vs *scanned‑out* and surfaces the mismatches.
4. **Two tables** with **enum status** columns, sortable:
   - **Table A — Packed / In Staging:** sorted by *when a packer scanned it*.
   - **Table B — Shipped Out:** sorted by *when it left the warehouse*.

Everything is derivable from existing tables plus **one new append‑only event type**. No schema migration.

---

## 2. Phase‑0 discovery — entity map (brief → real schema)

| Concept | Real table(s) | Notes / refs |
|---|---|---|
| Shipment (order‑level) | `orders` + `order_shipment_links` (one order ↔ N tracking #s) | `orders.status` is **free‑text**, not an enum |
| Package / handling unit | **No outbound carton table.** The de‑facto package = one `shipping_tracking_numbers` row (one tracking #). `handling_units` (`H-####`) is **inbound‑only**; `serial_units.unit_uid` is a per‑item LPN | `2026-06-08_handling_units_lpn.sql`; `2026-03-10_shipping_backbone.sql:4` |
| Scan event (append‑only) | `station_activity_logs` — pure append‑only, zero UPDATEs. PACK events: `activity_type ∈ {PACK_COMPLETED, PACK_SCAN}`, `station='PACK'` | `2026-03-12_create_tech_scan_logs.sql`; `src/lib/station-activity.ts:5‑16` |
| External "took custody" truth | `shipping_tracking_numbers` milestone flags: `is_label_created/label_created_at`, `is_carrier_accepted/carrier_accepted_at`, `is_in_transit`, `is_out_for_delivery`, `is_delivered`, `has_exception`, `is_terminal` + append‑only `shipment_tracking_events` | `2026-03-10_shipping_backbone.sql`; carrier webhooks **active** `src/app/api/webhooks/{fedex,ups,usps}/route.ts` |
| Reconciliation / exceptions | **None outbound.** `orders_exceptions` is **inbound** unmatched‑scan only (`reason='not_found'`) | `orders_exceptions` `schema.ts:1297` |

### Conventions confirmed (for any future migration)
- Dated raw‑SQL migrations in `src/lib/migrations/` (`YYYY-MM-DD[suffix].sql`); applied via `scripts/`.
- `@neondatabase/serverless` `pool.query(sql, params)`; tenant GUC `app.current_org`.
- `BIGSERIAL` for event/volume tables; trigger‑minted codes (`H-{id}`, `R-{id}`).
- `organization_id UUID NOT NULL DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid`.
- RLS defined but **not forced** (owner has `BYPASSRLS`).

---

## 3. Conflicts with the generic brief (deferring to the repo)

1. **"Label created is treated as shipped" → FALSE here.** The default shipped list is gated on
   **carrier custody**: `COALESCE(stn.is_carrier_accepted OR stn.is_in_transit OR stn.is_out_for_delivery OR stn.is_delivered, false)` (`src/lib/neon/orders-queries.ts:153‑314`, `ORDER_SERIALS_CTE`; mirrored `src/lib/zoho/fulfillment-source.ts:88‑89`). The blind spot is the **inverse**: packed‑but‑staged is *hidden* until the carrier scans. That hidden window is exactly the "invisible staging" the scan‑out flow makes visible.
2. **No label/rate service** (no EasyPost/Shippo/Stamps). Tracking numbers arrive *from* carriers via
   webhook/poll, so `label_created_at` is a carrier milestone, not an internal print event.
3. **No carrier EOD manifest pull** and USPS is webhook‑only (`enabled-carriers.ts:13 = ['UPS','FEDEX']`).
   `is_carrier_accepted` **is** the "carrier took custody" signal — use it as the manifest substitute.
4. **GS1 SSCC is unnecessary.** Use the house code pattern, not SSCC‑18.
5. **`packer_logs` is not pure append‑only** (re‑scans UPDATE). Build the event spine on
   `station_activity_logs`.

---

## 4. v1 design (no new tables)

### 4.1 Events on one timeline (joined by `shipment_id`)
Both the packed scan and the scan‑out write to **`station_activity_logs`**, linked to the same
`shipping_tracking_numbers.id` (`shipment_id`). The full timeline per tracking number is then:

```
PACK (PACK_COMPLETED)  →  SHIP_CONFIRM (new)  →  carrier ACCEPTED  →  IN_TRANSIT  →  DELIVERED
[internal, packer]        [internal, dock]       [shipment_tracking_events, carrier-reported]
```

- **Packed scan** already exists: `POST /api/packing-logs` writes `PACK_COMPLETED`/`PACK_SCAN`
  (`src/app/api/packing-logs/route.ts`). No change needed; it is the "scanned by packer" time.
- **Scan‑out (new):** add `activity_type='SHIP_CONFIRM'` (and `station='OUTBOUND'`) to the union in
  `src/lib/station-activity.ts:5‑16`. **No DB migration** — both columns are free‑text VARCHAR. Write
  it through the existing `createStationActivityLog(...)` helper.

### 4.2 "Invisible staging" = a derived state (not a physical place)
A package is **in staging** when it has a PACK event (or `packer_logs.packed_by`) **and** no
`SHIP_CONFIRM` event **and** the carrier hasn't accepted it yet. Nothing to store — it falls out of
the join. The packed scan "places it in staging" simply by existing without a scan‑out.

### 4.3 Derived enum status (TypeScript, not DB)
Compute one display enum per package from signals already available:

| `OutboundState` | Derivation |
|---|---|
| `PACKED_STAGED` | PACK event exists; no `SHIP_CONFIRM`; not carrier‑accepted |
| `SCANNED_OUT` | `SHIP_CONFIRM` event exists; not yet carrier‑accepted |
| `IN_CUSTODY` | `is_carrier_accepted OR is_in_transit OR is_out_for_delivery` |
| `DELIVERED` | `is_delivered` / `is_terminal` |
| `EXCEPTION` | `has_exception` OR `isStalled(...)` (already computed at `DashboardShippedTable.tsx:349‑356`) |
| `PROCESS_GAP` | `SHIP_CONFIRM` exists but **no** PACK event |
| `ORPHAN` | carrier‑accepted but **no** `SHIP_CONFIRM` (shipped outside the scan‑out flow) |

### 4.4 Cross‑reference report (the daily worklist)
A small server query over today's population grouped by `OutboundState`:
- **Packed, not scanned out** (`PACKED_STAGED`) → still in staging, find & ship.
- **Scanned out, never packed** (`PROCESS_GAP`) → backfill / coach.
- **Carrier accepted, never scanned out** (`ORPHAN`) → left outside the system.
- **Clean** = `SCANNED_OUT` → `IN_CUSTODY`/`DELIVERED`.

**Invariant:** `{shipment_ids carrier‑accepted today}` ⊇ `{shipment_ids with SHIP_CONFIRM today}`;
any gap is `ORPHAN` (accepted, not scanned) or `PACKED_STAGED` (packed, not yet out).

---

## 5. Exact code touch‑points

| Change | File | Migration? |
|---|---|---|
| Add `SHIP_CONFIRM` activity type + `OUTBOUND` station | `src/lib/station-activity.ts:5‑16` | No (free‑text columns) |
| New scan‑out endpoint (normalize tracking → match `shipping_tracking_numbers` → insert `SHIP_CONFIRM` via `createStationActivityLog`; idempotent using the existing `station_scan_sessions` pattern) | new `src/app/api/shipped/scan-out/route.ts` (model on `src/app/api/packing-logs/route.ts`) | No |
| Emit `packed_at`, `ship_confirmed_at`, and derived `outbound_state` from the shipped query | `src/lib/neon/orders-queries.ts` (`ORDER_SERIALS_CTE`) | No |
| **Stop deduping multi‑package orders into one row** (key by `(order_id, shipment_id)` or expand `tracking_number_rows[]`) | `DashboardShippedTable.tsx:319‑327` | No |
| **Group by effective ship time**, not pack time (`ship_confirmed_at ?? carrier_accepted_at ?? label_created_at ?? packed_at`) so packages land under the day they left | `DashboardShippedTable.tsx:400‑413, 544` | No |
| Render the scan‑out `StationScanBar` + two enum‑status tables + cross‑ref report as a **sidebar mode** (`?mode=scanout`) on the shipped page, per the `sidebar-mode` skill | `src/components/ShippedSidebar.tsx`, `src/app/dashboard/page.tsx`, reuse `src/components/station/StationScanBar.tsx` | No |
| Surface multiple tracking numbers per row (already plumbed via `tracking_number_rows`, `DashboardShippedTable.tsx:237,280` but unused in render at `:594`) | `DashboardShippedTable.tsx:586‑598` | No |

**Two tables (Table A / Table B)** are two views over the same enriched rows:
- **Table A — Packed / In Staging:** filter `outbound_state ∈ {PACKED_STAGED, PROCESS_GAP}`, sort by `packed_at`.
- **Table B — Shipped Out:** filter `outbound_state ∈ {SCANNED_OUT, IN_CUSTODY, DELIVERED}`, sort by `ship_confirmed_at`.

The existing filter toolbar already supports carrier/status/exceptions filters
(`readShipped*Filter`, `DashboardShippedTable.tsx:129‑131`, applied `:344‑360`) — extend it with the
`outbound_state` filter rather than building a new control.

---

## 6. Phased steps & acceptance

- **Step 1 — Display truth (table only).** Fix `order_id` dedup; group by effective ship time; show
  multi‑tracking + derived `outbound_state` chip.
  *Accept:* a multi‑package order that ships across two days shows two rows under two days.
- **Step 2 — Scan‑out event.** Add `SHIP_CONFIRM` type + scan‑out endpoint; render `StationScanBar`
  on the shipped page; stamp `ship_confirmed_at`.
  *Accept:* scanning a label writes one append‑only event and stamps "left the warehouse" time.
- **Step 3 — Two tables + cross‑ref.** Render Table A / Table B + the cross‑reference report as a
  sidebar mode.
  *Accept:* "packed but not gone" and "gone but not packed" are visible, sortable worklists; the
  invariant holds.

---

## 7. KPIs (for a 5‑person shop, keep to 3)
- **Staging leakage:** `PACKED_STAGED` count at end of day.
- **Scan‑out coverage:** `SHIP_CONFIRM` ÷ carrier‑accepted (catch `ORPHAN`s).
- **Same‑day out rate:** packed and scanned‑out on the same day.

## 8. Open items / deferred
- A real `outbound_packages` (`P-####`) table + package status enum is **only** needed if a carton
  must have identity *before* a tracking number exists (multi‑box consolidation at the dock). Not v1.
- Carrier SCAN‑Form / EOD pull and EDI 856 ASN are retail/FBA‑lane hardening, out of scope.
