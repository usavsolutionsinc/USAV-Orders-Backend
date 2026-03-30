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
  - `tokens/colors/semantic.ts` — includes `condition` palette (used/new/parts/quantity)
- Typography:
  - `tokens/typography/families.ts`
  - `tokens/typography/sizes.ts`
  - `tokens/typography/weights.ts`
  - `tokens/typography/presets.ts` — composed Tailwind class presets (`sectionLabel`, `fieldLabel`, `dataValue`, `monoValue`, `chipText`, `cardTitle`, `tableHeader`, `tableCell`, `microBadge`)
- Density and structure:
  - `tokens/spacing.ts` — includes `density` presets (compact/standard/spacious)
  - `tokens/borders.ts`
  - `tokens/radii.ts` — graduated scale (none → sm → md → lg → xl → 2xl → 3xl → full)
  - `tokens/shadows.ts` (surface-dim/low-opacity only)
- Motion:
  - `foundations/motion.ts` — CSS-oriented durations / cubic-bezier strings (`micro=100ms`, `fast=150ms`)
  - `foundations/motion-framer.ts` — Framer Motion presets used on station surfaces:
    - `motionBezier.easeOut` / `motionBezier.layout` — cubic tuples aligned with **ActiveStationOrderCard** / **Up Next OrderCard**
    - `framerDuration` — second-scale timings (now includes `tableRowMount`, `sidebarExpand`, `dropdownOpen`, `overlaySearchIn`, `chipCopyFeedback`)
    - `framerTransition` — named transitions (`stationCardMount`, `upNextRowMount`, `stationCollapse`, `upNextCollapse`, `tableRowMount`, `sidebarExpand`, `dropdownOpen`, `overlaySearchIn`, `chipCopyFeedback`, chevrons, serial rows, badges, work-order springs)
    - `framerPresence` — `initial` / `animate` / `exit` objects (now includes `tableRow`, `dropdownPanel`, `sidebarSection`); `framerVariants` for the variants API
- CSS variable generation:
  - `tokens/css-variables.ts`

### Themes

- `themes/light.ts` and `themes/dark.ts` now include:
  - Surface container ladder (`containerLow` -> `containerHighest`)
  - Signature primary gradient zone
  - Glass/scrim overlay values
  - Ghost border and no-box primitives

### Primitives (`primitives/`)

- `PanelRow.tsx` — base row with label, accessory, actions, divider
- `IconButton.tsx` — icon-only button with tone variants
- `SearchField.tsx` — decoupled draft architecture, debounced, tone-colored
- `DeferredQtyInput.tsx` — number input with internal draft, clamped on blur
- `StatusText.tsx` — uppercase label with colored underline
- `ExpandableSection.tsx` — AnimatePresence height:'auto' wrapper (uses `framerPresence.sidebarSection`)
- `StickyHeader.tsx` — sticky top/bottom with optional frosted-glass backdrop
- `ConditionText.tsx` — inline condition+qty+title with color mapping; exports `getConditionColor`, `formatConditionLabel`
- `ActionButtonGroup.tsx` — row of icon action buttons with consistent spacing

### Components (`components/`)

- Layout/data rows: `DetailLineRow`, `DetailsPanelRow`, `PanelSection`, `MetricLineRow`
- Status/feedback: `StatusBadge`, `InlineSaveIndicator`, `AlertLineRow`
- Values/editing: `UnderlineValue`, `InlineEditableValue`
- Actions: `CopyActionIcon`, `ExternalLinkActionIcon`
- Search/labels: `CompactSearchInput`, `StatusMicroLabel`
- Overlays: `AssignmentOverlayCard`, `Tooltip`
- **New components:**
  - `DateGroupHeader.tsx` — sticky date group header for tables with variant-based tonal backgrounds
  - `FormField.tsx` — standardized form field wrapper (label, required indicator, hint)
  - `OverlaySearch.tsx` — animated toggle between trigger element and search input
- **Re-exported from `components/ui/`:**
  - `CopyChip.tsx` — semantic chip family (TrackingChip, FnskuChip, SerialChip, OrderIdChip, TicketChip, SourceOrderChip)
  - `TabSwitch.tsx` — universal tab switcher with variant support
- Sidebar intake chrome: `sidebar-intake/` (intakeFormClasses, SidebarIntakeFormShell, SidebarIntakeFormField)

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

## Desktop ↔ Mobile Design Mapping

### Mode Detection (`providers/UIModeProvider.tsx`)

The `UIModeProvider` wraps `useDeviceMode()` and exposes a single `mode: 'desktop' | 'mobile'` value via React context. Components consume it via `useUIMode()` or the safe `useUIModeOptional()`.

Detection priority:
1. `forceMode` prop (testing / Storybook)
2. User manual override (localStorage, via `DeviceModeToggle`)
3. Hardware detection (`navigator.userAgentData.mobile` → UA string fallback)
4. Viewport width + touch input (< 768px AND coarse pointer)

### Navigation

| Desktop | Mobile |
|---------|--------|
| Left sidebar (360px) with labels, sections, back nav | Bottom `MobileNavBar` with 3–5 icon tabs + active dot |
| `DesktopShell` with sidebar + main content | `MobileShell` with toolbar + scrollable content + bottom nav |
| Collapsible sidebar (details panel override) | `MobileToolbar` (48px) with title + 1–2 trailing actions |
| Section headers within sidebar | Slide-in drawer for deep navigation (future) |

### Lists / Tables

| Desktop | Mobile |
|---------|--------|
| Full `DataTable` with columns, sticky headers | Card/list layout: primary text + secondary metadata |
| Hover row highlight, inline actions | Tappable rows, swipe actions or overflow `...` menu |
| `DateGroupHeader` for date grouping | Same component, full-width with larger touch targets |
| Multi-column data rows | Single-column stacked layout |

