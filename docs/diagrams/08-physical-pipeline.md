# 08 — Physical Item Pipeline

The end-to-end journey of a physical item through the warehouse: **Receiving → Tech → Packing → Shipped**.

## receiving_lines.workflow_status state machine

```mermaid
stateDiagram-v2
    [*] --> EXPECTED: Zoho PO pulled<br/>/api/qstash/zoho/*
    EXPECTED --> ARRIVED: POST /api/receiving-entry
    ARRIVED --> MATCHED: POST /api/receiving/match
    MATCHED --> UNBOXED: POST /api/receiving/mark-received
    UNBOXED --> AWAITING_TEST: tech queue pickup
    AWAITING_TEST --> IN_TEST: POST /api/tech/scan
    IN_TEST --> PASSED: tech marks passed
    IN_TEST --> FAILED: tech marks failed
    PASSED --> DONE: item goes to inventory
    FAILED --> RTV: return to vendor
    FAILED --> SCRAP: scrap disposition
    RTV --> [*]
    SCRAP --> [*]
    DONE --> [*]
```

## End-to-end sequence

```mermaid
sequenceDiagram
    autonumber
    participant ZOHO as Zoho Inventory
    participant QS as QStash cron
    participant RECV as /receiving
    participant TECH as /tech
    participant PACK as /packer
    participant DB as Neon
    participant UPS as UPS / carrier

    ZOHO->>QS: (pull every 20/50 min)
    QS->>DB: INSERT receiving_lines<br/>workflow_status='EXPECTED'

    Note over RECV: Physical box arrives
    RECV->>DB: POST /api/receiving-entry<br/>→ receiving row + lines → ARRIVED
    RECV->>DB: POST /api/receiving/match<br/>match PO → MATCHED
    RECV->>DB: POST /api/receiving/mark-received<br/>→ UNBOXED
    RECV->>DB: POST /api/receiving-photos (per item)
    RECV->>DB: POST /api/receiving/scan-serial<br/>→ tech_serial_numbers

    Note over TECH: Tech picks from queue
    TECH->>DB: POST /api/tech/scan-sku → IN_TEST
    TECH->>DB: POST /api/tech/serial<br/>→ tech_serial_numbers (station_source='TECH')
    alt item passes QA
        TECH->>DB: set qa_status='PASSED', disposition='ACCEPT'<br/>→ workflow_status='PASSED' → 'DONE'
    else FBA item
        TECH->>DB: POST /api/fba/items/ready<br/>→ fba_shipment_items.status='READY_TO_GO'
    else item fails
        TECH->>DB: qa_status='FAILED_*'<br/>→ workflow_status='RTV' or 'SCRAP'
    end

    Note over PACK: Packer pulls order
    PACK->>DB: POST /api/packing-logs<br/>scan tracking + SKU/FNSKU
    PACK->>DB: UPSERT shipping_tracking_numbers
    PACK->>DB: UPDATE orders SET shipment_id<br/>(→ order implicitly shipped)
    PACK->>DB: INSERT packer_logs + photos

    Note over UPS: Carrier takes package
    UPS-->>DB: webhook POST /api/webhooks/ups<br/>→ update shipping_tracking_numbers status
    QS->>DB: POST /api/qstash/shipping/sync-due<br/>(every 2h) → poll carrier APIs
```

## Enums referenced

| Column | Values |
|---|---|
| `receiving_lines.workflow_status` | EXPECTED, ARRIVED, MATCHED, UNBOXED, AWAITING_TEST, IN_TEST, PASSED, FAILED, RTV, SCRAP, DONE |
| `receiving.qa_status` / `receiving_lines.qa_status` | PENDING, PASSED, FAILED_DAMAGED, FAILED_INCOMPLETE, FAILED_FUNCTIONAL, HOLD |
| `disposition_code` | ACCEPT, HOLD, RTV, SCRAP, REWORK |
| `condition_grade` | BRAND_NEW, USED_A, USED_B, USED_C, PARTS |
| `return_platform` | AMZ, EBAY_DRAGONH, EBAY_USAV, EBAY_MK, FBA, WALMART, ECWID |
| `target_channel` | ORDERS, FBA |
| `work_assignments.status` | OPEN, ASSIGNED, IN_PROGRESS, DONE, CANCELED |
| `work_assignments.entity_type` | ORDER, REPAIR, FBA_SHIPMENT, RECEIVING, SKU_STOCK |
| `work_assignments.work_type` | TEST, PACK, REPAIR, QA, RECEIVE, STOCK_REPLENISH |

## Fork points

The physical item can branch into three destinations after tech testing:

```mermaid
graph LR
    TECH{Tech QA<br/>passed?}
    TECH -->|yes, target_channel=ORDERS| PACKER[Packer queue]
    TECH -->|yes, target_channel=FBA| FBA[FBA board → shipment]
    TECH -->|failed| DISPO{disposition}
    DISPO -->|RTV| RETURN[Return to vendor]
    DISPO -->|SCRAP| SCRAP[Scrapped]
    DISPO -->|REWORK| REWORK[Back to tech queue]
    DISPO -->|HOLD| HOLD[Held for review]

    PACKER --> SHIPPED[Shipped to customer]
    FBA --> AMAZON[Shipped to Amazon FC]
```

## Key files

| Stage | File |
|---|---|
| Receiving entry | `src/app/api/receiving-entry/route.ts` |
| Match PO | `src/app/api/receiving/match/route.ts` |
| Mark received | `src/app/api/receiving/mark-received/route.ts:7-131` |
| Scan serial | `src/app/api/receiving/scan-serial/route.ts` |
| Tech scan | `src/app/api/tech/scan/route.ts` (hub), `src/app/api/tech/scan-tracking/route.ts:1-22` |
| FBA ready | `src/app/api/fba/items/ready/route.ts` |
| Packing log | `src/app/api/packing-logs/route.ts:126-200+` |
| Carrier sync | `src/app/api/qstash/shipping/sync-due/route.ts` |
