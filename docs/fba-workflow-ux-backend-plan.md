# FBA Workflow UX + Backend Plan

## Goal
Build a consistent FBA flow across Tech -> Packing -> Label Queue -> Shipped that is easy to scan, compact, and operationally safe.

## Canonical Workflow States
Use these as the single workflow source-of-truth for UI filters and server logic:

1. `TESTED`
- Meaning: FNSKU has at least one tech scan.
- Rule: `tech_scanned_qty > 0`.

2. `PACKING`
- Meaning: Tech has scanned units that have not been pack-scanned yet.
- Rule: `tech_scanned_qty - pack_ready_qty > 0`.

3. `READY_TO_PRINT`
- Meaning: Units are pack-verified and available for carton/label grouping.
- Rule: `min(tech_scanned_qty, pack_ready_qty) - shipped_qty > 0`.

4. `LABEL_ASSIGNED`
- Meaning: Units are grouped to a printed label and waiting pickup/manifest.
- Rule: shipment item status is `LABEL_ASSIGNED`.

5. `SHIPPED`
- Meaning: Units confirmed outbound.
- Rule: outbound shipment/ship event exists for units.

## Event Transitions
1. Tech station FNSKU scan (`/api/tech/scan-fnsku`)
- Append immutable `TECH/SCANNED` log event.
- Transition impact: may move row to `PACKING` or increase `TESTED` units.

2. Packing station FNSKU scan (`/api/fba/items/scan`)
- Append immutable `PACK/READY` log event.
- Increment shipment item `actual_qty`.
- If item is `PLANNED`, move to `READY_TO_GO`.
- Transition impact: `PACKING` -> `READY_TO_PRINT` as unit counts balance.

3. Label queue mark printed
- Move shipment items `READY_TO_GO` -> `LABEL_ASSIGNED`.

4. Shipping confirm
- Append immutable `SHIP/SHIPPED` log event.
- Move shipment/item status to `SHIPPED`.

## UX Ownership by Surface

### Sidebar (`src/components/sidebar/FbaSidebarPanel.tsx`, `src/components/fba/FbaSidebar.tsx`)
What belongs here:
1. Workflow slider only: `Packing`, `Ready Print`, `Tested`.
2. Compact pipeline metrics (tested, packed, ready, shipped).
3. Quick search + quick create controls.
4. Top 5-8 "active flow" FNSKUs for selected mode.

What should not live here:
1. Dense per-item metadata grids.
2. Long editable forms beyond quick create.
3. Shipment-level reconciliation details.

### Summary Table (`src/components/fba/FbaShipmentBoard.tsx`)
What belongs here:
1. Date-grouped canonical queue.
2. Dense row summary: product, shipment ref, SKU, T/P/R counters.
3. Mode badge + FNSKU chip.
4. One-row expand for quick actions only.

What should not live here:
1. Multi-step reconciliation workflows.
2. Full shipment edit forms.

### Details Panel (future dedicated FBA details panel)
What belongs here:
1. Shipment item history timeline.
2. Exception resolution (qty mismatch, relink, void).
3. Audit metadata (who/when/station).
4. Final irreversible actions with confirmations.

### Inline Row Expanded View
What belongs here:
1. Fast counters (Tested/Packed/Ready/In Packing).
2. Copy/open queue/refresh actions.
3. Minimal identifiers (FNSKU, SKU, ASIN, shipment ref).

What should not live here:
1. Any action requiring >1 confirmation step.
2. Full-page context switching controls.

## Backend Logic Gaps to Close
1. Scan idempotency guard
- Reject or collapse duplicate scans for same `(fnsku, station, staff)` within a short window (for scanner bounce).

2. Over-pack protection
- Prevent `pack_ready_qty` from exceeding expected constraints unless manual override is provided.

3. Exception channel
- Add `FBA_EXCEPTION` events for mismatch/unknown FNSKU/manual fixes instead of silent failures.

4. Explicit reconciliation queue
- Add endpoint returning rows where `abs(tech_scanned_qty - pack_ready_qty)` or `expected_qty vs actual_qty` diverges materially.

5. Strong status derivation contract
- Keep `workflow_mode` server-derived and returned with every summary row to avoid UI drift.

## UI/UX Size + Simplicity Constraints
1. Keep sidebar controls at 44px min height for touch consistency.
2. Keep row secondary metadata at 9-10px uppercase microcopy only.
3. Keep one visual accent per row (dot + badge), avoid multiple competing highlights.
4. Keep expanded inline actions icon-only and max 3 actions.

## Standards Sources Used
- Amazon Sell blog: FBA shipment event definitions and status semantics.
  - https://sell.amazon.com/es/blog/fba-shipment-tracking
- Amazon FBA Setup Guide PDF: box content, label placement, and shipment packaging checklist.
  - https://m.media-amazon.com/images/G/02/Sell/Guides/FBA_SEtupGuide_SU_EN_AS-XwEFVMTZuA.pdf
- Amazon Seller University (official): inventory requirements overview.
  - https://www.youtube.com/watch?v=3eCYQQLVqpQ

## Notes
Seller Central help reference pages are authoritative but require account sign-in from this environment, so direct crawled excerpts were unavailable.
