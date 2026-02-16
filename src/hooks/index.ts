/**
 * Custom hooks barrel export
 */

export { useCamera } from './useCamera';
export type { CameraConfig, CameraHook } from './useCamera';

export { useInfiniteScroll } from './useInfiniteScroll';
export type { InfiniteScrollOptions, InfiniteScrollResult } from './useInfiniteScroll';

export { useStationTheme } from './useStationTheme';
export type { ThemeColor, ThemeColors } from './useStationTheme';

export { useStationHistory } from './useStationHistory';
export type { HistoryLog, StationHistoryResult, StationHistoryOptions } from './useStationHistory';

export { useRepairs, useRepair, useUpdateRepairStatus, useUpdateRepairNotes, useUpdateRepairField } from './useRepairQueries';
export { useShipped, useShippedRecord, useUpdateShippedStatus, useUpdateShippedField } from './useShippedQueries';
export { useStaffNameMap } from './useStaffNameMap';
