# FBA Alignment Implementation Plan

**Generated:** 2026-03-26  
**Codebase:** USAV-Orders-Backend (Next.js FBA warehouse management)  
**Scope:** 6 targeted fixes + 1 integration testing checklist. No renames, no big refactors — additions and surgical edits only.

---

## Table of Contents

1. [Shared Qty Utility](#section-1-shared-qty-utility)
2. [Shared FbaSelectionItemList Component](#section-2-shared-fbaselectionitemlist-component)
3. [Plan Ref Auto-Generation in Create Form](#section-3-plan-ref-auto-generation-in-create-form)
4. [Accessible Create Plan Button](#section-4-accessible-create-plan-button)
5. [StationTesting → FBA Plan Integration](#section-5-stationtesting--fba-plan-integration)
6. [Fix Plan Due Date Display](#section-6-fix-plan-due-date-display)
7. [Integration & Testing](#section-7-integration--testing)

---

## Section 1: Shared Qty Utility

**Problem:** Three different qty calculation approaches exist across the codebase with no shared source of truth.

| Location | Current Logic |
|---|---|
| `FbaWorkspaceScanField.tsx` line 319–323 | `actual > 0 ? actual : max(0, expected - actual)` |
| `SelectionFloatingBar.tsx` line 20–24 | Same expression, duplicated |
| `FbaPlanCard.tsx` line 96–97 | `total_expected_qty > 0 ? total_expected_qty : max(1, total_items)` |
| `FbaSidebar.tsx` line 417 | `plan.total_expected_qty > 0 ? plan.total_expected_qty : Math.max(1, plan.total_items)` (in `handleCommitPlanQty`) |

**Risk:** Low — pure utility functions with no side effects.

### 1.1 Create `src/lib/fba/qty.ts`

**File to create:** `src/lib/fba/qty.ts`

This file exports two pure functions:

**`resolveFbaItemDisplayQty(item)`**
- Input: an object with `actual_qty?: number | null` and `expected_qty?: number | null`
- Rule: if `actual_qty > 0`, return `actual_qty`; otherwise return `Math.max(0, (expected_qty ?? 0) - (actual_qty ?? 0))`
- This is the "remaining to scan" interpretation: once actuals exist, show actuals; otherwise show how many more are needed.
- Handles null/undefined by coercing to `Number(value || 0)`.

**`resolveFbaPlanQtyBase(plan)`**
- Input: an object with `total_expected_qty?: number` and `total_items?: number`
- Rule: if `total_expected_qty > 0`, return `total_expected_qty`; else return `Math.max(1, total_items ?? 0)`
- Used for plan-level display and for the qty draft edit in the sidebar.

```typescript
// Exact function signatures for the new file:

export interface FbaItemQtySource {
  actual_qty?: number | null;
  expected_qty?: number | null;
}

export interface FbaPlanQtySource {
  total_expected_qty?: number | null;
  total_items?: number | null;
}

export function resolveFbaItemDisplayQty(item: FbaItemQtySource): number {
  const actual = Number(item.actual_qty || 0);
  const expected = Number(item.expected_qty || 0);
  if (actual > 0) return actual;
  return Math.max(0, expected - actual);
}

export function resolveFbaPlanQtyBase(plan: FbaPlanQtySource): number {
  const expectedQty = Number(plan.total_expected_qty || 0);
  const totalItems = Number(plan.total_items || 0);
  if (expectedQty > 0) return expectedQty;
  return Math.max(1, totalItems);
}
```

### 1.2 Files to Update

Replace inline qty expressions with the shared utility:

**`src/components/fba/sidebar/FbaWorkspaceScanField.tsx`**
- Add import: `import { resolveFbaItemDisplayQty } from '@/lib/fba/qty';`
- Lines 319–323: Replace the inline IIFE block with `resolveFbaItemDisplayQty(item)`

**`src/components/fba/table/SelectionFloatingBar.tsx`**
- Add import: `import { resolveFbaItemDisplayQty } from '@/lib/fba/qty';`
- Lines 20–24: Replace `actual > 0 ? actual : remaining` in the `reduce` with `resolveFbaItemDisplayQty(item)`

**`src/components/station/upnext/FbaPlanCard.tsx`**
- Add import: `import { resolveFbaPlanQtyBase } from '@/lib/fba/qty';`
- Line 96–97: Replace inline `qtyBase` computation with `resolveFbaPlanQtyBase(plan)`

**`src/components/fba/sidebar/FbaSidebar.tsx`**
- Add import: `import { resolveFbaPlanQtyBase } from '@/lib/fba/qty';`
- Line 417 in `handleCommitPlanQty`: Replace inline `qtyBase` computation with `resolveFbaPlanQtyBase(plan)`

### 1.3 Dependencies

None. This section has no dependencies and can be done first.

---

## Section 2: Shared FbaSelectionItemList Component

**Problem:** The selected items list is rendered twice — once in `FbaWorkspaceScanField` (inside the tracking card) and once (in summary form) in `SelectionFloatingBar`. Both must stay in sync when the display logic changes. The `FbaWorkspaceScanField` version is the richer one (shows plan label, FNSKU subtext, qty, focus button, animations).

**Risk:** Medium — involves extracting animated JSX from two locations and threading props correctly.

### 2.1 Create `src/components/fba/sidebar/FbaSelectionItemList.tsx`

**File to create:** `src/components/fba/sidebar/FbaSelectionItemList.tsx`

Extract the `<motion.ul>` block from `FbaWorkspaceScanField` (lines 315–365) into a standalone component.

**Props interface:**
```typescript
export interface FbaSelectionItemListProps {
  /** The enriched items from the workspace selection. */
  selectedItems: EnrichedItem[];
  /** When set, items from this plan float to the top. */
  activePlanId: number | null;
  /** Chrome tokens for theme-aware styling (scanChrome from FbaWorkspaceScanField). */
  scanChrome: ReturnType<typeof fbaWorkspaceScanChrome[keyof typeof fbaWorkspaceScanChrome]>;
  /** Emits fba-print-focus-plan event on item click. */
  onFocusPlan?: (planId: number) => void;
  /** Optional: suppress plan label even when multiple plans selected. */
  hidePlanLabel?: boolean;
}
```

**What the component renders:**
- A `<motion.ul>` with `layout` and `AnimatePresence` wrapping sorted item rows.
- Each item row is a `<motion.li>` with enter/exit framer variants matching the existing `framerPresence.upNextRow` pattern already used in the parent.
- Each row shows:
  - `display_title || fnsku` in bold uppercase
  - `fnsku` subtext using `scanChrome.fnskuSubtext` class
  - Plan label (via `getPlanLabel(item)`) when `selectedPlanIds.length > 1` and `!hidePlanLabel`
  - Qty via `resolveFbaItemDisplayQty(item)` from Section 1
  - A click handler that fires `window.dispatchEvent(new CustomEvent('fba-print-focus-plan', { detail: { planId, shipmentId: planId } }))`

**Sorting logic** (copied from `FbaWorkspaceScanField` `selectedItemRows` memo):
- Items from `activePlanId` come first
- Then alphabetical by `getPlanLabel`, then by `display_title || fnsku`

**Import the component into `src/components/fba/sidebar/index.ts`:**
```typescript
export { FbaSelectionItemList } from './FbaSelectionItemList';
```

### 2.2 Update `FbaWorkspaceScanField.tsx`

- Remove the inline `selectedItemRows` memo (lines 198–211) — it moves into the component.
- Remove the `<motion.ul>...</motion.ul>` block (lines 315–365) inside the tracking card `<div>`.
- Replace with: `<FbaSelectionItemList selectedItems={selectedItems} activePlanId={activePlanId} scanChrome={scanChrome} />`
- Keep the "Selected items" header and "Clear" button row (lines 303–313) in place — these stay in `FbaWorkspaceScanField` as they are layout chrome, not the list itself.
- Add import of `FbaSelectionItemList` from `'./FbaSelectionItemList'`.

### 2.3 Update `SelectionFloatingBar.tsx`

The floating bar currently does NOT render the item list — it shows a summary line of counts and a pairing instruction. The requirement says to reuse `FbaSelectionItemList` here to replace the "design" and include it.

**Approach (additive, not destructive):**
- Import `FbaSelectionItemList` from `'../sidebar/FbaSelectionItemList'`.
- Import `fbaWorkspaceScanChrome` from `'@/utils/staff-colors'` and use a fixed `'blue'` theme (or accept a `stationTheme` prop if the bar's parent passes it down — check `SelectionFloatingBar` consumers).
- Below the existing pill badges row, conditionally render a `<FbaSelectionItemList>` block when `n > 0`. Wrap in a collapsible `<details>` element or a simple conditional div if the bar has scroll space. Given that `SelectionFloatingBar` is a bottom sticky bar, keep it compact: only expand the item list if `n <= 5`, otherwise show a "View N items" chevron toggle.
- The qty total shown in the violet badge (`Qty {qty}`) continues to use `resolveFbaItemDisplayQty` from Section 1 (already done by that point).

### 2.4 Dependencies

Depends on Section 1 (uses `resolveFbaItemDisplayQty`). Must be done after Section 1.

---

## Section 3: Plan Ref Auto-Generation in Create Form

**Problem:** `FbaCreateShipmentForm` exposes `shipment_ref` as a dumb text field with a static placeholder `"FBA-03-24-26"`. The user must type the ref manually even though `buildFbaPlanRefFromIsoDate` already computes it from `due_date`. If `due_date` is not set and `shipment_ref` is blank, the API falls back to today's date — but the user has no visibility into what ref will be saved. The bug case `FBA-00-00-00` can appear if the parser fails.

**Risk:** Medium — form state management change; the form is a controlled component whose state lives in the parent.

### 3.1 Context: How `FbaCreateShipmentForm` Is Used

`FbaCreateShipmentForm` is a purely presentational component (`FbaCreateShipmentFormProps` interface in `src/components/fba/FbaCreateShipmentForm.tsx`). All state management (`form`, `setForm`, `onSubmit`) lives in the **parent** component that renders it. The form component receives `setForm` and calls it directly.

The parent must track two extra pieces:
1. `lastAutoRef: string` — the most recently auto-derived ref, so we know if the user has overridden it.
2. The live preview string computed from `form.due_date`.

**Strategy:** Add a `derivedRef` computed value inside `FbaCreateShipmentForm` itself using a `useMemo`. The component can check whether the current `form.shipment_ref` equals either `''` or `derivedRef` to know if it should update automatically on `due_date` change. A `useRef` inside the component tracks the "last auto value" to detect user overrides without exposing extra props to the parent.

### 3.2 Changes to `FbaCreateShipmentForm.tsx`

**Add at the top of the component function body:**
```typescript
// Import buildFbaPlanRefFromIsoDate
import { buildFbaPlanRefFromIsoDate } from '@/lib/fba/plan-ref';

// Inside component:
const derivedRef = useMemo(
  () => form.due_date ? buildFbaPlanRefFromIsoDate(form.due_date) : '',
  [form.due_date]
);
const lastAutoRefRef = useRef<string>('');
const isAutoRef = form.shipment_ref === '' || form.shipment_ref === lastAutoRefRef.current;
const refIsInvalid = form.shipment_ref === 'FBA-00-00-00';
```

**Add a `useEffect` for auto-sync:**
```typescript
useEffect(() => {
  if (!derivedRef) return;
  // Only auto-update if the user hasn't manually typed a custom ref
  if (isAutoRef) {
    lastAutoRefRef.current = derivedRef;
    setForm((f) => ({ ...f, shipment_ref: derivedRef }));
  }
}, [derivedRef]); // eslint-disable-line react-hooks/exhaustive-deps
```

**Update the Plan ID field JSX:**
- Change `hintBelow` to render a live preview badge:
  ```tsx
  hintBelow={
    <div className="space-y-1">
      {derivedRef && derivedRef !== 'FBA-00-00-00' ? (
        <p className="text-[10px] font-mono text-emerald-700">
          Will be saved as: {form.shipment_ref || derivedRef}
        </p>
      ) : null}
      {!isAutoRef ? (
        <button
          type="button"
          className="text-[10px] text-blue-600 underline"
          onClick={() => {
            lastAutoRefRef.current = derivedRef;
            setForm((f) => ({ ...f, shipment_ref: derivedRef }));
          }}
        >
          Reset to auto
        </button>
      ) : null}
      <p className="text-[10px] leading-snug text-gray-500">
        Stored as shipment_ref — not the internal DB row id or Amazon's FBA shipment id.
      </p>
    </div>
  }
  ```

**Update `canSubmit` guard:**
```typescript
const canSubmit = Boolean(
  form.shipment_ref.trim() &&
  form.shipment_ref !== 'FBA-00-00-00' &&
  Number(form.assigned_tech_id)
);
```

**Add warning text when ref is invalid:**
- Below the Plan ID input, show a `<p className="text-[10px] text-amber-600">` if `refIsInvalid`:
  ```
  "Invalid plan ref (FBA-00-00-00). Set a valid due date or type a custom ref."
  ```

**Update the `onChange` handler for `shipment_ref` input:**
- When the user manually changes the field, clear `lastAutoRefRef.current` so the "Reset to auto" link appears:
  ```typescript
  onChange={(e) => {
    lastAutoRefRef.current = ''; // user override
    setForm((f) => ({ ...f, shipment_ref: e.target.value }));
  }}
  ```

### 3.3 No Changes Needed to API Route

`src/app/api/fba/shipments/route.ts` already handles `shipment_ref` correctly — if provided, it uses it; if omitted or blank, it auto-generates from `due_date`. The form now ensures a non-blank ref is always submitted.

### 3.4 Dependencies

No dependencies on other sections. Can be done independently.

---

## Section 4: Accessible Create Plan Button

**Problem:** The `FbaCreateShipmentForm` exists but is only reachable via `emitOpenAddFba()` in the Admin panel (`FbaCatalogSidebarInner` in `FbaSidebar.tsx`). The workspace sidebar (`FbaWorkspaceSidebarInner`) has no "Create Plan" button. The `FbaPlansUpNext` empty state (`EmptyPlansSlate`) shows just a Package icon with "No open plans" — no actionable CTA.

**Key event mechanism:** `emitOpenAddFba()` dispatches `'admin-fba-open-add'`. `FBAManagementTab.tsx` listens to this event and sets `isAddOpen = true`. However, `FBAManagementTab` is the **admin catalog** form (for FNSKU mappings), NOT the shipment plan create form. The current `emitOpenAddFba` in `FbaWorkspaceSidebarInner` is calling the wrong listener for the intended purpose.

**Note:** There is currently NO listener for `'admin-fba-open-add'` on the `/fba` workspace page. The `FbaFnskuChecklist` and `StationFbaInput` components handle plan creation inline (via their own form states). The `FbaCreateShipmentForm` component is exported but **not currently instantiated anywhere** — it is a ready-to-use component awaiting a host.

**Risk:** Medium — requires understanding the event wiring and adding a new overlay/panel to the `/fba` page.

### 4.1 Create a New Event: `'fba-open-create-plan'`

To avoid confusion with `'admin-fba-open-add'` (which opens the FNSKU catalog row form), introduce a distinct event:

```typescript
// In a new constants file or co-located in FbaCreateShipmentForm.tsx:
export const FBA_OPEN_CREATE_PLAN_EVENT = 'fba-open-create-plan';
```

### 4.2 Create `FbaCreatePlanModal.tsx`

**File to create:** `src/components/fba/FbaCreatePlanModal.tsx`

This component:
- Listens for `FBA_OPEN_CREATE_PLAN_EVENT` on mount.
- Manages all local state: `form: FbaCreateShipmentFormState`, `submitting`, `submitError`.
- Implements `addItem`, `removeItem`, `updateItem` handlers.
- Implements `onSubmit` — POSTs to `/api/fba/shipments`, then dispatches `'fba-plan-created'` on success.
- Renders as a fixed-position modal overlay (same pattern as `FbaQuickAddFnskuModal`).
- Renders `<FbaCreateShipmentForm>` inside the modal body.
- Fetches the staff directory via `useActiveStaffDirectory()` for the staff dropdowns.

**Initial form state:**
```typescript
const INITIAL_FORM: FbaCreateShipmentFormState = {
  shipment_ref: '',
  destination_fc: '',
  due_date: '',
  notes: '',
  assigned_tech_id: '',
  assigned_packer_id: '',
  items: [{ fnsku: '', expected_qty: '1' }],
};
```

**Submit handler:**
```typescript
const handleSubmit = async () => {
  setSubmitting(true);
  setSubmitError(null);
  try {
    const res = await fetch('/api/fba/shipments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shipment_ref: form.shipment_ref.trim() || undefined,
        destination_fc: form.destination_fc.trim() || undefined,
        due_date: form.due_date || undefined,
        notes: form.notes.trim() || undefined,
        assigned_tech_id: form.assigned_tech_id || undefined,
        assigned_packer_id: form.assigned_packer_id || undefined,
        items: form.items
          .filter((i) => i.fnsku.trim())
          .map((i) => ({ fnsku: i.fnsku.trim(), expected_qty: Number(i.expected_qty) || 1 })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to create plan');
    window.dispatchEvent(new Event('fba-plan-created'));
    setOpen(false);
    setForm(INITIAL_FORM);
  } catch (err: any) {
    setSubmitError(err?.message || 'Failed');
  } finally {
    setSubmitting(false);
  }
};
```

### 4.3 Mount `FbaCreatePlanModal` on the `/fba` Page

**File to update:** `src/app/fba/page.tsx`

In `FbaPageContent`, add `<FbaCreatePlanModal stationTheme={stationTheme} />` alongside the existing `<FbaQuickAddFnskuModal stationTheme={stationTheme} />`.

### 4.4 Add "+ New Plan" Button to `FbaWorkspaceSidebarInner`

**File to update:** `src/components/fba/sidebar/FbaSidebar.tsx`

**Where to add:** In `FbaWorkspaceSidebarInner`, in the section that renders the plans list (around line 603–610), add a header row above `<FbaPlansUpNext>`:

```tsx
{activeTab !== 'shipped' && activeTab !== 'paired' ? (
  <div aria-label="Open plans" className="w-full shrink-0 border-t border-gray-100">
    {/* NEW: Plans header with Create button */}
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
        Open plans
      </span>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('fba-open-create-plan'))}
        className="flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-purple-700 transition-colors hover:bg-purple-100"
      >
        <Plus className="h-3 w-3" />
        New plan
      </button>
    </div>
    <FbaPlansUpNext {...summaryPlansListProps} />
  </div>
) : null}
```

Note: `Plus` is already imported in `FbaSidebar.tsx` (line 6).

### 4.5 Add Empty State CTA to `FbaPlansUpNext`

**File to update:** `src/components/station/upnext/FbaPlansUpNext.tsx`

Replace the current `EmptyPlansSlate` component (lines 49–64) with an enhanced version that accepts an `onCreatePlan` callback:

```tsx
function EmptyPlansSlate({
  label,
  stationTheme,
  onCreatePlan,
}: {
  label: string;
  stationTheme: StationTheme;
  onCreatePlan?: () => void;
}) {
  const chrome = fbaSidebarThemeChrome[stationTheme];
  return (
    <motion.div ...className={chrome.emptyShell}>
      <div className="flex items-center justify-between gap-3">
        <p className={...}>{label}</p>
        <Package className={...} />
      </div>
      {onCreatePlan ? (
        <button
          type="button"
          onClick={onCreatePlan}
          className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-purple-700 underline"
        >
          + Create new plan
        </button>
      ) : null}
    </motion.div>
  );
}
```

Update `FbaPlansUpNextProps` to include `onCreatePlan?: () => void`.

Pass it down from `FbaWorkspaceSidebarInner` as:
```typescript
onCreatePlan: () => window.dispatchEvent(new CustomEvent('fba-open-create-plan')),
```

Update `summaryPlansListProps` to include `onCreatePlan`.

### 4.6 Dependencies

- Section 3 should be done first (so the form has auto-ref behavior when opened via this button).
- `FbaCreatePlanModal` must be created before it can be mounted on the page.

---

## Section 5: StationTesting → FBA Plan Integration

**Problem:** When a tech scans an FNSKU at the tech station (`StationTesting.tsx`), the call goes to `/api/tech/scan-fnsku` which logs the scan and returns order context — but there is no bridge to the FBA workspace plan list. The tech has no UI affordance to say "add this FNSKU to today's FBA plan."

**Existing event infrastructure:** `StationTesting` already fires `window.dispatchEvent(new CustomEvent('tech-log-added', ...))` after a successful FNSKU scan (in `useStationTestingController.ts` line 402–431). We can piggyback on this pattern.

**Risk:** High — requires coordination between two separate UI trees (`StationTesting` and the FBA sidebar/workspace). The simplest approach (toast/chip prompt) is lower risk than deep integration.

### 5.1 Emit `fba-fnsku-station-scanned` From Station Controller

**File to update:** `src/hooks/useStationTestingController.ts`

In `handleFnskuScan`, after the success block (after line 432, before the `catch`), add:

```typescript
// After the existing tech-log-added dispatch and triggerGlobalRefresh():
window.dispatchEvent(
  new CustomEvent('fba-fnsku-station-scanned', {
    detail: {
      fnsku: fnsku,
      productTitle: data.order.productTitle ?? null,
      shipmentId: data.shipment?.shipment_id ?? null,
      planRef: data.shipment?.shipment_ref ?? null,
    },
  })
);
```

This fires regardless of whether an existing plan was found, providing the fnsku as the minimum payload.

### 5.2 Create `FbaFnskuScanToast.tsx` in Sidebar

**File to create:** `src/components/fba/sidebar/FbaFnskuScanToast.tsx`

This component:
- Mounts inside `FbaWorkspaceSidebarInner` (in `FbaSidebar.tsx`).
- Listens for `'fba-fnsku-station-scanned'` events.
- When received, shows a dismissible chip/toast at the top of the sidebar scroll area with:
  - FNSKU in monospace
  - Product title (truncated) if available
  - An "Add to plan" button that, when clicked:
    - If there is exactly one open plan (`pendingPlans.length === 1`), calls `/api/fba/shipments/{plan.id}/items` directly (PATCH or POST) with the fnsku.
    - If there are multiple open plans, shows a small inline plan picker (a `<select>` dropdown populated from `pendingPlans`).
    - On success, dispatches `'fba-plan-created'` to refresh.
  - A dismiss "×" button.

**Props:**
```typescript
interface FbaFnskuScanToastProps {
  pendingPlans: FbaPlanQueueItem[];
  stationTheme: StationTheme;
}
```

**Toast auto-dismiss:** Auto-hide after 12 seconds if the user takes no action.

**Example add-to-plan API call:**
```typescript
// POST to add a new item to an existing plan
await fetch(`/api/fba/shipments/${planId}/items`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fnsku, expected_qty: 1 }),
});
```

Check existing API: `src/app/api/fba/shipments/[id]/items` — verify the endpoint supports single-item POST before implementing.

### 5.3 Mount `FbaFnskuScanToast` in `FbaSidebar.tsx`

**File to update:** `src/components/fba/sidebar/FbaSidebar.tsx`

In `FbaWorkspaceSidebarInner`, inside the scroll container `<div data-testid="fba-sidebar-scroll">`, add near the top (after the scan field band):

```tsx
{isBoard && (
  <FbaFnskuScanToast
    pendingPlans={pendingPlans}
    stationTheme={stationTheme}
  />
)}
```

`pendingPlans` is already available in `FbaWorkspaceSidebarInner` state.

### 5.4 Alternative Simpler Flow (Lower Risk)

If the toast/plan-picker approach is too complex for an initial release, a simpler alternative is:

- In `FbaWorkspaceSidebarInner`, listen for `'fba-fnsku-station-scanned'` and store the latest scanned fnsku in local state `lastScannedFnsku`.
- Display a small pill badge in the sidebar header: `"FNSKU scanned: X00ABC — Add to today's plan →"` that links to the plan detail page for the matching plan.
- This avoids any inline plan picking and instead routes the tech to the plan page.

### 5.5 Dependencies

- Section 4 (Create Plan button) should be done first, so a plan exists before the tech scans.
- The API endpoint `POST /api/fba/shipments/[id]/items` must be verified to support adding items to existing plans.

---

## Section 6: Fix Plan Due Date Display

**Problem:** `FbaPlanCard` (and several other components) use `new Date(plan.due_date).toLocaleDateString(...)` which is timezone-unsafe. For a `due_date` stored as `YYYY-MM-DD` (date-only string, no time), `new Date('2026-03-26')` parses as **UTC midnight**, which renders as March 25 in PST (UTC-7/UTC-8). The codebase already has `toPSTDateKey` and `formatDatePST` in `src/utils/date.ts` that handle this correctly.

**Risk:** Low — drop-in replacements with no logic changes.

### 6.1 Fix `FbaPlanCard.tsx` (Highest Priority)

**File to update:** `src/components/station/upnext/FbaPlanCard.tsx`

`toPSTDateKey` and `getCurrentPSTDateKey` are already imported (line 8). The bug is in the expanded panel date cell.

**Lines 211–217 (inside expanded panel):**
```tsx
// CURRENT (timezone-unsafe):
{plan.due_date
  ? new Date(plan.due_date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  : 'Not set'}

// REPLACE WITH (PST-safe):
{plan.due_date
  ? (() => {
      const dateKey = toPSTDateKey(plan.due_date);
      if (!dateKey) return 'Not set';
      const [y, m, d] = dateKey.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    })()
  : 'Not set'}
```

Alternatively, import and use `formatDatePST` (already exported from `src/utils/date.ts`):
```tsx
import { formatDatePST, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
// ...
{plan.due_date ? formatDatePST(plan.due_date) : 'Not set'}
```

`formatDatePST` returns `"M/D/YYYY"` format (e.g., `"3/26/2026"`). If `"Mar 26, 2026"` format is required, use the IIFE approach above.

### 6.2 Audit and Fix `FbaLabelQueue.tsx`

**File to update:** `src/components/fba/FbaLabelQueue.tsx`

Two occurrences:
- Line 161: `Due: {new Date(shipment.due_date).toLocaleDateString()}` → Replace with `Due: {formatDatePST(shipment.due_date) ?? 'Unknown'}`
- Line 198: `` `Due: ${new Date(shipment.due_date).toLocaleDateString()} · ` `` → Replace with `` `Due: ${formatDatePST(shipment.due_date) ?? 'Unknown'} · ` ``

Add import: `import { formatDatePST } from '@/utils/date';` (already imports `formatDateWithOrdinal` and `getCurrentPSTDateKey` so the import path is established).

### 6.3 Fix `FbaFnskuChecklist.tsx`

**File to update:** `src/components/fba/FbaFnskuChecklist.tsx`

- Line 268: `new Date().toLocaleDateString('en-US', ...)` — this renders today's date but uses the local JS Date which is fine for "today" since no timezone-at-midnight issue exists here. However for consistency with PST: replace with `new Date(getCurrentPSTDateKey() + 'T12:00:00').toLocaleDateString('en-US', ...)`. Low priority.
- Line 843: `` `due ${new Date(planDueDate).toLocaleDateString()}` `` → Replace with `formatDatePST(planDueDate)`.

### 6.4 Check `FbaShipmentBoard.tsx`

`FbaShipmentBoard.tsx` already imports `toPSTDateKey` and `getCurrentPSTDateKey` from `@/utils/date`. Audit the date rendering in the board rows (around lines 340–380) for any `new Date(due_date)` calls. The `FbaShipmentBoard.tsx` file uses `toPSTDateKey` for grouping (line 115 area) — verify no direct `new Date().toLocaleDateString()` calls in the JSX render paths.

### 6.5 Fix `FbaSidebar.tsx` Sort Comparator

**File to update:** `src/components/fba/sidebar/FbaSidebar.tsx`

Line 367 sort comparator: `new Date(a.due_date).getTime() - new Date(b.due_date).getTime()`

For date-only strings this is actually fine for sorting (UTC midnight is consistent across both operands), but replace for semantic correctness:
```typescript
return String(a.due_date || '').localeCompare(String(b.due_date || ''));
```
ISO date strings sort correctly with string comparison.

### 6.6 Dependencies

None. All fixes in this section are independent of other sections.

---

## Section 7: Integration & Testing

### End-to-End Flows to Verify

---

#### Flow 1: Create Plan → Ref Auto-Derives From Date

**Steps:**
1. Open `/fba` workspace.
2. Click "New Plan" button in the sidebar (Section 4).
3. Modal opens with `FbaCreateShipmentForm`.
4. Set `due_date` to a future date.
5. Observe: `shipment_ref` field auto-populates with `FBA-MM-DD-YY`.
6. Observe: Live preview badge shows "Will be saved as: FBA-03-26-26".
7. Manually edit `shipment_ref` to a custom value.
8. Observe: "Reset to auto" link appears.
9. Click "Reset to auto" — ref reverts to derived value.
10. Leave `due_date` blank and type nothing in `shipment_ref` — submit button remains disabled.
11. Submit with a valid date and tech assigned.
12. Sidebar plan list refreshes and shows new plan.

**Files involved:** `FbaCreateShipmentForm.tsx`, `FbaCreatePlanModal.tsx`, `FbaSidebar.tsx`, `FbaPlansUpNext.tsx`, `src/lib/fba/plan-ref.ts`

---

#### Flow 2: Station Scan FNSKU → Plan List Updates / Add to Plan Flow

**Steps:**
1. Open tech station page with a tech user.
2. Scan a valid FNSKU barcode.
3. Observe: `'fba-fnsku-station-scanned'` event fires (verify via browser DevTools `window.addEventListener`).
4. On the `/fba` workspace (can be open in a second tab or same page if sidebar is visible):
   - Observe: Toast/chip appears in the sidebar with the FNSKU and "Add to plan" button.
5. Click "Add to plan" — if one plan exists, item is added; if multiple, plan picker appears.
6. Dismiss the toast.
7. Verify the plan's item count updates in the sidebar.

**Files involved:** `useStationTestingController.ts`, `FbaFnskuScanToast.tsx`, `FbaSidebar.tsx`

---

#### Flow 3: Select Items in Board → Sidebar Shows Unified Selection List With Tracking

**Steps:**
1. Open `/fba` board tab.
2. Check 2+ items from the same plan.
3. Observe: `SelectionFloatingBar` appears at the bottom of the board with correct item count and Qty.
4. Observe: Sidebar `FbaWorkspaceScanField` shows the tracking card with the unified `FbaSelectionItemList`.
5. Verify each item shows `display_title || fnsku`, FNSKU subtext, and correct qty from `resolveFbaItemDisplayQty`.
6. Check items from 2 different plans.
7. Observe: Plan label column appears in the item list.
8. Enter Amazon FBA shipment ID in sidebar — verify it persists on blur.
9. Click an item row in the sidebar list — verify `fba-print-focus-plan` event fires and the board scrolls/highlights the plan.

**Files involved:** `FbaWorkspaceScanField.tsx`, `SelectionFloatingBar.tsx`, `FbaSelectionItemList.tsx`, `src/lib/fba/qty.ts`, `FbaWorkspaceContext.tsx`

---

#### Flow 4: Qty Shows Correctly in All 3 Display Locations

**Steps:**
1. Select an item with `actual_qty = 0`, `expected_qty = 5`.
   - Expect all 3 displays to show **Qty 5** (remaining = max(0, 5-0) = 5).
2. Select an item with `actual_qty = 3`, `expected_qty = 5`.
   - Expect all 3 displays to show **Qty 3** (actual > 0, show actual).
3. Select a plan with `total_expected_qty = 20`, `total_items = 3`.
   - Expect plan card to show **20** (expected takes precedence).
4. Select a plan with `total_expected_qty = 0`, `total_items = 4`.
   - Expect plan card to show **4** (max(1, 4)).

**Check locations:**
- `FbaWorkspaceScanField` item list (sidebar tracking card)
- `SelectionFloatingBar` Qty badge (bottom bar)
- `FbaPlanCard` qty row (sidebar plan list expanded panel)

**Files involved:** `src/lib/fba/qty.ts`, `FbaWorkspaceScanField.tsx`, `SelectionFloatingBar.tsx`, `FbaPlanCard.tsx`

---

#### Flow 5: Plan Day Shows Correct PST Date

**Steps:**
1. Create a plan with `due_date = '2026-03-26'`.
2. Open the plan card in the sidebar and expand it.
3. Observe the "Due" cell shows **Mar 26, 2026** (not Mar 25).
4. Verify in PST timezone (UTC-7) — the date should not shift by 1 day.
5. Check `FbaLabelQueue` — any plans with due dates display correctly.
6. Check `FbaFnskuChecklist` footer — due date label is correct.

**Files involved:** `FbaPlanCard.tsx`, `FbaLabelQueue.tsx`, `FbaFnskuChecklist.tsx`, `src/utils/date.ts`

---

### Implementation Sequence (Recommended Order)

```
Step 1 (Independent):  Section 1 — Create src/lib/fba/qty.ts
Step 2 (Independent):  Section 6 — Fix date display (no dependencies)
Step 3 (After Step 1): Section 2 — Create FbaSelectionItemList (uses qty utility)
Step 4 (Independent):  Section 3 — Plan ref auto-generation in form
Step 5 (After Step 4): Section 4 — Create FbaCreatePlanModal + New Plan button
Step 6 (After Step 5): Section 5 — StationTesting → FBA scan event + toast
Step 7:                Section 7 — Integration testing of all flows
```

---

### Risk Summary

| Section | Risk | Reason |
|---|---|---|
| 1 — Qty utility | Low | Pure functions, no side effects |
| 2 — FbaSelectionItemList | Medium | Animated component extraction, prop threading |
| 3 — Plan ref auto-gen | Medium | Controlled form state side effect via useEffect |
| 4 — Create Plan button | Medium | New modal host + event wiring |
| 5 — Station scan integration | High | Cross-UI tree event, new API call, plan picker UX |
| 6 — Date display fix | Low | Drop-in function replacement |

---

## Critical Files for Implementation

- `src/components/fba/FbaCreateShipmentForm.tsx` — Section 3 auto-ref logic lives here
- `src/components/fba/sidebar/FbaSidebar.tsx` — Section 4 New Plan button + Section 5 toast mount
- `src/components/station/upnext/FbaPlanCard.tsx` — Section 6 timezone fix + Section 1 qty utility consumer
- `src/hooks/useStationTestingController.ts` — Section 5 `fba-fnsku-station-scanned` event emit
- `src/components/fba/sidebar/FbaWorkspaceScanField.tsx` — Section 2 FbaSelectionItemList extraction point

---

*End of plan. All file paths are relative to the project root `/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/`.*
