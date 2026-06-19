# USAV Operations — Master Build Plan

> **Loop anchor.** Each session: find the first `- [ ]` in the highest-priority section,
> implement it, flip to `- [x]`, note what file(s) changed, then stop or continue if the
> next task is a natural follow-on. Never skip to a lower-priority section while a higher
> one has open items.

---

## Design System Contracts (read before every task)

Before touching any UI:

1. **Primitives first** — `src/design-system/primitives/` and `src/design-system/components/`
  are the source of truth. Check there before writing a single new `<div>`.
2. **Chips are semantically bound** — `TrackingChip`=blue, `FnskuChip`=purple,
  `SerialChip`=emerald, `OrderIdChip`=gray, `TicketChip`=orange. Never swap.
3. **Tabs** — always `TabSwitch` from `src/components/ui/TabSwitch.tsx`. No ad-hoc pill rows.
4. **Buttons** — canonical `Button` (5 variants) at `design-system/primitives/Button.tsx`.
  `PrimaryButton` is a thin alias. Never hand-roll button classes.
5. **Motion** — use `framerTransition.`* / `framerPresence.*` from
  `design-system/foundations/motion-framer.ts`. Micro = 100ms, fast = 150ms.
6. **New sidebar modes** — must go through `HorizontalButtonSlider` + `?mode=` URL param
  via `SidebarShell`. See `sidebar-mode` skill before building any new sidebar feature.
7. **New standalone components** — grep first, ask before creating. The rule:
  if a component does what you need within 2 props, extend it; if you need something
   genuinely new, state *why* and which existing primitive it composes from.
8. **Condition labels** — `conditionLabel()` from `src/lib/conditions.ts` only.
9. **Z-index** — named tokens from `design-system/tokens/z-index.ts` only. Never `z-[NNN]`.
10. **Typography** — `typographyPresets.`* (sectionLabel, fieldLabel, dataValue, monoValue,
  chipText, cardTitle, tableHeader, tableCell, microBadge) over hand-rolled Tailwind strings.

---

## 🔴 Section 1 — Active Bugs (blocking daily ops)

- [ ] Fix multi-post to Zoho description on testing submit (duplicate entries)
- [ ] Fix testing staff name should not post to Zoho from the testing mode testing page component
- [ ] Show testing status as visually distinct from "received" status in receiving recent rail
- [ ] FBA Dashboard Popover: tracking number updates not saving correctly
- [ ] FBA Dashboard Popover: condition updates not persisting to database

---

## 🟠 Section 2 — Partial Builds (finish what's started)

- [ ] **Phase 5 migration**: apply `2026-06-13_orders_tracking_label_timestamps.sql`
  ```
  then wire stamping chips in AddTrackingPopover and OrderLabelsSection
  ```
