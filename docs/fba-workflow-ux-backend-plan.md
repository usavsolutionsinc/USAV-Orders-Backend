# FBA Workflow UX + Backend Plan (Plan/Print/Shipped Realignment)

## Objective
Move the current `src/components/fba/FbaShippedTable.tsx` behavior out of the **Shipped** tab and into the **Plan** flow as a **Print-ready FNSKU** view, because those rows are pack-scanned and ready for label/print work, not yet shipped.

## Current Problem (As-Is)
1. `FbaShippedTable` is rendered when `tab=shipped` (`src/app/fba/page.tsx`).
2. `FbaShippedTable` data source is `/api/packerlogs` via `fetchDashboardPackedRecords`.
3. `/api/packerlogs` represents PACK station activity, including `FBA_READY`, not shipment close.
4. Result: FNSKU rows can look "shipped" too early, even though they are only ready to print.

## Target Flow (To-Be)
Use strict lifecycle ownership per tab:

1. **Plan tab**
- Source of truth: `fba_fnsku_logs` summary and FNSKU workflow state.
- Show FNSKU rows in these modes: `PLAN`, `PACKING`, `PRINT_READY` (`READY_TO_GO` alias).
- This is where the moved table lives.

2. **Print tab**
- Source of truth: shipment/item queue for label operations.
- Shows shipment groups and item rows that are ready for label assignment / printing.

3. **Shipped tab**
- Source of truth: shipment close (`SHIP/SHIPPED`) outcomes only.
- No PACK scan ledger data here.

## Canonical Server State Contract
Continue server-side derivation from `fba_fnsku_logs`:

1. `PLAN`
- Rule: `tech_scanned_qty > 0` and `currently_packing_qty = 0` and `ready_to_print_qty = 0`.

2. `PACKING`
- Rule: `tech_scanned_qty - pack_ready_qty > 0`.

3. `PRINT_READY` (API alias accepted: `READY_TO_GO`, `READY_TO_PRINT`)
- Rule: `min(tech_scanned_qty, pack_ready_qty) - shipped_qty > 0`.

4. `LABEL_ASSIGNED`
- Rule: shipment item status is `LABEL_ASSIGNED`.

5. `SHIPPED`
- Rule: shipment/item status `SHIPPED` and/or `SHIP/SHIPPED` event exists.

## Frontend Ownership Changes

### 1) Move FbaShippedTable behavior to Plan flow
1. Keep the row UX pattern from `FbaShippedTable` (date groups, chips, quick scanning readability).
2. Rebind its data source from `/api/packerlogs` to FBA workflow API (`/api/fba/logs/summary` filtered to print-ready + optional plan/packing modes).
3. Place this table in `tab=summary` (Plan tab), under a mode toggle that can explicitly show print-ready rows.

Suggested naming cleanup:
- `FbaShippedTable` -> `FbaPrintReadyTable` (or `FbaWorkflowTable`) to match behavior.

### 2) Keep Print tab for label operations
1. `FbaLabelQueue` remains the print-action surface.
2. It should consume shipment/item states (`READY_TO_GO`, `LABEL_ASSIGNED`) and not depend on packer-log fallback as primary path.

### 3) Restrict Shipped tab to shipped history only
1. Replace current FBA shipped-tab data with shipment-close history.
2. Use `fba_shipments.status = 'SHIPPED'` (+ item details) as list/detail source.
3. Remove dependence on `/api/packerlogs` for this tab.

## API Plan

### A) Extend `GET /api/fba/logs/summary`
Add explicit mode contract for UI filters:
1. Accept: `ALL`, `PLAN`, `PACKING`, `PRINT_READY`, `READY_TO_GO`, `READY_TO_PRINT`, `LABEL_ASSIGNED`, `SHIPPED`.
2. Normalize aliases server-side (`READY_TO_GO`/`READY_TO_PRINT` => `PRINT_READY`).
3. Return canonical `workflow_mode` values used by UI (`PLAN`, `PACKING`, `PRINT_READY`, `LABEL_ASSIGNED`, `SHIPPED`, `NONE`).

Response fields to guarantee:
1. `fnsku`, `product_title`, `asin`, `sku`.
2. `tech_scanned_qty`, `pack_ready_qty`, `shipped_qty`, `ready_to_print_qty`.
3. `workflow_mode`, `last_event_at`.
4. `shipment_id`, `shipment_ref`, `shipment_item_status`, `expected_qty`, `actual_qty`.

### B) Add dedicated print-ready list endpoint (recommended)
`GET /api/fba/items/print-ready`

Query params:
1. `q` (search fnsku/title/asin/sku/shipment_ref)
2. `weekStart`, `weekEnd`
3. `limit`, `offset`

Purpose:
1. Provide row-level list directly for moved table in Plan tab.
2. Avoid overloading `/api/packerlogs` and avoid mixing non-FBA pack logs.

### C) Shipped history endpoint contract
Use existing shipment APIs with shipped filter:
1. `GET /api/fba/shipments?status=SHIPPED&limit=...&q=...`
2. `GET /api/fba/shipments/[id]/items`

Optional later optimization:
- Add `GET /api/fba/shipments/shipped-history` if we need flattened row paging.

## Transition Rules by Event

1. Tech scan (`/api/tech/scan-fnsku`)
- Append `TECH/SCANNED`.
- Affects Plan/Packing counts.

2. Pack scan (`/api/fba/items/scan`)
- Append `PACK/READY`.
- Promotes to print-ready when counts allow.
- Must not appear in shipped history.

3. Label bind (`/api/fba/labels/bind`)
- Move item to `LABEL_ASSIGNED`.

4. Ship close (`/api/fba/shipments/close`)
- Append `SHIP/SHIPPED`.
- Now eligible for Shipped tab.

## Rollout Phases

### Phase 1: API hardening
1. Update `summary` mode aliases + canonical `workflow_mode` output.
2. Add `/api/fba/items/print-ready`.
3. Add tests for mode filters and state derivation.

### Phase 2: UI reassignment
1. Move/rename `FbaShippedTable` into Plan tab as print-ready list.
2. Repoint table fetch logic to new FBA endpoint.
3. Add Plan sub-modes: `PLAN`, `PACKING`, `PRINT_READY`.

### Phase 3: Shipped tab correction
1. Replace shipped-tab content with shipped-only data source.
2. Remove `/api/packerlogs` dependency from FBA page.

### Phase 4: Cleanup
1. Remove legacy query keys (`shipped-fba`, `shipped-table-fba`) if unused.
2. Remove FBA-specific assumptions from generic shipped table handlers.

## Acceptance Criteria
1. Pack-scanned FNSKU appears in Plan/Print-ready view, not in Shipped tab.
2. Shipped tab shows only rows with confirmed ship close.
3. Same FNSKU does not appear as shipped before `SHIP/SHIPPED` event.
4. API contracts are explicit and mode aliases are backward-compatible.
5. Sidebar counts and table rows stay consistent for all mode filters.

## Key Files Affected (Implementation)
1. `src/app/fba/page.tsx`
2. `src/components/fba/FbaShippedTable.tsx` (rename/rebind)
3. `src/components/fba/FbaShipmentBoard.tsx`
4. `src/components/sidebar/FbaSidebarPanel.tsx`
5. `src/components/fba/types.ts`
6. `src/app/api/fba/logs/summary/route.ts`
7. `src/app/api/fba/items/print-ready/route.ts` (new)
8. `src/app/api/fba/shipments/route.ts` (shipped filter usage/fields as needed)
