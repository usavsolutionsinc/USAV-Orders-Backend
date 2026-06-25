# Reference timeline — the shared history→detail data-display pattern

> Inherits: ../ui-design-system.md (linear scaffold, one-row anatomy, eyebrow headers, chips, semantic-token color). This doc adds only what is timeline-specific.

The merged, read-only event trail that shows **what happened to a record, newest-first** — carrier events,
order/audit history, lifecycle `inventory_events`, tech verdicts, station scans, warranty/repair steps. It is a
**cross-cutting display pattern, not an archetype.** It lives **inside** a Workbench detail pane (an order/SKU/unit
inspector) or a Monitor page (the Operations history surface). It is never a page on its own and never the thing the
user navigates by.

> Rule of thumb: a timeline is a *fact display*, not an input. If the user is reading what already happened, it's this
> pattern. If they're picking/editing records, that's Workbench; if they're scanning, that's Station. The timeline rides
> along inside one of those.

This is the **master–detail "detail" half** ([master–detail interface](https://en.wikipedia.org/wiki/Master%E2%80%93detail_interface)):
the master picks a record, this renders that record's history. Treat it as a leaf component you drop in, not a surface
you design per feature.

---

## One primitive, no second timeline

- **`EventTimeline` (`src/components/ui/EventTimeline.tsx`) is the single timeline renderer.** It takes a flat
  `TimelineItem[]` and owns *everything visual*: the fading hairline rail, tone dots, day bands, the hover row, the
  staggered reveal, and the serial↔time toggle. It knows nothing about any domain.
- **`TimelineSection` (`src/components/ui/TimelineSection.tsx`) is the drop-in block** — eyebrow header + right slot +
  loading skeleton + empty message, wrapping `EventTimeline`. A panel adds a full history with one line:
  `<TimelineSection title="Activity" loading={isLoading} items={items} />`. **Use `TimelineSection`, not `EventTimeline`
  bare** — you get the header/skeleton/empty for free and stay consistent with every other panel.
- **Never build a second timeline component.** If a surface needs history, it adapts its rows into `TimelineItem[]` and
  hands them to `TimelineSection`. Forking a list with dots is the exact mistake this primitive exists to prevent.

> Rule of thumb: if you're writing markup with absolutely-positioned dots and a vertical line, stop — you're
> re-implementing `EventTimeline`. Write an adapter instead.

---

## Adapter pattern: domain row → `TimelineItem`

- **The single event schema is `TimelineItem` in `src/lib/timeline/types.ts`.** One generic, domain-agnostic row:
  `{ id, at, title, tone?, subtitle?, ref?, actor?, badges?, icon? }`. Every domain maps into this shape; the renderer
  never learns a domain.
- **Each spine has a pure `*ToTimeline` adapter under `src/lib/timeline/`** (exported from `src/lib/timeline/index.ts`):
  `carrierEventsToTimeline`, `orderAuditToTimeline`, `inventoryEventsToTimeline`, `techEventsToTimeline`,
  `stationActivityToTimeline`, `warrantyEventsToTimeline`. Each owns its own `type → { title, tone }` map (e.g.
  `ACTIVITY_MAP` in `station-activity-events.ts`) — the action→label/tone mapping lives in the adapter, **never inline in
  a view**.
- **The adapter picks the `tone` and the `ref` `kind`; the view stays dumb.** An adapter decides "this SAL row is a
  `tracking` scan, tone `info`"; the renderer just draws an `info` dot and a `tracking` chip. Mirrors the house SoT rule:
  format in lib, render dumb (../source-of-truth.md).

| Spine | Source | Adapter |
|---|---|---|
| Carrier events | tracking-poll events | `carrierEventsToTimeline` |
| Order / audit | `audit_logs` (order-anchored) | `orderAuditToTimeline` |
| Lifecycle | `inventory_events` (unit-anchored) | `inventoryEventsToTimeline` |
| Tech verdicts | TEST_* | `techEventsToTimeline` |
| Station activity | `station_activity_logs` (SAL) | `stationActivityToTimeline` |
| Warranty / repair | warranty events | `warrantyEventsToTimeline` |

---

## Merge + collapse happen at merge time, not in the renderer

- **Combine multiple spines, then sort newest-first before handing to `EventTimeline`.** The renderer day-groups in
  *array order* — it does not sort — so the merged list must already be ordered. `OrderTimelineSection`
  (`src/components/shipped/OrderTimelineSection.tsx`) is the reference: it spreads three adapters
  (`orderAuditToTimeline` + `inventoryEventsToTimeline` + `stationActivityToTimeline`) and `.sort()`s by `at` descending.
- **Collapse adjacent identical scans with `collapseTimeline` (`src/lib/timeline/collapse.ts`).** Tech re-scans of the
  same ref by the same actor stack into near-duplicate rows; `collapseTimeline` folds an *adjacent run* of equal
  `(title + ref + actor + tone)` into one row, keeps the newest timestamp, and annotates `"N× · earliest …"` in the
  subtitle so nothing is dropped. **Only adjacent equals merge** — a scan that brackets a different event stays distinct.
- **Do the merge/collapse in the section component, never inside `EventTimeline`.** The primitive renders a list; it must
  not know there were three sources. Keep the spine-combining logic in the `*TimelineSection` wrapper.

---

## Tone registry is the SoT for timeline color

- **`TimelineTone` (`'default' | 'info' | 'success' | 'warning' | 'danger' | 'muted'`) is the only color vocabulary.**
  `EventTimeline.tsx` owns the three tone→class maps: `DOT_TONE` (the dot fill), `DOT_HALO` (the soft static halo behind
  the latest dot), and `BADGE_TONE` (badge pills). Adapters choose a *tone*, never a class string.
- **No surface invents its own dot colors.** If a new tone is genuinely needed, extend the registry in `EventTimeline.tsx`
  — do not pass a Tailwind class through. This is the same single-source-of-truth discipline as the lifecycle dot models
  (../source-of-truth.md): color flows from one map.
- **The dot is the only color in a row** (per ../ui-design-system.md). Title/time/actor/subtitle are gray; tone shows up
  exclusively in the dot, its halo, and badge pills.

---

## Serial↔time grouping is pure presentation over the same data

- **`groupMode` toggles the same items between two views — no second fetch, no second component.** `'time'` (default)
  renders chronological **day bands** (`groupByDay`, header `"EEE, MMM d"`). `'serial'` re-buckets the *same*
  `TimelineItem[]` into one band per identifier via `groupBySerial`.
- **Serial mode re-enters `EventTimeline` per bucket with `groupByDay={false}`.** Each identifier band renders its own
  rows in time order through the *same* renderer — the serial view literally *is* the time view, re-bucketed. The
  serial↔order toggle works because every adapter already attaches a per-row `TimelineRef`; it's a presentation switch,
  not a data switch.
- **Ref-less rows land under a trailing "Order events" band** (`groupBySerial` sorts the no-ref bucket last) so nothing
  vanishes in serial mode. `OrderTimelineSection` only shows the toggle when `items.some(it => it.ref)` — otherwise it
  would just relabel a flat list.

---

## Density and chips

- **Two density modes change padding and dot position only — never font size.** `comfortable` (panels, default) vs
  `compact` (sidebars/tight panels) adjust `pb`/day-margin/`dotTop` in the `DENSITY` map. Type scale is constant across
  densities; readability never degrades. (`AuditTimeline` mirrors this with its own `compact` prop.)
- **`TimelineRef` identifiers render through the shared CopyChip family — never re-implement chip display.**
  `EventTimeline`'s `TimelineRefChip` dispatches by `kind` to `TrackingChip` / `SerialChip` / `FnskuChip` /
  `SkuScanRefChip` / `OrderIdChip` (`src/components/ui/CopyChip.tsx`), and uses `getLast4` for the preview. A
  tracking/serial in the timeline looks and copies exactly like the same id everywhere else. **Never re-derive last-4 or
  hand-roll a chip** — that's the copy-chip SoT (../source-of-truth.md → copy-chip/serial display).

---

## The deliberate exception: `AuditTimeline`

- **`AuditTimeline` (`src/components/audit/AuditTimeline.tsx`) is NOT `EventTimeline` — and that's intentional.** It is a
  separate per-entity (bin/SKU) history that merges **three** sources — `audit_log` + `inventory_event` +
  `sku_stock_ledger` — and needs to render a structured **before/after diff** (`diffSummary`) per row plus a per-source
  badge (`EDIT` / `LIFECYCLE` / `LEDGER`). It is a bordered, divided adjacency list, not the fading-rail trail.
- **Do not force it onto the primitive.** Its row shape (diff keys, ledger deltas, source provenance) doesn't fit
  `TimelineItem`'s single-line model. **Match the existing instance** if you extend bin/SKU audit; **everything else uses
  `EventTimeline`.** When in doubt, the default is the primitive — `AuditTimeline` is the one sanctioned fork, not a
  pattern to copy.

> Rule of thumb: one merged single-line history → `EventTimeline`. A 3-source before/after audit ledger → extend
> `AuditTimeline`. There is exactly one exception; don't grow a second.

---

## Motion

- **Reveal only — never a layout animation.** `EventTimeline` staggers rows in on mount: a `container`/`row` variant pair
  with `opacity + y:3 → 0`, eased by `motionBezier.easeOut` (`[0.22,1,0.36,1]`, from
  `src/design-system/foundations/motion-framer.ts`). The rail/dots/day-bands never animate their size.
- **`prefers-reduced-motion` is honored automatically.** `useReducedMotion()` collapses the stagger to `0` and drops the
  `y` offset to a pure opacity fade — per ../ui-design-system.md and
  [Material — applying transitions](https://m3.material.io/styles/motion/transitions/applying-transitions). Don't add
  motion that ignores the reduced-motion branch.
- **The timeline does not own the crossfade.** When this lives in a Workbench detail pane, the *right pane* crossfades on
  selection change (see ../contextual-display.md → Workbench / ./motion-crossfade.md); the timeline just re-renders with
  new items. Never crossfade the list of rows itself.

---

## Empty / error / loading

- **Loading → `TimelineSection`'s skeleton.** Pass `loading` and you get a rail-shaped pulse placeholder; don't render a
  bare spinner over a timeline.
- **Empty → a quiet teaching line, not a crash.** `EventTimeline` renders `emptyMessage` (`"No events yet."`) centered;
  `TimelineSection` defaults to `"No activity recorded yet."`. Override with a record-specific line.
- **Degrade, don't hard-fail.** A timeline is a *sub-resource* of a detail pane. A failed history fetch must render empty
  (or `AuditTimeline`'s inline error box), **never 500 the whole record** — mirror the per-fetch `try/catch` discipline
  in ../contextual-display.md (Workbench: degrade-not-fail). `OrderTimelineSection` throws inside its query; the section
  shows empty rather than taking down the panel.

---

## Reference modules

- `src/components/ui/EventTimeline.tsx` — the primitive (rail, tone maps, density, serial↔time grouping).
- `src/components/ui/TimelineSection.tsx` — drop-in block: header + skeleton + empty + `EventTimeline`.
- `src/lib/timeline/types.ts` — `TimelineItem` / `TimelineTone` / `TimelineRef` schema (the SoT shape).
- `src/lib/timeline/` — adapters (`*ToTimeline`) + `collapseTimeline`; exported via `index.ts`.
- `src/components/shipped/OrderTimelineSection.tsx` — reference merge: three spines → sort → collapse → section, with the serial↔order toggle.
- `src/components/audit/AuditTimeline.tsx` — the one deliberate exception (3-source bin/SKU diff ledger).

---

## Do / Don't

| Do | Don't |
|---|---|
| Adapt domain rows into `TimelineItem[]` via a `*ToTimeline` fn | Hand-roll dots + a vertical line in a panel |
| Render through `TimelineSection` (header/skeleton/empty included) | Use `EventTimeline` bare and re-build the header |
| Merge spines + `collapseTimeline` + sort in the section wrapper | Sort/merge/collapse inside `EventTimeline` |
| Pick a `TimelineTone`; let the registry map the class | Pass a Tailwind color class or invent a hex dot |
| Render ids through the CopyChip family (`TimelineRefChip`) | Re-derive last-4 or hand-build a chip |
| Use `density` for sidebars; keep the same font scale | Shrink the type to fit a tight panel |
| Use `EventTimeline` for any merged single-line history | Fork a new timeline component "just for this view" |
| Extend `AuditTimeline` only for the 3-source diff ledger | Force the before/after audit onto `TimelineItem` |
| Let a failed history fetch render empty | Let a sub-resource fetch 500 the whole record |

---

Indexed by ../contextual-display.md
