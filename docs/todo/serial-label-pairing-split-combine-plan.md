# Serial ↔ Label Pairing, Split/Combine & Multi-Serial Acknowledgement — Plan

**Goal:** Give operators industry-standard control over **which serial is on which label**,
**how units are grouped for preboxed printing**, and **how multi-serial / multi-line
context is acknowledged** in receiving and testing — without forking the existing
`serial_units` aggregate or duplicating verdict data on `receiving_lines`.

**Status:** PLAN (not yet built). **Date:** 2026-07-06.

**Related (already shipped / in flight):**
- `docs/partial/handling-unit-lpn-plan.md` — LPN combine/split at the **physical box** layer (DONE)
- `context/inventory_system_upgrade_plan.md` — GS1 Digital Link + per-unit state machine
- `docs/todo/packing-checklist-plan.md` — pack-time BOM acknowledgement (orthogonal; ships at pack)
- `docs/todo/polymorphic-tables-database-refactor-plan.md` — line vs unit grain for testing facts
- `docs/todo/testing-priority-needs-test-plan.md` — queue priority vs needs-test (orthogonal axis)

---

## 1. Executive summary — three layers, one rule

Industry WMS/QMS systems never conflate **unit identity**, **printed label**, and **physical
grouping**. Cycle Forge already has the first and third; the gap is an auditable **label
manifest** layer and richer **acknowledgement UI** across receiving + testing.

| Layer | Industry term | Cycle Forge today | Gap |
|-------|---------------|-------------------|-----|
| **Unit** | Serialized item / instance | `serial_units` — `normalized_serial`, `unit_uid`, `current_status` | Solid aggregate root |
| **Label** | Unit label, kit label, reprint | `post-multi-sn` mints 1 UID per serial; `printProductLabel(s)` client-side | No per-print ledger; no multi-serial **one-label** manifest |
| **Receipt line** | PO line / inbound line | `receiving_lines` + `receiveLineUnits()` | Serial chips per line; supplemental over-cap handled |
| **Container** | LPN / license plate | `handling_units` + `H-{id}` | Mobile `/m/h/[id]` exists; desktop testing lacks box panel |
| **Allocation** | Order pairing | `order_unit_allocations` + `/api/serial-units/[id]/allocate` | Pack/ship path; not wired into prebox print |

**Hard rule (non-negotiable):** one manufacturer serial → one `serial_units` row → one
canonical `unit_uid` (mint once, reprint forever). Split/combine changes **membership**
(box, manifest, allocation), never re-mints identity.

---

## 2. What already exists (~70% substrate)

### 2.1 Identity & receive pipeline

| Need | Exists | File / route |
|------|--------|--------------|
| Per-unit aggregate | `serial_units` + `upsertSerialUnit()` | `src/lib/drizzle/schema.ts` (~2483), `src/lib/neon/serial-units-queries.ts` |
| Receive writer (serial + ledger + events) | `receiveLineUnits()` | `src/lib/receiving/receive-line.ts` |
| Supplemental over-cap serials (honest chips, capped qty) | `supplemental: true` result | same |
| Serial attach / replace on a line | `attachSerialToLine()` | `src/lib/receiving/serial-attach.ts` |
| Provenance spine (additive, reader migration pending) | `serial_unit_provenance` | `schema.ts` (~2538); comment: *"nothing reads this yet"* |
| State transitions | `transition()` only | `src/lib/inventory/state-machine.ts` |

### 2.2 Label print & pairing

| Need | Exists | File / route |
|------|--------|--------------|
| Multi-serial label issue (N serials → N labels) | `POST /api/post-multi-sn` | `src/app/api/post-multi-sn/route.ts` |
| Client print orchestration | `useMultiSkuBarcode` → `printProductLabels()` | `src/components/barcode/multi-sku/useMultiSkuBarcode.ts` |
| Unit UID mint `{SKU}-{YYWW}-{SEQ6}` | `allocateNextUnitId` / upsert at birth | `unit-label-api.ts`, `post-multi-sn` |
| Reprint = same UID | `resolveReprintUnit()` | `useMultiSkuBarcode.ts` (~123) |
| Batch audit (who printed what SKU) | `station_activity_logs` per batch | `post-multi-sn` comment block |
| Per-unit LABELED event | `recordInventoryEvent()` | `post-multi-sn` |
| Bulk print from history selection | `useReceivingLineBulkSelection` → `printProductLabels` | `src/hooks/useReceivingLineBulkSelection.tsx` (~79) |

