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
  - `foundations/motion.ts` — CSS-oriented durations / cubic-bezier strings (`micro=100ms`, `fast=150ms`)
  - `foundations/motion-framer.ts` — Framer Motion presets used on station surfaces:
    - `motionBezier.easeOut` / `motionBezier.layout` — cubic tuples aligned with **ActiveStationOrderCard** / **Up Next OrderCard**
    - `framerDuration` — second-scale timings
    - `framerTransition` — named transitions (`stationCardMount`, `upNextRowMount`, `stationCollapse`, `upNextCollapse`, chevrons, serial rows, badges)
    - `framerPresence` — `initial` / `animate` / `exit` objects; `framerVariants` for the variants API
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
- **Reference example (inline inventory note):** `components/OutOfStockField.tsx` — micro-label + underline row, read/edit modes, debounced save with ephemeral “Saved” feedback; use as a template for similar operational fields (see file-level comment).
  - `components/CopyActionIcon.tsx`
  - `components/ExternalLinkActionIcon.tsx`
  - `components/StatusMicroLabel.tsx`
  - `components/CompactSearchInput.tsx`
  - `components/AssignmentOverlayCard.tsx`
  - `components/sidebar-intake/` — sidebar “intake” chrome shared by **ShippedIntakeForm** and **FbaCreateShipmentForm**:
    - `intakeFormClasses.ts` — label / input / select / submit button class strings
    - `SidebarIntakeFormShell.tsx` — header + optional band + scroll body + footer
    - `SidebarIntakeFormField.tsx` — stacked label + control + optional hints

## CopyChip Semantic Rules

**Hard rule: chip variants are semantically bound to data types and must never be interchanged.**

| Chip | Color | Icon | Use for | Never use for |
|------|-------|------|---------|---------------|
| `TrackingChip` | Blue / `border-blue-500` | MapPin | Carrier shipping tracking numbers (UPS, FedEx, USPS…) | FNSKU codes, order IDs |
| `FnskuChip` | Purple / `border-purple-500` | Package | Amazon FNSKU identifiers (e.g. `X001ABC123`) | Shipping tracking numbers |
| `SerialChip` | Emerald / `border-emerald-500` | Barcode | Device / unit serial numbers | Any non-serial value |
| `OrderIdChip` | Gray / `border-gray-400` | Hash | Internal order IDs | Tracking or FNSKU |
| `TicketChip` | Orange / `border-orange-500` | Settings | Repair / support ticket IDs | Any other type |
| `SourceOrderChip` | Gray / `border-gray-400` | Hash | External platform order numbers | Tracking or FNSKU |

**FNSKU ≠ Tracking Number.** FNSKUs are Amazon product identifiers scanned at FBA intake. Tracking numbers are carrier labels attached to outbound shipments. Displaying an FNSKU inside a `TrackingChip` (blue, MapPin) or a tracking number inside an `FnskuChip` (purple, Package) is a design-system violation.

## Tab Switcher Rules

**Hard rule: all tab-like UI must use `TabSwitch` from `src/components/ui/TabSwitch.tsx`.** Custom pill buttons or ad-hoc toggle rows are not permitted. Wrap the switcher in `SidebarTabSwitchChrome` when it sits in a sidebar header row.

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

This keeps implementation aligned with the Kinetic Ledger contract while avoiding one-off styling drift.
