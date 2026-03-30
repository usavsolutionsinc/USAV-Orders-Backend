# Custom Hooks Reference

35 custom React hooks in `src/hooks/`.

## Core Hooks

### useStationTheme (`src/hooks/useStationTheme.ts`)
Single entry point for staff theme resolution.
```typescript
const { theme, colors, inputBorder, inputTheme } = useStationTheme({ staffId: 3 });
const { theme, colors } = useStationTheme('purple');
```
Returns: `ResolvedTheme` (theme, colors, inputBorder, inputTheme)

### useAblyChannel (`src/hooks/useAblyChannel.ts`)
Subscribe to Ably realtime channels.
```typescript
useAblyChannel('orders:changes', (message) => { /* handle */ });
```

### useOrderAssignment (`src/hooks/index.ts`)
Mutation hook for bulk order assignment (tech + packer).
```typescript
const mutation = useOrderAssignment();
await mutation.mutateAsync({ orderIds: [1,2,3], testerId: 6, packerId: 5 });
```

## Data Hooks

### useDashboardSearchController (`src/hooks/useDashboardSearchController.ts`)
Search, filter, and pagination state for dashboard tables.

### useDashboardSelectedOrder (`src/hooks/useDashboardSelectedOrder.ts`)
Selected order state for dashboard details panel.

### useExternalItemUrl (`src/hooks/useExternalItemUrl.ts`)
Resolves external platform URLs (eBay listing, Amazon ASIN).

### useStaffNameMap (`src/hooks/useStaffNameMap.ts`)
Maps staff IDs to names using cached staff data.

### useStationTestingController (`src/hooks/useStationTestingController.ts`)
Full state management for tech testing station (scans, serials, undo).

## UI Hooks

### useCamera (`src/hooks/useCamera.ts`)
QR code / barcode scanning via device camera.

### useInfiniteScroll (`src/hooks/useInfiniteScroll.ts`)
Intersection observer-based pagination.

### useDebounce / useDebouncedCallback
Debounced values and callbacks for search inputs.

## Sidebar Hook

### useActiveStaffDirectory (`src/components/sidebar/hooks.ts`)
Returns cached active staff directory. Uses `staffCache.ts` singleton.
```typescript
const staff: StaffMember[] = useActiveStaffDirectory();
// Returns [] while loading, then full list
```

## Barrel Export (`src/hooks/index.ts`)
```typescript
export { useStationTheme, type ResolvedTheme, type StationTheme } from './useStationTheme';
export { useOrderAssignment } from './useOrderAssignment';
// ... plus other hook re-exports
```
