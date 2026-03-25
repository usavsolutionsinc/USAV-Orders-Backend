# FBA FNSKU Plan Input — Detailed Refactor Plan

> **Aesthetic direction:** Refined industrial-utilitarian. Dense data tables, monospace DNA, surgical micro-animations via Framer Motion, amber/violet accent system on a near-black surface. Think "Bloomberg Terminal meets Notion." Every pixel earns its place.

---

## 0. Architecture Overview

```
FbaFnskuPlanInput
├── StepIndicator            ← contextual, collapses on short viewports
├── PasteStep                ← row-based token display, no rich text
├── ReviewStep               ← catalog status, today's plan diff, bulk upload
├── FormStep (CreateStep)    ← confirm + post-create pending state
└── PostCreateStep           ← pending catalog additions + upload CTA
```

**State shape (single `useReducer`):**

```ts
interface PlanState {
  step: 'paste' | 'review' | 'form' | 'post-create';
  rawTokens: string[];          // parsed X00… strings, order-preserving
  validated: ValidatedFnsku[];  // server response
  todayPlanFnskus: string[];    // already in today's plan (from local store / API)
  pendingCatalog: string[];     // not-found FNSKUs persisted to localStorage
  createdShipment: { id: number; ref: string } | null;
  submitting: boolean;
  validating: boolean;
  error: string | null;
}
```

**Local persistence (localStorage keys):**

| Key | Value |
|-----|-------|
| `fba:pending_catalog` | `string[]` — FNSKUs never found, awaiting upload |
| `fba:today_plan` | `{ date: string; fnskus: string[] }` — resets daily |

---

## 1. Layout & Height Constraint

### Problem
Current implementation uses `overflow-y-auto` on the inner pane, meaning content can scroll independently. The modal shell itself has no guaranteed fixed height, causing layout jank.

### Solution: Viewport-relative, never-scroll shell

```tsx
// Outer shell — caller is responsible for modal sizing,
// but the component always fits its container exactly
<div
  className="flex flex-col"
  style={{ height: '100%', maxHeight: 'var(--fnsku-modal-height, 520px)' }}
>
  <Header />         {/* shrink-0, ~40px */}
  <StepBody />       {/* flex-1 min-h-0 — the only scrollable zone */}
  <FooterActions />  {/* shrink-0, contextual height */}
</div>
```

**Rules:**
- `StepBody` is the **only** element with `overflow-y-auto`. All other regions are `shrink-0`.
- `FooterActions` stacks button(s) and error text. On very short viewports (< 480px height) it collapses to a single icon+label compact bar.
- `StepDots` / `StepIndicator` auto-hides label text below 360px height using a CSS `@container` query.

---

## 2. Paste Step — Complete Redesign

### Current issues
- Uses `<textarea>` which is a rich text-like freeform blob.
- Preview list is stacked below the input, pushing buttons off-screen.
- Numbers on left, FNSKU on right (needs inversion per spec).

### New design

#### Layout (two-column, fixed-height body)

```
┌─────────────────────────────────────┐
│  [INPUT AREA — left col, 50%]       │  [TOKEN ROWS — right col, 50%]  │
│                                     │                                  │
│  Paste anything here…               │  X004NDIUJJ          1          │
│                                     │  X003SG6CER          2          │
│                                     │  X00492D0TJ          3          │
│                                     │                                  │
└─────────────────────────────────────┘
[n FNSKUs detected]          [Validate →]
```

On narrow modal (< 400px wide) → single column, input collapses to a 3-row compact strip, token rows appear below.

