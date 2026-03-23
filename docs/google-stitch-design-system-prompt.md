# USAV Minimal Line Design System Prompt (Google Stitch)

Use this file as the source prompt for Google Stitch to generate a clean, lightweight design system and a `DESIGN_SYSTEM.md` spec for implementation.

## Source Components Reviewed

- `src/components/ui/CopyChip.tsx`
- `src/components/station/upnext/OrderCard.tsx`
- `src/components/shipped/details-panel/ShippingInformationSection.tsx`
- `src/design-system/components/OutOfStockField.tsx` (re-export: `src/components/ui/OutOfStockField.tsx`)
- `src/components/ui/SearchBar.tsx`
- `src/components/work-orders/WorkOrderAssignmentCard.tsx`
- Supporting line-row primitives already in use:
  - `src/design-system/components/DetailLineRow.tsx`
  - `src/components/shipped/details-panel/blocks/DetailsPanelRow.tsx`
  - `src/components/shipped/details-panel/blocks/CopyableValueFieldBlock.tsx`

## What These Components Have In Common

1. Information-first layout:
- Data is shown in compact rows with clear label/value hierarchy.
- Labels are small uppercase metadata; values are bolder and easier to scan.

2. Subtle separators instead of heavy containers:
- Frequent use of `border-b` dividers (`gray-100`, `red-100`, accent variants).
- Most sections feel like stacked lines, not boxed cards.

3. Inline utility actions:
- Edit, copy, external-link actions are icon-level controls in the same row.
- Action icons stay minimal and rely on color transitions for feedback.

4. Compact typography system:
- Labels around `9px-10px`, uppercase, `font-black`, wide tracking.
- Values around `13px-14px` / `text-sm`, bold, with `font-mono` for IDs/tracking/serials.

5. Inline editing behavior:
- Edit-in-place pattern with `bg-transparent`, `border-0`, and no modal forms for simple fields.
- Fast save feedback via small inline status text (Saving/Saved/Error).

6. Functional color semantics:
- Neutral base (`gray-*`) plus meaning-driven accents:
  - Blue = link/info actions
  - Emerald = success/primary completion
  - Red = risk/needs attention
  - Yellow/Orange = warning

7. Micro motion only:
- Short transitions for hover/focus/active.
- Small scale tap feedback on action buttons (`active:scale-95` / similar).

8. Line-emphasis value styling:
- Underline emphasis appears in key value chips (`border-b-2`) instead of filled pills.
- Visual weight comes from text + underline, not bubble backgrounds.

## Prompt For Google Stitch

Build a production-ready design system for an operations dashboard UI with a **clean, simple, line-based visual language**.

### Objective
Create a reusable system that standardizes row-based detail panels, inline editing, compact metadata labels, and copy/edit/link actions.  
The style should be utilitarian, high-signal, and fast to scan.

### Core Design Direction
- Use a **minimal line UI**: separators and subtle underlines, not heavy cards.
- Prefer **inline editing** over modal editing for field-level changes.
- Keep controls compact and dense for workflow speed.
- Preserve a professional, neutral look with restrained accent colors.

### Critical Constraints
- Do **not** rely on bubble/pill containers for standard field values.
- Do **not** create oversized cards or decorative gradients.
- Do **not** introduce playful or consumer-style UI motifs.
- Keep spacing tight and consistent for high information density.

### Typography
- Font family: DM Sans for interface text, monospace for machine values (IDs/tracking/serials).
- Label style: 9-10px, uppercase, heavy weight, wide tracking, muted gray.
- Value style: 13-14px (or text-sm), bold/black, darker gray.
- Use monospace on values that are operational identifiers.

### Color System (Semantic)
- Neutrals: white + gray scale for canvas, surfaces, lines, text.
- Accents:
  - Blue: links, external/open actions, informative state.
  - Emerald: success, completion, positive actions.
  - Red: errors, missing stock, critical warnings.
  - Yellow/Orange: caution or late states.
- Keep accent use sparse and purposeful.

### Border, Shape, and Elevation
- Default structure: 1px bottom divider (`gray-100` / contextual line color).
- Emphasis values: 2px underline accent for important short values.
- Radius should be subtle (`lg` to `2xl`) and used mainly for controls/modals.
- Shadows are minimal and only for overlays/dialogs.

### Interaction Patterns
- Standard row pattern:
  - Left: label + optional small accessory tag
  - Right: icon actions (copy/edit/external)
  - Below: primary value (read mode or inline input mode)
- Inline editing pattern:
  - Toggle via pencil icon
  - Input uses transparent background and no heavy border chrome
  - Blur/autosave with small inline save indicator
- Copy pattern:
  - Icon action with transient “Copied” feedback (text + icon)
- Motion:
  - 120-200ms transitions
  - Simple opacity/scale or slight slide only

### Components To Generate
- `DetailLineRow`
- `UnderlineValue`
- `InlineEditableValue`
- `CopyActionIcon`
- `ExternalLinkActionIcon`
- `InlineSaveIndicator`
- `CompactSearchInput`
- `StatusMicroLabel`
- `AssignmentOverlayCard` (modal-only case; still typography-first and minimal)

### Token Outputs Required
Provide tokens with names and values for:
- Color (base + semantic)
- Typography (families, sizes, weights, letter spacing)
- Spacing scale
- Border widths and divider styles
- Radii
- Shadow levels
- Motion durations/easing

### Required Deliverable Format
Return a `DESIGN_SYSTEM.md` with:
1. Design principles
2. Token tables
3. Component specs (anatomy, states, variants)
4. Interaction behavior rules
5. Accessibility requirements
6. “Do/Don’t” examples
7. Migration guidance for existing components

## Alignment Checklist For Existing USAV Components

Use this after Stitch produces `DESIGN_SYSTEM.md`.

1. `CopyChip.tsx`
- Keep icon + value inline.
- Standardize underline token and width variants.
- Use shared copy feedback pattern.

2. `OrderCard.tsx`
- Keep border-led hierarchy and compact metadata.
- Replace ad-hoc value pills with system `UnderlineValue` or line-row primitives where appropriate.
- Normalize action button sizes, radii, and motion to tokens.

3. `ShippingInformationSection.tsx`
- Migrate all field rows to one shared `DetailLineRow` contract.
- Standardize action icon spacing, hover colors, and inline input styles.
- Reuse shared inline save indicator and status text tokens.

4. `OutOfStockField.tsx`
- Keep two-line row structure (label/actions + value/input).
- Move label typography and divider colors to system tokens.
- Reuse common inline edit/save behavior spec.

5. `SearchBar.tsx`
- Keep compact utility behavior (search/clear/paste).
- Align radius, border, focus ring, icon sizing, and typography to token scale.
- Ensure compact and default size variants map to spacing tokens.

6. `WorkOrderAssignmentCard.tsx`
- Keep as overlay-only component.
- Align header/metadata typography and selection button styles to shared type, spacing, and semantic color tokens.
- Minimize visual weight; prioritize scannable text over decorative surfaces.

