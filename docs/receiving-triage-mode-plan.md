# Receiving — Triage/Scan mode + layout improvements

> **v2 redesign plan:** see [`receiving-triage-redesign-plan.md`](./receiving-triage-redesign-plan.md) for the current UX/data-model spec (polymorphic triage vs unbox split, Done tab, shelf+lane staging, unfound todo). This file retains the **v1 implementation history** below.

**Status:** Phases 1–4 BUILT (2026-06-06); Phase 5 entry-point left at default (bare→Unbox) · **Date:** 2026-06-06

> **Implemented:** mode registry reorder/relabel across all 4 sources + new `triage`
> id (Phase 1); triage shares scan-bar + rail (Phase 2); `TriageDetailsPanel`
> right pane wired into `ReceivingDashboard` (Phase 3); **live** expedited/normal
> via read-only `GET /api/receiving/pending-check` (Phase 4 — chose live-check over
> persisted column, so it never goes stale). tsc clean; 27 nav/mode unit tests pass.
> **Deferred:** L1 entry stays bare→Unbox (a `?mode=triage` href breaks the
> `getSidebarHref` invariant test); scan-auto-select into the triage pane; a
> triage-scoped rail data view (today's rail is the unboxing feed).
**Goal:** Add a **scanning/triage** surface as a first-class Receiving *mode* (before
unboxing), reorder + relabel the mode rail, and give it a new right-pane details panel.
Builds on the mobile `unbox_verdict` (expedited / normal / unfound) work in
`lookup-po` + `Receive.tsx` (see [[mobile-door-receive-feature]]).

---

## 1. Current architecture (as scanned)

### Page mount
- **Desktop:** `src/app/receiving/page.tsx` → `RouteShell` with
  `actions={<ReceivingSidebarPanel/>}` (left sidebar) + `history={<ReceivingDashboard/>}`
  (right/main pane). Both render on desktop; mobile picks one via RouteShell.
- **Mobile:** `src/app/m/receiving/page.tsx` → `RedesignedMobileReceivingLive`.

### The mode system lives in **four parallel registries** (must stay in sync)
| # | File | What it defines |
|---|---|---|
| 1 | `src/components/sidebar/receiving/receiving-sidebar-shared.ts` | `ReceivingMode` union + `RECEIVING_MODE_ITEMS` (the panel pills) |
| 2 | `src/lib/sidebar-navigation.ts` (~L324) | master-nav L2 rail `modes[]` + `resolveMode` |
| 3 | `src/lib/mobile-context-navigation.ts` (L43, L116) | mobile mode list + resolver |
| 4 | `src/lib/receiving/receiving-modes.ts` | `ReceivingTableMode` + descriptors (right-pane data layer) |

`ReceivingMode = 'receive' | 'incoming' | 'history' | 'pickup'`. The right-pane table
mode (`receive | history | incoming`) is a narrower union; `pickup` (and the new
`triage`) are handled upstream by a different pane, never by the lines table.

### Mode resolution is duplicated (absent `?mode=` → `'receive'`)
`ReceivingSidebarPanel:117`, `ReceivingDashboard:74/351/432`,
`ReceivingLinesTable:76`, `RecentActivityRailBase:66`, `sidebar-navigation.ts:336`,
`mobile-context-navigation.ts:118`, `receiving-modes.ts:50`. **8+ copies of the same
ternary** — an improvement opportunity (see §6).

### Right pane (`ReceivingDashboard.tsx`) per mode
- `isTableOnlyMode = history || incoming`.
- `pickup` → `LocalPickupEditPanel`.
- `incoming` → `ReceivingLinesTable` + `IncomingDetailsPanel` (420px slide-over).
- `history` → `ReceivingLinesTable` (+ `ReceivingDetailsStack` overlay on row click).
- `receive` (default) → `ReceivingLinesTable` (hidden via `display:none`) with
  `ReceivingLineWorkspace` overlay when a line is selected; else "Scan to start".

### Selection flow (sidebar → pane)
Row click in `RecentActivityRailBase` / `ReceivingLinesTable` dispatches the
`receiving-select-line` CustomEvent → panel sets `selectedLine` → panel dispatches
`receiving-workspace-open/close` → dashboard renders the workspace. Incoming/history
instead open their own overlays. **The right pane never reaches back into the sidebar.**

### Detail-panel patterns to model the new triage pane on
- **`IncomingDetailsPanel.tsx`** — 420px slide-over, `PaneHeaderTabs`, one consolidated
  fetch. Cleanest structural template.
- **`UnfoundQueueDetailsPanel.tsx` + `useUnfoundTriageDetail.ts`** — triage-flavored
  header/tabs/footer + React-Query-cache-merge pattern; closest in *intent*.

---

## 2. Target state

### New mode rail (left → right) with icons
| Pos | id | Label | Icon | Right pane |
|---|---|---|---|---|
| 1 | `incoming` | Incoming | `Inbox` | table + IncomingDetailsPanel |
| 2 | **`triage`** (new) | **Receiving** | `ClipboardList` | **`TriageDetailsPanel`** (new) |
| 3 | `receive` | **Unbox** (relabel) | `Box` | unboxing workspace (unchanged) |
| 4 | `history` | History | `List` | table + ReceivingDetailsStack |
| 5 | `pickup` | Local Pickup | `ShoppingCart` | LocalPickupEditPanel |

- The new **"Receiving" (triage)** mode is the scan/identify surface *before* unboxing.
  Icon = clipboard, per request.
- The current `receive` workspace is **relabeled "Unbox"** (icon `Box`). **Its id stays
  `receive`** — a UI-only label change, no string rename (see §3).
- `incoming` moves to position 1 and the panel pill adopts `Inbox` (the master-nav rail
  in `sidebar-navigation.ts` already uses `Inbox`; the panel currently uses `Package` —
  this also *fixes an existing inconsistency*).

### Decision: add `triage` (additive) — do NOT rename `receive`
Renaming `'receive' → 'unbox'` touches **18 hardcoded sites** (union, descriptors,
query keys `['receiving-lines-table','all','receive']`, 7 test assertions, 8 `?? 'receive'`
fallbacks, nav links) and **breaks every `?mode=receive` deep link + stalls cached
react-query entries**. Adding `triage` is purely additive. **Recommended: additive.**

---

## 3. Workstreams (phased, each independently shippable)

### Phase 1 — Mode registry: add `triage`, reorder, relabel (low risk, no behavior change)
1. `receiving-sidebar-shared.ts`
   - `ReceivingMode = 'incoming' | 'triage' | 'receive' | 'history' | 'pickup'`.
   - Reorder `RECEIVING_MODE_ITEMS`: Incoming(`Inbox`) · Receiving(`ClipboardList`,
     id `triage`) · Unbox(`Box`, id `receive`) · History(`List`) · Local Pickup(`ShoppingCart`).
   - Import `Inbox`, `Box` from `@/components/Icons` (both exist).
2. `sidebar-navigation.ts` receiving `modes[]` — mirror the same order/labels/icons; add
   a `triage` entry `to: () => ({ mode: 'triage' })`; relabel `receive`→"Unbox" + `Box`;
   extend `resolveMode` to map `m === 'triage'`.
3. `mobile-context-navigation.ts` — add `triage`, relabel, extend resolver.
4. Panel mode-resolver (`ReceivingSidebarPanel:117`) — add the `triage` branch.

### Phase 2 — Triage sidebar body (reuse scan bar + `ReceivingRecentRail`)
In `ReceivingSidebarPanel`, treat `triage` like `receive` for the **sidebar body**: it
shows the `StationScanBar` + `ReceivingRecentRail` (per request — "the current
ReceivingRecentRail should be displayed in the new mode receiving as well"). Concretely:
the pickup/incoming/history branches already early-return; `triage` simply falls through
to the existing scan-bar + rail branch alongside `receive`. The mode-flip effect
(`receiving-focus-scan` on entering `receive`) should also fire for `triage`.

> ⚠️ **Data-scope caveat:** `ReceivingRecentRail` fetches `view=activity` — the *unboxing*
> pipeline, which **excludes door-only scans and unfound cartons** (its own doc comment).
> Triage wants exactly those. Phase 2 reuses the rail as-is (visual parity, as asked);
> **Phase 4** adds a triage data view so unfound/just-scanned cartons actually appear.

### Phase 3 — Triage right pane: `TriageDetailsPanel` (new, placeholder → filled)
1. `ReceivingDashboard.tsx`: add `isTriageMode`; render `<TriageDetailsPanel/>` for it
   (sibling to the `pickup` branch — triage owns its pane, it is **not** table-only).
   Keep `isTableOnlyMode` = history|incoming unchanged.
2. New `src/components/receiving/triage/TriageDetailsPanel.tsx` modeled on
   `IncomingDetailsPanel` (header + `PaneHeaderTabs` + consolidated fetch). Tabs:
   **Identify** (verdict, PO#, scanned SKU, paired-platform SKU, pending hit, carrier),
   **Items** (PO lines), **Photos**. Selection arrives via `receiving-select-line`
   (already dispatched by the rail) — reuse, don't invent a new channel.
3. Placeholder first (empty-state + selected-carton header), then fill the Identify tab.

### Phase 4 — Verdict data for the triage list (backend)
The list needs per-carton **found/unfound** + **expedited/normal**:
- **Found/unfound** is already derivable: `receiving_source` (`'unmatched'` = unfound).
- **Expedited/normal** = the pending-order match, which today is computed *per scan* and
  **not persisted**. Two options:
  - **(a) Persist at scan time (recommended):** in `lookup-po`, write the computed
    `unbox_verdict` (or a `pending_match boolean` + matched SKUs) onto the receiving row
    / `receiving_scans`. The list then reads a column — O(1), no recompute.
  - **(b) Compute in a triage list endpoint:** batch `findPendingOrderSkuMatches` over the
    visible rows. Heavier; recompute on every list load.
- Add a `view=triage` (or reuse door-scan view) to `/api/receiving-lines` +
  a `receiving-modes.ts` descriptor so the rail/table can show door-scanned + unfound
  rows with a verdict dot (rose=expedited, amber=unfound, emerald=normal — mirror the
  mobile `ScanResultRow` states).

### Phase 5 — Entry point, deep-link, verify
- **Default landing decision (needs your call):** keep bare `/receiving` → `receive`
  (Unbox) for deep-link/realtime safety, and point the L1 "Receiving" nav item to
  `?mode=triage` so the scan/triage surface is the natural entry "before unboxing".
  Alternative: make `triage` the absolute default (touches the 8 `?? 'receive'`
  fallbacks + `showWorkspace`/`isTableOnlyMode` logic — higher blast radius).
- Verify per the sidebar-mode skill: deep-link `?mode=triage` loads directly; switching
  modes clears stale `q`/`filter`/`open`; refresh preserves mode; right pane stays visual.

---

## 4. Files to touch (summary)

| Phase | File | Change |
|---|---|---|
| 1 | `receiving-sidebar-shared.ts` | union + `RECEIVING_MODE_ITEMS` (order/label/icon) |
| 1 | `lib/sidebar-navigation.ts` | master-nav `modes[]` + `resolveMode` |
| 1 | `lib/mobile-context-navigation.ts` | mobile modes + resolver |
| 1 | `ReceivingSidebarPanel.tsx` | mode resolver branch for `triage` |
| 2 | `ReceivingSidebarPanel.tsx` | `triage` shares the scan-bar + rail branch; focus effect |
| 3 | `ReceivingDashboard.tsx` | `isTriageMode` → render `TriageDetailsPanel` |
| 3 | `receiving/triage/TriageDetailsPanel.tsx` | **new** right pane |
| 4 | `api/receiving/lookup-po/route.ts` | persist verdict on scan (option a) |
| 4 | `api/receiving-lines/route.ts` + `receiving-modes.ts` | `view=triage` + descriptor |
| 4 | new `TriageRecentRail.tsx` (or extend `ReceivingRecentRail`) | door-scan/unfound feed + verdict dot |

---

## 5. Open decisions (your call)
1. **Default landing** when `?mode=` is absent: keep `receive`/Unbox (safe) **[recommended]**
   vs make `triage` the default (more "scan-first", higher blast radius).
2. **Triage rail data:** reuse `ReceivingRecentRail` verbatim now and add a triage view in
   Phase 4 **[recommended]**, vs build the triage-scoped rail up front.
3. **Verdict persistence:** persist on scan (option a, recommended) vs recompute per load (b).

## 6. Adjacent improvements surfaced by the scan (optional, not required)
- **Centralize mode resolution.** Replace the 8 duplicated `?? 'receive'` ternaries with
  one `resolveReceivingMode(params)` exported from `receiving-sidebar-shared.ts`; the
  per-registry copies drift (e.g. icon mismatch for `incoming`).
- **Single mode source of truth.** The four registries (§1) duplicate order/label/icon.
  Consider deriving the master-nav + mobile lists from `RECEIVING_MODE_ITEMS` so a reorder
  is a one-file edit.

## 7. Risks
- Forgetting one of the four registries → rail and pills disagree (the existing
  `incoming` icon drift is evidence this already happens). Phase 1 fixes all four together.
- `ReceivingTableMode` is an exhaustive union switched in `receiving-modes.ts`; `triage`
  must NOT be added there (it's not a table mode) — it's handled in the dashboard pane
  switch like `pickup`. `tsc` will enforce exhaustiveness.
- Reusing the rail in Phase 2 shows the unboxing feed, not door-scans — acceptable
  interim, but call it out in UI copy until Phase 4 lands.
