# FBA Print-Ready Table — Detailed Refactor Plan

> **Context:** This table is the operational nerve centre between a planned FBA shipment and a physical UPS drop-off. Every row is an FNSKU that needs two labels: (1) a unit FNSKU sticker covering the manufacturer barcode, and (2) a carton-level FBA Box ID + UPS carrier label. The table drives a sidebar that captures the Amazon Shipment ID and UPS tracking number before those labels can print. This plan is written with that exact two-label workflow in mind.
>
> **Aesthetic:** Stays light mode. Industrial-precise. JetBrains Mono for codes, DM Sans for prose. Violet FBA accent, amber for warnings/pending, red for overdue/blocked, emerald for shipped/ready.

---

## 0. Conceptual Model — What the Table Actually Represents

```
Day Bucket
 └── Shipment Group  (one Amazon FBA Shipment ID)
      └── Item Row   (one FNSKU × qty)
           ├── Status: ready_to_print | needs_print | pending_reason | shipped
           └── Labels needed: [FNSKU unit label] + [FBA Box ID + UPS carrier label]
```

### Industry workflow context
Per FBA labeling standards: the FNSKU label goes on every **unit** (covers UPC/EAN), and the FBA Box ID + UPS carrier label goes on every **carton** after shipment creation. Items in "print queue" = FNSKU unit labels are ready to print but may be blocked if:
- Out of stock (can't physically label what isn't there)
- Failed QC (item condition rejected — needs re-inspection or disposal)
- Scan missed by tech/packer (status ambiguous — force "needs print" manually)

---

## 1. State Architecture

### Replace scattered `useState` → single `useReducer`

```ts
type ItemStatus =
  | 'ready_to_print'
  | 'needs_print'            // manually flagged — tech/packer scan missed
  | 'pending_out_of_stock'
  | 'pending_qc_fail'
  | 'shipped';

type PendingReason = 'out_of_stock' | 'qc_fail' | null;

interface EnrichedItem extends PrintQueueItem {
  status: ItemStatus;
  pending_reason: PendingReason;
  pending_reason_note?: string; // free text from tech
  expanded: boolean;            // inline detail row open
}

interface TableState {
  items: EnrichedItem[];
  selected: Set<number>;        // item_ids
  loading: boolean;
  error: string | null;
  expandedItemId: number | null;
  viewMode: 'by_day' | 'by_shipment';
  dayFilter: string | null;     // ISO date string, null = today
}

type TableAction =
  | { type: 'SET_ITEMS'; payload: EnrichedItem[] }
  | { type: 'TOGGLE_SELECT'; id: number }
  | { type: 'SELECT_ALL' }
  | { type: 'DESELECT_ALL' }
  | { type: 'SELECT_SHIPMENT'; shipment_id: number }
  | { type: 'TOGGLE_EXPAND'; id: number }
  | { type: 'MARK_NEEDS_PRINT'; id: number }
  | { type: 'SET_PENDING_REASON'; id: number; reason: PendingReason; note?: string }
  | { type: 'REMOVE_FROM_PLAN'; id: number }   // qty=1 items only
  | { type: 'SET_VIEW_MODE'; mode: 'by_day' | 'by_shipment' }
  | { type: 'SET_DAY_FILTER'; date: string | null }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null };
```

---

## 2. Layout — Day-First Grouping

### Primary grouping: Day bucket → Shipment group → Items

```
┌─ DAY BUCKET: Today · Mon Mar 23 ──────────────────────────────────────┐
│  [FBA-2024-0042 · XXXXXXXXXX · PHX3]         3 items   2d left        │
│  ├─ [☐] X004NDIUJJ  Wireless Mouse Pad      [1] [0] [1]  ✓ ready     │
│  ├─ [☐] X003SG6CER  USB-C Hub 7-port        [2] [1] [1]  ✓ ready     │
│  └─ [☐] X00492D0TJ  Silicone Case Black     [1] [0] [1]  △ pending   │
│       └── ▸ INLINE EXPAND ROW (animated open)                         │
│            Reason: Out of stock · "Restock expected Tue" [Edit]       │
│            [Mark Needs Print]  [Remove from plan]                     │
├─ [FBA-2024-0043 · —— · SDF8]                1 item    Ship today      │
│  └─ [☐] X00HDJW92K  HDMI 2.1 Cable 6ft     [−Remove] [0] [1]  🖨 needs│
└────────────────────────────────────────────────────────────────────────┘

┌─ DAY BUCKET: Tomorrow · Tue Mar 24 ──────────────────────────────────┐
│  ...collapsed by default if not today                                 │
└───────────────────────────────────────────────────────────────────────┘
```

