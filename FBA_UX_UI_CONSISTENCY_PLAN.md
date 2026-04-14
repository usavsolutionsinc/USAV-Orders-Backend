# FBA Flow — UX & UI Consistency Plan

**Generated:** 2026-04-14
**Codebase:** USAV-Orders-Backend (Next.js App Router, Tailwind, Framer Motion, dnd-kit)
**Scope:** Full FBA module — board, sidebar, editor, paired review, create flow, station up-next, and dashboard surface.
**Relationship to prior plan:** Complements `FBA_ALIGNMENT_PLAN.md` (2026-03-26, 6 surgical fixes). That plan stays valid; this plan is the broader consolidation pass that sits on top of it.
**Style:** Surgical edits preferred. No terminology renames at the DB layer. Component consolidation is in-scope.

---

## 0. Guiding Principles

1. **One pattern per job.** Create/edit/reassign share one form chrome, one status vocabulary, one loading pattern.
2. **Surgical before structural.** Fix inconsistency where users see it (labels, status colors, form fields) before reworking state.
3. **Preserve what works.** Event-driven sync, `FbaWorkspaceContext`, shared types, theme chrome, chip semantics — keep these.
4. **No backend rename.** `fba_shipments` stays. The word "plan" is a UI-layer synonym. Pick one user-facing term ("Shipment") and enforce it in labels only.
5. **Staff theming is a feature.** Station colors (8 themes) are load-bearing for packers visually identifying their own queue; do not flatten.
6. **Warehouse first, mobile second.** Packers work on desktop; responsive is a nice-to-have, not a blocker.

---

## Table of Contents

