/**
 * Hooks barrel export.
 *
 * Always import hooks from '@/hooks' — never from the internal _*.ts files.
 *
 * Category files (internal):
 *   _lifecycle.ts  useMount, useUnmount, usePrevious, useDebounce, useThrottle, useIsMounted
 *   _storage.ts    useLocalStorage, useSessionStorage
 *   _ui.ts         useScrollPosition, useWindowSize, useToggle, useInView, useClickOutside, useMediaQuery, useIsMobile, useDeviceMode
 *   useKeyboard.ts useKeyboard (mobile virtual keyboard detection via Visual Viewport API)
 *   _data.ts       useFetch, useMutation
 *   _auth.ts       useAuthToken, usePermissions
 *   _cache.ts      useCache
 *   _form.ts       useAutoSaveForm, useUnsavedWarning
 */

// ─── New consolidated category hooks ──────────────────────────────────────────
export * from './_lifecycle';
export * from './_storage';
export * from './_ui';
export * from './_data';
export * from './_auth';
export * from './_cache';
export * from './_form';

// ─── Existing domain hooks ─────────────────────────────────────────────────────
export { useCamera } from './useCamera';
export type { CameraConfig, CameraHook } from './useCamera';

export { useInfiniteScroll } from './useInfiniteScroll';
export type { InfiniteScrollOptions, InfiniteScrollResult } from './useInfiniteScroll';

export { useStationTheme } from './useStationTheme';
export type { StationTheme, StationThemeColors, StationInputThemeClasses, ResolvedTheme } from './useStationTheme';


export { useStationHistory } from './useStationHistory';
export type {
  HistoryLog,
  StationHistoryResult,
  StationHistoryOptions,
} from './useStationHistory';

export {
  useRepairs,
  useRepair,
  useUpdateRepairStatus,
  useUpdateRepairNotes,
  useUpdateRepairField,
} from './useRepairQueries';

export {
  useShipped,
  useShippedRecord,
  useUpdateShippedStatus,
  useUpdateShippedField,
} from './useShippedQueries';

export { useStaffNameMap } from './useStaffNameMap';
export { useTodayStaffAvailability } from './useTodayStaffAvailability';
export { useOrderAssignment } from './useOrderAssignment';
export type { OrderAssignPayload } from './useOrderAssignment';
export { useDeleteOrderRow } from './useDeleteOrderRow';
export type { DeleteOrderRowPayload } from './useDeleteOrderRow';
export { useStationTestingController, getOrderIdLast4 } from './useStationTestingController';
export type {
  ActiveStationOrder,
  StationThemeColor,
} from './useStationTestingController';
export { useUnifiedKeyboard } from './useUnifiedKeyboard';
export type { UnifiedKeyboardTarget } from './useUnifiedKeyboard';

export { useKeyboard } from './useKeyboard';
export type { KeyboardState } from './useKeyboard';

export { useBarcodeScanner } from './useBarcodeScanner';
export type { BarcodeScanStatus } from './useBarcodeScanner';

export { usePanelActions } from './usePanelActions';
export type { PanelAction, PanelActionContext, PanelEntityType } from './usePanelActions';

export { useAblyChannel } from './useAblyChannel';
export { usePersistedStaffId } from './usePersistedStaffId';
export { useExternalItemUrl } from './useExternalItemUrl';
export { useLast8TrackingSearch } from './useLast8TrackingSearch';
export { useOrderFieldSave } from './useOrderFieldSave';
export { usePackerLogs } from './usePackerLogs';
export type { PackerRecord, UsePackerLogsOptions } from './usePackerLogs';
export { useRealtimeInvalidation } from './useRealtimeInvalidation';
export { useReceivingDetailForm } from './useReceivingDetailForm';
export {
  useRepairsTable,
} from './useRepairs';
export { useShippedTableData } from './useShippedTableData';
export { useTechLogs } from './useTechLogs';
export { useUpNextData } from './useUpNextData';