### Day bucket header bar

```tsx
<DayBucketHeader>
  <DayLabel />          // "Today · Mon Mar 23" or "Tomorrow · Tue Mar 24"
  <DaySummaryBadges />  // "5 items · 2 shipments · 3 ready · 1 pending"
  <CollapseToggle />    // chevron, animates with framer layout
</DayBucketHeader>
```

Today's bucket is open by default; future/past buckets are collapsed.

---

## 3. Column Changes

### Remove
- ❌ X / close button anywhere in the header
- ❌ Radial gradient overlay on the card (clean data surface)

### Rename
- "Planned Units" → **Qty**
- "Already Shipped" → **Printed** (label-print progress, not carrier scan)
- "Left to Ship" → **Remaining**

### New column (appended right)
- **Status** — pill badge with icon

### Final column order
```
[☐]  FNSKU  Product  Qty  Printed  Remaining  Status
```

### Qty = 1 special behaviour
When `expected_qty === 1` AND `actual_qty === 0`:

```tsx
{item.expected_qty === 1 && item.actual_qty === 0 ? (
  <RemoveFromPlanButton itemId={item.item_id} onConfirm={handleRemove} />
) : (
  qtyTag(item.expected_qty, 'planned')
)}
```

The `RemoveFromPlanButton` renders a ghost red `− Remove` link.
On click → inline confirmation appears (no modal):
```
Remove X004NDIUJJ from plan?  [Cancel] [Remove]
```
On confirm → `DELETE /api/fba/shipment-items/:id` → row animates out → undo toast.

---

## 4. Status Badges & Inline Expand Row

### Status badge variants

| Status | Badge | Color |
|--------|-------|-------|
| `ready_to_print` | `✓ Ready` | Emerald |
| `needs_print` | `🖨 Needs Print` | Violet + pulsing dot |
| `pending_out_of_stock` | `△ Out of Stock` | Amber |
| `pending_qc_fail` | `✗ QC Fail` | Red |
| `shipped` | `✓ Shipped` | Zinc/muted |

### "Needs Print" manual override

A tech or packer flags any row as "Needs Print" when a scan was missed.

Trigger: Click status badge of any `ready_to_print` row → small popover:
```
Mark this item as "Needs Print"?
Overrides current status — queues for re-labeling.
[Cancel]  [Mark Needs Print →]
```
Optimistic update → `PATCH /api/fba/shipment-items/:id` async.

### Inline expand row

Click anywhere on a row (except the checkbox) to toggle `expanded`. An `AnimatePresence` + `motion.tr` slides open below it:

```tsx
<AnimatePresence>
  {item.expanded && (
    <motion.tr
      key={`expand-${item.item_id}`}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      <td colSpan={7}>
        <ItemDetailPanel item={item} />
      </td>
    </motion.tr>
  )}
</AnimatePresence>
```

#### `ItemDetailPanel` contents

```
┌──────────────────────────────────────────────────────────┐
│  FNSKU Details                                           │
│  ASIN  B09XXXXXXXX   SKU  MY-SKU-001                    │
│  Shipment  FBA-2024-0042   Amazon ID  FBA17XXXXXXXX     │
│  Destination  PHX3                                       │
│                                                          │
│  Status                                                  │
│  ○ Ready  ○ Needs Print  ○ Pending                      │
│    If Pending → [Reason ▾ Out of stock / QC Fail]       │
│                 [Note for team…]                         │
│                                                          │
│  [Mark Needs Print]        [Remove from plan ×]          │
│                            (only shown if qty = 1)       │
└──────────────────────────────────────────────────────────┘
```

API: `PATCH /api/fba/shipment-items/:id` body `{ status, pending_reason, pending_reason_note }`

---

## 5. Selection System — Three Levels

### Level 1: Individual row checkbox
Clicking the checkbox or anywhere on the row (except expand zone) toggles selection.