### 2.3 Physical combine/split (LPN)

| Need | Exists | File / route |
|------|--------|--------------|
| Box CRUD + assign/unassign | `/api/handling-units/*` | `src/lib/schemas/handling-unit.ts` |
| `H-{id}` scan → multi line picker | `resolveTestingScan` `lpn` branch | `src/lib/testing/resolve-testing-scan.ts` |
| Mobile box page `k/n tested` | `/m/h/[id]` | `src/app/m/(shell)/h/[id]/page.tsx` |
| LPN chip (teal / Package) | `HandlingUnitChip` | `src/components/receiving/HandlingUnitChip.tsx` |
| Mint box from carton workspace | `CartonAddPopover` → `BoxTab` | `PoLinesAccordion.tsx` (~698), `carton-add/BoxTab.tsx` |
| LPN label print | `printHandlingUnitLabel()` | `src/lib/print/printHandlingUnitLabel.ts` |

### 2.4 UI acknowledgement primitives

| Need | Exists | File |
|------|--------|------|
| Identifier icon semantics (SoT) | `CHIP_TONES` — Hash=PO/id, Pencil=SKU, Barcode=serial, Package=LPN | `src/components/ui/CopyChip.tsx` (~80) |
| Serial chips on a line | `SerialCard`, `SerialChip`, `SerialChipWithMenu` | `src/components/receiving/workspace/SerialCard.tsx` |
| Per-line accordion + serial header chips | `PoLinesAccordion` | `src/components/receiving/workspace/PoLinesAccordion.tsx` |
| Testing scan bar + armed modes | `TestingScanBar`, `classifyTestingScan` | `src/components/sidebar/receiving/TestingScanBar.tsx` |
| Post-scan ack strip | `lastAck` + `viaAckMeta` | `src/components/sidebar/TestingSidebarPanel.tsx` |
| Multi-match picker (minimal) | Amber strip, line title + qty only | same (~210–238) |
| Bulk selection + print | `SelectionAction` + `ContextualSelectionBar` | `src/lib/selection/selection-actions.tsx`, `ContextualSelectionBar.tsx` |

---

## 3. Real codebase gaps (grounded issues)

These are the concrete problems this plan closes — not hypothetical.

### 3.1 Label pairing is not audit-grade per unit

- `post-multi-sn` logs **one** `station_activity_logs` row per **batch**, not per
  `(serial_unit_id, unit_uid, qr_payload, printer_profile_id)`.
- **Risk:** cannot answer "which exact DataMatrix was on the sticker for serial X?" or
  prove reprint vs first issue in disputes.
- **Industry:** print job ledger (Manhattan `LABEL_HISTORY`, ShipHero print events).

### 3.2 Bulk/history print skips canonical UID

`useReceivingLineBulkSelection.handlePrintLabels` calls `printProductLabels({ sku, serialNumbers })`
without resolving `unit_uid` from `serial_units` first.

- **Risk:** reprints from history may encode bare serial or SKU instead of the minted UID;
  scans at testing won't match pre-pack state.
- **Fix:** resolve units server-side (or via `/api/serial-units/resolve-batch`) before ZPL.

### 3.3 No "one label, many serials" (preboxed kit manifest)

`useMultiSkuBarcode.handleFinalAction` in `print` mode always does:

```ts
printProductLabels({ serialNumbers, qrPayloads: serialNumbers.map(...) })
```

— **N stickers for N serials**. There is no parent manifest UID for shrink-wrapped kits.

