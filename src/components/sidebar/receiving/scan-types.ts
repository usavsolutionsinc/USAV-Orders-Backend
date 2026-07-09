/**
 * Shared scan types for the receiving scan loop — extracted so the effectful
 * apply layer (`scan-apply.ts`) and the orchestrator hook (`useTrackingScan.ts`)
 * can both reference them WITHOUT importing each other (which would cycle).
 */

import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import type { PhotoRequestPublisher } from '@/components/sidebar/receiving/usePhotoRequestPublisher';
import type { PoContext, PoLineSummary } from '@/components/sidebar/receiving/receiving-sidebar-shared';

/**
 * Result echoed to a scan's caller — phone-paired scans listen for this to
 * render their matched/unmatched result.
 */
export interface TrackingScanResult {
  tracking: string;
  matched: boolean;
  po_ids: string[];
  receiving_id?: number;
  exception_id?: number | null;
  exception_reason?: string | null;
  error?: string;
}

/**
 * Everything the effectful apply layer needs to open a carton: the per-scan
 * context (the scanned value, the stale-guard, the onResult echo) plus the
 * hook's state setters / refs / collaborators. Built once per submit in
 * `useTrackingScan` and threaded into `applyMatchedCarton` /
 * `applyUnmatchedCarton`, so the open/promote effects live OUTSIDE the giant
 * submit closure while capturing the exact same cells they did inline.
 */
export interface ScanApplyCtx {
  // — per-scan —
  /** The scanned value (carried into onResult + the promote follow-up body). */
  trackingNumber: string;
  staffId: string;
  /** Stale-guard: false once the operator switched modes mid-scan. */
  isCurrent: () => boolean;
  onResult?: (result: TrackingScanResult) => void;
  // — hook collaborators —
  queryClient: QueryClient;
  publishPhotoRequestFor: PhotoRequestPublisher;
  serialInputRef: RefObject<HTMLInputElement | null>;
  accordionBootstrapRef: MutableRefObject<'default' | 'all'>;
  autoPushCameraRef: MutableRefObject<boolean>;
  autoFocusSerialRef: MutableRefObject<boolean>;
  setSelectedLine: Dispatch<SetStateAction<ReceivingLineRow | null>>;
  setScanMatchedRows: Dispatch<SetStateAction<ReceivingLineRow[]>>;
  setLineAccordionBootstrap: Dispatch<SetStateAction<'default' | 'all'>>;
  setScanDriven: Dispatch<SetStateAction<boolean>>;
  setPoContext: Dispatch<SetStateAction<PoContext | null>>;
  setArmedLineId: Dispatch<SetStateAction<number | null>>;
  setPendingCandidates: Dispatch<SetStateAction<PoLineSummary[]>>;
  /** Unbox vs triage — forwarded to background lookup-po follow-ups. */
  intakeSurface?: 'unbox' | 'triage';
}
