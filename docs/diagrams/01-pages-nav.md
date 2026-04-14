# 01 — Pages & Navigation

All user-facing pages under `src/app/**` and the primary sidebar links that connect them. The root `/` redirects to `/dashboard`.

```mermaid
graph LR
    ROOT["/ (redirect)"]:::entry --> DASH

    subgraph SIDEBAR[Sidebar Nav]
        DASH["/dashboard"]
        OPS["/operations"]
        FBA["/fba"]
        WALKIN["/walk-in"]
        WO["/work-orders"]
        REPL["/replenish"]
        RECV["/receiving"]
        TECH["/tech<br/>(?staffId=1)"]
        PACK["/packer<br/>(?staffId=4)"]
        SKU["/sku-stock"]
        AI["/ai"]
        MAN["/manuals"]
        SUP["/support"]
        PQ["/previous-quarters"]
        ADM["/admin"]
    end

    TECH --> TECHID["/tech/[id]"]
    PACK --> PACKID["/packer/[id]"]
    SKU --> SKUID["/sku-stock/[sku]"]

    SUP -.-> ADMCONN["/admin?section=connections"]
    ADMCONN -.-> ADMZOHO["/admin?section=connections&page=zoho-management"]

    REPAIR["/repair"]:::side
    SUP -.-> REPAIR

    classDef entry fill:#2d3748,color:#fff,stroke:#1a202c
    classDef side fill:#4a5568,color:#fff,stroke:#2d3748
```

## Routes at a glance

| Route | File | Dynamic? |
|---|---|---|
| `/` | `src/app/page.tsx` | — |
| `/admin` | `src/app/admin/page.tsx` | query-param driven |
| `/ai` | `src/app/ai/page.tsx` | — |
| `/dashboard` | `src/app/dashboard/page.tsx` | — |
| `/fba` | `src/app/fba/page.tsx` | — |
| `/manuals` | `src/app/manuals/page.tsx` | — |
| `/operations` | `src/app/operations/page.tsx` | — |
| `/packer` | `src/app/packer/page.tsx` | — |
| `/packer/[id]` | `src/app/packer/[id]/page.tsx` | ✓ |
| `/previous-quarters` | `src/app/previous-quarters/page.tsx` | — |
| `/receiving` | `src/app/receiving/page.tsx` | — |
| `/repair` | `src/app/repair/page.tsx` | — |
| `/replenish` | `src/app/replenish/page.tsx` | — |
| `/sku-stock` | `src/app/sku-stock/page.tsx` | — |
| `/sku-stock/[sku]` | `src/app/sku-stock/[sku]/page.tsx` | ✓ |
| `/support` | `src/app/support/page.tsx` | — |
| `/tech` | `src/app/tech/page.tsx` | — |
| `/tech/[id]` | `src/app/tech/[id]/page.tsx` | ✓ |
| `/walk-in` | `src/app/walk-in/page.tsx` | — |
| `/work-orders` | `src/app/work-orders/page.tsx` | — |
