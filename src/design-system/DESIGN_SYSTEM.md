# Precision Operations Architecture

This design system implements the "Kinetic Ledger" direction for dense operations interfaces.

## North Star

- Data-first hierarchy and compact scanning.
- Line-based separators over card-heavy layouts.
- Functional color cues for instant state recognition.
- Inline editing and inline actions as the default interaction model.

## Implemented In This Folder

### Tokens

- Color base and semantic maps:
  - `tokens/colors/base.ts`
  - `tokens/colors/semantic.ts`
- Typography:
  - `tokens/typography/families.ts`
  - `tokens/typography/sizes.ts`
  - `tokens/typography/weights.ts`
- Density and structure:
  - `tokens/spacing.ts`
  - `tokens/borders.ts`
  - `tokens/radii.ts` (zero-radius policy)
  - `tokens/shadows.ts` (surface-dim/low-opacity only)
- Motion:
  - `foundations/motion.ts` (`micro=100ms`, `fast=150ms`)
- CSS variable generation:
  - `tokens/css-variables.ts`

### Themes

- `themes/light.ts` and `themes/dark.ts` now include:
  - Surface container ladder (`containerLow` -> `containerHighest`)
  - Signature primary gradient zone
  - Glass/scrim overlay values
  - Ghost border and no-box primitives

### Core Primitives

- Existing primitives updated to ledger style:
  - `components/DetailLineRow.tsx`
  - `components/DetailsPanelRow.tsx` — label / accessory / actions header + body; default `border-gray-100` dividers for sidebar & shipped panels
  - `components/PanelSection.tsx` — titled block wrapping a stack of `DetailsPanelRow` (same rhythm as **Shipping Information** and **FBA** sidebar sections)
  - `components/MetricLineRow.tsx`
  - `components/InlineSaveIndicator.tsx`
  - `components/AlertLineRow.tsx`
  - `components/StatusBadge.tsx`
- New precision primitives:
  - `components/UnderlineValue.tsx`
  - `components/InlineEditableValue.tsx`
  - `components/CopyActionIcon.tsx`
  - `components/ExternalLinkActionIcon.tsx`
  - `components/StatusMicroLabel.tsx`
  - `components/CompactSearchInput.tsx`
  - `components/AssignmentOverlayCard.tsx`

## Functional Color Mapping

- Repair / Support ticket: Orange
- Inventory alert: Red
- System identifiers: Gray
- Logistics / Tracking: Blue
- Success / Inbound: Green
- Fulfillment channel: Purple
- Queued / Pending: Yellow

## System Rules

- No card dependency for ordinary data rows.
- Primary separation through ghost borders and tonal shifts.
- Labels: 9px, uppercase, heavy weight, tracked.
- Values: 13px bold, with monospace for technical identifiers.
- Status communication via text + underline, not pill badges.
- Interaction micro-motion: 100-150ms.

## Next Integration Step

Adopt the new exported primitives in:

- `src/components/ui/CopyChip.tsx`
- `src/components/station/upnext/OrderCard.tsx`
- `src/components/shipped/details-panel/ShippingInformationSection.tsx` (optional: wrap blocks with `PanelSection`; `DetailsPanelRow` re-exports from design-system)
- `src/components/ui/OutOfStockField.tsx`
- `src/components/ui/SearchBar.tsx`
- `src/components/work-orders/WorkOrderAssignmentCard.tsx`

This keeps implementation aligned with the Kinetic Ledger contract while avoiding one-off styling drift.
