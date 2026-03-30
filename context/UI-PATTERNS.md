# UI Patterns & Design System

## Framework
- React 19 with Next.js 16 App Router
- All interactive components use `'use client'` directive
- Tailwind CSS for styling
- Framer Motion for animations
- TanStack React Query for server state

## Design System (`src/design-system/`)

### Structure
```
design-system/
├── components/      # Button, Input, Modal, Table, Pagination (~20 reusable)
├── foundations/     # Colors (50+ semantic), typography scales, spacing
├── primitives/      # Low-level: flex, grid, card, stack
├── themes/          # Light/dark theme CSS classes
├── tokens/          # Design token definitions
├── utils/           # Animation helpers, CSS merge
└── DESIGN_SYSTEM.md # Documentation
```

### Key Components
| Component | Location | Purpose |
|-----------|----------|---------|
| SearchBar | `src/components/ui/SearchBar.tsx` | Search input with clear button |
| ShipByDate | `src/components/ui/ShipByDate.tsx` | Date display with urgency coloring |
| DaysLateBadge | `src/components/ui/DaysLateBadge.tsx` | Late order indicator |
| CopyChip / FnskuChip | `src/components/ui/CopyChip.tsx` | Click-to-copy text chips |
| WeekHeader | `src/components/ui/WeekHeader.tsx` | Week navigation with count |
| OverlaySearchBar | `src/components/ui/OverlaySearchBar.tsx` | Fullscreen search overlay |
| OrderStaffAssignmentButtons | `src/components/ui/OrderStaffAssignmentButtons.tsx` | Tech/packer assignment rows |
| PlatformExternalChip | `src/components/ui/PlatformExternalChip.tsx` | eBay/Ecwid/Zoho external link |

## Layout Patterns

### Sidebar + Main Content
Most pages follow: sidebar (navigation/filters) + main content area.
- `DashboardSidebar` — Dashboard nav + staff selection
- `FbaSidebar` — FBA staff selector + workspace + plans
- `PackerSidebarPanel` / `TechSidebarPanel` — Station-specific

### Details Panel (Slide-in)
Right-side panel that slides in on order selection:
- `AdminDetailsStack` — Bulk assignment + order details
- `ShippedDetailsPanel` — Shipped order details
- `DashboardDetailsStack` — Dashboard order details
- Uses `framer-motion` for slide animation (`x: '100%' -> x: 0`)
- Fixed position, 420px wide, z-[120]

### Station Layout
Tech/Packer stations are full-screen themed interfaces:
- `StationTesting` — Tech testing station
- `StationPacking` — Packer station
- `StationFba` — FBA station wrapper
- Theme color flows through entire UI via `useStationTheme`

## Styling Conventions

### Text Sizes
- Labels: `text-[9px] font-black uppercase tracking-widest`
- Body: `text-xs` or `text-sm`
- Headings: `text-[20px] font-black tracking-tight`
- Buttons: `text-[10px] font-black uppercase tracking-wider`

### Spacing
- Card padding: `px-6 py-5` or `px-8 py-5`
- Gaps: `gap-1.5` (tight), `gap-2` (normal), `gap-4` (section)
- Section dividers: `<div className="h-px bg-gray-100" />`

### Colors
- Primary: `bg-blue-600` / `text-blue-600`
- Success: `bg-emerald-600`
- Warning: `bg-orange-500`
- Danger: `bg-red-500`
- Neutral: `bg-gray-50`, `border-gray-200`, `text-gray-400`/`text-gray-900`

### Rounded Corners
- Buttons: `rounded-xl` or `rounded-2xl`
- Cards: `rounded-2xl` or `rounded-3xl`
- Chips/badges: `rounded-full`

### Shadows
- Cards: `shadow-sm`
- Panels: `shadow-[-20px_0_50px_rgba(0,0,0,0.05)]`
- Active buttons: `shadow-lg shadow-{color}-200`

## State Management

### Server State (React Query)
```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ['resource', params],
  queryFn: () => fetch('/api/resource').then(r => r.json()),
});
```

### Form State
Local `useState` for form fields, submission state.

### URL State
`useSearchParams()` for filters, tabs, staff selection.
```typescript
const searchParams = useSearchParams();
const tab = searchParams.get('tab');
const staffId = searchParams.get('staffId');
```

### Context State
- `AblyContext` — Realtime subscriptions (app-wide)
- `FbaWorkspaceContext` — FBA selection, tracking, scan state
- `HeaderContext` — Global search/filter state

## Animation Patterns

### Framer Motion
- Panel slide-in: `initial={{ x: '100%' }} animate={{ x: 0 }}`
- Fade: `initial={{ opacity: 0 }} animate={{ opacity: 1 }}`
- Spring: `type: 'spring', damping: 25, stiffness: 350, mass: 0.5`
- `AnimatePresence` for exit animations
- `useReducedMotion()` for accessibility

### Transitions
- Buttons: `transition-all` (Tailwind)
- Tab switches: CSS transitions
- Loading states: `Loader2` spinner with `animate-spin`

## Component Patterns

### Staff-Themed Buttons
```typescript
const theme = getStaffThemeById(member.id);
const themeClass = stationThemeClasses[theme];
<button className={isActive ? themeClass.active : themeClass.inactive}>
```

### Copy-to-Clipboard
```typescript
navigator.clipboard.writeText(text);
setCopied(true);
window.setTimeout(() => setCopied(false), 2000);
```

### Conditional Rendering
- Loading: `<Loader2 className="animate-spin" />`
- Error: `<FbaErrorState message={error} onRetry={retry} />`
- Empty: Inline message or shell component

## Icons
Custom icon components in `src/components/Icons.tsx`.
Named exports: `Check`, `X`, `Plus`, `Minus`, `Loader2`, `Package`, `AlertCircle`, `ChevronRight`, `Pencil`, `Search`, `ExternalLink`, etc.