### Level 2: Select shipment group
In each `ShipmentGroupHeader`:
```tsx
<button onClick={() => dispatch({ type: 'SELECT_SHIPMENT', shipment_id })}>
  Select all {group.items.length}
</button>
// Changes to "Deselect all in this shipment" when all are selected
```

### Level 3: Global select / deselect all
Header checkbox cycles `none → all → none`. Add explicit text buttons:
```
[☑ Select All]  [☐ Deselect All]   3 / 7 selected
```

### Extended selection bar (floating bottom)

```
[✓]  3 items selected · 2 shipments  ·  Next: add FBA ID + UPS tracking →
                                                          [Clear selection]
```

The "Next" CTA glows amber if all selected items are `ready_to_print` (sidebar input needed).

---

## 6. Pending Items — Display Rules

### In-table treatment

Pending rows render with:
- Row background: `bg-amber-50/60` (out of stock) or `bg-red-50/50` (QC fail)
- Left border accent: `border-l-2 border-l-amber-400` or `border-l-2 border-l-red-400`
- Inline reason sub-text below product title (no expand required for quick scan):

```
[☐]  X00492D0TJ   Silicone Case Black   [−Remove]  [0]  [1]   △ Out of Stock
                  ↳ "Restock expected Tue"
```

### Constraint: Pending must have a reason

If an item is `pending` with no `pending_reason`, render:
```
△ Pending — reason required   [Add reason →]
```
"Add reason" auto-expands the inline panel and focuses the reason select.

### Day bucket summary includes pending count

```
Today · Mon Mar 23    5 items · 3 ready · 1 needs print · 1 pending
```

---

## 7. Framer Motion — Full Choreography Plan

### Day bucket collapse/expand
```ts
const bucketVariants = {
  open:   { height: 'auto', opacity: 1 },
  closed: { height: 0,      opacity: 0 },
};
// layoutId on bucket header keeps it anchored during height animation
```

### Row enter stagger (per day bucket, not global)
```ts
// Each DayBucket owns its own <motion.tbody variants={tableVariants}>
// Stagger only fires when bucket first opens
const tableVariants = {
  visible: { transition: { staggerChildren: 0.025, delayChildren: 0.05 } },
};
```

### Row hover
```ts
whileHover={{ x: 1.5, boxShadow: '0 1px 8px -4px rgba(109,40,217,0.18)' }}
```

### Row exit on "Remove from plan"
```ts
exit: { opacity: 0, x: -24, height: 0, transition: { duration: 0.2 } }
// Triggers undo toast after exit completes
```

### Inline expand row
```ts
// blur reveal on enter
initial: { opacity: 0, filter: 'blur(3px)', y: -4 }
animate: { opacity: 1, filter: 'blur(0px)', y: 0 }
```

### Status badge swap (on manual toggle)
```ts
// AnimatePresence mode="wait" + rotateY flip on axis
initial: { rotateY: 90, opacity: 0 }
animate: { rotateY: 0,  opacity: 1 }
```

### "Needs Print" pulsing dot
```ts
animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
```

### Selection bar count increment
```ts
// useMotionValue for selected.size → animated number display
// Spring physics on count change
```

### Undo toast (after remove from plan)
```ts
// Fixed bottom-right, y: 16 → y: 0 slide-in
// Auto-dismisses after 4s with a shrinking progress bar underline
```

### View toggle (By Day / By Shipment)
```ts
// Sliding pill indicator using layoutId="viewTogglePill"
// Table content cross-fades on switch
```

---

## 8. Header — Changes

### Remove
- ❌ X/close button (per spec — table is a permanent dashboard panel)
- ❌ Gradient overlay on card

### Keep
- Violet `Print Queue` label + subtext
- Badge row: shipments count, planned, remaining

### Add
- **View toggle**: `By Day | By Shipment` pill (sliding animated indicator)
- **Day filter strip** (visible in By Day mode): `← Yesterday · Today · Tomorrow →`
- **Refresh icon button** — rotate animation on click, no label

```tsx
<div className="ml-auto flex items-center gap-2">
  <ViewToggle value={viewMode} onChange={...} />
  <RefreshButton loading={loading} onClick={load} />
</div>
```

---

## 9. Sidebar Integration — Payload Extension

