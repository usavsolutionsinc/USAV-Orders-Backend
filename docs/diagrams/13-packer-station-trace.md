# 13 — Packer Station Trace

A packer "session" is informal — it's just one or more rows in `packer_logs` linked by `packed_by`. Each scan is an independent event with photos, a `shipment_id` (when resolvable), and a `station_activity_logs` anchor.

## Scan dispatch

```mermaid
graph TB
    SCAN[Packer scans barcode]
    CLASSIFY[classifyScan&#40;input&#41;]
    SCAN --> CLASSIFY
    CLASSIFY --> T{trackingType?}
    T -->|ORDERS| ORDER_PATH[Order tracking path]
    T -->|FBA| FBA_PATH[FBA tracking path]
    T -->|SKU| SKU_PATH[SKU pull path]
    T -->|FNSKU| FNSKU_PATH[FNSKU path]

    ORDER_PATH --> LOOKUP{order found?}
    LOOKUP -->|yes| OK[pack + mark shipped]
    LOOKUP -->|no| EX[upsert orders_exceptions]

    FBA_PATH --> FBA_LINK[link to fba_shipment_tracking]

    classDef path fill:#2d3748,color:#fff
    class ORDER_PATH,FBA_PATH,SKU_PATH,FNSKU_PATH path
```

## Order scan (main success path)

```mermaid
sequenceDiagram
    autonumber
    participant UI as /packer page
    participant P as POST /api/packing-logs/update
    participant R as resolveShipmentId
    participant DB as Neon
    participant CACHE as Upstash
    participant ABL as Ably

    UI->>P: { shippingTrackingNumber, trackingType:'ORDERS', packDateTime, packedBy, packerPhotosUrl[] }
    P->>R: resolveShipmentId
    R-->>P: { shipmentId, scanRef }

    P->>DB: INSERT packer_logs<br/>(shipment_id, scan_ref, tracking_type,<br/>packed_by, created_at) RETURNING id
    DB-->>P: packerLogId

    P->>DB: createStationActivityLog<br/>(station='PACK',<br/>activity_type='PACK_COMPLETED',<br/>staff_id, shipment_id, scan_ref, packer_log_id)

    P->>DB: createAuditLog (action='PACK_COMPLETED')

    loop per photo URL
        P->>DB: INSERT photos<br/>(entity_type='PACKER_LOG', entity_id=packerLogId,<br/>url, taken_by_staff_id, photo_type='box_label')
    end

    P->>DB: UPDATE orders SET status='shipped'<br/>WHERE shipment_id=$1 AND status IS NULL OR status != 'shipped'<br/>RETURNING id

    P->>DB: UPSERT work_assignments<br/>(entity_type='ORDER', entity_id,<br/>work_type='PACK', completed_by_packer_id,<br/>status='DONE', completed_at=NOW())

    par
        P->>CACHE: invalidate ['packing-logs','orders','orders-next','shipped']
    and
        P->>ABL: publishPackerLogChanged {action:'insert', row}
        P->>ABL: publishOrderChanged {orderIds:[shippedOrderId]}
    end

    P-->>UI: { success, packerLogId, ordersUpdated, photosCount }
```

## Order scan (not found → exception)

```mermaid
sequenceDiagram
    autonumber
    participant UI
    participant P as POST /api/packing-logs
    participant DB as Neon

    UI->>P: { trackingNumber, photos[], packerId }
    P->>DB: lookup orders via<br/>1. tracking_number_normalized exact<br/>2. right-18 alphanumeric<br/>3. right-8 digits
    DB-->>P: null
    P->>DB: lookup fba_shipment_tracking
    DB-->>P: null

    P->>DB: upsertOpenOrderException<br/>(shipping_tracking_number, source_station='PACKER',<br/>staff_id, reason='not_found')

    P->>DB: INSERT packer_logs (shipment_id NULL, scan_ref)
    P->>DB: createStationActivityLog<br/>(activity_type='PACK_COMPLETED',<br/>orders_exception_id)

    opt photos present
        P->>DB: INSERT photos × N
    end

    P-->>UI: { warning: 'recorded in orders_exceptions' }
```

## FBA tracking scan