- **Industry:** kit/master label + child unit labels, or SSCC logistic label with ASN manifest.

### 3.4 Testing multi-picker hides serial + box context

`TestingSidebarPanel` picker rows show only `item_name` and `qty_received/qty_expected` —
no `SerialChip` preview, no `HandlingUnitChip`, no `unit_uid`.

- **Operator pain:** "Found via serial" but picker doesn't show **which** serial matched on
  which line when PO has duplicate SKUs.

### 3.5 LPN split/combine is mobile-first, not workbench-complete

- `/m/h/[id]` supports add/remove units — **desktop testing sidebar has no equivalent box panel**.
- `PoLinesAccordion` can mint a box for the carton but **no multi-select serial chips → "Move to box H-…"**
  on desktop (only implicit via `BoxTab` all-units path).
- **Industry:** desktop workbench shows container membership inline with line attribution.

### 3.6 `SerialChipWithMenu` is hover-only, not overflow-menu standard

Current pattern: hover-reveal dropdown under chip (`SerialCard.tsx` ~431–486), not
`MoreVertical` trigger.

- **Issues:** touch devices, keyboard/a11y, crowded rows — industry uses explicit `⋯` overflow.
- **House direction:** `StickyActionBar` already documents split CTA + chevron `menu[]`;
  `MobileToolbar` caps at 2 actions → `...` overflow.

### 3.7 Provenance not surfaced in UI

`serial_unit_provenance` exists but schema says readers still use legacy origin columns.

- **Risk:** split unit across lines/boxes can't show "came from line A, now in box H-17"
  without joining provenance + `handling_unit_id`.

### 3.8 Grain confusion (don't duplicate in this project)

`polymorphic-tables-database-refactor-plan.md` §9 flags testing facts overlapping
`serial_units` / `testing_results`.

- **Rule for this plan:** line-level routing (`needs_test`, priority) stays on
  `receiving_lines` / carton; **per-unit verdict** stays on `serial_units` / test APIs.
  Label/manifest tables reference `serial_unit_id` only.

### 3.9 Dual serial audit paths (integration debt)

`tech_serial_numbers` still written alongside `serial_units` in receive + print paths.

- Not blocking this plan, but label ledger should FK `serial_unit_id`, not TSN id.

---

## 4. Industry-standard operations matrix

Map operator verbs to the correct layer — implement each once.

| Operator intent | Industry verb | Data mutation | Label output | UI surface |
|-----------------|---------------|---------------|--------------|------------|
| Scan serial onto PO line | Receive / identify | `receiveLineUnits` + `upsertSerialUnit` | Optional unit label | `SerialCard` |
| Print sticker for one unit | Issue unit label | `post-multi-sn` + mint `unit_uid` | 1× product label | Products / MultiSku workspace |
| Print N stickers for N units | Batch issue | same, loop | N× product labels | `useMultiSkuBarcode` print mode |
| Shrink-wrap kit, one master sticker | Aggregate / kit | **NEW** `label_manifest` + items | 1× manifest label (+ optional child labels) | Prebox wizard |
| Put units in test tray | LPN assign | `handling_units.assign` | `H-{id}` label | `BoxTab`, bulk `Move to box` |
| Remove unit from tray | LPN unassign | `handling_units.unassign` | — | `⋯` on unit row |
| Split kit back to singles | Disaggregate manifest | manifest item DELETE + reprint unit labels | N× unit labels | Manifest detail `⋯` |
| Reprint same sticker | Reprint | print job row, **same** `unit_uid` | 1× copy | Reprint mode / chip `⋯` |
| Test: acknowledge which unit | Verify / test | test API on `serial_unit_id` | — | Testing panel + ack strip |

**Never:** re-mint `unit_uid` on split; **never** raw `UPDATE serial_units.current_status`.

---

## 5. Target data model (additive)

### 5.1 `label_print_jobs` — per-issue audit (Phase 2)

Immutable ledger row per physical print (unit or manifest).

