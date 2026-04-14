# 06 — Order Lifecycle

How an order moves from import to shipped. Explicit `pending` / `assigned` / `in_progress` states were removed on 2026-02-05 — assignment is now implicit via tech scanning tracking.

## State diagram

```mermaid
stateDiagram-v2
    [*] --> unassigned: import-orders<br/>POST /api/import-orders

    unassigned --> unassigned: backfill / verify / set-item-number

    unassigned --> shipped: tech scan-tracking<br/>POST /api/tech/scan-tracking<br/>(links shipment_id FK)

    unassigned --> shipped: packer logs scan<br/>POST /api/packing-logs<br/>(links tracking number)

    shipped --> [*]

    note right of unassigned
        Initial state when order row is inserted.
        `orders.shipment_id` is NULL.
    end note

    note right of shipped
        Derived: orders.shipment_id points to
        shipping_tracking_numbers.id
    end note
```

## Ingestion sources

```mermaid
graph LR
    ZOHO[Zoho Inventory]
    EBAY[eBay API]
    ECWID[Ecwid]
    SHEETS[Google Sheets<br/>ShipStation export]

    ZOHO -->|POST /api/zoho/orders/ingest<br/>+ cron| ORDERS[(orders table<br/>status='unassigned')]
    EBAY -->|POST /api/ebay/sync<br/>+ cron| ORDERS
    ECWID -->|POST /api/ecwid-square/sync<br/>+ /api/ecwid/transfer-orders| ORDERS
    SHEETS -->|POST /api/google-sheets/sync-shipstation-orders<br/>+ cron 3x/day| ORDERS

    ORDERS -->|tech scans tracking| SCAN[/api/tech/scan-tracking/]
    ORDERS -->|packer scans tracking| PACK[/api/packing-logs/]

    SCAN --> SHIP[(shipping_tracking_numbers)]
    PACK --> SHIP
    SHIP -.->|FK: orders.shipment_id| ORDERS

    style ORDERS fill:#2d3748,color:#fff
    style SHIP fill:#4a5568,color:#fff
```

## Key transitions (code citations)

| Transition | Endpoint | File |
|---|---|---|
| Insert `unassigned` | `POST /api/import-orders` | `src/app/api/import-orders/route.ts` |
| Link tracking (→ shipped) | `POST /api/tech/scan-tracking` → delegates to `/api/tech/scan` | `src/app/api/tech/scan-tracking/route.ts:1-22` |
| Link tracking (→ shipped) | `POST /api/packing-logs` | `src/app/api/packing-logs/route.ts:126-200+` |
| Deprecated assignment | `POST /api/orders/start` | `src/app/api/orders/start/route.ts:1-37` (no-op) |

## Gotchas

- No enum constraint — `orders.status` is a plain text column. New status strings won't be type-checked.
- `status_history` (jsonb) on `orders` records audit trail, but is not required for transitions to happen.
- An order with a linked `shipment_id` is considered shipped regardless of `status` column value.
