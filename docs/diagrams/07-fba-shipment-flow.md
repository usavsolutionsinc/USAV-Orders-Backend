# 07 — FBA Shipment Flow

Creation through close, with item-level state machine. Items and shipments have separate status enums.

## Item state machine (fba_shipment_items.status)

```mermaid
stateDiagram-v2
    [*] --> PLANNED: POST /api/fba/shipments<br/>or .../[id]/items
    PLANNED --> READY_TO_GO: tech marks ready<br/>POST /api/fba/items/ready<br/>(sets ready_by_staff_id, ready_at)
    READY_TO_GO --> LABEL_ASSIGNED: labels bound<br/>POST /api/fba/labels/bind<br/>(sets labeled_by_staff_id, labeled_at)
    LABEL_ASSIGNED --> SHIPPED: close or mark-shipped
    READY_TO_GO --> SHIPPED: close with force=true

    PLANNED --> PLANNED: reassign to another shipment<br/>PATCH /api/fba/shipments/[id]/items/[itemId]/reassign

    SHIPPED --> [*]: fba_shipments auto-deleted<br/>when all items SHIPPED
```

## Shipment state machine (fba_shipments.status)

```mermaid
stateDiagram-v2
    [*] --> PLANNED: POST /api/fba/shipments
    PLANNED --> SHIPPED: close w/ all items shipped<br/>POST /api/fba/shipments/close
    SHIPPED --> [*]: cleanup job deletes row<br/>once all items confirmed SHIPPED
```

## Creation sequence

```mermaid
sequenceDiagram
    autonumber
    participant UI as FBA UI<br/>(FbaCreateShipmentForm)
    participant API as POST /api/fba/shipments
    participant DB as Neon Postgres
    participant ABL as Ably Realtime

    UI->>API: { shipment_ref?, destination_fc, due_date, items[], staff_ids }
    API->>DB: INSERT fba_shipments (status='PLANNED')
    API->>DB: UPSERT fba_fnskus (one per item)
    API->>DB: INSERT fba_shipment_items (status='PLANNED')
    API->>DB: INSERT/UPDATE work_assignments (QA tasks)
    API->>ABL: publish fba-shipment-created
    API-->>UI: { id, shipment_ref, items[] }
    Note over UI,ABL: Cache tags invalidated:<br/>fba-board, fba-shipments
```

## Close flow

```mermaid
sequenceDiagram
    autonumber
    participant UI as FBA sidebar
    participant API as POST /api/fba/shipments/close
    participant DB as Neon

    UI->>API: { shipment_id, staff_id, force }
    API->>DB: SELECT items WHERE shipment_id=?
    alt any item still PLANNED && !force
        API-->>UI: 409 blocked
    else proceed
        API->>DB: UPDATE fba_shipment_items<br/>SET status='SHIPPED', shipped_by_staff_id, shipped_at<br/>WHERE status IN ('LABEL_ASSIGNED', 'READY_TO_GO' if force)
        API->>DB: INSERT fba_fnsku_logs (SHIPPED event × N)
        API->>DB: UPDATE fba_shipments SET status='SHIPPED', shipped_at
        API-->>UI: { updated_items, shipment }
    end
```

## Mark-shipped flow (bulk + tracking)

```mermaid
sequenceDiagram
    autonumber
    participant UI
    participant API as POST /api/fba/shipments/mark-shipped
    participant DB as Neon

    UI->>API: { item_ids[], tracking_number, amazon_shipment_id?, carrier? }
    API->>DB: UPSERT shipping_tracking_numbers (by tracking_number)
    API->>DB: INSERT fba_shipment_tracking (junction)
    API->>DB: UPDATE fba_shipment_items<br/>SET status='SHIPPED', actual_qty=expected_qty
    API->>DB: UPSERT fba_shipments (amazon_shipment_id)
    opt all items in shipment now SHIPPED
        API->>DB: DELETE fba_shipments WHERE id=?
    end
    API-->>UI: { updated, deleted_shipment_ids[] }
```

## Key files

| Flow | File |
|---|---|
| Create | `src/app/api/fba/shipments/route.ts:163-300+` |
| Close | `src/app/api/fba/shipments/close/route.ts:5-133` |
| Mark shipped | `src/app/api/fba/shipments/mark-shipped/route.ts:25-157` |
| Item reassign | `src/app/api/fba/shipments/[id]/items/[itemId]/reassign/route.ts` |
| Schema | `src/lib/drizzle/schema.ts:879-929` |

## Staff tracking on each item

Every transition records which staff member did it:
- `ready_by_staff_id` → tech who marked READY_TO_GO
- `verified_by_staff_id` → QA verifier
- `labeled_by_staff_id` → person who bound Amazon labels
- `shipped_by_staff_id` → final packer on close