### Forms

| Desktop | Mobile |
|---------|--------|
| Multi-column forms, inline validation | Single-column vertical, `mobileDensity.spacious` spacing |
| Compact inputs (h-8 to h-9) | Inputs promoted to h-11 minimum (44px touch target) |
| Tab between fields, Enter to submit | Progressive disclosure via accordion/steps |
| `FormField` horizontal layout option | `FormField` vertical-only on mobile |

### Scanning Flow

| Desktop | Mobile |
|---------|--------|
| `ScanInputDesktop`: hidden input listening for scanner keystrokes | `ScanCameraMobile`: fullscreen camera viewfinder |
| Auto-focused, always ready, Enter to confirm | Auto-scan or tap capture, manual entry fallback |
| Inline success/error feedback (ring + shake) | Viewfinder ring color + success checkmark / error X |
| Results appear inline below input | Results appear as cards, camera closes on success |

### Buttons & Actions

| Desktop | Mobile |
|---------|--------|
| `PrimaryButton` at standard sizes (h-8 to h-10) | Sizes promoted: sm→h-11, md→h-12, lg→h-14 (44px+ targets) |
| Label always visible | `iconOnly` option hides label (icon + aria-label) |
| Secondary actions inline | Secondary actions in overflow menu (`...`) |
| Hover states | Active/press states, `whileTap` scale feedback |

### Mobile Touch Tokens (`tokens/touch.ts`)

- `touchTarget.min: 44px` — absolute minimum tappable area (iOS HIG)
- `touchTarget.comfortable: 48px` — standard action buttons
- `touchTarget.large: 56px` — FABs, primary CTAs
- `safeArea.*` — `env(safe-area-inset-*)` for notch/home-bar devices
- `mobileDensity.*` — promoted px/py/gap/minH for mobile rows
- `mobileIconSize.*` — consistent icon sizing (nav: 24px, toolbar: 20px, fab: 24px)
- `bottomNav.height: 56px` — bottom navigation height
- `fab.size: 56px` — floating action button diameter

### Mobile Motion Presets (`foundations/motion-framer.ts`)

Mobile-specific additions to the existing motion system:
- `framerDurationMobile.*` — sheet slides (0.32s), camera enter/exit, scan feedback, FAB, nav
- `framerTransitionMobile.*` — spring-damped sheets, camera transitions, scan success/failure
- `framerPresenceMobile.*` — sheet (y: 100%), camera (scale+opacity), FAB (scale from 0.6), scan feedback (pulse/shake)

### Mobile Icon UX Rules

- **Primary actions** = icon + optional short label (`MobileActionButton` extended FAB)
- **Bottom nav** = icon + 9px uppercase label (always visible, per iOS HIG)
- **Secondary actions** = overflow menu (`...` icon) on mobile, inline on desktop
- **Toolbar** = max 2 trailing icon buttons (44px touch targets)
- **Accessibility**: all icon-only buttons require `ariaLabel`; desktop adds `title` for tooltip hover

### Accessibility & Usability

**Mobile-specific:**
- All tappable elements meet 44px minimum (enforced by `mobileDensity` and `PrimaryButton` size promotion)
- Safe-area-inset handling in `MobileShell`, `MobileNavBar`, `ScanCameraMobile`
- `prefers-reduced-motion` respected: `UIModeProvider.prefersReducedMotion` flag
- Camera permission denied: graceful fallback to manual text entry in `ScanCameraMobile`

**Desktop scanning:**
- `ScanInputDesktop` auto-focuses on mount, window refocus, and after each scan submission
- Visual confirmation: green ring pulse (success), red ring + shake (error)
- Enter key hint badge always visible

### Folder Structure

```
design-system/
├── providers/
│   ├── UIModeProvider.tsx    — React context: mode, capabilities, override
│   └── index.ts
├── tokens/
│   └── touch.ts              — Touch targets, safe areas, mobile density, icon sizes
├── foundations/
│   └── motion-framer.ts      — Extended with framerDurationMobile, framerTransitionMobile, framerPresenceMobile
├── primitives/
│   └── PrimaryButton.tsx     — Mode-aware button (auto-promotes touch targets on mobile)
├── components/
│   ├── ResponsiveShell.tsx   — Auto-selects DesktopShell or MobileShell
│   ├── desktop/
│   │   ├── DesktopShell.tsx  — Sidebar + main content frame
│   │   └── ScanInputDesktop.tsx — Keyboard/scanner barcode input
│   └── mobile/
│       ├── MobileShell.tsx       — Toolbar + content + bottom dock + nav
│       ├── MobileNavBar.tsx      — Bottom tab navigation
│       ├── MobileActionButton.tsx — Floating action button (FAB)
│       ├── MobileToolbar.tsx     — Top app bar
│       └── ScanCameraMobile.tsx  — Fullscreen camera scanner
```

## Next Integration Step

Migrate existing components to consume new design system primitives:

1. **OrderCard / FbaItemCard / RepairCard** — replace inline `getConditionColor` helpers with `ConditionText` primitive
2. **TechTable / PackerTable / DashboardShippedTable** — replace inline sticky date headers with `DateGroupHeader` component
3. **UpNextFilterBar** — replace inline AnimatePresence toggle with `OverlaySearch` component
4. **Sidebar form sections** — replace inline label styling with `FormField` component
5. **All expand/collapse patterns** — replace inline AnimatePresence+motion.div with `ExpandableSection` primitive
6. **Typography** — replace hand-rolled `text-[10px] font-black uppercase tracking-[0.2em]` with `typographyPresets.sectionLabel` etc.

See `.design-system-rules.md` for complete auto-UX integration rules.