#### Input behaviour
- `<textarea>` with `resize: none`, `readonly` stylings removed — user can paste/type freely.
- On every `onChange` / `onPaste`, run `parseFnskus()` and update the right-column live.
- Right column: `FNSKU left-aligned monospace` | `number right-aligned muted`. **NOT a textarea — rendered `<div>` list.**
- Each token row: `motion.div` with `layoutId={fnsku}` so rows animate in/out smoothly when duplicates are removed.
- If a FNSKU is already in `todayPlanFnskus` (local store), show an amber `● Today` badge on its row — no validation needed yet.
- Max visible rows in right column before it internally scrolls: fill available height.
- `⌘↵` / `Ctrl+Enter` triggers validate.

#### Token row component

```tsx
<motion.div
  key={fnsku}
  layout
  initial={{ opacity: 0, x: 8 }}
  animate={{ opacity: 1, x: 0 }}
  exit={{ opacity: 0, x: -8 }}
  className="grid grid-cols-[1fr_auto] items-center gap-2 px-2 py-1 
             border-b border-zinc-800 last:border-0"
>
  <span className="font-mono text-[11px] font-bold tracking-widest text-zinc-100">
    {fnsku}
  </span>
  <span className="text-[9px] font-black text-zinc-500">{idx + 1}</span>
  {isAlreadyInTodayPlan && (
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      className="col-span-2 text-[9px] font-black uppercase text-amber-400"
    >
      ● already in today's plan
    </motion.span>
  )}
</motion.div>
```

---

## 3. Review Step — Enhancements

### 3a. Status categories (4 states per row)

| State | Indicator | Action |
|-------|-----------|--------|
| `found + not in today's plan` | ✓ green | Will be added |
| `found + already in today's plan` | ⊘ amber | Skipped — already added |
| `not found + in pendingCatalog` | △ amber | "Needs catalog upload" |
| `not found + new` | ✗ red | Saved to pendingCatalog + shown as CTA |

### 3b. "Already in today's plan" deduplication

- Before rendering, cross-reference `validated[]` against `todayPlanFnskus` from local store.
- Items already in today's plan render with amber `⊘` indicator and are **excluded** from the shipment POST body.
- A count badge "N already in plan" appears in the header row.

### 3c. "Not in catalog" → persistent local store + upload CTA

When `v.found === false`:
1. Save `v.fnsku` to `localStorage['fba:pending_catalog']` (merge, deduplicate).
2. In the review list, show the row as:

```
[△] X004NDIUJJ
    Need to add to catalog
    [+ Add to catalog now →]   ← inline CTA, opens upload sub-panel
```

3. A sticky banner above the list (if any not-found):

```
┌────────────────────────────────────────────────┐
│ △  3 FNSKUs not in catalog                     │
│    You can still create the plan. Upload CSV   │
│    to fba_fnskus to resolve later.             │
│                      [Upload CSV ↑]            │
└────────────────────────────────────────────────┘
```

### 3d. Upload CSV sub-panel (inline, not a modal)

Triggered by "Upload CSV" button. Slides in from the right within the review step body using `AnimatePresence`.

```
┌──────────────────────────────────┐
│  ← Back to review                │
│                                  │
│  Upload FNSKU catalog CSV        │
│  ┌──────────────────────────┐    │
│  │  Drop CSV here or click  │    │
│  └──────────────────────────┘    │
│  Expected columns:               │
│  fnsku, product_title, asin, sku │
│                                  │
│  [Upload to fba_fnskus ↑]        │
└──────────────────────────────────┘
```

- `POST /api/fba/fnskus/bulk` with multipart form data.
- On success: re-run validation for the pending tokens, update review list live.
- On failure: show inline error with retry.

### 3e. "Can still create plan" even with not-found items

- The "Confirm" button is always enabled if at least 1 FNSKU is scanned (found OR not-found).
- Body sent to POST includes a `unresolved_fnskus` array alongside `items` for found ones.
- Backend should handle gracefully (store unresolved for later fulfillment).

---

## 4. Form Step (Create Plan) — Refinements

### 4a. Summary before create

Show a compact 2-col grid:

```
Will add    4 FNSKUs
Skipped     2 (already in plan)
Unresolved  1 (not in catalog)
Due date    Today · Mar 23
```