1. [Terminology Lock-Down](#1-terminology-lock-down)
2. [Unified Status System](#2-unified-status-system)
3. [Form Chrome Consolidation](#3-form-chrome-consolidation)
4. [Edit-Flow Consolidation](#4-edit-flow-consolidation)
5. [Component Deduplication](#5-component-deduplication)
6. [Loading / Empty / Error State Standardization](#6-loading--empty--error-state-standardization)
7. [Button & Control Standardization](#7-button--control-standardization)
8. [Navigation & Deep-Linking](#8-navigation--deep-linking)
9. [Data-Fetching Convergence](#9-data-fetching-convergence)
10. [Accessibility Pass](#10-accessibility-pass)
11. [Responsive & Touch Pass](#11-responsive--touch-pass)
12. [Rollout, Sequencing, Risk](#12-rollout-sequencing-risk)
13. [Verification Checklist](#13-verification-checklist)

---

## 1. Terminology Lock-Down

**Problem.** Labels blur two genuinely different concepts. The prior draft of this section incorrectly treated "plan" and "shipment" as synonyms. They are **two phases of the same workflow, not two names for one thing.**

### 1.1 Canonical domain model (authoritative)

**Plan** — *the prep queue.*
- An FNSKU added to the DB so every tech can see it on their station up-next.
- Rendered on `src/components/UpNextOrder.tsx` via `FbaItemCard` under the "FBA Pending Items" section.
- Lives until a tech pulls it into a shipment. It has no Amazon FBA ID, no UPS tracking, no box grouping. Just "this SKU needs to be prepped for FBA".

**FBA shipment ID (Amazon's)** — *the Amazon-issued label that pairs the shipment.*
- One Amazon shipment ID can span **multiple boxes**, each with its **own UPS tracking number**.
- The *shipment record* (`fba_shipments` row / `FbaPlan` type) is what groups those boxes + UPS trackings together under the one Amazon shipment ID.
- Rendered via `src/components/fba/sidebar/FbaShipmentCard.tsx` and `FbaActiveShipments.tsx`.
- This is the outbound phase: prepped items have been assigned to boxes, weighed, labeled, ready to ship.

**Tracking bundle** — *one UPS tracking number within one shipment.*
- Holds the item allocations for the single box that tracking number covers.
- Many-to-one with the shipment record.

### 1.2 Canonical vocabulary
| Concept | UI label | Code identifier | Surface |
|---|---|---|---|
| Prep-queue entry | **Plan item** (short: "Plan") | `fba_shipment_item` rows pre-assignment; `FbaItemCard` | `UpNextOrder` FBA tab |
| Outbound record | **Shipment** | `fba_shipments` row, `FbaPlan` type, `ActiveShipment` | `FbaShipmentCard`, `FbaActiveShipments` |
| Amazon's pairing ID | **FBA shipment ID** | `amazon_shipment_id` | Card header, inline-edit |
| UPS-tracked box | **Tracking bundle** | `tracking_bundle`, `trackingGroup` | Inside shipment cards |
| Qty of plan item assigned to a bundle | **Allocation** | `allocation` | Editor form |

### 1.3 Why the naming debt exists
The DB/type name `FbaPlan` predates the distinction: originally a "plan" was the outbound object. The prep-queue concept grew on top of the same table via `fba_shipment_items`. The schema still reflects the older model. Do **not** rename `FbaPlan`; instead add a JSDoc header that says "represents the outbound shipment record; the *plan* (prep-queue) phase uses the same row but before `amazon_shipment_id` / tracking bundles are assigned."

### 1.4 Copy change checklist (by file)
Rule of thumb: if the user is looking at an FNSKU before it's been grouped under an Amazon ID + UPS tracking, call it a **Plan item**. Once grouped, it's a **Shipment**.

- `src/components/station/upnext/FbaItemCard.tsx` — headline and labels use "Plan" / "Plan item".
- `src/components/UpNextOrder.tsx:166` — section header already reads "FBA Pending Items"; change to **"FBA Plan Items"** to align with the vocabulary. Tab label `fba` displayed as "FBA" can stay.
- `src/components/fba/FbaCreatePlanModal.tsx` — keep title as **"Create plan"** (this is the prep-queue intake). Do NOT rename to "shipment" — the action is adding FNSKUs to the plan queue.
- `src/components/fba/FbaCreateShipmentForm.tsx` — file name is misleading; the form creates a *plan*, not an outbound shipment. Leave filename (cost > benefit), but change visible copy to "Create plan", "Plan ref", "Due date". Add a JSDoc comment at top noting the filename/label mismatch.
- `src/components/fba/FbaBoardTable.tsx` — empty state: **"No FBA plan items"**.
- `src/components/fba/sidebar/FbaSidebar.tsx` — intake/prep section uses "Plan", active/outbound section uses "Shipment".
- `src/components/fba/sidebar/FbaActiveShipments.tsx` — section header "Active shipments" stays.
- `src/components/fba/sidebar/FbaShipmentCard.tsx` — expanded panel label **"FBA Shipment ID"** (currently correct, keep).
- `src/components/fba/sidebar/FbaPairedReviewPanel.tsx` — verb shifts based on context: "Split into a new plan" when the target is a prep queue; "Move to another shipment" when target is outbound.
- `src/components/sidebar/FbaAddToShipmentPanel.tsx` — rename visible title to **"Add FNSKU to plan"** (it adds to the prep queue, not outbound).
- Event names in `src/lib/fba/events.ts` stay as-is. Payload messages and toast strings get aligned to the vocabulary.

### 1.5 Out of scope (explicit)
- No DB migration to rename tables.
- No TypeScript rename (`FbaPlan` → anything).
- No renaming of `FbaCreatePlanModal` / `FbaCreateShipmentForm` filenames — surgical copy change only.

**Risk:** Low. Pure copy, tracked by grep.
**Est. surface:** ~30 string edits across ~12 files.

---

## 2. Unified Status System

**Problem.** Shipment-level statuses use pill badges (`FBAShipmentsTable.tsx:55–69` `STATUS_STYLES`). Item-level statuses use row color. Tracking bundle has a chip but no status. Amazon shipment ID presence is conveyed only by its visibility. No icon language.

### 2.1 Create a single `FbaStatusBadge` component
**New file:** `src/components/fba/shared/FbaStatusBadge.tsx`

- Single component takes `status: FbaShipmentStatus | FbaItemStatus | FbaTrackingStatus` and `size?: 'xs' | 'sm'`.
- Maps each status to `{ label, icon, colorClass, ariaLabel }` in a single source-of-truth table.
- Uses lucide icons (already a project dep):
  - `PLANNED` → `Circle` (gray-500)
  - `READY_TO_GO` → `CheckCircle2` (emerald-600)
  - `LABEL_ASSIGNED` → `Tag` (blue-600)
  - `SHIPPED` → `Truck` (purple-600)
  - `CLOSED` → `Lock` (slate-500)

### 2.2 Replace existing badge sites
- `src/components/dashboard/FBAShipmentsTable.tsx:55–69` — delete local `STATUS_STYLES`, use `FbaStatusBadge`.
- `src/components/fba/FbaBoardTable.tsx` — board rows that currently convey status through sort order only should show a badge per row.
- `src/components/fba/sidebar/FbaShipmentCard.tsx` — card header gets a `FbaStatusBadge size="xs"` next to shipment ref.
- `src/components/fba/sidebar/FbaTrackingGroupDisplay.tsx:52–66` — tracking bundle header gets a mini status badge (`LABEL_ASSIGNED` vs `READY_TO_GO`).

### 2.3 Item-level status
- Item rows (`FbaSelectedLineRow.tsx`) currently imply status by row color only. Add a trailing 12px status dot (same color map) instead of changing row background.
- Row background stays neutral; status dot is the single visual indicator.

### 2.4 Color tokens
Don't scatter Tailwind classes. Add to `src/design-system/tokens.ts` (or wherever tokens live) a `fbaStatusTone` map. `FbaStatusBadge` is the only consumer.

**Risk:** Low-medium. The board-table row re-paint is the biggest visual change; QA by screenshot.
**Est. surface:** 1 new component, 4 call-site replacements, 1 token addition.

---

## 3. Form Chrome Consolidation

**Problem.** Three form looks exist:
- `FbaCreateShipmentForm` uses `SidebarIntakeFormShell` + `SidebarIntakeFormField`.
- `FbaShipmentEditorForm` uses raw grid with inline-editable chips.
- `FbaAddToShipmentPanel` uses a dropdown + ad-hoc `<select>` + text input, no shell.

### 3.1 Introduce `FbaFormShell` and `FbaField`
**New files:**
- `src/components/fba/shared/FbaFormShell.tsx`
- `src/components/fba/shared/FbaField.tsx`

`FbaFormShell`:
- Props: `title`, `description?`, `stationTheme`, `actions` (ReactNode for button row), `children`.
- Provides consistent header (title + short description), content gap, and a sticky action row at bottom.
- Respects `fbaSidebarThemeChrome[stationTheme]` for the action row background + primary button.

`FbaField`:
- Props: `label`, `hint?`, `error?`, `required?`, `htmlFor`, `children`.
- Label sits above control, hint below, error replaces hint when present (red-600, aria-live="polite").
- Wraps any input-shaped child (select, input, textarea, custom combobox).

### 3.2 Migrate existing forms
- `FbaCreateShipmentForm`: keep sidebar-chrome visual but rebuild its rows with `FbaField`. Keep the same fields. Keep auto-derived shipment ref (already in `FBA_ALIGNMENT_PLAN.md §3`).
- `FbaAddToShipmentPanel`: wrap in `FbaFormShell` titled "Add FNSKU to shipment". Dropdown becomes the shell's header control. Text input and shipment select become two `FbaField`s side by side.
- `FbaShipmentEditorForm`: the drag-drop canvas is not a traditional form — do **not** wrap its DnD grid in `FbaFormShell`. But the *header strip* (shipment ref, date, save button) and *footer save bar* should use the same action-row pattern as `FbaFormShell`'s sticky footer so visual rhythm matches.

### 3.3 Deprecate
- `SidebarIntakeFormShell` / `SidebarIntakeFormField` stay (they're used outside FBA), but FBA no longer imports them.

**Risk:** Medium. Form is the most visible surface. Ship behind a feature flag if one exists, otherwise staff preview first.
**Est. surface:** 2 new components, 3 form migrations.

---

## 4. Edit-Flow Consolidation

**Problem.** Users can edit a shipment in 4 places:
- `FbaCreatePlanModal` (new shipments)
- `FbaShipmentEditorForm` (items + tracking bundles, drag-drop sidebar panel)
- `FbaShipmentCard` inline chips (FBA ID, tracking)
- `FbaQuickAddFnskuModal` (catalog entry, separate concern)
- `FbaAddToShipmentPanel` (manual add FNSKU to existing)

The first three operate on the same record with different affordances.

### 4.1 Define the canonical edit surface
**The editor sidebar (`FbaShipmentEditorForm`) is the canonical surface for all shipment-level edits.** Inline chips stay (they're faster for one-field tweaks), but the editor is the "full truth" view. Expanded `FbaShipmentCard` becomes **display-only** below its chip-level edits.

### 4.2 Concrete fix — strip inline item editing from `FbaShipmentCard`
**Observed bug:** when `editable={true}`, the expanded card currently renders per-item checkboxes, qty steppers, a "combine review" X button, and a Save button. This duplicates exactly what the editor form does, and users have reported the checkmarks look wrong here because the intended edit path is: click the edit button → opens `FbaShipmentEditorForm`.

**Required changes in `src/components/station/upnext/FbaShipmentCard.tsx`:**

1. **Remove the selection checkboxes** from the expanded display. Do NOT pass `selectedIds`, `onCheckedChange`, or `onSetQty` into `FbaTrackingGroupDisplay` when rendered inside this card. Render each tracking bundle with `editable={false}` regardless of the card's `editable` prop.
2. **Remove the "selection counts" row** (lines 108–124): `{selectedCount} · {selectedUnits}` and the X button that toggles paired review. The paired-review entry point stays, but it moves onto the card header's action cluster, next to the edit button (§4.3).
3. **Remove the Save button + error inline** (lines 629–646). The save path is: edit button → editor form → save.
4. **Remove the Save-related state** (`selectedIds`, `qtyOverrides`, `saving`, `error`, `handleSaveSelection`, `applyBundleAllocations`, `adjustQtyInBundle`, `setQtyInBundle`, `adjustQtyLegacy`, `setQtyLegacy`, `syntheticBundle` as used for editing). Keep `items` purely as a read mirror of `shipment.items`.
5. **Remove the undo toast plumbing tied to item editing.** Keep the undo toast only for the two remaining inline chip edits (FBA ID and per-bundle UPS tracking) — those continue to use `showUndoToast`.
6. **Keep the two inline-editable chips** behind the `editable` prop:
   - FBA Shipment ID (`InlineEditableValue`, lines 549–562)
   - UPS tracking per bundle (`TrackingSection` inline edit, lines 127–144)
   These are quick one-field edits and don't conflict with the editor.
7. **Delete `resolveBundlesForSave`** (top of file) — unused after steps 3–4.
8. **Delete `TrackingSection`** inline selection-count row; the section keeps only the UPS tracking inline edit + the read-only items display.

**Interaction after the fix:**
- Expanded card shows: header (Amazon ID, totals, status), FBA Shipment ID (inline-editable), each tracking bundle with UPS tracking (inline-editable) and its items read-only.
- To change item selection / qty / allocation: click the edit button in the card header → fires `FBA_OPEN_SHIPMENT_EDITOR` → `FbaShipmentEditorForm` opens with the full editing UI.

### 4.3 Where the edit button lives
The edit button is rendered by `FbaActiveShipments.tsx` in the card header (already wired to `FBA_OPEN_SHIPMENT_EDITOR`). Confirm it sits **visibly** inside the card header, not hidden on hover, and has `aria-label="Edit shipment"`. Place the paired-review toggle (currently the X inside the card) next to it as a secondary action with a clear icon + label.

### 4.4 Rules (updated)
1. **Inline chips** (`InlineEditableValue`) stay for: UPS tracking (per bundle), FBA Shipment ID, shipment notes. These are one-field, one-record edits and live on `FbaShipmentCard`.
2. **Editor sidebar** handles: item selection/qty, adding/removing items, creating/renaming tracking bundles, splitting to another shipment, closing shipment, paired/combine review.
3. **`FbaShipmentCard` is display-only below chip edits.** No checkboxes, no Save button, no qty steppers in the expanded view.
4. **Create modal** only appears from the "+" button and only creates new. It cannot edit existing shipments.
5. **Add-FNSKU-to-plan panel** stays as a quick-add shortcut for the *plan* (prep-queue) phase. Label it "Quick add to plan". Target: fold into the editor once the editor gains an inline add row.
6. **Paired review panel** becomes a *mode* inside the editor (tab or segmented control: "Edit" / "Paired review"), instead of a separate sibling panel.

### 4.3 Interaction contract
- **Opening the editor** on an active shipment closes the inline chip edits (focus stays with editor).
- **Closing the editor** fires `USAV_REFRESH_DATA` (already happens) + collapses the card it came from.
- **Save** in editor is the only commit point for item/bundle changes. Inline chips save on blur as today.
- **Undo** stays scoped to editor only (existing localStorage behavior). Inline edits do not undo.

### 4.4 Specific changes
- `src/components/fba/sidebar/FbaPairedReviewPanel.tsx` — becomes `FbaShipmentEditorForm`'s "Paired review" tab. Move its logic in; dispose the standalone panel.
- `src/components/sidebar/FbaAddToShipmentPanel.tsx` — keep for now, rename visually to "Quick add FNSKU" to disambiguate. Target: removal once editor has an inline add row.
- `FBA_PAIRED_REVIEW_TOGGLE` event in `src/lib/fba/events.ts` — retained but now switches the tab inside an already-open editor; opens the editor first if closed.

**Risk:** Medium-high. This is the biggest UX change. Staff preview mandatory; ship with a rollback toggle if practical.
**Est. surface:** 1 large edit (editor form gains a tabs container), 1 panel deletion, event semantics update.

---

## 5. Component Deduplication

**Problem.** `FbaTrackingBundleCard` and `FbaTrackingGroupDisplay` do ~90% the same thing. `FbaDraggableLineRow` is `FbaSelectedLineRow` + dnd-kit wrapper.

### 5.1 Tracking bundle: single component with modes
**Keep:** `FbaTrackingGroupDisplay` (it's already the "shared" one per the code comments).
**Change:** add a `mode: 'readonly' | 'qty-only' | 'full-edit'` prop.
- `readonly` — current card / station up-next use.
- `qty-only` — current active-shipment card behavior (qty stepper visible, no drag handles).
- `full-edit` — editor view (drag handles + qty + remove button).

**Delete:** `FbaTrackingBundleCard.tsx` once the editor is migrated to `FbaTrackingGroupDisplay mode="full-edit"`.

**Call-site updates:**
- `FbaShipmentEditorForm.tsx` — swap `FbaTrackingBundleCard` usage for `FbaTrackingGroupDisplay mode="full-edit"`.
- Verify `FbaActiveShipments.tsx` still renders correctly with `mode="qty-only"` (current behavior).
- Verify `FbaShipmentCard.tsx` (station) uses `mode="readonly"`.

### 5.2 Line row: single component, DnD as an opt-in wrapper
**Keep:** `FbaSelectedLineRow` as the row visual.
**Change:** `FbaDraggableLineRow` becomes a thin wrapper that applies dnd-kit's `useSortable` + drag handle and renders `FbaSelectedLineRow` inside. No duplicated markup.

### 5.3 Bundle editor + status
Once `FbaTrackingGroupDisplay` has `mode="full-edit"`, add a `FbaStatusBadge` (§2) to its header for consistency with the editor's bundle cards.

**Risk:** Medium. Bundle component is touched everywhere. Ship behind a branch; run through every render path in QA.
**Est. surface:** 1 component expanded, 1 component deleted, 1 component flattened.

---

## 6. Loading / Empty / Error State Standardization

**Problem.** Each table/list picks its own feedback style (spinner vs skeleton vs hidden vs toast).

### 6.1 Create three shared primitives
**New files:** `src/components/fba/shared/`
- `FbaSkeleton.tsx` — variant `row` / `card` / `detail`. Used for all loading states.
- `FbaEmpty.tsx` — icon + headline + optional CTA.
- `FbaErrorState.tsx` — icon + message + retry callback.

### 6.2 Apply
| File | Loading now | Empty now | Error now | After |
|---|---|---|---|---|
| `FbaBoardTable.tsx` | Spinner | Text | None | Skeleton rows, `FbaEmpty`, `FbaErrorState` |
| `FbaActiveShipments.tsx` | `SkeletonList` | `return null` | Silent catch | Skeleton cards, `FbaEmpty "No active shipments"`, `FbaErrorState` |
| `FbaShippedTable.tsx` | `SkeletonList` | Text | Silent | Skeleton, `FbaEmpty`, `FbaErrorState` |
| `FbaShipmentEditorForm.tsx` | None | Text | Inline `<p>` | Skeleton (on first open), `FbaEmpty "No items yet"`, `FbaErrorState` |
| `FbaWorkspaceScanField.tsx` | None | "No matches" | Toast | Loading dot next to input while fetching; `FbaEmpty` in dropdown; error toast unchanged |
| `FBAShipmentsTable.tsx` (dashboard) | Spinner | Text | Text | Skeleton rows, `FbaEmpty`, `FbaErrorState` with retry |

### 6.3 Motion
All skeletons use the same shimmer (already defined in design-system if present; if not, add one `animate-pulse` + gradient).

**Risk:** Low. Purely additive.
**Est. surface:** 3 new primitives, ~6 call-site replacements.

---

## 7. Button & Control Standardization

**Problem.** Some buttons use `fbaSidebarThemeChrome[theme]`, others hardcode Tailwind (`bg-emerald-50`, `bg-blue-50`). Qty stepper is a bespoke control.

### 7.1 Button roles
Standardize on three button roles inside FBA:
- **Primary** — submits/creates/saves. Uses theme chrome's `primaryButton`.
- **Secondary** — cancel, back, tertiary action. Neutral gray.
- **Destructive** — remove, split, close shipment. Red-50 bg / red-700 text / red-200 border.

All three live in `fbaSidebarThemeChrome` (extend the existing map — it already holds `primaryButton`).

### 7.2 Replace hardcoded styles
Grep for: `rounded-md border emerald-300`, `rounded-lg border.*bg-blue-50`, `rounded border.*bg-red-`, and similar.
Each match becomes a themed button role.

Known sites:
- `FbaShipmentEditorForm.tsx:630–646` — save button → primary
- `FbaAddToShipmentPanel.tsx` add button → primary
- `FbaPairedReviewPanel.tsx` split button → destructive

### 7.3 Qty stepper
`FbaQtyStepper.tsx` stays. Confirm:
- Minimum tap target (see §11).
- `aria-label` on +/− buttons ("Increase quantity" / "Decrease quantity").
- Red-danger style at `qty <= 0` uses the same red token as the destructive button.

**Risk:** Low.
**Est. surface:** Theme chrome extension + ~10 Tailwind replacements.

---

## 8. Navigation & Deep-Linking

**Problem.** FBA state lives in React context + CustomEvents + localStorage. Refresh loses editor state. No shareable URL for "shipment X being edited".

### 8.1 Minimum viable URL state
Add URL search params to the `/fba` route (and wherever the sidebar lives):
- `?shipment=<id>` — expands that shipment card on mount.
- `?edit=<id>` — opens the editor for that shipment on mount.
- `?view=paired` — editor opens in paired-review tab.

### 8.2 Implementation sketch
- Read params in the top-level FBA page component on mount.
- On `FBA_OPEN_SHIPMENT_EDITOR` event, also push `?edit=<id>` via `router.replace` (no scroll).
- On editor close, clear the param.
- Do **not** sync every selection change to URL — that would thrash history. Only the "major mode" (editor open, paired view).

### 8.3 Back button
Browser back should close the editor (naturally follows from step 8.2).

### 8.4 Out of scope
- Persisting the workspace selection IDs to URL (too noisy).
- Deep-linking into specific tracking bundles.

**Risk:** Low-medium. `router.replace` misuse can trigger re-renders; guard against loops.
**Est. surface:** ~30 lines across FBA page + editor open/close handlers.

---

## 9. Data-Fetching Convergence

**Problem.** Dashboard uses TanStack Query. FBA uses raw `fetch` + `useState` + `useEffect`. Cache invalidation is manual via CustomEvents. Note: `MEMORY.md → Neon CU-hr Optimization` — any polling/fetch changes here need to stay friendly to the recent Neon optimization.

### 9.1 Decision
Migrate FBA's read paths to TanStack Query over two waves. Writes stay as direct `fetch` (with query invalidation on success).

### 9.2 Wave A — board + dashboard parity (low risk)
- `FbaBoardTable` → `useQuery(['fba', 'board', week])`
- `FbaShippedTable` → `useQuery(['fba', 'shipped', week])`
- `FbaActiveShipments` → `useQuery(['fba', 'active'])`

On successful write (close shipment, mark shipped, save editor), `queryClient.invalidateQueries({ queryKey: ['fba'] })`.

### 9.3 Wave B — editor + scan field (medium risk)
- `FbaWorkspaceScanField` catalog lookup → `useQuery` with `enabled: term.length >= N`. Respect existing debounce.
- `FbaShipmentEditorForm` initial load → `useQuery`. Optimistic updates on drag-drop stay in local state; commit happens on save.

### 9.4 Polling
Do **not** add polling. Keep CustomEvent-driven invalidation. The `USAV_REFRESH_DATA` event becomes a `queryClient.invalidateQueries` call.

### 9.5 Neon cost safety
- `staleTime: 30_000` default for FBA queries; `60_000` for shipped/history views.
- `refetchOnWindowFocus: false` to match Neon optimization intent.

**Risk:** Medium. Touches many data-entry points. Ship Wave A first, observe for a week.
**Est. surface:** ~6 component migrations for A, ~2 for B.

---

## 10. Accessibility Pass

### 10.1 ARIA labels
- `FbaQtyStepper`: label +/− buttons.
- `FbaSelectedLineRow` checkbox: labelled by FNSKU row title; add `aria-describedby` for qty.
- Collapsible card headers (`FbaActiveShipments`, `FbaShipmentCard`): `aria-expanded`, `aria-controls`.
- `FbaWorkspaceScanField`: explicit `<label>` (visually hidden) + `aria-describedby` for helper text.

### 10.2 Keyboard
- Inline editables: `Esc` cancels, `Enter` commits, `Tab` commits. Currently only blur commits.
- dnd-kit: enable `KeyboardSensor` so items can be moved between bundles via arrow keys. Announce moves via `DndContext.announcements`.
- Modal focus trap: verify `FbaCreatePlanModal` traps focus and restores it on close.

### 10.3 Color contrast
- Status dot-only indicators (§2.3) must ship with a text label nearby (the status name in the tooltip suffices — do not convey state via color alone).
- Verify amber/yellow themes meet 4.5:1 on their primary button.

### 10.4 Motion
- `useReducedMotion` is already wired in. Audit that every `AnimatePresence` / `motion.div` in FBA respects it. Skeletons in §6 should freeze shimmer when reduced-motion is on.

**Risk:** Low.
**Est. surface:** ~15 small edits.

---

## 11. Responsive & Touch Pass

Warehouse first. Mobile and tablet polish second, behind existing layouts.

### 11.1 Touch targets
- All interactive icons and checkboxes → min 32×32 hit area (visual stays current size via padding).
- `FbaQtyStepper` +/− buttons reach 36×36 on touch.

### 11.2 Tables on narrow viewports
- `FbaBoardTable` and `FbaShippedTable`: at `< md` breakpoint, collapse into a card list (one card per row, title + status badge + qty). Same data, different layout.
- `FBAShipmentsTable` (dashboard) gets the same treatment.

### 11.3 Sidebar on narrow viewports
- Sidebar gets a collapse toggle at `< lg`. Default collapsed on first mobile visit, remembered via localStorage.

### 11.4 Out of scope
- Rewriting the editor drag-drop for touch. DnD on touch is notoriously finicky; the editor is a desktop surface.

**Risk:** Low-medium. Defer if warehouse teams never hit these breakpoints.
**Est. surface:** ~200 LOC across 3 tables + sidebar shell.

---

## 12. Rollout, Sequencing, Risk

### 12.1 Phase order
Each phase is independently shippable. Stop after any phase if priorities shift.

| Phase | Sections | Blast radius | User-visible | Ship gate |
|---|---|---|---|---|
| **P1 — Copy & Status** | §1, §2 | Low | High | Screenshot review |
| **P2 — Forms & Loading** | §3, §6, §7 | Medium | High | Staff preview |
| **P3 — Consolidation** | §5 | Medium | Low (invisible refactor) | QA on all bundle render paths |
| **P4 — Edit flow** | §4 | High | High | Staff preview + rollback plan |
| **P5 — Nav & Data** | §8, §9 (wave A) | Medium | Medium | Canary on dashboard first |
| **P6 — Data wave B + A11y + Responsive** | §9 wave B, §10, §11 | Medium | Medium | Accessibility checklist pass |

### 12.2 Dependencies between phases
- §5 (dedup) should land **before** §4 (edit flow), so the editor's bundle card already points at the merged component.
- §2 (status badge) should land **before** §5 so the merged bundle component gets the badge for free.
- §7 (buttons) should land alongside §3 (forms) — they touch adjacent markup.

### 12.3 Feature flag / rollback
Current codebase does not appear to use a feature-flag system for FBA. Two practical options:
- **Branch-per-phase.** Merge on Friday, observe Mon–Tue, next phase Wednesday.
- **Env-gated editor.** Wrap P4's editor changes in `process.env.NEXT_PUBLIC_FBA_EDITOR_V2 === '1'` and flip on when validated.

### 12.4 What explicitly stays
- Event system in `src/lib/fba/events.ts`.
- `FbaWorkspaceContext`.
- Staff color themes and `fbaSidebarThemeChrome`.
- Shared types in `src/lib/fba/types.ts`.
- DB schema and API route paths.
- `FBA_ALIGNMENT_PLAN.md` surgical fixes (this plan assumes they land first or in parallel — no conflicts identified).

---

## 13. Verification Checklist

Run this checklist per phase before merging.

### 13.1 Visual
- [ ] Every status display in FBA uses `FbaStatusBadge` (grep `STATUS_STYLES`, no local copies).
- [ ] Every FBA form uses `FbaFormShell` + `FbaField` OR is documented as an intentional exception (editor canvas).
- [ ] Every FBA loading state uses `FbaSkeleton`; every empty state uses `FbaEmpty`; every error uses `FbaErrorState`.
- [ ] No inline Tailwind button classes for primary/secondary/destructive buttons — all go through theme chrome.
- [ ] Station themes (all 8) render correctly on: create form, editor, active card, board.

### 13.2 Behavioral
- [ ] Opening the editor via URL `?edit=<id>` works on cold load.
- [ ] Browser back closes the editor.
- [ ] Paired review is a tab inside the editor, not a separate panel.
- [ ] Save in editor invalidates all `['fba', …]` queries.
- [ ] Inline chip edits still work and still save on blur.

### 13.3 Accessibility
- [ ] Axe DevTools clean on `/fba` and on open editor.
- [ ] All buttons / checkboxes / steppers have an accessible name.
- [ ] Modal focus trap on `FbaCreatePlanModal` verified.
- [ ] Keyboard-only user can: open create form, submit, open editor, move one item to another bundle via arrow keys, save, close.
- [ ] `prefers-reduced-motion` freezes skeleton shimmer and disables card expand animation.

### 13.4 Data / cost
- [ ] No new polling loops introduced (confirm against Neon optimization memory).
- [ ] `refetchOnWindowFocus: false` on all new `useQuery` calls.
- [ ] `staleTime` set explicitly on every query.

### 13.5 Terminology
- [ ] Prep-queue surfaces (UpNextOrder FBA tab, board table, create-plan modal, add-FNSKU panel) say **"Plan"** / **"Plan item"**.
- [ ] Outbound surfaces (active shipments sidebar, FbaShipmentCard, editor header) say **"Shipment"** and **"FBA Shipment ID"** consistently.
- [ ] The two vocabularies never blur on the same screen.

### 13.6 FbaShipmentCard strip (§4.2)
- [ ] Expanded card shows no checkboxes, no qty steppers, no Save button, no selection counts row.
- [ ] FBA Shipment ID inline edit still works.
- [ ] Per-bundle UPS tracking inline edit still works.
- [ ] Edit button in card header opens `FbaShipmentEditorForm` (existing `FBA_OPEN_SHIPMENT_EDITOR` event).
- [ ] Paired-review toggle moved to card header action cluster with a clear icon + aria-label.
- [ ] `resolveBundlesForSave`, `handleSaveSelection`, `applyBundleAllocations`, `adjustQtyInBundle`, `setQtyInBundle`, `adjustQtyLegacy`, `setQtyLegacy` removed.

---

## Appendix A — File impact map

| File | §1 | §2 | §3 | §4 | §5 | §6 | §7 | §8 | §9 | §10 | §11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `FbaCreatePlanModal.tsx` | ✓ |  |  |  |  |  |  |  |  | ✓ |  |
| `FbaCreateShipmentForm.tsx` | ✓ |  | ✓ |  |  | ✓ | ✓ |  |  | ✓ |  |
| `FbaShipmentEditorForm.tsx` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `FbaPairedReviewPanel.tsx` | ✓ |  |  | ✓ (merged in) |  |  | ✓ |  |  |  |  |
| `FbaActiveShipments.tsx` | ✓ | ✓ |  |  | ✓ | ✓ |  |  | ✓ | ✓ | ✓ |
| `FbaShipmentCard.tsx` (sidebar) | ✓ | ✓ |  | ✓ | ✓ |  |  |  |  | ✓ |  |
| `FbaShipmentCard.tsx` (station up-next) |  | ✓ |  | ✓ (strip item edit, §4.2) | ✓ |  |  |  |  | ✓ |  |
| `UpNextOrder.tsx` | ✓ (section label) |  |  |  |  |  |  |  |  |  |  |
| `FbaItemCard.tsx` (station up-next) | ✓ |  |  |  |  |  |  |  |  | ✓ |  |
| `FbaTrackingBundleCard.tsx` |  |  |  |  | ✗ delete |  |  |  |  |  |  |
| `FbaTrackingGroupDisplay.tsx` |  | ✓ |  |  | ✓ (modes) |  |  |  |  | ✓ |  |
| `FbaSelectedLineRow.tsx` |  | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |
| `FbaDraggableLineRow.tsx` |  |  |  |  | ✓ (wrap) |  |  |  |  | ✓ |  |
| `FbaBoardTable.tsx` | ✓ | ✓ |  |  |  | ✓ |  |  | ✓ | ✓ | ✓ |
| `FbaShippedTable.tsx` | ✓ | ✓ |  |  |  | ✓ |  |  | ✓ |  | ✓ |
| `FbaSidebar.tsx` | ✓ |  |  |  |  |  | ✓ | ✓ |  | ✓ | ✓ |
| `FbaWorkspaceScanField.tsx` |  |  |  |  |  | ✓ |  |  | ✓ | ✓ |  |
| `FbaAddToShipmentPanel.tsx` | ✓ |  | ✓ | ✓ (renamed) |  |  | ✓ |  |  | ✓ |  |
| `FbaQtyStepper.tsx` |  |  |  |  |  |  | ✓ |  |  | ✓ | ✓ |
| `FbaQuickAddFnskuModal.tsx` | ✓ |  | ✓ |  |  |  | ✓ |  |  | ✓ |  |
| `FBAShipmentsTable.tsx` (dashboard) | ✓ | ✓ |  |  |  | ✓ |  |  | ✓ | ✓ | ✓ |
| `src/lib/fba/events.ts` |  |  |  | ✓ (semantics) |  |  |  | ✓ |  |  |  |
| `src/lib/fba/types.ts` | ✓ (jsdoc) |  |  |  |  |  |  |  |  |  |  |

## Appendix B — New files to create

- `src/components/fba/shared/FbaStatusBadge.tsx` (§2)
- `src/components/fba/shared/FbaFormShell.tsx` (§3)
- `src/components/fba/shared/FbaField.tsx` (§3)
- `src/components/fba/shared/FbaSkeleton.tsx` (§6)
- `src/components/fba/shared/FbaEmpty.tsx` (§6)
- `src/components/fba/shared/FbaErrorState.tsx` (§6)

## Appendix C — Known non-goals

- No DB rename.
- No migration from `fetch` to `useQuery` for write paths.
- No rewrite of dnd-kit canvas for touch input.
- No new design system; this plan tightens the one that exists.
- No global renaming of `FbaPlan` in TypeScript.
- No change to staff theme palette — themes are a feature, not a bug.

---

*End of plan.*
