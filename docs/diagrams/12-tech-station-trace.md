# 12 — Tech Station Trace

Every tech-station endpoint routes through the **scan hub** at `POST /api/tech/scan`. Thin wrappers convert legacy request shapes and delegate.

## Hub dispatcher

```mermaid
graph TB
    START[Request arrives at tech endpoint]
    HUB[POST /api/tech/scan<br/>src/app/api/tech/scan/route.ts:237]

    SCAN_T[POST /tech/scan-tracking] -->|{type:'TRACKING'}| HUB
    SCAN_F[GET /tech/scan-fnsku] -->|{type:'FNSKU'}| HUB
    SCAN_S[POST /tech/scan-sku] -.runs separately.-> HUB
    SCAN_R[POST /tech/scan-repair-station] -.separate flow.-> REPAIR_FLOW

    START --> HUB
    HUB --> DETECT{looksLikeFnsku&#40;value&#41;?}
    DETECT -->|yes| PATH_FNSKU[FNSKU path<br/>lines 257-350]
    DETECT -->|no| PATH_TRACK[TRACKING path<br/>lines 352-475]

    PATH_TRACK --> RESOLVE{order found?}
    RESOLVE -->|yes| ORDER_OK[record + Ably publishOrderTested]
    RESOLVE -->|no| EXCEPTION[upsert orders_exceptions<br/>reason='not_found']

    REPAIR_FLOW[appendRepairStatusHistory<br/>→ publishRepairChanged]

    classDef hub fill:#2d3748,color:#fff
    classDef wrapper fill:#4a5568,color:#fff
    class HUB hub
    class SCAN_T,SCAN_F,SCAN_S,SCAN_R wrapper
```

## TRACKING scan trace (order found)

```mermaid
sequenceDiagram
    autonumber
    participant UI as Tech UI
    participant H as POST /api/tech/scan
    participant R as resolveShipmentId
    participant DB as Neon
    participant CACHE as Upstash cache
    participant ABL as Ably

    UI->>H: { value: '1Z...', type: 'TRACKING', techId }
    H->>R: resolve via carrier APIs
    R-->>H: { shipmentId, scanRef }
    H->>DB: SELECT from orders via<br/>findOrderByShipment(shipmentId, key18, last8)<br/>LEFT JOIN shipping_tracking_numbers, work_assignments
    DB-->>H: order row + ship context

    H->>DB: INSERT station_activity_logs<br/>(activity_type='TRACKING_SCANNED',<br/>station='TECH', staff_id, shipment_id,<br/>scan_ref, metadata: {order_found:true})
    DB-->>H: { salId }

    par cache
        H->>CACHE: invalidate ['orders', 'orders-next', 'tech-logs']
    and realtime
        H->>ABL: publishTechLogChanged {action:'insert', rowId:salId}
        H->>ABL: publishActivityLogged {activityType:'TRACKING_SCANNED'}
        H->>ABL: publishOrderTested {orderId, testedBy}
    and session
        H->>DB: createStationScanSession (sessionKind='ORDER')
    end

    H-->>UI: { salId, found:true, orderFound:true, order: {...} }
```

## TRACKING scan trace (not found → exception)

```mermaid
sequenceDiagram
    autonumber
    participant UI as Tech UI
    participant H as POST /api/tech/scan
    participant DB as Neon
    participant ABL as Ably

    UI->>H: { value, type:'TRACKING', techId }
    H->>DB: findOrderByShipment(...)
    DB-->>H: null

    H->>DB: upsertOpenOrderException<br/>(shipping_tracking_number, source_station,<br/>staff_id, reason='not_found')
    H->>DB: INSERT station_activity_logs<br/>(activity_type='TRACKING_SCANNED',<br/>orders_exception_id, metadata: {order_found:false})

    H->>ABL: publishTechLogChanged + publishActivityLogged
    H->>DB: createStationScanSession (sessionKind='EXCEPTION')
    H-->>UI: { salId, found:true, warning:'recorded in exceptions' }
```

## FNSKU scan trace

```mermaid
sequenceDiagram
    autonumber
    participant UI as Tech UI
    participant H as POST /api/tech/scan
    participant DB as Neon
    participant ABL as Ably

    UI->>H: { value: 'X0ABC...', type:'FNSKU', techId, sourceStation:'TECH' }
    H->>H: FNSKU = value.toUpperCase().replace(/[^A-Z0-9]/g,'')

    H->>DB: ensureFnskuCatalog →<br/>UPSERT fba_fnskus<br/>(is_active=TRUE, last_seen_at=NOW())

    H->>DB: INSERT station_activity_logs<br/>(activity_type='FNSKU_SCANNED',<br/>station=sourceStation, staff_id, fnsku)
    DB-->>H: salId

    H->>DB: INSERT fba_fnsku_logs<br/>(source_stage='TECH', event_type='SCANNED',<br/>station_activity_log_id=salId, quantity=1)

    par
        H->>ABL: publishTechLogChanged + publishActivityLogged
    and
        H->>DB: createStationScanSession (sessionKind='FNSKU')
    end

    H-->>UI: { salId, fnskuLogId, catalogCreated, summary: {tech_scanned, pack_ready, shipped}, order: stub }
```

## SKU pull trace (separate endpoint)

`POST /api/tech/scan-sku` is **not** routed through the hub — it requires an existing `salId` as context.

