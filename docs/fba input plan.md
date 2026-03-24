## FBA FNSKU Plan Input Refactor

This document records the staged refactor plan you requested. Each numbered section mirrors the 1‑through‑12 structure, so future work can be traced back to the intention you laid out.

### 1. Architecture Overview
- **Component tree**: `FbaFnskuPlanInput` (orchestrator) → `StepIndicator`, `PasteStep`, `ReviewStep`, `FormStep`, `PostCreateStep`, theming hooks.
- **State**: single `useReducer` managing `step`, parsed tokens, validation results, quantities, pending catalog list, today’s plan, API status flags, and errors.
- **Local persistence**: `localStorage[fba:pending_catalog]` for catalog gaps and `localStorage[fba:today_plan]` for deduping same-day shipments.
- **Persistence safety**: reset `today_plan` at midnight and keep `pending_catalog` across refreshes.

### 2. Layout & Height Constraint
- Host component must stretch to parent height (`height: 100%`, `maxHeight: var(--fnsku-modal-height, 520px)`), with only one scrollable area (`StepBody`).
- `StepBody` is the only element permitted `overflow-y-auto`; header, footer, and navigation rows stay `shrink-0`
- Buttons (create plan, back) sit in a contextual footer that collapses at heights < 420px.
- Container queries (`@container`) toggle label text, padding, and button size for small heights.

### 3. Paste Step — Two-column, row-based input
- Replace the rich-text textarea preview with a wide, monospace multi-line input that parses FNSKUs live.
- Right column shows parsed token rows (FNSKU left, index right) with `motion.div` animations, no truncation, no scrolling per row.
- Paste area triggers validate on `Ctrl+Enter`, `⌘+Enter`, or explicit button; updates token list via `parseFnskus`.
- Token rows include badges for “already in today’s plan” (deduped against local storage) and should support up to the available height before internal scrolling.
- Encourage `PasteStep` to be height-adaptive and to auto-scroll only within the token list section.

### 4. Review Step — Status, catalog awareness, CTA
- Display FNSKU details (title bold, FNSKU below) plus qty controls (`+`/`-`) and delete action.
- Show icons for four states (found, already in plan, pending catalog, missing) with consistent colors, similar to `OutOfStockField`’s divider.
- Always allow “Confirm” even when catalog rows exist; unresolved items go into `pendingCatalog` local storage and show inline CTA to upload to `fba_fnkus`.
- Upper section: “Does this look right?” with FNSKU/Title now aligned per spec, plus `Upload to catalog` button that slides in inline `CatalogUploadPanel` rather than leaving the flow.
- Deduplicate “already in today’s plan” before POST; show a badge count in the header.

### 5. Form Step — Create plan summary
- Create a compact summary grid (will add, skipped, unresolved, due date) with motion-driven count-up.
- Buttons reorganized: “Back” on the left, “Create plan”/“Plan created” toggling right, both top-aligned before details.
- Ensure FNSKU list below shows FNSKU & title (title bold) plus quantity adjustments inline, matching spec for display order (planned left, print right). Provide `+`/`-` controls and a delete icon per row.
- `Create plan` posts to `/api/fba/shipments` with `due_date`, `items`, and optional `unresolved_fnskus`. If backend doesn’t accept `deadline_at`, update `wa` table accordingly.

### 6. Post-Create Step — Success + catalog follow-up
- After POST success, do not auto-close; show success tick animation, plan reference (e.g., `Plan #FBA-2026-XXX created`), counts, and list of pending catalog FNSKUs.
- Provide CTA buttons (“Done”, “Upload CSV”) plus inline `Upload FNSKU catalog CSV` panel.
- Persist post-create pending items to `localStorage[fba:pending_catalog]` and surface them until resolved.

### 7. Visual & Token System
- Adopt amber/violet accent palette on a near-black base (zinc/gray surfaces). Introduce CSS variables for colors and typography (JetBrains Mono for labels, DM Sans for body) as described.
- Provide simple divider (bottom line) similar to `src/components/ui/OutOfStockField.tsx` between sections to keep page edge-to-edge.
- Implement purposeful micro-animations (frame motion transitions for steps, badges, success ticks).

### 8. Contextual Height Adaptation
- Use CSS container queries on `.fnsku-panel` to adjust text visibility and padding when height < 420px or < 360px.
- Footer buttons shrink to icon-only view on very short panels, with tooltips if needed.

### 9. Component & Hook Breakdown
- Break `FbaFnskuPlanInput` into smaller modules under `components/fba`, mirroring the tree in section 1.
- Introduce `hooks/usePendingCatalog.ts`, `hooks/useTodayPlan.ts`, `parts/StepIndicator.tsx`, `parts/FooterActions.tsx`, etc.
- Reuse `parseFnskus` utility, ensuring consistent token extraction across paste + review.

### 10. API Updates
- `POST /api/fba/shipments` must accept `unresolved_fnskus` alongside validated `items` so plan creation still succeeds with catalog gaps.
- Add `POST /api/fba/fnskus/bulk` (CSV upload) to populate the `fba_fnkus` table, and `GET /api/fba/shipments/today` for dedup checks.

### 11. Implementation Order
1. Build `useTodayPlan` and `usePendingCatalog` hooks.
2. Extract shared primitives (`StepIndicator`, token rows, footer actions) and styling tokens (colors, typography, container queries).
3. Redesign `PasteStep` with row-based layout and contextual height spacing.
4. Enhance `ReviewStep` with status icons, inline catalog upload, and deduping logic.
5. Implement `CatalogUploadPanel` with CSV upload handling.
6. Build `FormStep` summary + `Create plan` flow with new API contract.
7. Add `PostCreateStep` with success animation and catalog debt details.
8. Apply Framer Motion choreography and `AnimatePresence` transitions (enter/exit, badges, icons).
9. Sync local storage states and container-query CSS.
10. Wire everything inside `FbaFnskuPlanInput` reducer orchestrator.

### 12. UX Decision Notes
- Paste input is the only editable surface; review/form sections are display-only to prevent accidental edits.
- Title (bold) should always appear above the FNSKU, with no truncation; FNSKU is monospace and shown in full.
- Buttons are top-aligned; “Create plan”/“Back” remain accessible without scrolling.
- Pending catalog items persist across reloads to allow later upload and show inline CTAs such as “Upload to catalog” / “Add to catalog now”.