Each stat animated in with staggered `motion.div` (`delay: i * 0.06`).

### 4b. After create → transition to `post-create` step

On successful POST:
1. Show a 600ms "tick" success animation (SVG checkmark path draw, spring physics).
2. Transition step to `'post-create'`.
3. Update `localStorage['fba:today_plan']` with newly added FNSKUs.

---

## 5. Post-Create Step (new)

This replaces the current `onCreated` callback dismissal. The panel **stays open** to surface catalog work.

```
┌──────────────────────────────────────┐
│ ✓  Plan #FBA-2024-0042 created       │
│    4 items queued for today          │
├──────────────────────────────────────┤
│ PENDING CATALOG (1)                  │
│                                      │
│  ✗  X004NDIUJJ                       │
│     Not in catalog                   │
│     [+ Add to catalog now]           │
├──────────────────────────────────────┤
│ [Done]              [Upload CSV ↑]   │
└──────────────────────────────────────┘
```

- "Pending catalog" list is sourced from `localStorage['fba:pending_catalog']`.
- After a successful catalog upload, each row animates out with a ✓ and the pending list count badge decrements.
- "+ Add to catalog now" opens the inline CSV uploader sub-panel (same component as Review step).
- "Done" calls `onCreated(id, ref)` and closes.

---

## 6. Framer Motion — Interaction Choreography

### Step transitions
```ts
const pageVariants = {
  enter: (dir: 1 | -1) => ({ x: dir * 20, opacity: 0, filter: 'blur(2px)' }),
  center: { x: 0, opacity: 1, filter: 'blur(0px)' },
  exit:   (dir: 1 | -1) => ({ x: dir * -20, opacity: 0, filter: 'blur(2px)' }),
};
// dir = +1 forward, -1 backward — passed as custom prop
```

### Token row list (`paste` step)
- `<AnimatePresence>` wrapping a `motion.div` per token.
- Use `layout` prop so reordering (dedup) animates position.

### Review row status icons
- Icon swap (✓ / ✗ / △ / ⊘) uses `AnimatePresence` with a `rotate` + `scale` exit/enter.

### "Already in plan" badge
- Springs in with `type: 'spring', stiffness: 400, damping: 20`.

### Success checkmark (post-create)
- SVG `<path>` with `pathLength` motion value driven from 0→1 on mount.

### Stat counters (form step)
- `useMotionValue` + `useTransform` for counting-up number animation.

### Upload drop zone
- Border pulses with `animate={{ borderColor: ['#6d28d9', '#a78bfa', '#6d28d9'] }}` on drag-over.

### Button loading states
- Shimmer sweep across button background using a `linear-gradient` animated via `motion.div` positioned absolutely.

---

## 7. Visual & Aesthetic System

### Color tokens
```css
--surface-base:     #0f0f11;   /* near-black */
--surface-raised:   #18181b;   /* zinc-900 */
--surface-overlay:  #27272a;   /* zinc-800 */
--border-subtle:    #3f3f46;   /* zinc-700 */
--text-primary:     #fafafa;
--text-secondary:   #a1a1aa;   /* zinc-400 */
--text-muted:       #52525b;   /* zinc-600 */
--accent-violet:    #7c3aed;
--accent-violet-lt: #a78bfa;
--accent-amber:     #d97706;
--accent-amber-lt:  #fcd34d;
--success:          #059669;
--danger:           #dc2626;
```

### Typography
- **Display / labels:** `JetBrains Mono` — monospace backbone, everything feels like a terminal
- **Body / descriptions:** `DM Sans` — warm, readable contrast to the mono
- Sizes: 9px caps labels → 10px body → 11px primary → 13px headings. Never exceed 14px inside the panel.

### Spacing rhythm
- Base unit: 4px. All padding/gap values are multiples: 4, 8, 12, 16, 20.

