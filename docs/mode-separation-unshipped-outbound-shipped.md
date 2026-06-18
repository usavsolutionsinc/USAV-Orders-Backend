# Mode separation — Unshipped · Outbound · Shipped

_Status: implemented (2026-06-16)._

## Ownership matrix

| State / work | Page | API scope |
|---|---|---|
| `AWAITING_LABEL` (no tracking) | **Outbound · Labels** (`/outbound`) | `awaitingOnly=true` |
| `PENDING` / `TESTED` / `BLOCKED` | **Dashboard · Unshipped** (`/dashboard?unshipped`) | `fulfillmentScope=true` |
| `PACKED_STAGED` (dock staging) | **Outbound · Scan-out** (`/outbound?mode=scan-out`) | `stagedOnly=true` |
| Post-dock + carrier history | **Dashboard · Shipped** (`/dashboard?shipped`) | `/api/shipped` week query |

**Packer scan display** (`packed_by`, pack initials) remains on **Shipped** until a dedicated pack-history API exists.

## Pipeline

```
Sold → Outbound Labels (TRK# + label PDF)
     → Unshipped (test + pack)
     → Outbound Scan-out (dock SHIP_CONFIRM)
     → Shipped (carrier + packer attribution)
```

## Key files

| Layer | Path |
|---|---|
| API scopes | `src/app/api/orders/route.ts` — `fulfillmentScope`, `awaitingOnly`, `stagedOnly` |
| Fulfillment fetch | `src/lib/dashboard-table-data.ts` — `fetchUnshippedOrdersData` |
| Labels / staged fetch | `src/lib/outbound/outbound-table-data.ts` |
| Fulfillment states | `src/lib/unshipped-state.ts` — `deriveFulfillmentState`, `FULFILLMENT_STATE_META` |
| Shared table | `src/components/dashboard/OrdersQueueTable.tsx` — `queueMode` prop |
| Add tracking UX | `src/components/outbound/labels/AddTrackingPopover.tsx` |
| Detail contexts | `ShippedDetailsPanel` — `fulfillment` \| `labels` \| `staged` \| `shipped` |

## URL migration

| Legacy | Redirect / replacement |
|---|---|
| `/dashboard?unshipped&stage=awaiting` | `/outbound` (preserves `search` → `q`) |
| Add TRK# on Unshipped rows | **Outbound · Labels** only |

## Cache invalidation

- Tracking added → `bustLabelsCaches` + `bustFulfillmentCaches` (`useOrderAssignment`)
- Scan-out / staging → `bustScanOutCaches` (unchanged)
- Realtime `order.changed` / `order.assignments` → dashboard + outbound query prefixes
