# 14 — FBA Station Trace

Tech and packer both participate in FBA. State transitions on `fba_shipment_items.status` are driven by four distinct endpoints — don't mix them up.

## Item status → endpoint map

```mermaid
stateDiagram-v2
    [*] --> PLANNED: POST /api/fba/shipments (initial)
    PLANNED --> READY_TO_GO: POST /api/fba/items/ready<br/>(tech marks ready)
    PLANNED --> READY_TO_GO: POST /api/fba/items/scan<br/>(packer verifies, auto-advance)
    READY_TO_GO --> READY_TO_GO: POST /api/fba/items/verify<br/>(idempotent verification pass)
    READY_TO_GO --> LABEL_ASSIGNED: POST /api/fba/labels/bind
    LABEL_ASSIGNED --> SHIPPED: POST /api/fba/shipments/close<br/>or .../mark-shipped
    READY_TO_GO --> SHIPPED: close with force=true

    PLANNED --> PLANNED: split-for-paired-review<br/>(resets to PLANNED on new shipment)
```

> **key distinction:** `items/ready` = tech says "I've tested and it's good". `items/scan` = packer scans an FNSKU at the pack station (increments actual_qty, auto-advances status). `items/verify` = optional QA verification (doesn't change status, just stamps `verified_at`).

## Two FNSKU scan routes (important)

```mermaid
graph LR
    FBA_SCAN[GET /api/fba/scan-fnsku]
    TECH_SCAN[GET /api/tech/scan-fnsku]
    HUB[POST /api/tech/scan<br/>hub]

    FBA_SCAN -->|sourceStation:'FBA'| HUB
    TECH_SCAN -->|sourceStation:'TECH'| HUB

    HUB --> SAL[INSERT station_activity_logs<br/>station = sourceStation]
    HUB --> LOG[INSERT fba_fnsku_logs<br/>source_stage = sourceStation]
```

Both write the same tables — the difference is the `station` / `source_stage` field. This matters for reporting (which workspace did the scan come from).

## Pack-station FNSKU scan (items/scan)

```mermaid
sequenceDiagram
    autonumber
    participant UI as FBA packer UI
    participant S as POST /api/fba/items/scan
    participant DB as Neon
    participant ABL as Ably

    UI->>S: { fnsku, staff_id, station }

    opt ASIN scan (starts with B0)
        S->>DB: upsertFnskuCatalogRow<br/>(fba_fnskus UPSERT)
    end

    S->>DB: SELECT fba_shipment_items + fba_shipments<br/>WHERE fs.status != 'SHIPPED'<br/>ORDER BY status priority, created_at

    alt item exists
        S->>DB: UPDATE fba_shipment_items<br/>SET actual_qty += 1,<br/>status = CASE WHEN PLANNED/PACKING THEN READY_TO_GO ELSE status,<br/>verified_by_staff_id, verified_at
    else no item today
        S->>DB: create today's PLANNED shipment (if missing)
        S->>DB: INSERT fba_shipment_items<br/>(expected_qty=1, actual_qty=1,<br/>status='READY_TO_GO',<br/>verified_by_staff_id, verified_at)
        Note over S,DB: auto_added_to_plan=true
    end

    opt no more PLANNED items in shipment
        S->>DB: UPDATE fba_shipments SET status='READY_TO_GO'
    end

    S->>DB: INSERT fba_fnsku_logs<br/>(source_stage='PACK', event_type='READY',<br/>fba_shipment_id, fba_shipment_item_id, quantity=1)

    S->>DB: INSERT station_activity_logs<br/>(station='PACK', activity_type='FBA_READY',<br/>fnsku, fbaShipmentId, fbaShipmentItemId)

    S->>DB: SELECT summary counts from fba_fnsku_logs
    par cache
        S->>S: invalidate ['fba-board','fba-stage-counts']
    and
        S->>ABL: publishFbaItemChanged {action:'scan'}
        opt auto-created
            S->>ABL: publishFbaShipmentChanged {action:'created'}
        end
    end

    S-->>UI: { item, summary: {tech_scanned, pack_ready, shipped}, auto_added_to_plan }
```

## Tech "ready" trace

```mermaid
sequenceDiagram
    autonumber
    participant UI as Tech UI
    participant R as POST /api/fba/items/ready
    participant DB as Neon

    UI->>R: { shipment_id, fnsku, staff_id, station }

    R->>DB: INSERT fba_shipment_items<br/>(expected_qty=1, actual_qty=1, status='READY_TO_GO',<br/>ready_by_staff_id, ready_at)<br/>ON CONFLICT DO UPDATE<br/>SET actual_qty += 1, status = CASE WHEN 'PLANNED' THEN 'READY_TO_GO',<br/>ready_by_staff_id, ready_at COALESCE

    R->>DB: INSERT fba_fnsku_logs<br/>(source_stage='PACK', event_type='READY',<br/>station='TECH_READY')

    R->>DB: INSERT station_activity_logs<br/>(station='PACK', activity_type='FBA_READY')

    opt no PLANNED left
        R->>DB: UPDATE fba_shipments SET status='READY_TO_GO'
    end

    R-->>UI: { item, event, staff_name }
```

## Label bind trace

```mermaid
sequenceDiagram
    autonumber
    participant UI as Labeler UI
    participant B as POST /api/fba/labels/bind
    participant DB as Neon
    participant ABL as Ably

    UI->>B: { shipment_id, label_barcode, fnskus:[...], staff_id }

    loop per fnsku
        B->>DB: SELECT item WHERE shipment_id=$1 AND fnsku=$2
        Note over B,DB: reject if PLANNED or SHIPPED
        B->>DB: UPDATE fba_shipment_items<br/>SET status='LABEL_ASSIGNED',<br/>labeled_by_staff_id, labeled_at=NOW()
        B->>DB: INSERT fba_fnsku_logs<br/>(event_type='ASSIGNED', quantity=actual_qty,<br/>metadata: {label_barcode, previous_status})
    end

    B->>DB: auto-advance fba_shipments.status<br/>if no PLANNED AND no READY_TO_GO → LABEL_ASSIGNED<br/>if no PLANNED → READY_TO_GO

    B->>ABL: publishFbaItemChanged {action:'label-bind'}
    B-->>UI: { bound_items, bound_count, errors? }
```

## Split-for-paired-review (advanced)

Splits a shipment: selected items are pulled into a brand-new shipment with new tracking + amazon_shipment_id. Used when half a shipment ships UPS and half ships on an Amazon pallet.

```mermaid
sequenceDiagram
    autonumber
    participant UI
    participant SP as POST /api/fba/shipments/split-for-paired-review
    participant DB as Neon
    participant ABL as Ably

    UI->>SP: { source_shipment_id, new_amazon_shipment_id,<br/>tracking_number, carrier, lines:[{shipment_item_id, quantity}] }

    SP->>DB: UPDATE fba_shipment_items (source) SET expected_qty=$1
    SP->>DB: DELETE fba_tracking_item_allocations WHERE shipment_item_id=ANY

    SP->>DB: UPDATE fba_shipment_items<br/>SET status='PLANNED', labeled_at=NULL, labeled_by_staff_id=NULL<br/>(if status was LABEL_ASSIGNED and no other tracking)

    SP->>DB: INSERT fba_shipments (copy of source,<br/>amazon_shipment_id=new, status='PLANNED') RETURNING newShipmentId

    SP->>DB: UPDATE fba_shipment_items SET shipment_id=newShipmentId<br/>(move selected lines)

    SP->>DB: refreshShipmentAggregateCounts (both old + new)

    SP->>DB: UPSERT shipping_tracking_numbers<br/>(tracking_number_raw, carrier, source_system='fba')

    SP->>DB: INSERT fba_shipment_tracking<br/>(shipment_id=newShipmentId, tracking_id, label)

    SP->>DB: replaceTrackingAllocations →<br/>write fba_tracking_item_allocations<br/>(shipment_item_id, qty)

    par
        SP->>SP: invalidate ['fba-shipments','fba-board','fba-stage-counts']
    and
        SP->>ABL: publishFbaShipmentChanged × 2 (source + new)
    end
```

## Read endpoints (dashboards)

```mermaid
graph LR
    UI[FBA workspace]
    UI -->|FNSKU roll-up| BOARD[GET /api/fba/board<br/>grouped by FNSKU, active shipments only]
    UI -->|queue list| Q[GET /api/fba/items/queue<br/>status=PLANNED,READY_TO_GO,LABEL_ASSIGNED]
    UI -->|stage counter| SC[GET /api/fba/stage-counts<br/>counts per status]
    UI -->|today only| TODAY[GET /api/fba/shipments/today<br/>due_date=today, status='PLANNED']
    UI -->|full detail| ACT[GET /api/fba/shipments/active-with-details<br/>active + recent shipped + allocations]
    UI -->|print queue| PR[GET /api/fba/print-queue<br/>status in READY_TO_GO, OUT_OF_STOCK, PACKING]
```

## Triggers per transition

| Transition | Endpoint | Writes to |
|---|---|---|
| `—` → `PLANNED` | `POST /api/fba/shipments` or `.../[id]/items` | fba_shipment_items (INSERT) |
| `PLANNED` → `READY_TO_GO` (tech) | `POST /api/fba/items/ready` | ready_by_staff_id, ready_at |
| `PLANNED` → `READY_TO_GO` (packer auto) | `POST /api/fba/items/scan` | verified_by_staff_id, verified_at, actual_qty++ |
| `READY_TO_GO` → `READY_TO_GO` (idempotent) | `POST /api/fba/items/verify` | verified_at stamp (COALESCE) |
| `READY_TO_GO` → `LABEL_ASSIGNED` | `POST /api/fba/labels/bind` | labeled_by_staff_id, labeled_at |
| `LABEL_ASSIGNED` → `SHIPPED` | `POST /api/fba/shipments/close` | shipped_by_staff_id, shipped_at |
| any (bulk) → `SHIPPED` | `POST /api/fba/shipments/mark-shipped` | shipped_at, actual_qty=expected_qty |
| `LABEL_ASSIGNED` → `PLANNED` (new shipment) | `POST /api/fba/shipments/split-for-paired-review` | moves row, clears labeled_* fields |

## Staff attribution chain

Each transition stamps a different staff column — this gives you full forensics per item:

```mermaid
graph LR
    P[PLANNED] -->|tech tests| R[READY_TO_GO<br/>ready_by_staff_id]
    R -->|packer verifies| R2[READY_TO_GO<br/>+ verified_by_staff_id]
    R2 -->|label printer| L[LABEL_ASSIGNED<br/>+ labeled_by_staff_id]
    L -->|shipment close| S[SHIPPED<br/>+ shipped_by_staff_id]
```

## Activity log vocabulary (FBA-originated)

| activity_type | Station | Written when |
|---|---|---|
| `FNSKU_SCANNED` | TECH or FBA | FNSKU scanned at workspace |
| `FBA_READY` | PACK | Packer marks ready via scan or tech via `/items/ready` |

## fba_fnsku_logs `event_type` values

| event_type | When |
|---|---|
| `SCANNED` | Tech/FBA FNSKU scan |
| `READY` | `/items/ready` or `/items/scan` |
| `VERIFIED` | `/items/verify` (quantity=0) |
| `ASSIGNED` | `/labels/bind` (quantity=actual_qty) |
| `SHIPPED` | `/shipments/close` or `/mark-shipped` |

## Cache tags invalidated

- `fba-board` — any item or shipment write
- `fba-stage-counts` — scan, ready, label, close, split
- `fba-shipments` — create, split, close

## Key files

| Endpoint | File |
|---|---|
| Board roll-up | `src/app/api/fba/board/route.ts:14-143` |
| FBA scan-fnsku | `src/app/api/fba/scan-fnsku/route.ts:8-28` |
| Items scan (packer) | `src/app/api/fba/items/scan/route.ts:12-277` |
| Items ready (tech) | `src/app/api/fba/items/ready/route.ts:13-144` |
| Items verify | `src/app/api/fba/items/verify/route.ts:13-119` |
| Labels bind | `src/app/api/fba/labels/bind/route.ts:12-165` |
| Print queue | `src/app/api/fba/print-queue/route.ts:19-120` |
| Queue | `src/app/api/fba/items/queue/route.ts:9-78` |
| Today | `src/app/api/fba/shipments/today/route.ts:16-94` |
| Stage counts | `src/app/api/fba/stage-counts/route.ts:21-49` |
| Active + details | `src/app/api/fba/shipments/active-with-details/route.ts:18-184` |
| Split | `src/app/api/fba/shipments/split-for-paired-review/route.ts:32-200+` |
| FBA log helper | `src/lib/fba/createFbaLog.ts:37-63` |
| Catalog upsert | `src/lib/fba/upsert-fnsku-catalog.ts` |
| Allocation writer | `src/lib/fba/replace-tracking-allocations.ts` |