```sql
CREATE TABLE label_print_jobs (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL,
  job_type        text NOT NULL,  -- 'UNIT' | 'MANIFEST' | 'HANDLING_UNIT' | 'REPRINT'
  serial_unit_id  integer REFERENCES serial_units(id) ON DELETE SET NULL,
  manifest_id     bigint REFERENCES label_manifests(id) ON DELETE SET NULL,
  handling_unit_id bigint REFERENCES handling_units(id) ON DELETE SET NULL,
  unit_uid        text,           -- snapshot at print time
  qr_payload      text NOT NULL,
  symbology       text NOT NULL DEFAULT 'datamatrix',
  template_id     text,           -- 'product' | 'prebox_master' | 'lpn'
  printer_profile_id integer,
  copies          smallint NOT NULL DEFAULT 1,
  is_reprint      boolean NOT NULL DEFAULT false,
  reprint_of_id   bigint REFERENCES label_print_jobs(id),
  actor_staff_id  integer,
  client_event_id text,           -- idempotency
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_label_print_jobs_idempotency
  ON label_print_jobs (organization_id, client_event_id)
  WHERE client_event_id IS NOT NULL;
```

**Writer:** extend `post-multi-sn` (and future manifest route) inside the same transaction
as `upsertSerialUnit`. **Readers:** "Recently printed", unit history timeline, reprint dialog.

### 5.2 `label_manifests` + `label_manifest_items` — preboxed combine (Phase 3)

```sql
CREATE TABLE label_manifests (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL,
  manifest_uid    text NOT NULL,  -- KIT-{sku}-{seq} or org-scoped ULID
  manifest_type   text NOT NULL,  -- 'PREBOX' | 'KIT' | 'MASTER_CARTON'
  sku             text,
  sku_catalog_id  integer,
  condition_grade text,
  status          text NOT NULL DEFAULT 'OPEN', -- OPEN | SEALED | DISSOLVED
  notes           text,
  created_by      integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sealed_at       timestamptz
);

CREATE TABLE label_manifest_items (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL,
  manifest_id     bigint NOT NULL REFERENCES label_manifests(id) ON DELETE CASCADE,
  serial_unit_id  integer NOT NULL REFERENCES serial_units(id),
  ordinal         smallint NOT NULL DEFAULT 0,
  added_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, manifest_id, serial_unit_id)
);
```

- **Combine:** create manifest, insert items, `status=SEALED`, print one master QR → `manifest_uid`.
- **Split:** set manifest `DISSOLVED`, remove items, optional unit label reprint per child.
- **Scan:** new `routeScan` class `manifest` → detail page listing children with line attribution.

### 5.3 No change to `serial_units` grain

- `handling_unit_id` — physical box membership (current).
- `label_manifest_items` — logical kit membership (new, optional).
- A unit may be in **both** an open manifest and an LPN; UI shows both chips.

---

## 6. UI / UX spec — design system grounded

**Archetype:** receiving + testing surfaces are **Workbench** regions (see
`.claude/rules/contextual-display.md`) — list → select → detail → update. Label
workflows that need preview + print are **Station** sub-regions (scan → crossfade → display).

### 6.1 Chip vocabulary (reuse `CHIP_TONES` — do not invent colors)

| Concept | Chip / icon | Token |
|---------|-------------|-------|
| PO# / order ref | `Hash` | `id` tone |
| SKU | `Pencil` | `sku` tone (yellow) |
| Serial | `SerialChip` / `Barcode` | `serial` tone (emerald) |
| Unit UID | `Hash` or dedicated mono chip | `id` tone |
| LPN / box | `HandlingUnitChip` | teal / `Package` |
| Manifest / kit | **NEW** `ManifestChip` | violet / `Package` variant |
| Test status | dot + `HoverTooltip` | `workflowStageDot` |

### 6.2 Row anatomy (one row, left → right)

Per `.claude/rules/ui-design-system.md`:

```
[selection] Title · meta eyebrow · [serial chips…] · [H-17 chip] · [⋯]
```