```ts
interface PrintSelectionPayload {
  selectedItems: EnrichedItem[];
  shipmentIds: number[];
  readyCount: number;
  pendingCount: number;
  needsPrintCount: number;
}
```

### Sidebar input model (per selected shipment group)
1. **Amazon FBA Shipment ID** — validated `/^FBA[0-9A-Z]{8,}$/`
2. **UPS Tracking Number** — validated `/^1Z[A-Z0-9]{16}$/`

When both are filled → "Print Labels" activates for that group.

### Visual feedback back into the table
When sidebar has both IDs for a shipment, the group header shows a `✓ Ready to print` emerald pill. Surfaced via `readyToShip: boolean` prop fed back from sidebar state.

---

## 10. File & Component Structure

```
components/fba/table/
├── FbaPrintReadyTable.tsx         ← orchestrator, useReducer, day grouping
├── DayBucketSection.tsx           ← collapsible day container + header
├── ShipmentGroupHeader.tsx        ← group row with select-shipment link
├── ItemRow.tsx                    ← main data row + checkbox + status badge
├── ItemExpandPanel.tsx            ← animated inline detail/edit panel
├── PendingReasonRow.tsx           ← sub-row shown when pending + reason text
├── RemoveFromPlanButton.tsx       ← qty=1 inline confirmation pattern
├── SelectionFloatingBar.tsx       ← extended payload, "Next" CTA
├── StatusBadge.tsx                ← 4 states, flip animation, pulsing dot
├── ViewToggle.tsx                 ← By Day | By Shipment pill toggle
└── UndoToast.tsx                  ← fixed corner, 4s auto-dismiss + progress bar
```

---

## 11. API Changes Required

| Endpoint | Change |
|----------|--------|
| `GET /api/fba/print-queue` | Add `status`, `pending_reason`, `pending_reason_note` fields; add `?date=` param |
| `PATCH /api/fba/shipment-items/:id` | New — update `status`, `pending_reason`, `note` |
| `DELETE /api/fba/shipment-items/:id` | New — remove item (server-side qty=1 guard) |
| `POST /api/fba/print-labels` | New — `{ shipment_id, amazon_shipment_id, ups_tracking, item_ids }` |

---

## 12. Implementation Order

1. `useReducer` + full action types — replace all `useState`
2. Day grouping logic — group by `due_date`, sort ascending
3. Column restructure — rename, Status column, remove X button
4. `StatusBadge` — 4 states + flip animation + pulsing dot
5. `ItemRow` + `ItemExpandPanel` — click-to-expand, detail fields, reason select
6. `PendingReasonRow` — inline sub-row for quick-scan context
7. `RemoveFromPlanButton` — qty=1 guard + inline confirm + undo toast
8. Three-level selection + updated `SelectionFloatingBar`
9. `DayBucketSection` + collapse/expand layout animation
10. Header: `ViewToggle` + `RefreshButton`, remove X button
11. Sidebar payload extension — `readyCount`, `pendingCount`, `needsPrintCount`
12. Framer Motion choreography pass — stagger, hover, exit, pulsing dot
13. "Needs Print" manual flag — badge click → popover → PATCH
14. "Ready to print" group pill — sidebar state feedback

---

## 13. UX Decision Summary

| Decision | Rationale |
|----------|-----------|
| Day-first grouping | FBA prep is daily ops — pickers think "what am I doing today", not "which shipment" |
| Pending requires reason | Ops accountability — unlabeled pending items cause receiving delays at Amazon FC |
| Qty=1 shows "Remove" not a number | Single-unit items are disposable from plan — surfacing remove is faster than editing |
| No X button in table header | Table is a permanent dashboard panel, not a dismissible modal |
| "Needs Print" is a manual override | Covers scan gaps without requiring a full status API — optimistic update, PATCH async |
| Expand inline, not a modal | Keeps packer's eye on the full list while editing a single item |
| Sidebar owns FBA ID + UPS tracking | Separation of concerns — table = what to ship, sidebar = where/how |
| Three-level selection | Ops often batch by shipment, not by individual item |
| Undo toast after remove | Single-unit removes are easy to fat-finger; 4s undo window is standard |
| "Printed" not "Already Shipped" | FNSKU label printing ≠ carrier scan — distinct operational steps |