---

## 8. Contextual Height Adaptation

Use CSS `@container` (container query) on the modal wrapper:

```css
.fnsku-panel { container-type: size; container-name: fnsku; }

@container fnsku (max-height: 420px) {
  .step-indicator-labels { display: none; }
  .paste-description     { display: none; }
  .review-banner         { padding-block: 6px; }
}

@container fnsku (max-height: 360px) {
  .footer-actions { padding-block: 6px; }
  .footer-actions button { padding-block: 4px; font-size: 9px; }
}
```

Footer buttons:
- **Default:** Full-width pill buttons with icon + label.
- **< 420px height:** Icon only, with tooltip on hover.
- **< 360px height:** Inline compact row, 28px tall.

---

## 9. File & Component Structure

```
components/fba/
├── FbaFnskuPlanInput.tsx      ← orchestrator, reducer, localStorage sync
├── steps/
│   ├── PasteStep.tsx
│   ├── ReviewStep.tsx
│   ├── FormStep.tsx
│   └── PostCreateStep.tsx
├── parts/
│   ├── TokenRow.tsx           ← animated row for paste + review
│   ├── StepIndicator.tsx      ← dots + labels, collapses at small heights
│   ├── FooterActions.tsx      ← contextual height-aware button bar
│   ├── CatalogUploadPanel.tsx ← slide-in CSV uploader
│   └── SuccessTick.tsx        ← SVG path-draw checkmark animation
├── hooks/
│   ├── usePendingCatalog.ts   ← localStorage read/write for pending FNSKUs
│   └── useTodayPlan.ts        ← localStorage today plan, auto-resets at midnight
└── utils/
    ├── parseFnskus.ts
    └── getTodayDate.ts
```

---

## 10. API Contract Changes Needed

| Endpoint | Change |
|----------|--------|
| `POST /api/fba/shipments` | Add `unresolved_fnskus?: string[]` to body |
| `POST /api/fba/fnskus/bulk` | New — accepts `multipart/form-data` CSV, upserts `fba_fnskus` table |
| `GET /api/fba/shipments/today` | New (or existing) — returns today's plan FNSKU list for deduplication |

---

## 11. Implementation Order

1. **`useTodayPlan` + `usePendingCatalog` hooks** — foundation for all state.
2. **`parseFnskus` util** — already exists, extract to own file.
3. **`TokenRow` + `StepIndicator` + `FooterActions`** — shared primitives.
4. **`PasteStep` redesign** — two-column layout, token rows, today-plan badges.
5. **`ReviewStep` enhancements** — 4-state rows, banner, inline upload sub-panel.
6. **`CatalogUploadPanel`** — drag-drop CSV, POST, re-validate.
7. **`FormStep` summary grid** — stat counters, stagger animation.
8. **`PostCreateStep`** — success tick, pending catalog list.
9. **Container query CSS** — height adaptation.
10. **Framer Motion choreography pass** — wire all `custom` direction props, blur transitions, spring badges.
11. **`FbaFnskuPlanInput` orchestrator** — replace `useState` with `useReducer`, compose all steps.

---

## 12. Key UX Decisions Summary

| Decision | Rationale |
|----------|-----------|
| No textarea in review/form | Prevents accidental edits; paste is the only input surface |
| FNSKU left, number right | Spec requirement; aligns with data-table conventions |
| Always-enabled Confirm (even with not-found) | Ops shouldn't be blocked by catalog gaps |
| Persistent pendingCatalog in localStorage | Survives page refresh; ops can return to upload later |
| Post-create step instead of immediate dismiss | Surfaces catalog debt at the highest-attention moment |
| Same-day deduplication via local store + API | Prevents accidental double-plans without network round-trip on paste |
| Inline upload panel (not a new modal) | Keeps focus inside the panel; avoids modal-over-modal |
| Container queries for height | More robust than JS-based viewport detection; zero layout shift |