```mermaid
sequenceDiagram
    autonumber
    participant UI
    participant P as POST /api/packing-logs
    participant DB as Neon

    UI->>P: { trackingNumber (matches FBA) }
    P->>DB: SELECT fba_shipment_tracking JOIN fba_shipments
    DB-->>P: { fba_plan_id, amazon_shipment_id, items[] }

    P->>DB: INSERT packer_logs<br/>(tracking_type='FBA', scan_ref)
    P->>DB: createStationActivityLog<br/>(activity_type='PACK_COMPLETED',<br/>metadata: {fba_plan_id, amazon_shipment_id})

    P-->>UI: { trackingType:'FBA', plan, item_count, total_qty }
```

## Start session (lightweight helper)

```mermaid
sequenceDiagram
    participant UI
    participant S as POST /api/packing-logs/start-session
    participant DB as Neon

    UI->>S: { trackingNumber, packedBy, trackingType='ORDERS' }
    S->>DB: resolve key18 → shipment_id
    S->>DB: INSERT packer_logs (shipment_id, scan_ref, tracking_type, packed_by)
    S-->>UI: { packerLogId, shipmentId, orderId }
```

> **Note:** `start-session` creates the packer_logs row early (before photos) so the client has an id to attach photos to via `save-photo`. `update` then wraps up the full flow in one shot. Most current UI uses `update`.

## Read endpoints

```mermaid
graph LR
    UI[/packer page]
    UI -->|recent list| L[GET /api/packing-logs<br/>by packerId, limit/offset]
    UI -->|v4 unified view| V[GET /api/packerlogs<br/>with photos + serials + orders + tech data]
    UI -->|last order| LAST[GET /api/packing-logs/last-order<br/>→ last row + photos]
    UI -->|tracking detail| D[GET /api/packing-logs/details<br/>right-8 match against orders]
    UI -->|photo list| PH[GET /api/packing-logs/photos]
```

## Tracking types observed in `packer_logs.tracking_type`

| Value | Scan source |
|---|---|
| `ORDERS` | Carrier tracking barcode for a customer order |
| `FBA` | Carrier tracking tied to an FBA shipment |
| `FNSKU` | Amazon FNSKU scan |
| `SKU` | Internal SKU pull scan |

## Photos

Polymorphic via `(entity_type='PACKER_LOG', entity_id=packer_logs.id)`. Uploaded via `POST /api/packing-logs/save-photo` (pre-session) or inline with `update`.

## Activity log vocabulary (packer-originated)

| activity_type | Written when |
|---|---|
| `PACK_COMPLETED` | Order tracking scanned successfully (or exception recorded) |
| `PACK_SCAN` | SKU/FBA scan at pack station (not full order completion) |
| `FBA_READY` | Packer marks FNSKU ready at PACK station (see FBA trace) |

## Cache tags invalidated (packer writes)

- `packing-logs`
- `orders`
- `orders-next`
- `shipped`

## Session lifecycle (informal)

```mermaid
stateDiagram-v2
    [*] --> ScanReceived: packer scans
    ScanReceived --> OrderMatched: resolveShipmentId hit
    ScanReceived --> FbaMatched: FBA tracking hit
    ScanReceived --> Exception: no match
    OrderMatched --> Logged: INSERT packer_logs + SAL
    FbaMatched --> Logged
    Exception --> Logged
    Logged --> PhotoUploaded: photos attached
    PhotoUploaded --> OrderShipped: UPDATE orders.status='shipped'
    OrderShipped --> AssignmentDone: work_assignments.status='DONE'
    AssignmentDone --> [*]
```

## Key files

| File | Role |
|---|---|
| `src/app/api/packing-logs/route.ts:75-450+` | Main scan handler (POST) + list (GET) |
| `src/app/api/packing-logs/update/route.ts:30-257` | Full flow: log + SAL + photos + order status + assignment |
| `src/app/api/packing-logs/start-session/route.ts:20-87` | Early log creation for photo attachment |
| `src/app/api/packerlogs/route.ts:13-431` | v4 unified read + simple insert |
| `src/app/api/packing-logs/last-order/route.ts:10-85` | Last-packed view |
| `src/lib/station-activity.ts` | createStationActivityLog + createAuditLog |
