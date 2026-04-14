# 03 — Page → API Flows

Which pages call which API routes. Only direct fetches from the page file are shown here; component-level fetches are summarized per feature at the bottom.

## Page-level fetches

```mermaid
graph LR
    DASH[/dashboard]
    FBA[/fba]
    MAN[/manuals]

    DASH --> D1[/api/dashboard/fba-shipments]
    DASH --> D2[/api/orders]
    DASH --> D3[/api/orders/recent]
    DASH --> D4[/api/shipped]
    DASH --> D5[/api/dashboard/operations]

    FBA --> F1[/api/fba/board]

    MAN --> M1[/api/sku-catalog]
    MAN --> M2[/api/sku-catalog/unpaired]
    MAN --> M3[/api/sku-catalog/unpaired-ecwid]
```

## Feature → API clusters (component-level)

```mermaid
graph LR
    subgraph FEATURES[Feature areas]
        CDASH[Dashboard components]
        CFBA[FBA components]
        CAI[AI Chat components]
        CRECV[Receiving components]
        CTECH[Tech components]
        CREPAIR[Repair components]
        CPACK[Packer components]
        CWI[Walk-In components]
        CADMIN[Admin components]
        CREPL[Replenish components]
        CSKU[SKU/Catalog components]
        CWO[Work Orders components]
    end

    CDASH --> AD1[/api/activity/feed]
    CDASH --> AD2[/api/orders · /api/orders/recent · /api/orders/add]
    CDASH --> AD3[/api/shipped · /api/shipped/search · /api/shipped/submit]
    CDASH --> AD4[/api/staff · /api/staff-goals]

    CFBA --> AF1[/api/fba/board · /api/fba/board/:fnsku/entries]
    CFBA --> AF2[/api/fba/fnskus* · /api/fba/shipments*]
    CFBA --> AF3[/api/fba/items/* · /api/fba/labels/bind]
    CFBA --> AF4[/api/assignments · /api/assignments/sku-search]

    CAI --> AA1[/api/ai/openclaw-health · session · chat]
    CAI --> AA2[/api/ai/chat-sessions + /messages]

    CRECV --> AR1[/api/receiving-lines · entry · logs · photos]
    CRECV --> AR2[/api/receiving/match · lookup-po · mark-received]
    CRECV --> AR3[/api/receiving/scan-serial · serials · pending-unboxing]

    CTECH --> AT1[/api/tech-logs · /api/tech/serial]
    CTECH --> AT2[/api/tech/undo-last · update-serials · delete-tracking]

    CREPAIR --> AP1[/api/repair/customers · issues · search]
    CREPAIR --> AP2[/api/repair/submit · square-payment-link]
    CREPAIR --> AP3[/api/repair/ecwid-categories · ecwid-products]
    CREPAIR --> AP4[/api/repair-service/pickup]

    CPACK --> AK1[/api/packerlogs · /api/packing-logs]
    CPACK --> AK2[/api/packing-logs/last-order · update · save-photo]

    CWI --> AW1[/api/local-pickups · /api/local-pickup-orders/*]

    CADMIN --> AX1[/api/admin/features* · logs · qstash-status]
    CADMIN --> AX2[/api/admin/fba-fnskus · upload]
    CADMIN --> AX3[/api/zoho/* · /api/ebay/*]

    CREPL --> AL1[/api/replenish/shipped-fifo · receiving-lines]
    CREPL --> AL2[/api/need-to-order · /api/shipping/track/sync-due]

    CSKU --> AS1[/api/sku-catalog* · /api/product-manuals*]
    CSKU --> AS2[/api/sku-stock · /api/sku/by-tracking · serials-from-code]
    CSKU --> AS3[/api/manuals/recent · /api/sku-manager]

    CWO --> AQ1[/api/work-orders]
```

## Reverse lookup tips

- **Who calls an endpoint?** `rg "/api/fba/board" src` (swap in any route).
- **What does a page call?** Open the page file plus its imported components under `src/components/<area>/`.
- **Cron-only endpoints?** Look for `/api/qstash/*` — those aren't called from the UI, they're triggered on schedule.
