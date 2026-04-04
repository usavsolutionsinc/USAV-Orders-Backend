import type React from 'react';
import type { QueryClient } from '@tanstack/react-query';

export interface ActiveStationOrder {
  id: number | null;
  orderId: string;
  fnsku?: string | null;
  /** `fba_fnsku_logs.id` — links serials to the FNSKU log row in the TSN table. */
  fnskuLogId?: number | null;
  /** SAL row id — the single source of truth anchor for this scan session. */
  salId?: number | null;
  productTitle: string;
  itemNumber: string | null;
  sku: string;
  condition: string;
  notes: string;
  tracking: string;
  serialNumbers: string[];
  testDateTime: string | null;
  testedBy: number | null;
  quantity?: number;
  shipByDate?: string | null;
  createdAt?: string | null;
  orderFound?: boolean;
  sourceType?: 'order' | 'fba' | 'repair';
  /** Server-issued anchor for serial/SKU scans (tracking / exception / FNSKU / repair session). */
  scanSessionId?: string | null;
  /** Friendly inline UX copy rendered inside the active order card. */
  inlineMicrocopy?: string | null;
  /** Storage SKU codes scanned during this session (e.g. "1809:A03"). Shown in the details panel. */
  scannedSkuCodes?: string[];
}

export interface ResolvedProductManual {
  id: number;
  sku: string | null;
  itemNumber: string | null;
  displayName: string | null;
  googleFileId: string;
  type: string | null;
  matchedBy: 'item_number';
  updatedAt: string;
  previewUrl: string;
  viewUrl: string;
  downloadUrl: string;
}

/**
 * Shared context passed from useStationTestingController to every scan handler.
 * Handlers are plain async functions — not hooks — so this object is the only
 * dependency they need rather than importing React state directly.
 */
export interface ScanHandlerContext {
  userId: string;
  userName: string;
  getScanContextOrder: () => ActiveStationOrder | null;
  reopenScanContextOrder: () => ActiveStationOrder | null;
  syncActiveOrderState: (order: ActiveStationOrder | null, opts?: { preserveHidden?: boolean }) => void;
  setIsLoading: (v: boolean) => void;
  setErrorMessage: (v: string | null) => void;
  setSuccessMessage: (v: string | null) => void;
  setInputValue: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  scanSessionIdRef: React.MutableRefObject<string | null>;
  queryClient: QueryClient;
  triggerGlobalRefresh: () => void;
  resolveManual: (sku?: string | null, itemNumber?: string | null) => void;
  /** Clears resolved manuals from both React state and localStorage. */
  clearManuals: () => void;
  newIdempotencyKey: () => string;
}