- Selection: `bg-blue-50 ring-1 ring-inset ring-blue-400` only — no height shift.
- Truncate title; chips scroll horizontally in a `min-w-0` region if needed.

### 6.3 Overflow `⋯` menu — when to use

**Standard:** structural actions beyond 2 visible icons go behind `MoreVertical` (`src/components/icons/actions.tsx`),
not hover-only menus.

| Surface | Visible actions (max 2) | Overflow `⋯` items |
|---------|-------------------------|-------------------|
| Serial chip row | Copy (chip tap), Condition pill | Edit serial, Delete, Print unit label, Move to box…, View history |
| Line header (PO accordion) | Receive CTA, Print | Print all serials, Select serials, Create manifest… |
| Handling unit row | Open box, Print LPN | Add units, Remove selected, Close box |
| Manifest row | Print master, Seal | Add unit, Remove unit, Dissolve, Print all children |
| Testing picker row | Open line | Preview serials (expand), Copy PO#, Jump to box |
| Bulk selection bar | Primary = Copy (`SelectionAction.primary`) | Print labels, Move to box, Create manifest — via `ContextualSelectionBar` icon capsule |

**Implementation notes:**
- Desktop serial row: evolve `SerialChipWithMenu` → `SerialChip` + `IconButton` `MoreVertical`
  opening a portaled menu (`HoverTooltip` for labels, not `title=`).
- Sticky footers: `StickyActionBar` `primary.menu[]` for split-button overflow (already in DS).
- Mobile: follow `MobileToolbar` — max 2 trailing icons, rest in `...` sheet.

### 6.4 Receiving — multi-serial acknowledgement panels

#### A. Line workspace (`SerialCard` / `PoLinesAccordion`)

**Already good:** scan → chip list, comma-paste sequential submit (FOR UPDATE safe).

**Add:**
1. **Unit row** under each saved serial (collapsed by default): `unit_uid` mono chip,
   last print time (from `label_print_jobs`), LPN chip if assigned.
2. **Line progress** eyebrow: `2/2 serials · 2 labeled · Box H-17` in meta slot.
3. **Select mode** on serial chips (reuse `useTableSelection` scope
   `receiving-line-{id}-serials`) → `ContextualSelectionBar` with Move to box / Print / Remove.

#### B. Carton rollup card (new subsection in right pane)

Linear `space-y-2` block above PO lines:

```
UNITS ON THIS CARTON                    [⋯]
R-4821 · PO-1234
├ Line: Sony Soundbar     2/2  ●● SN…21 SN…33
├ Line: Remote            1/1  ●  SN…02
└ Box H-17 · 3 units      [Open box]
```

- Tap serial chip → select line in accordion.
- Tap `H-17` → open box detail (desktop drawer, reuse `/m/h` data shape).

#### C. Prebox print entry

From line or bulk selection overflow: **"Create prebox label…"** → short wizard:
1. Confirm serial checklist (multi-select pre-filled)
2. Choose template: *One label per unit* vs *One master label for kit*
3. Print + write `label_print_jobs` (+ manifest if master)

### 6.5 Testing — multi-serial / multi-line acknowledgement

#### A. Upgrade multi-picker (`TestingSidebarPanel`)

Replace minimal amber buttons with **workbench rows**:

```
Pick a unit — 3 serial matches
┌─────────────────────────────────────────────────────────┐
│ Sony Soundbar · 2/2 received          [MapPin] TRK…4821 │
│ ● SN…4821  ● SN…9033          Box H-17 · 2 units    [⋯] │
└─────────────────────────────────────────────────────────┘
```

- `viaAckMeta` chip on each row matching `lastAck` tone (already wired for post-scan strip).
- Row `⋯`: Open line, Copy serial, Print unit label, Remove from box (if permitted).

#### B. Enriched `lastAck` strip

After successful scan, show **full context** (not just via + value):

```
[Serial] SN…4821  →  Sony Soundbar · line 2/2 · Box H-17 · UID 00098-2621-000142
```

#### C. Desktop box panel (parity with `/m/h/[id]`)

