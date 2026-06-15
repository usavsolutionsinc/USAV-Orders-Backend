# Unshipped: rich add-tracking popover + tracking/label event timeline + NAS label storage

_Plan only (2026-06-13). Work-on-main. Builds on the merged Unshipped mode
([[unshipped-pending-merge]]) and the earlier WMS discussion (the Unshipped page is the
authoritative record of **tracking-added** and **label-printed**)._

## 0. Decisions (locked with owner)

- **Label file storage = NAS** (browser-direct WebDAV), NOT Vercel Blob. A label PDF is
  ~80–250KB; 2GB Blob ≈ ~13k labels (weeks–months at volume, then overage + bandwidth).
  NAS is multi-TB and is already where receiving photos live (Blob was removed). Reuse the
  receiving NAS pattern.
- **Event model = event-sourced timeline.** `audit_logs` is the append-only event source;
  the order details panel renders a **Shopify-style vertical timeline** from it. Two
  **denormalized columns** on `orders` (`tracking_added_at`, `label_printed_at`) power the
  Unshipped list chips/sort (cheap reads), derived from the first occurrence of each event.
- **"Label printed" = upload the label file.** Dropping the carrier/ShipStation label PDF
  onto the order writes the file to NAS AND records the `label.printed` event in one act
  (file + timestamp together). Stored as a `documents` row, not a column blob.