- [ ] **Phase 6**: roll out order timeline (orderAuditToTimeline) to all order detail views
- [ ] Platform/account/type catalog: build read-side resolvers (migration applied, CRUD done,
  ```
  resolvers pending — see `docs/platform-account-type-catalog-plan.md`)
  ```
- [ ] SKU graph UI: build Cytoscape visualization (backend `/api/sku-catalog/graph` is done,
  ```
  migration unapplied — apply first, then wire frontend)
  ```
- [ ] Unshipped rail badges: add count badges to rail pills
- [ ] DashboardManagementPanel deduplication (follow-up from Unshipped+Pending merge)
- [ ] Station builder: wire drag-and-drop for block reordering (click-to-add is live, DND pending)
- [ ] Station builder: wire attach-tracking action block

---

## 🟡 Section 3 — Core Operations Features

### Receiving & Packing

- [ ] **Quick Keys**: hotkey`Escape` to fucos station scan bar in unbox mode 
  ```

  ```
- [ ] **Packing page — distinct modes**: add mode rail to packing page
  ```
  (e.g. Standard / Fragile / Multi-Item) via `HorizontalButtonSlider` + `?packMode=`
  ```
- [ ] **Packing page — per-SKU QA guidelines**: display known problems and explicit pack
  ```
  instructions per SKU in the packing panel (source from `sku_catalog` notes field or
  a new `sku_pack_notes` column if it doesn't exist)
  ```
- [ ] **Mobile packer flow**: Scan 1 pulls order details; Scan 2 shows exactly what to pack;
  ```
  auto-progress between modes on successful scan (build on `/m/pack` shell)
  ```
- [ ] **Mobile QR code scanning**: update mobile mode to support scanning both PO QR codes
  ```
  and printed label QR codes during testing and receiving flows
  ```
- [ ] **Incoming/Receiving Search-To-Do**: generate a search-driven to-do list from
  ```
  incoming email order numbers (surface unfound/unmatched POs in priority order)
  ```

### Repair Service & Ticketing

- [ ] **Repair Service UI flow**: redesign repair flow as a simple, centered, linear - keyboard below centered text entry one by one display similar to square POS including framer motion animation, email entry should include if shipping is needed.
  ```
  step display — paperwork viewable at any point in the flow
  ```
- [ ] **Repair Ticket CRUD**: full Create/Read/Update/Delete on repair records including
  ```
  manual service entry (not just warranty-linked repairs)
  ```
- [ ] **Ticket linkage**: link and unlink repair tickets to orders/serials; add scrollable
  ```
  recent-entries feed to the repair dashboard
  ```
- [ ] **Repair Service Pickup Dashboard**: track readiness, staff attribution, and due dates
  ```
  for Ecwid walk-ins and in-person pickups
  ```
- [ ] **Warranty quick-access**: add warranty check-in action to the quick-access popover

### Timelines & Notifications

- [ ] **Testing to-do list**: a to-do list in the tech station that defaults to recently
  ```
  received items, updates in real-time as items arrive from receiving
  ```
- [ ] **Notification inbox — unboxed returns**: bell alert fires when a return is unboxed
  ```
  and needs attention (extend existing `inbox:{staffId}` Ably channel)
  ```
- [ ] **Notification inbox — ready to ship**: bell alert fires when a packed order has been
  ```
  unboxed and is staged for carrier pickup
  ```

---

## 🟢 Section 4 — Integrations & AI

- [ ] **OCR for local pickups**: scan product title → quick SKU lookup or missing-item flag - middle scan page in mobile that has a local pick up / identify product screen for hitting a server on an rtx visual python traced for OCR thats been reranked trained for all the images of products
  ```
  use browser camera + OCR API (Tesseract.js or a cloud endpoint)
  ```

---

## 🔵 Section 5 — Design & Polish (Linear/Notion Aesthetic)

- [ ] **Site-wide audit**: run through each major page and flag components that deviate from
  ```
  the design system (cards where lines should be, hand-rolled badges, non-preset typography)
  ```
- [ ] **Operations page overhaul**: top section = current goal chip (already exists in header,
  ```
  promote to page-level); scroll section = stats, research displays, local agent status
  ```
- [ ] **Component cleanup — Testing view**: standardize display panels to use `PanelSection`,
  ```
  `DetailsPanelRow`, `ExpandableSection` from the design system
  ```
- [ ] **Component cleanup — Shipping view**: same audit and migration for Shipped/Outbound panels
- [ ] **Motion integration**: wire `framerPresence.dropdownPanel`, `framerPresence.sidebarSection`,
  ```
  `framerPresence.tableRow` across all panels and drawers that currently animate with
  raw `opacity`/`transform` instead of the design system presets
  ```
- [ ] **New icons — sorting**: add dedicated sort-direction and sort-category icons to `Icons.tsx`
  ```
  (check for duplicates first via the dedup script)
  ```
- [ ] **New icons — staff assignment**: add staff-assignment icon to `Icons.tsx`

---

## ⚪ Section 6 — Infrastructure & Data

- [ ] **QR Code fix — 502 batch**: the ~90 QR codes returning HTML/502 are pointing to
  ```
  PDF URLs that no longer resolve. Script: iterate the `sku_catalog` manual URL fields,
  HEAD-check each, collect failures, re-upload correct PDFs to R2/Vercel Blob, update URLs
  ```
- [ ] **QR Code fix — 404s**: items 40 (wms III) and 157 (Series III 03781) — locate correct
  ```
  PDFs from `/Volumes/USAV Media/1 Manual/1 Bose Manual`, re-upload, update QR target URL
  ```
- [ ] **QR Code fix — internal file URLs**: items 240, 323, 350 use `file://` internal paths —
  ```
  upload to R2 and replace with public HTTPS URLs
  ```
- [ ] **Duplicate PDF dedupe**: upload each unique hash once to R2 (143 objects, ~1.8 GB);
  ```
  build a manifest mapping every folder path to its shared R2 key (see Duplicate PDF Report
  in the Google Doc for the full list of 36 duplicate groups)
  ```
- [ ] **Calendar page**: design and implement a staff scheduling and assignment calendar
  ```
  (use `design-system/components/Calendar.tsx` as the base)
  ```
- [ ] **SOP generation**: once packing/testing/repair workflows are finalized, generate the
  ```
  final operations manual as a structured PDF
  ```

---

## ✅ Done (shipped — do not re-implement)

- [x] Universal Timelines / EventTimeline primitive (`src/components/ui/EventTimeline.tsx`)
- [x] First Trace audit trail (order timeline, audit_logs, inventory_events spines)
- [x] Notification inbox bell — header goal chip + `inbox:{staffId}` Ably channel
- [x] Testing priority + needs-test toggle (receiving.is_priority + per-line flag)
- [x] AI Claims Assistant v1 — A1 Zendesk claim draft (Hermes tool-call helper)
- [x] AI Product Sourcing — B1 PO-email pile (Hermes plugin)
- [x] Warranty page + Zendesk round-trip (warranty.* perms, bulk CRUD, soft delete)
- [x] Warranty quick-access check-in (4th Orders/Shipping mode)
- [x] Zoho PO sync cron (po-sync mirror = the "Sync" button)
- [x] NAS direct write for receiving photos (browser-direct WebDAV)
- [x] NAS PDF viewer / DOCX→PDF via LibreOffice in Vercel Sandbox
- [x] Mobile door-receive flow (`/m/receive`) + priority_unbox Ably alert
- [x] Mobile shell consistency (MobileTopBar, fixed bottom nav, History auto-open)
- [x] PO Unboxing serial reuse (unbox scan Tracking/Order# modes, local-mirror-first)
- [x] Multi-tracking PO (`receiving_shipments` junction)
- [x] Handling-unit LPN (H-#### boxes, H1–H5 built + migration applied)
- [x] Incoming carrier-mismatch state (CARRIER_MISMATCH tile/icon/matrix col)
- [x] Unshipped + Pending merged into one mode (`?unshipped`, FilterRefinementBar)
- [x] Ship-confirm scan-out (`StationScanBar`, `shipping.mark_shipped` perm)
- [x] Order labels section + NAS drop-zone (`/api/order-labels`, WebDAV PUT/GET/list/DELETE)
- [x] Add tracking popover (prev/next worklist, recently-added, SKU/item# fill)
- [x] Bose parts sourcing engine (compatibility DB, EOL alerts, eBay sourcing, auto-replenish)
- [x] Receiving triage streamline (Bug1 + Bug2 shipped, Zoho-received reconcile)
- [x] Delivered-unscanned delete (IncomingDetailsPanel shipment-only mode)
- [x] Rail edit-mode bulk select (SidebarRailShell + SelectionActionBar)
- [x] Dashboard table bulk select (usePageSelection → ContextualSelectionBar)
- [x] BootGate sign-in animation + dashboard-queries factory
- [x] CollapsibleGroupRow primitive (PO/shipment expandable rows)
- [x] Station builder S1+S3-lite (registries, station_definitions, /api/stations, pilot live)
- [x] God component cleanup (StaffAccessDetail, UnfoundQueueDetailsPanel, FbaShipmentEditorForm, LineEditPanel)
- [x] Receiving carton type model (carton-default + line-override, effectiveReceivingType)
- [x] Receiving Viewed pill (Queue·Unboxed·Viewed rail, receiving_line_views)
- [x] Visual receiving identify — service built (DINOv2, vision/ + Vercel glue), UI pending
- [x] Unshipped tracking/label record Phases 0–4 (EventTimeline extracted, audit actions, AddTrackingPopover, OrderLabelsSection)
- [x] Detail-panel timelines shared across Shipped/Incoming/Tech
- [x] Operations Studio /studio page skeleton (semantic zoom, 5 lenses, StudioWorkspaceProvider)
- [x] Platform/account/type catalog — migration + CRUD API + hooks (read-side resolvers pending → Section 2)
- [x] SKU graph backend CRUD (`/api/sku-catalog/graph`, sku_relationships table — UI pending → Section 2)