```mermaid
sequenceDiagram
    autonumber
    participant UI as Tech UI
    participant S as POST /api/tech/scan-sku
    participant DB as Neon

    Note over UI: A prior TRACKING or FNSKU scan<br/>has established salId

    UI->>S: { skuCode, tracking?, techId, salId, scanSessionId }
    S->>DB: SELECT sku WHERE static_sku=$1 (or base/fuzzy)
    DB-->>S: sku row with serial_number (CSV)

    loop per serial in CSV
        S->>DB: INSERT tech_serial_numbers<br/>(context_station_activity_log_id=salId,<br/>source='tech.scan-sku', source_method='SKU_PULL')
    end

    S->>DB: UPDATE sku_stock SET stock = stock - qty
    opt has tracking
        S->>DB: UPDATE sku SET shipping_tracking_number, shipment_id
    end

    S-->>UI: { matchedSku, serialNumbers[], quantityDecremented, shipmentId }
```

## Serial management action map

`POST /api/tech/serial` is a sub-hub for serial CRUD. Every other serial endpoint eventually calls it.

```mermaid
graph LR
    ADD[POST /tech/add-serial]
    ADD_LAST[POST /tech/add-serial-to-last]
    UPDATE[POST /tech/update-serials]
    UNDO[POST /tech/undo-last]

    SERIAL[POST /tech/serial<br/>action: add&#124;remove&#124;update&#124;undo]

    ADD -->|resolves latest SAL| SERIAL
    ADD_LAST -->|latest TECH SAL| SERIAL
    UPDATE -->|via fnskuLogId| SERIAL
    UNDO -->|latest SAL| SERIAL

    SERIAL --> ACTION{action?}
    ACTION -->|add| A_INS[INSERT tech_serial_numbers<br/>+ publishTechLogChanged:insert]
    ACTION -->|remove| A_DEL[DELETE SAL 'SERIAL_ADDED'<br/>+ DELETE tech_serial_numbers]
    ACTION -->|update| A_UPD[DELETE removed + INSERT new]
    ACTION -->|undo| A_UNDO[DELETE last serial DESC]
```

## Delete trace (cascade)

`POST /api/tech/delete` removes a full SAL "anchor" and everything referencing it.

```mermaid
sequenceDiagram
    autonumber
    participant UI
    participant D as POST /api/tech/delete
    participant DB as Neon
    participant ABL as Ably

    UI->>D: { salId }
    D->>DB: SELECT station_activity_logs WHERE id=$1<br/>(validates + gets staff_id)

    D->>DB: DELETE station_activity_logs<br/>WHERE activity_type='SERIAL_ADDED'<br/>AND tech_serial_number_id IN<br/>(SELECT id FROM tech_serial_numbers WHERE context_station_activity_log_id=$1)

    D->>DB: DELETE tech_serial_numbers<br/>WHERE context_station_activity_log_id=$1
    Note over D,DB: returns deletedSerialCount

    D->>DB: DELETE fba_fnsku_logs<br/>WHERE station_activity_log_id=$1

    D->>DB: DELETE station_activity_logs WHERE id=$1

    D->>ABL: publishTechLogChanged {action:'delete'}
    D-->>UI: { deletedSerials: N }
```

`POST /api/tech/delete-tracking` is a thin wrapper that resolves a `salId` from either `sourceKind='fba_scan' | 'tech_scan' | 'tech_serial'` and delegates to `/api/tech/delete`.

## Activity log vocabulary (tech-originated)

| activity_type | Written when |
|---|---|
| `TRACKING_SCANNED` | Order tracking barcode scanned |
| `FNSKU_SCANNED` | FBA FNSKU scanned at tech station |
| `SERIAL_ADDED` | A serial number tied to an anchor SAL |

## Cache tags invalidated (tech writes)

- `tech-logs` — always on tech write
- `orders-next` — always on tech write
- `orders` — on tracking scan success
- `shipped` — on tech delete
- `fba-stage-counts` — on FNSKU scan at FBA source station

## Endpoint cheat sheet

| Endpoint | Role | Delegates to |
|---|---|---|
| `POST /api/tech/scan` | Hub — auto-detects FNSKU vs tracking | — |
| `POST /api/tech/scan-tracking` | Legacy wrapper | scan (type:TRACKING) |
| `GET /api/tech/scan-fnsku` | Legacy wrapper | scan (type:FNSKU) |
| `POST /api/tech/scan-sku` | Standalone — pulls serials from SKU CSV | — (needs salId) |
| `POST /api/tech/scan-repair-station` | Standalone — repair ticket status | appendRepairStatusHistory |
| `POST /api/tech/serial` | Serial CRUD hub | — |
| `POST /api/tech/add-serial` | Resolves latest SAL → serial (add) | serial |
| `POST /api/tech/add-serial-to-last` | Same, filtered to TECH SALs | serial |
| `POST /api/tech/update-serials` | Resolves via fnskuLogId → serial (update) | serial |
| `POST /api/tech/undo-last` | Latest SAL → serial (undo) | serial |
| `POST /api/tech/delete` | Cascade delete an SAL | — |
| `POST /api/tech/delete-tracking` | Resolves salId → delete | delete |
| `GET /api/tech/orders-without-manual` | Query: orders tech tested, no product manual | — |
| `GET /api/tech-logs` | Query: unified tech log view | — |

## Key files

| File | Role |
|---|---|
| `src/app/api/tech/scan/route.ts:237-475` | Hub dispatcher |
| `src/app/api/tech/scan-sku/route.ts:19-269` | SKU pull with serial CSV |
| `src/app/api/tech/serial/route.ts:14-180` | Serial CRUD |
| `src/app/api/tech/delete/route.ts:10-82` | Cascade delete |
| `src/app/api/tech/logs/route.ts:11-215` | Unified read |
| `src/lib/station-activity.ts:18-64` | createStationActivityLog |
| `src/lib/fba/createFbaLog.ts:37-63` | createFbaLog |
| `src/lib/tech/insertTechSerialForSalContext.ts` | Serial INSERT with context |
| `src/lib/realtime/publish.ts` | Ably publishers |