- **UI = a popover** with **prev/next order** navigation, a **"recently added" running
  list** (what you just stamped this session), the tracking input, and **fill-missing
  fields** (SKU/item#) with real DB linkage.

## 1. Current state (verified — file:line)

- **`orders`** (`src/lib/drizzle/schema.ts:798`): `id, order_id, item_number, product_title,
  sku, condition, quantity, shipment_id→shipping_tracking_numbers, sku_catalog_id, …`.
  **No** `tracking_added_at` / `label_printed_at`.
- **`shipping_tracking_numbers`** (`src/lib/migrations/2026-03-10_shipping_backbone.sql`):
  has `is_label_created` + `label_created_at` — but those are **carrier-event** driven
  (when the carrier reports a label), NOT our internal "operator added/printed it."
- **`audit_logs`** (`src/lib/migrations/2026-03-31_create_audit_logs.sql`): `actor_staff_id,
  actor_role, source, action, entity_type, entity_id, before_data, after_data, metadata,
  created_at` — indexed by `(entity_type, entity_id, created_at DESC)`. Emit via
  `recordAudit(db, ctx, req, args)` / `createAuditLog(db, params)` (`src/lib/audit-logs.ts`).
  `/api/orders/assign` already emits `ORDER_ASSIGNMENT_UPDATED`. **No** tracking/label actions yet.
- **Add-tracking write path**: `useOrderAssignment` → `POST /api/orders/assign`
  (`src/app/api/orders/assign/route.ts`) → `upsertOrderTracking()`
  (`src/lib/neon/orders-tracking-queries.ts`) creates/links the STN + sets
  `orders.shipment_id`. The assign payload already accepts `shippingTrackingNumber`, `sku`,
  `itemNumber`, `condition`, `quantity`. **Does not** stamp a tracking-added time.
- **NAS**: `/api/nas-config` → `{ baseUrl, folder }`; `buildNasPhotoUrl()` + `putNasPhoto()` /
  `deleteNasPhoto()` (`src/lib/nas-photos.ts`, WebDAV PUT, `credentials:'include'`); recorded
  via `POST /api/receiving-photos` into the polymorphic **`photos`** table with a NAS
  URL-origin allowlist + idempotency (`receiving.upload_photo`).
- **`documents`** table (`schema.ts:1142`, polymorphic: `entity_type, entity_id,
  document_type, documentData JSONB, …`) — better home for label files than `photos`.
- **Labels are external** — the app generates NO carrier labels (only receiving/product
  thermal labels via `src/lib/print/*`). So this is *attach + record*, not *generate*.
- **SKU linkage**: `GET /api/get-title-by-sku?sku=` resolves `items`(title SoT)→
  `sku_platform_ids`→`sku_catalog`→`sku_stock`, returns `{ title, skuCatalogId, gtin, stock,
  location, imageUrl }`. Use it; **never join on the SKU string** ([[items-vs-sku-catalog-sku-collision]]).
  `orders.sku_catalog_id` is the canonical FK to set.
- **Details panel**: `ShippedDetailsPanel` (wrapped by `UnshippedDetailsPanel` `context="queue"`)
  already inline-edits tracking/order#/item#/ship-by/notes via `useOrderFieldSave` → `/api/orders/assign`.
- **A timeline UI already exists** — the "Recent carrier events" trail in
  `IncomingDetailsPanel` (`src/components/sidebar/receiving/IncomingDetailsPanel.tsx:636-696`,
  helpers `eventDotClass`/`fmtEventTime`/`eventDayKey` at `177-200`): an `<ol>` with
  day-bands, status-colored dots (ring + latest-highlight), title + right-aligned time, and
  location/badge sublines. It's currently **inline** (not a shared component) and maps
  `shipment_tracking_events`. **Reuse this exact UX** — don't build a new look.

## 2. Data-model changes

1. **Audit actions** (`src/lib/audit-logs.ts` AUDIT_ACTION):
   - `TRACKING_ADDED: 'orders.tracking.added'`
   - `LABEL_PRINTED: 'orders.label.printed'`
   (entity_type `'order'` already exists; `'SHIPPING_LABEL'` doc entity is new.)
2. **`orders` columns** (new migration): `tracking_added_at TIMESTAMPTZ`,
   `tracking_added_by INT→staff.id`, `label_printed_at TIMESTAMPTZ`,
   `label_printed_by INT→staff.id`. **First-time-only** (don't overwrite when tracking is
   re-edited). Backfill `tracking_added_at` from the earliest `audit_logs` row / STN
   `created_at` for existing tracked orders (optional one-shot).
3. **`documents` for labels**: `entity_type='SHIPPING_LABEL'`, `entity_id=orders.id`,
   `document_type='shipping_label'`, `documentData={ carrier, tracking, labelUrl, printedAt,
   pageCount? }`. (No schema change — table is generic.)
4. Multi-tenancy: every new write scoped by `org_id` per [[multi-tenancy-hardening-prompt]].

## 3. Backend

- **`/api/orders/assign`** — when `shippingTrackingNumber` transitions empty→set for an
  order: emit `recordAudit(… action 'orders.tracking.added' …)` and stamp
  `orders.tracking_added_at/by` if null. Keep the existing `ORDER_ASSIGNMENT_UPDATED`.
- **New `POST /api/order-labels`** (mirror `/api/receiving-photos`): body `{ orderId,
  labelUrl, carrier?, tracking? }`; validates `labelUrl` against the NAS origin allowlist;
  idempotent on `(SHIPPING_LABEL, orderId, url)`; inserts the `documents` row, stamps
  `orders.label_printed_at/by` (first time), emits `orders.label.printed`. `GET` lists an
  order's labels; `DELETE` removes (mirrors `deleteNasPhoto`). New permission
  `shipping.upload_label` (registry + manifest test per [[permission-registry-guard]]).
- **`GET /api/orders/[id]/timeline`** — returns `audit_logs` for `(entity_type='order',
  entity_id=id)` mapped to timeline items `{ at, actor, action, summary, meta }`. (Or fold
  into the order detail fetch as a batched sub-query to avoid an extra round-trip.)
- **NAS**: extend `/api/nas-config` (or add `/api/nas-config?scope=labels`) to expose a
  labels folder; generalize `buildNasPhotoUrl` → `buildNasFileUrl({ scope:'labels',
  orderRef, filename })` writing to a `labels/` subpath. Same WebDAV PUT helper.

## 4. Frontend

- **`AddTrackingPopover`** (new, `src/components/unshipped/`):
  - Header: order identity (order#, title, platform, condition·qty) + **‹ Prev / Next ›**
    buttons that walk the current Unshipped list order (drives selection, keeps the popover open).
  - **Tracking** input (paste/scan) → `useOrderAssignment`.
  - **Fill missing** SKU / item# — SKU field calls `get-title-by-sku` (debounced),
    shows the resolved title + a 🔗 confirm that stores `sku` **and** `sku_catalog_id`
    (canonical linkage), item# free-text.
  - **Label** drop-zone — drag/drop or pick a PDF/PNG → `putNasFile` → `POST /api/order-labels`.
  - **"Recently added" list** — a session-local running log (tracking just added, label just
    attached) so the operator sees throughput as they sweep prev→next. (Mirrors the clipboard-
    history choke-point pattern.)
  - Trigger from the row's `Add TRK#` affordance (replaces the bare paste with "open popover").
- **Order timeline = the existing carrier-events trail, reused.** Extract the inline
  timeline from `IncomingDetailsPanel` into a shared **`EventTimeline`** primitive
  (`src/components/ui/EventTimeline.tsx`) that takes generic items
  `{ id, at, title, dotTone, subtitle?, badge? }` and renders the same `<ol>` day-band /
  dot / time / subline layout (move `eventDotClass`/`fmtEventTime`/`eventDayKey` with it).
  Then: (a) refactor `IncomingDetailsPanel` to feed it `shipment_tracking_events`
  (no visual change — same component), and (b) render it in `ShippedDetailsPanel` fed by
  `/api/orders/[id]/timeline` (audit_logs → items: "Tracking added · 2:14 PM · Jose",
  "Label printed · 2:20 PM · Jose", "Packed · 3:01 PM"). One timeline component, two feeds.
- **Unshipped row chips** — small TRK✓ / LABEL✓ state dots derived from
  `tracking_added_at` / `label_printed_at` (two-step progress: needs-tracking → tracking-added
  → label-printed → packed). Optional `?sort=label_printed` later.

## 4a. `EventTimeline` — shared, decoupled, importable primitive

The timeline stops being incoming-specific and becomes a **first-class design-system
component any detail panel / page can import**. This is its own decoupling track (ships
independently of the tracking/label feature; the order timeline is just its first new consumer).

**Three layers (keep them separate, mirroring the CopyChip family discipline
[[copy-chip-serial-consistency]]):**

1. **Pure presentational component** — `src/components/ui/EventTimeline.tsx`. Knows nothing
   about carrier events, audit logs, or any domain. Renders a generic item list with the
   existing look (day-bands, status-dot + ring + latest-highlight, title + right time,
   subtitle/badge sublines, `border-l` rail).
   ```ts
   export type TimelineTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';
   export interface TimelineItem {
     id: string | number;
     at: string | Date | null;        // event time (component formats + day-groups)
     title: string;                   // primary line
     tone?: TimelineTone;             // dot color (default 'info')
     subtitle?: string;               // location / detail line
     actor?: string;                  // "Jose" → rendered as "· Jose"
     badge?: { label: string; tone: TimelineTone };  // signed-by / exception pill
     href?: string;                   // optional click target
     icon?: React.ReactNode;          // optional leading glyph instead of a dot
   }
   export interface EventTimelineProps {
     items: TimelineItem[];
     emptyMessage?: string;
     groupByDay?: boolean;            // default true
     highlightLatest?: boolean;       // default true
     dense?: boolean;
   }
   ```
2. **Tone registry** — one map `TimelineTone → dot/bg classes` (generalize the current
   `eventDotClass`). Single source of truth for timeline colors; semantic, not per-caller.
3. **Per-domain feed adapters** (`src/lib/timeline/*`) — pure functions mapping a domain
   source → `TimelineItem[]`. The component never imports these; callers do.
   - `carrierEventsToTimeline(events: ShipmentTrackingEvent[])` — moved out of `IncomingDetailsPanel`.
   - `orderAuditToTimeline(rows: AuditLogRow[])` — maps `orders.tracking.added` /
     `orders.label.printed` / `ORDER_ASSIGNMENT_UPDATED` / `PACK_COMPLETED` → title + tone + actor.
   - Future adapters slot in with zero component change (see rollout).

**Decoupling steps:**
- Extract the inline `<ol>` + helpers (`eventDotClass`/`fmtEventTime`/`eventDayKey`) from
  `IncomingDetailsPanel.tsx:177-200,636-696` into `EventTimeline` + `lib/timeline/`.
- Refactor `IncomingDetailsPanel` to `EventTimeline items={carrierEventsToTimeline(s.events)}`
  — **pixel-identical, zero behavior change** (the safe first PR; no new feature).
- Then any panel imports `EventTimeline` + its own adapter.

**Rollout targets (import sites — wire incrementally, each is just an adapter + one render):**
- **Unshipped/Shipped order panel** — order events (this feature, Phase 4 below).
- **Receiving line / PO panel** — the [[audit-trail-anchor]] initiative is exactly "a unified
  timeline anchored on `receiving_line_id`"; this component is its UI. Adapter over
  `audit_logs` (entity `receiving_line`/`receiving`) + scan/test events.
- **Tech / Testing detail** — testing verdicts + serial lifecycle (`tech_serial_number` events).
- **Warranty claim detail** — claim → repair → Zendesk thread events ([[warranty-zendesk-roundtrip]]).
- **Repair detail** — repair history.
- **Serial / Unit detail** (`UnitDetailWorkspace`) — unit lifecycle (RECEIVED → IN_TEST → … → shipped/returned).

**Contract rule:** panels NEVER hand-roll a timeline again; they write a `*ToTimeline`
adapter and render `<EventTimeline>`. New event sources = a new adapter, never new markup.

## 5. Phasing (each shippable)

The `EventTimeline` decoupling (Phase 0) is **independent** — it's a pure refactor that can
land first, on its own, with no dependency on the tracking/label feature.

0. **Decouple the timeline** (foundational, standalone): extract `EventTimeline` +
   `lib/timeline/` (tone registry + `carrierEventsToTimeline`) and refactor
   `IncomingDetailsPanel` onto it — **pixel-identical, zero behavior change**. Ships alone.
1. **Data + write**: audit actions, `orders` columns + migration, assign stamping +
   `orders.tracking.added` event. (Invisible groundwork; nothing breaks.)
2. **Popover**: `AddTrackingPopover` with tracking + fill-missing (SKU/item# linkage) +
   prev/next + recently-added. (Highest day-to-day value.)
3. **NAS labels**: `buildNasFileUrl`, `POST/GET/DELETE /api/order-labels`, the drop-zone,
   `label_printed_at` stamping + `orders.label.printed` event, `shipping.upload_label` perm.
4. **Order timeline (first new consumer)**: `orderAuditToTimeline` adapter +
   `/api/orders/[id]/timeline`, render `<EventTimeline>` in `ShippedDetailsPanel`.
5. **List chips/sort**: TRK✓/LABEL✓ dots on the row from the denormalized columns.
6. **Timeline rollout (ongoing, per-panel)**: add `*ToTimeline` adapters + an
   `<EventTimeline>` render to the receiving-line/PO, tech/testing, warranty, repair, and
   serial/unit panels (see §4a rollout list). Each is a small, independent PR; the
   receiving-line one realizes the [[audit-trail-anchor]] plan's UI.

## 6. Risks / edge cases

- **First-time-only stamping** — `tracking_added_at` must not move when tracking is corrected;
  use `COALESCE`/`WHERE … IS NULL`. The timeline still shows every edit (audit log is full).
- **NAS HTTPS/CORS** — labels need the office network / HTTPS NAS like receiving photos;
  surface the same friendly error. ([[nas-direct-write]], [[nas-photo-picker]].)
- **SKU collisions** — resolve via `get-title-by-sku`, store `sku_catalog_id`; never string-join.
- **Idempotency** — re-dropping the same label is a 409 (no dup `documents` row, no second event).
- **audit_logs growth** — already indexed by `(entity_type, entity_id, created_at)`; timeline
  query is cheap. Keep label files OUT of the DB (NAS only; DB holds the URL).
- **Label preview** — PDFs render in an `<iframe>`/`<embed>`; PNGs inline. Store `pageCount`
  in `documentData` if useful.

## 6a. Build progress (2026-06-13)

**Shipped (tsc clean on touched files, eslint 0 new errors, production build green):**
- **Phase 0** — `EventTimeline` extracted to `src/components/ui/EventTimeline.tsx` (tone
  registry) + `src/lib/timeline/{types,carrier-events,index}.ts`; `IncomingDetailsPanel`
  refactored onto it (pixel-identical; inline `<ol>` + `eventDotClass`/`fmtEventTime`/
  `eventDayKey` removed). The timeline is now an importable primitive.
- **Phase 1** — audit actions `orders.tracking.added` + `orders.label.printed` added to
  `AUDIT_ACTION`; `/api/orders/assign` now emits a one-time `orders.tracking.added` event
  for orders that had no tracking before (first-add only; re-edits stay
  `ORDER_ASSIGNMENT_UPDATED`). Assign route + `useOrderAssignment` extended with
  `skuCatalogId` → sets `orders.sku_catalog_id` (canonical linkage). **No migration**
  (audit_logs is the event store; denormalized `orders` columns deferred to Phase 5).
- **Phase 2** — `AddTrackingPopover` (`src/components/unshipped/AddTrackingPopover.tsx`) +
  `AddTrackingNavProvider` (`add-tracking-context.tsx`): rich popover with order identity,
  tracking input (+ paste), fill-missing SKU (debounced `get-title-by-sku` → links
  `sku_catalog_id`) + item#, prev/next worklist nav ("Save & Next"), position counter, and a
  session "recently added" log. Replaces the bare paste affordance in `OrdersQueueTable`
  (provider wraps the table; awaiting order ids drive nav).

- **Phase 4** — order timeline live: `orderAuditToTimeline` adapter
  (`src/lib/timeline/order-events.ts`, curates titles/tones + drops the redundant
  assignment-only-tracking row) + `GET /api/orders/[id]/timeline` (audit_logs by
  `lower(entity_type)='order'`, joined to staff for actor names, `orders.view`-gated) +
  `OrderTimelineSection` rendering `<EventTimeline>` in `ShippedDetailsPanel` (dashboard/
  queue/shipped contexts). The tracking-added events from Phase 1 are now visible.

- **Phase 3** — NAS shipping-label CRUD: `buildNasLabelUrl` (flat `LABEL_<orderRef>__<file>`,
  no subdir → no WebDAV 409) + `/api/order-labels` (GET list + NAS config, POST attach with
  origin-allowlist + idempotency + first-label `orders.label.printed` event, DELETE) on the
  `documents` table (`entity_type='SHIPPING_LABEL'`) + `OrderLabelsSection` drop-zone (browser-
  direct WebDAV PUT via `putNasPhoto`, list, delete) in `ShippedDetailsPanel`.
  **Live-tested** against `/Volumes/personal_folder/Photos` via `deploy/nas-photo-server/Caddyfile.local`
  (caddy-webdav): PUT→201, GET→200, JSON list, OPTIONS→204 CORS, DELETE→204, GET→404. Plus
  `tests/e2e/order-labels.spec.ts` (attach → list → 409 → delete contract).

- **Phase 5 (partial)** — migration `2026-06-13_orders_tracking_label_timestamps.sql` **APPLIED**
  (via `npm run db:migrate`; 4 columns verified on `orders`). First-time stamping **wired + tested**:
  assign route stamps `tracking_added_at/by`, order-labels route stamps `label_printed_at/by`
  (verified live — a label attach SET `label_printed_at` by staff 1).

**E2E tested (2026-06-13, live server + applied DB):**
- `tests/e2e/order-labels.spec.ts` — **PASS** (attach → list → 409 → delete).
- Full chain verified + cleaned up: label attach → `orders.label.printed` audit event →
  `label_printed_at` stamp → `GET /api/orders/5501/timeline` returns it. Allowlist correctly
  rejects off-NAS URLs (400).
- Live NAS WebDAV CRUD vs `/Volumes/personal_folder/Photos` via caddy-webdav: PUT 201 / GET 200 /
  JSON list / OPTIONS 204 CORS / DELETE 204 / GET 404.
- No regressions; the only failing specs (nas-photos receiving POST, unbox-nas-photos) fail on
  ENVIRONMENT (org has a configured NAS base → their placeholder URLs are rejected; `/Volumes/USAV
  Media/…` not mounted) — pre-existing, unrelated to these changes.

**Remaining:** Phase 5 row chips — TRK✓/LABEL✓ dots on the Unshipped row (needs the orders list
query to SELECT the new columns + the row to render them). Phase 6 — roll `EventTimeline` out to the
receiving-line/tech/warranty/repair/unit panels.

**To run the live NAS test locally:**
```
curl -fsSL "https://caddyserver.com/api/download?os=darwin&arch=arm64&p=github.com/mholt/caddy-webdav" -o ./caddy-webdav && chmod +x ./caddy-webdav
./caddy-webdav run --config deploy/nas-photo-server/Caddyfile.local --adapter caddyfile   # serves /Volumes/personal_folder/Photos on :8088
# point the app at it, then run the spec:
NEXT_PUBLIC_NAS_PHOTOS_BASE_URL=http://localhost:8088 npm run dev
PW_TEST_ORDER_ID=<id> npx playwright test order-labels
```

## 7. Why this is the right shape

- Reuses the existing assign write-path, audit system, NAS WebDAV pattern, and `documents`
  table — minimal new surface, consistent with the codebase.
- The Unshipped page becomes the **system of record** for the two governing events
  (tracking-added, label-printed) exactly as framed in the WMS discussion, with an
  immutable trail (audit_logs) + a fast list projection (columns) + a human timeline.
- Forward-compatible: a future ShipStation/carrier API integration can auto-create the
  label `documents` row + fire `orders.label.printed` with zero schema change.
