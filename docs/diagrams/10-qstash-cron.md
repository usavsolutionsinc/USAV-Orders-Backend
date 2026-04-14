# 10 — QStash Cron Jobs

10 scheduled jobs driven by Upstash QStash. All schedules are declared in `src/config/qstash-schedules.json` and reconciled via `POST /api/qstash/schedules/bootstrap`.

## Schedule overview

```mermaid
gantt
    title QStash Daily Timeline (Pacific)
    dateFormat HH:mm
    axisFormat %H:%M

    section Shipping
    sync-due (every 2h)           :active, 00:00, 1440m
    full carrier sync (weekdays)  :crit, 17:00, 30m

    section eBay
    refresh tokens (hourly)       :active, 00:00, 1440m

    section Zoho
    POs (×2 / hour at :20 :50)    :active, 00:20, 1440m
    Receives (×2 / hr at :25 :55) :active, 00:25, 1440m

    section Staff
    goal history snapshot         :crit, 17:30, 5m

    section Replenishment
    daily low-stock scan          :crit, 06:00, 30m

    section Sheets
    transfer orders (8:30)        :crit, 08:30, 10m
    transfer orders (11:00)       :crit, 11:00, 10m
    transfer orders (15:00)       :crit, 15:00, 10m
```

## Jobs → data flow

```mermaid
graph LR
    QS[Upstash QStash]

    subgraph Jobs
        J1[shipping/sync-due<br/>every 2h]
        J2[ebay/refresh-tokens<br/>hourly]
        J3[google-sheets/transfer-orders<br/>8:30, 11:00, 15:00 PT]
        J4[zoho/purchase-orders/sync<br/>:20 :50]
        J5[zoho/purchase-receives/sync<br/>:25 :55]
        J6[staff-goals/history<br/>17:30 PT]
        J7[replenishment/sync<br/>06:00 PT]
        J8[shipping end-of-day<br/>17:00 PT wkdy]
    end

    subgraph External
        UPS[UPS/USPS/FedEx]
        EBAY[eBay OAuth]
        SHEETS[Google Sheets]
        ZOHO[Zoho Inventory]
    end

    subgraph Tables
        T1[(shipping_tracking_numbers)]
        T2[(ebay_accounts)]
        T3[(orders, packer_logs)]
        T4[(items, replenishment_requests,<br/>receiving_lines)]
        T5[(staff goal history)]
    end

    QS --> J1 --> UPS --> T1
    QS --> J2 --> EBAY --> T2
    QS --> J3 --> SHEETS
    SHEETS --> T3
    QS --> J4 --> ZOHO --> T4
    QS --> J5 --> ZOHO --> T4
    QS --> J6 --> T5
    QS --> J7 --> ZOHO --> T4
    QS --> J8 --> UPS --> T1
```

## Full schedule table

| Name | Cron | Route | Timeout | Retries | Notes |
|---|---|---|---|---|---|
| shipping-sync-due-every-2h | `0 */2 * * *` | `/api/qstash/shipping/sync-due` | 180s | 3 | UPS/USPS/FedEx delta poll |
| ebay-refresh-tokens-hourly | `0 * * * *` | `/api/qstash/ebay/refresh-tokens` | 60s | 3 | OAuth token refresh |
| google-sheets-transfer-orders-0830-pt | `30 8 * * 1-5` (PT) | `/api/qstash/google-sheets/transfer-orders` | 300s | 3 | ShipStation → orders sync |
| google-sheets-transfer-orders-1100-pt | `0 11 * * 1-5` (PT) | same | 300s | 3 | Midday run |
| google-sheets-transfer-orders-1500-pt | `0 15 * * 1-5` (PT) | same | 300s | 3 | Afternoon run |
| zoho-purchase-orders-half-hour | `20,50 * * * *` | `/api/zoho/purchase-orders/sync` | 300s | 3 | Pull POs 2 days back |
| zoho-purchase-receives-half-hour | `25,55 * * * *` | `/api/zoho/purchase-receives/sync` | 300s | 3 | Pull receipts |
| staff-goal-history-nightly-pt | `30 17 * * *` (PT) | `/api/qstash/staff-goals/history` | 120s | 3 | Daily snapshot |
| replenishment-sync-daily-6am-pt | `0 6 * * *` (PT) | `/api/qstash/replenishment/sync` | 300s | 3 | Detect low stock, plan POs |
| shipping-sync-all-5pm-weekdays-pt | `0 17 * * 1-5` (PT) | `/api/qstash/shipping/sync-due` | 300s | 3 | EOD full sweep, concurrency=8 |

## Bootstrap flow

```mermaid
sequenceDiagram
    participant Admin as Admin UI
    participant B as POST /api/qstash/schedules/bootstrap
    participant CFG as src/config/qstash-schedules.json
    participant QS as Upstash QStash API

    Admin->>B: trigger bootstrap
    B->>CFG: read desired schedules
    B->>QS: list current schedules
    B->>B: diff (current vs desired)
    B->>QS: DELETE obsolete schedule_ids
    B->>QS: UPSERT new/changed schedules
    B-->>Admin: { created, updated, deleted }
```

## Key files

| File | Purpose |
|---|---|
| `src/config/qstash-schedules.json` | Source of truth for schedule config |
| `src/app/api/qstash/schedules/bootstrap/route.ts:22-61` | Reconciles config with QStash |
| `scripts/sync-qstash-schedules.js` | CLI equivalent (`npm run qstash:sync`) |
| `src/app/api/qstash/*/route.ts` | Individual job handlers |
