# Staff System

## Staff Directory

8 staff members with fixed IDs. Constants defined in `src/utils/staff.ts`.

| ID | Name | Role | Theme Color |
|----|------|------|-------------|
| 1 | Michael | Technician | green |
| 2 | Thuc | Technician | blue |
| 3 | Sang | Technician | purple |
| 4 | Tuan | Packer | black |
| 5 | Thuy | Packer | red |
| 6 | Cuong | Technician | yellow |
| 7 | Kai | Receiving | lightblue |
| 8 | Lien | Sales | pink |

## Constants (`src/utils/staff.ts`)

```typescript
STAFF_NAMES: Record<number, string>       // ID -> display name
TECH_IDS: readonly number[]               // [1, 2, 3, 6] — technician IDs in display order
PACKER_IDS: readonly number[]             // [4, 5] — packer IDs in display order
TECH_NAME_ORDER: readonly string[]        // ['michael', 'thuc', 'sang', 'cuong'] — sort order
PACKER_NAME_ORDER: readonly string[]      // ['tuan', 'thuy'] — sort order
DEFAULT_TECH_ID: number                   // 6 (Cuong) — default bulk-assign tech
DEFAULT_PACKER_ID: number                 // 5 (Thuy) — default bulk-assign packer
TECH_EMPLOYEE_IDS: Record<string, string> // Station '1'->'TECH001' legacy mapping
STAFF_ID_BY_NAME: Record<string, number>  // Reverse lookup: 'michael' -> 1
getStaffName(staffId): string             // ID -> name, fallback 'Not specified'
getStaffIdByName(name): number | null     // Name -> ID
```

## Theme System (`src/utils/staff-colors.ts`)

### Theme Resolution
```
staffId -> getStaffThemeById(staffId) -> StationTheme -> Tailwind classes
```

### StationTheme Type
```typescript
type StationTheme = 'green' | 'purple' | 'blue' | 'yellow' | 'black' | 'red' | 'lightblue' | 'pink';
```

### Key Exports
```typescript
getStaffThemeById(staffId)          // number -> StationTheme
stationThemeColors[theme]           // bg, hover, light, border, text, shadow classes
stationThemeClasses[theme]          // active/inactive button classes
stationScanInputBorderClass[theme]  // Scan input border
getPackerInputTheme(theme)          // Packer input text/bg/ring/border
```

### useStationTheme Hook (`src/hooks/useStationTheme.ts`)
Single entry point for theme resolution in React components.

```typescript
// From a theme string directly
const { theme, colors, inputBorder, inputTheme } = useStationTheme('purple');

// From a staff ID (resolves dynamically)
const { theme, colors, inputBorder, inputTheme } = useStationTheme({ staffId: 3 });
```

Returns `ResolvedTheme`:
- `theme` — StationTheme string
- `colors` — StationThemeColors (bg, hover, light, border, text, shadow)
- `inputBorder` — Scan input border class
- `inputTheme` — Packer input classes

## Staff Cache (`src/lib/staffCache.ts`)

Module-level singleton. One API fetch per page load, shared across all components.

```typescript
getActiveStaff(): Promise<StaffMember[]>       // All active staff (cached)
getPresentStaffForToday(): Promise<StaffMember[]>  // Staff scheduled today (cached per day)
invalidateStaffCache(): void                   // Reset after mutations
```

### Hook: `useActiveStaffDirectory()` (`src/components/sidebar/hooks.ts`)
Wraps `getActiveStaff()` in a React hook. Returns `StaffMember[]` (empty array while loading).

## Staff Assignment UI

### OrderStaffAssignmentButtons (`src/components/ui/OrderStaffAssignmentButtons.tsx`)
Shared component for tech/packer assignment buttons. Uses `getStaffThemeById` for button colors.

### StaffSelector (`src/components/StaffSelector.tsx`)
Dropdown component for selecting staff. Supports role filtering (`role: 'all' | 'technician' | 'packer'`).
Sorts techs by `TECH_NAME_ORDER`, packers by ID.

### AdminDetailsStack (`src/components/shipped/stacks/AdminDetailsStack.tsx`)
Bulk assignment panel. Tester + packer selection with "Apply To Selected" action.

## Legacy Employee ID Mapping
Station numbers 1-4 map to legacy employee IDs (TECH001-TECH004) for backward compatibility.
Used in `resolveStaffIdFromTechParam()` when staff lookup by numeric ID fails.
Defined in `TECH_EMPLOYEE_IDS` constant in `src/utils/staff.ts`.
