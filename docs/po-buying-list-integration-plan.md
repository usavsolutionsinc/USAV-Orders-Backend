# PO Buying List + Zoho + Receiving Integration Plan (Reuse Existing Replenishment Tables)

## Goal
- Keep one buying workflow on top of existing replenishment tables.
- Track ordered state, PO ID/PO number, and urgent "must box first" inbound items.
- Show that inbound queue on Receiving with urgent-first priority.

## Reuse Existing Tables
1. `replenishment_requests`
- Main row per shortage item.
- Already has: `status`, `zoho_po_id`, `zoho_po_number`, quantities, vendor info, notes.

2. `replenishment_order_lines`
- Keep as the order linkage table (`id`, `replenishment_request_id`, `order_id`, `order_line_id`, `channel_order_id`, `quantity_needed`, `created_at`).
- Use it to render "orders waiting on this PO" in buying list and receiving views.

3. `replenishment_status_log`
- Keep as audit trail for every status transition and buyer action.
- Use `changed_by` + `note` for operator accountability.

## Data Model Adjustments (No New Table)
Add missing buyer-facing fields directly to `replenishment_requests`:
- `ordered_checked boolean not null default false`
- `eta_date date`
- `urgent boolean not null default false`
- `must_box_first boolean not null default false`

Validation rules:
- `ordered_checked=true` requires `zoho_po_id` or `zoho_po_number`.
- `must_box_first=true` requires `urgent=true`.

## Status Mapping (Use Existing Enum + Log)
Use current statuses and transitions:
- `pending_review` / `planned_for_po` = not ordered yet
- `po_created` / `waiting_for_receipt` = ordered/on the way
- `fulfilled` = received and no longer blocking
- `cancelled` = closed

Every change writes to `replenishment_status_log`.

## API Plan
1. `GET /api/need-to-order`
- Extend response with: `ordered_checked`, `eta_date`, `urgent`, `must_box_first`.
- Include linked orders from `replenishment_order_lines`.

2. `PATCH /api/need-to-order/[id]`
- Allow updating: `ordered_checked`, `zoho_po_id`, `zoho_po_number`, `eta_date`, `urgent`, `must_box_first`, `notes`.
- Enforce validation rules above.
- Append note to `replenishment_status_log` when values change.

3. `GET /api/receiving/on-the-way`
- Query `replenishment_requests` rows where status in (`po_created`, `waiting_for_receipt`) and not `fulfilled/cancelled`.
- Join/aggregate `replenishment_order_lines` to return waiting order counts.
- Sort by:
- `must_box_first desc`
- `urgent desc`
- `eta_date asc nulls last`
- `created_at asc`

## UI Plan
1. Buying list (Need-to-Order/Admin)
- Show checkbox for ordered.
- Editable PO ID / PO number.
- Urgent + must-box-first toggles.
- Linked waiting orders count from `replenishment_order_lines`.

2. Receiving page (`src/app/receiving/page.tsx` and receiving dashboard)
- Add "On The Way" table above logs.
- Columns:
- `Must Box First`
- `Urgent`
- `Item / SKU`
- `Qty to Order`
- `PO ID / PO #`
- `ETA`
- `Status`
- `Orders Waiting`

## Rollout Phases
1. Phase 1: schema + API extension
- add four columns to `replenishment_requests`
- extend existing need-to-order endpoints

2. Phase 2: receiving visibility
- add `/api/receiving/on-the-way`
- render receiving "On The Way" queue with urgent-first sorting

3. Phase 3: hardening
- add tests for validation + sorting
- add automatic reconciliation from Zoho PO receive updates

## Acceptance Criteria
- Team can manage PO ordered state and PO ID/number without a new table.
- Buying list and receiving both read from replenishment tables.
- Receiving always shows urgent must-box-first inbound rows at the top.