When `resolveTestingScan` returns via `lpn`, open **BoxWorkbenchPanel** in right pane:
- `k/n tested` chip (`handlingUnitStatusChipClass`)
- Unit list: serial chip + line title + status dot + `⋯`
- Scan-in add serial to box (assign API)
- Reuse `TestingRecentRail` selection sync

#### D. SKU pre-pack scan

Already resolves line + prefills serials (`testing-sku-prepack-scan.spec.ts`). **Add:**
read-only serial chip strip in testing detail with "labeled?" indicator from `unit_uid` presence.

### 6.6 Print flows — exact pairing UX

| Step | Operator sees | System does |
|------|---------------|-------------|
| First issue | Preview DataMatrix = next `unit_uid` peek | `post-multi-sn` mints per serial |
| Reprint | Banner: "Reprint — same UID" | `is_reprint=true` job row |
| Bulk history print | Toast: "Resolving 4 unit IDs…" | batch resolve before ZPL |
| Manifest seal | Master QR + child list | manifest `SEALED`, print job `MANIFEST` |

---

## 7. API sketch (follow `new-route` skill norms)

All routes: `withAuth` → Zod → domain helper → `recordAudit` → `client_event_id` idempotency.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/label-print-jobs` | Record client-side print (bridge until spooler) |
| GET | `/api/serial-units/resolve-batch` | `{ serials[] }` → `{ units: [{ id, serial, unit_uid }] }` |
| POST | `/api/label-manifests` | Create OPEN manifest |
| POST | `/api/label-manifests/[id]/items` | Add units (combine) |
| DELETE | `/api/label-manifests/[id]/items/[serialUnitId]` | Remove unit (split) |
| POST | `/api/label-manifests/[id]/seal` | Seal + return `manifest_uid` for print |
| POST | `/api/label-manifests/[id]/dissolve` | Split kit |
| GET | `/api/label-manifests/[id]` | Detail + items + line attribution join |

**Permissions (add to registry):**
- `label.print` — issue/reprint unit labels
- `label.manifest.manage` — create/seal/dissolve manifests
- Existing `handling_unit.manage` — box assign/unassign

---

## 8. Phased rollout

### Phase 0 — UI-only acknowledgement (no migration) — **1 week**

**Goal:** Operators see serial + line + box together; no new tables.

- [ ] Enrich `TestingSidebarPanel` picker rows (serials, LPN, tracking meta)
- [ ] Extend `lastAck` strip with line name + `unit_uid` when known
- [ ] Carton rollup card in receiving right pane (read-only, from existing `include=serials`)
- [ ] Fix bulk print: resolve `unit_uid` before `printProductLabels` in `useReceivingLineBulkSelection`
- [ ] E2E: extend `testing-sku-prepack-scan.spec.ts` to assert serial chips in picker

**Exit:** picker shows ≥1 serial chip per row when `row.serials` loaded; bulk print encodes UID when present.

### Phase 1 — LPN split/combine on desktop — **1 week**

**Goal:** Parity with `/m/h/[id]` in workbench.

- [ ] `BoxWorkbenchPanel` component (desktop drawer / right-pane crossfade)
- [ ] Serial chip select mode + `Move to box` / `Remove from box` via handling-unit APIs
- [ ] Wire `H-` scan in testing to open box panel (not only multi-picker list)
- [ ] Audit: ensure `HANDLING_UNIT_ASSIGN/UNASSIGN` emitted (already in registry)

**Exit:** operator can re-sort units across lines into `H-` without mobile.

### Phase 2 — `label_print_jobs` ledger — **1 week**

**Goal:** Audit-grade serial ↔ label pairing.

- [ ] Migration + Drizzle types
- [ ] Extend `post-multi-sn` to insert per-unit job rows in txn
- [ ] `GET /api/serial-units/[id]/print-history`
- [ ] Serial chip `⋯` → "Print history" sub-panel (last 3 jobs)
- [ ] Reprint path sets `is_reprint=true`, `reprint_of_id`

**Exit:** for any `serial_unit_id`, query returns ordered print jobs with identical `unit_uid` on reprints.

### Phase 3 — Label manifests (preboxed combine/split) — **2 weeks**

**Goal:** One master label for N serials; explicit dissolve.

- [ ] Migrations `label_manifests` + `label_manifest_items`
- [ ] CRUD routes + seal/dissolve
- [ ] `ManifestChip` + scan route class
- [ ] Prebox wizard from receiving overflow menu
- [ ] Print template `prebox_master` (QR → manifest UID)

**Exit:** seal manifest with 3 serials → one print job + master scan lists 3 units with line attribution.

### Phase 4 — GS1 + logistic labels (optional) — **later**

Align with `inventory_system_upgrade_plan.md` Phase 1:
- Product: `(01)GTIN(21)serial` when `sku_catalog.gtin` present
- Carton: SSCC `(00)` for outbound — separate from prebox manifest

---

## 9. Cross-cutting constraints

- **Tenant scope:** all new tables `organization_id` + `withTenantTransaction`; no manual `WHERE org_id`.
- **Status changes:** `transition()` only on `serial_units.current_status`.
- **Audit:** `recordAudit()` with new `AUDIT_ACTION` constants — never ad-hoc strings.
- **Idempotency:** `client_event_id` on every mutation touching inventory or print ledger.
- **Icons:** import from `@/components/Icons`; colors from `semantic.ts` / `CHIP_TONES`.
- **Do not** add per-serial verdict columns to `receiving_lines` (see polymorphic plan §9).

---

## 10. Open questions

1. **Manifest UID format** — `KIT-{sku}-{seq}` (human) vs ULID (collision-safe)? Leaning: same `{SKU}-{YYWW}-{SEQ6}` allocator family with prefix `KIT-`.
2. **Can a unit belong to multiple OPEN manifests?** Industry: no — enforce one OPEN manifest per unit via partial unique index.
3. **Print spooler** — keep browser ZPL for now or route through `/api/labels/print`? Phase 2 can log jobs client-side; Phase 4 moves spooler server-side.
4. **Desktop `/h/[id]` route** — mirror mobile page at `/warehouse/boxes/[id]` or only drawer? Leaning: drawer from workbench, mobile keeps `/m/h`.
5. **Provenance reader cutover** — when to show `serial_unit_provenance` in UI vs `origin_receiving_line_id`? Coordinate with polymorphic refactor; don't block Phase 0.

---

## 11. Verification & success criteria

- [ ] `tsc --noEmit` + receiving/testing e2e green after each phase
- [ ] Reprinting a label never changes `unit_uid` (automated test on `post-multi-sn`)
- [ ] Bulk print from history uses `unit_uid` when unit exists (unit test on hook)
- [ ] Assign/unassign emits audit + updates `handling_unit_id` atomically
- [ ] Manifest seal is idempotent under retry (`client_event_id`)
- [ ] Testing picker displays serial chips when `include=serials` on resolving fetch
- [ ] Permission registry + `route-permission-manifest.test.ts` updated for new routes
- [ ] No new hardcoded hex; overflow menus use `MoreVertical` + portal pattern

---

## 12. File touch list (by phase)

| Phase | Primary files |
|-------|----------------|
| 0 | `TestingSidebarPanel.tsx`, `useReceivingLineBulkSelection.tsx`, new `CartonUnitsRollup.tsx`, `ReceivingRightPane.tsx` |
| 1 | new `BoxWorkbenchPanel.tsx`, `SerialCard.tsx` (overflow refactor), `resolve-testing-scan.ts` consumers |
| 2 | `post-multi-sn/route.ts`, migration, `serial-units/[id]/print-history/route.ts`, `CopyChip` menu wiring |
| 3 | new `lib/labels/manifest.ts`, API routes, `barcode-routing.ts`, `useMultiSkuBarcode.ts` (manifest mode), print template |

---

*Changelog: 2026-07-06 — initial plan from serial/label pairing discovery session.*
