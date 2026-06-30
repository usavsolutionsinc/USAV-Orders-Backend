'use client';

/**
 * Tracking-scan orchestration for the receiving sidebar — the single entry point
 * a scanned tracking #, PO/order reference, or internal handle flows through.
 *
 * Resolution order (each short-circuits on a hit, else falls through):
 *   1. Internal code resolve (R-/RCV-/H-/L-/U-/REP- handles, printed unit-ids,
 *      serials) → jump straight to the PO line.
 *   2. Local-first tracking → a carton already in the system opens immediately,
 *      skipping the Zoho lookup-po round-trip.
 *   3. `/api/receiving/lookup-po` → match a PO (open the workspace) or create +
 *      open an unmatched carton.
 *
 * Owns the scan-input value (`bulkTracking`), the armed scan mode, and the
 * in-flight counter. Mutates the selection + PO-context cells via injected
 * setters (those cells live in useReceivingSelection / usePoContext). Extracted
 * verbatim from ReceivingSidebarPanel; behaviour is unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  deferInvalidateTriageAndUnboxQueueFeeds,
  deferInvalidateTriageReceivingFeeds,
  deferInvalidateUnboxReceivingFeeds,
  dispatchReceivingLinesPrepended,
  dispatchReceivingUnboxRefresh,
  dispatchReceivingTriageRefresh,
  upsertReceivingRailRows,
  upsertUnboxQueueRows,
  receivingRailCartonKey,
} from '@/lib/queries/receiving-queries';
import {
  resolveCachedCarton,
  resolveInternalCode,
  resolveLocalTracking,
  resolveViaLookupPo,
  type LocalTrackingResolution,
  type ScanResolutionMode,
  type ScanIntakeSurface,
} from '@/lib/receiving/scan';
import { applyMatchedCarton, applyUnmatchedCarton } from './scan-apply';
import type { ScanApplyCtx, TrackingScanResult } from './scan-types';
import { toast } from '@/lib/toast';
import {
  fetchLinesByTracking,
  resolveReceivingCodeToLine,
  looksLikeReceivingCode,
} from '@/lib/testing/resolve-testing-scan';
import { type UnboxScanMode } from '@/components/sidebar/receiving/ReceivingUnboxScanBar';

// `ScanResolutionMode` now lives with the scan pipeline (src/lib/receiving/scan)
// and is re-exported here for the existing import surface. `'auto'` (the default
// for an un-armed scan) resolves the value as EITHER a PO# or a tracking#; only
// `UnboxScanMode` ('tracking' | 'order') values can be armed in the UI.
export type { ScanResolutionMode };
import type {
  PoContext,
  PoLineSummary,
  ReceivingMode,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { dispatchSelectLine } from '@/components/station/receiving-lines-table-helpers';
import type { PhotoRequestPublisher } from '@/components/sidebar/receiving/usePhotoRequestPublisher';
import { useSetting } from '@/hooks/useSettings';
import { useScanFeedback } from '@/lib/scan-feedback/useScanFeedback';

// `TrackingScanResult` now lives in `scan-types` (shared with scan-apply);
// re-exported here for the existing import surface (ReceivingSidebarPanel, …).
export type { TrackingScanResult };

interface UseTrackingScanArgs {
  staffId: string;
  queryClient: QueryClient;
  publishPhotoRequestFor: PhotoRequestPublisher;
  serialInputRef: React.RefObject<HTMLInputElement | null>;
  // Selection cells (useReceivingSelection)
  setSelectedLine: React.Dispatch<React.SetStateAction<ReceivingLineRow | null>>;
  setScanMatchedRows: React.Dispatch<React.SetStateAction<ReceivingLineRow[]>>;
  setLineAccordionBootstrap: React.Dispatch<React.SetStateAction<'default' | 'all'>>;
  setScanDriven: React.Dispatch<React.SetStateAction<boolean>>;
  // PO-context cells (usePoContext)
  setPoContext: React.Dispatch<React.SetStateAction<PoContext | null>>;
  setArmedLineId: React.Dispatch<React.SetStateAction<number | null>>;
  // Serial-scan cells (useSerialScan)
  setPendingCandidates: React.Dispatch<React.SetStateAction<PoLineSummary[]>>;
  /** Active sidebar mode — drives UNBOX_SCAN_OPENED stamping when `receive`. */
  receivingMode: ReceivingMode;
}

export interface TrackingScanState {
  bulkTracking: string;
  setBulkTracking: React.Dispatch<React.SetStateAction<string>>;
  /** Armed unbox scan route (null = auto-detect: a value with "-" → Order#). */
  unboxScanMode: UnboxScanMode | null;
  setUnboxScanMode: React.Dispatch<React.SetStateAction<UnboxScanMode | null>>;
  /** >0 while one or more `/api/receiving/lookup-po` lookups are in flight. */
  trackingLookupInFlight: number;
  submitTrackingScan: (
    rawTracking?: string,
    opts?: { mode?: ScanResolutionMode; onResult?: (result: TrackingScanResult) => void },
  ) => void;
}

/**
 * Flatten every cached receiving feed under `['receiving-lines-table']` (Recent
 * rail, Prioritize, main table) into one de-duplicated row list. Tolerates the
 * three cached shapes those feeds use: a bare `ReceivingLineRow[]` (rails), an
 * `{ receiving_lines }` envelope (table), and an infinite `{ pages }` query.
 */
function collectCachedReceivingRows(queryClient: QueryClient): ReceivingLineRow[] {
  const out: ReceivingLineRow[] = [];
  const seen = new Set<number>();
  const push = (r: unknown) => {
    const row = r as ReceivingLineRow | null;
    if (!row || typeof row.id !== 'number' || seen.has(row.id)) return;
    seen.add(row.id);
    out.push(row);
  };
  for (const [, data] of queryClient.getQueriesData({ queryKey: ['receiving-lines-table'] })) {
    if (!data) continue;
    if (Array.isArray(data)) {
      data.forEach(push);
      continue;
    }
    const obj = data as { receiving_lines?: unknown; pages?: unknown };
    if (Array.isArray(obj.receiving_lines)) {
      obj.receiving_lines.forEach(push);
    } else if (Array.isArray(obj.pages)) {
      for (const page of obj.pages) {
        if (Array.isArray(page)) page.forEach(push);
        else if (Array.isArray((page as { receiving_lines?: unknown })?.receiving_lines)) {
          (page as { receiving_lines: unknown[] }).receiving_lines.forEach(push);
        }
      }
    }
  }
  return out;
}

export function useTrackingScan({
  staffId,
  queryClient,
  publishPhotoRequestFor,
  serialInputRef,
  setSelectedLine,
  setScanMatchedRows,
  setLineAccordionBootstrap,
  setScanDriven,
  setPoContext,
  setArmedLineId,
  setPendingCandidates,
  receivingMode,
}: UseTrackingScanArgs): TrackingScanState {
  const [bulkTracking, setBulkTracking] = useState('');
  const [unboxScanMode, setUnboxScanMode] = useState<UnboxScanMode | null>(null);
  const [trackingLookupInFlight, setTrackingLookupInFlight] = useState(0);
  const intakeSurfaceRef = useRef<ScanIntakeSurface>('triage');
  useEffect(() => {
    intakeSurfaceRef.current = receivingMode === 'receive' ? 'unbox' : 'triage';
  }, [receivingMode]);

  // Settings Registry — gate the on-resolve auto-actions. Read into refs so the
  // submitTrackingScan callback identity stays stable (no dep churn / stale
  // closures); defaults preserve the prior always-on behavior while loading.
  const { value: autoFocusSerialPref } = useSetting<boolean>('receiving', 'receiving.autoFocusSerial');
  const { value: autoPushCameraPref } = useSetting<boolean>('receiving', 'receiving.autoPushPhoneCamera');
  const { value: accordionExpandPref } = useSetting<'active' | 'all'>('receiving', 'receiving.accordionExpand');
  const autoFocusSerialRef = useRef(true);
  const autoPushCameraRef = useRef(true);
  const accordionBootstrapRef = useRef<'default' | 'all'>('default');
  useEffect(() => { autoFocusSerialRef.current = autoFocusSerialPref ?? true; }, [autoFocusSerialPref]);
  useEffect(() => { autoPushCameraRef.current = autoPushCameraPref ?? true; }, [autoPushCameraPref]);
  useEffect(() => {
    accordionBootstrapRef.current = accordionExpandPref === 'all' ? 'all' : 'default';
  }, [accordionExpandPref]);

  // Audio/haptic scan confirm (Station archetype §6 — the eyes-down operator needs
  // a non-visual cue). Read into a ref so the submitTrackingScan callback identity
  // stays stable (no dep churn). Silent by default: useScanFeedback gates sound on
  // the org master switch + per-staff toggle, haptics on the per-staff toggle.
  const { playScanFeedback } = useScanFeedback();
  const playScanFeedbackRef = useRef(playScanFeedback);
  useEffect(() => { playScanFeedbackRef.current = playScanFeedback; }, [playScanFeedback]);

  // Scan-race guard. Each scan captures the receiving page-mode "generation" at
  // submit; switching modes (or any `receiving-clear-line`) bumps it. A scan that
  // RESOLVES after the operator has moved on must NOT force its carton open in the
  // now-current mode (the cross-mode leak). It still refreshes every receiving
  // feed, so a found-order scan lands in the Unbox Queue rail (view=scanned)
  // rather than hijacking whatever view is now showing. Bump on clear-line only
  // (mode switch / unbox-view switch / workspace close) — the normal scan→open
  // flow never dispatches clear-line, so consecutive same-mode scans are unaffected.
  const scanGenerationRef = useRef(0);
  useEffect(() => {
    const bump = () => {
      scanGenerationRef.current += 1;
    };
    window.addEventListener('receiving-clear-line', bump);
    return () => window.removeEventListener('receiving-clear-line', bump);
  }, []);

  const submitTrackingScan = useCallback(
    (
      rawTracking?: string,
      opts?: { mode?: ScanResolutionMode; onResult?: (result: TrackingScanResult) => void },
    ) => {
      const trackingNumber = (rawTracking ?? bulkTracking).trim();
      if (!trackingNumber) return;

      // Resolve the scan route: an explicit armed mode wins; otherwise `'auto'`
      // lets the server resolve the value as EITHER a PO# or a tracking# before
      // creating any carton (no more dash-heuristic misrouting a PO# to Unfound).
      const lookupMode: ScanResolutionMode = opts?.mode ?? 'auto';

      // Capture the page-mode generation at submit. `isCurrent()` is checked at
      // every OPEN/SELECT commit below; when false the carton still flows into the
      // queue feed but does not seize the (now different) active view.
      const launchGeneration = scanGenerationRef.current;
      const isCurrent = () => scanGenerationRef.current === launchGeneration;

      setBulkTracking('');
      const scanStartedAt = Date.now();
      setTrackingLookupInFlight((n) => n + 1);

      // The right-pane "Opening your PO" takeover loader is NO LONGER shown on
      // every scan. It is reserved for the single slow phase — a live Zoho
      // round-trip (Phase 2 below) — and dispatched on demand via this helper.
      // Local resolves (Phase 0 recent-cache select, Phase 1 incoming/mirror
      // adopt) open with no loader. `useReceivingWorkspacePane` listens for
      // `receiving-scan-in-flight` and clears 500ms after `…-resolved`.
      const showZohoLoader = () => {
        window.dispatchEvent(
          new CustomEvent('receiving-scan-in-flight', {
            detail: { tracking: trackingNumber, startedAt: scanStartedAt },
          }),
        );
      };

      // Fire the per-scan audio/haptic confirm alongside the caller's onResult:
      // a clean PO match chimes success; everything else (unmatched, not-found,
      // integration-error, network error) buzzes so the operator knows to glance.
      // Every terminal below routes its result echo through this, and the apply
      // layer receives it as `applyCtx.onResult`, so the cue fires exactly once
      // per scan on every path.
      const fireResult = (result: TrackingScanResult) => {
        playScanFeedbackRef.current(result.matched && !result.error ? 'success' : 'reject');
        opts?.onResult?.(result);
      };

      void (async () => {
        try {
          // Serial / unit / carton-handle / receiving-id scan → jump straight to
          // the PO line it belongs to, bypassing carrier tracking intake. Only
          // short-circuits on a hit; tracking numbers and anything unrecognised
          // fall through to the normal lookup-po flow below untouched. Skipped in
          // Order# mode — an order/PO reference is never a serial/carton code.
          try {
            // Canonical internal codes — carton/line/unit/handling-unit/repair
            // handles (R-/RCV-/H-/L-/U-/REP-) and printed unit-ids — always
            // resolve to their PO line, bypassing carrier-tracking intake. This
            // is what lets a printed R-{id} receiving label scan back to its own
            // carton via the IDENTICAL path as any other scan. Every handle
            // contains a dash, so `classifyUnboxScan` auto-arms Order# mode for
            // them; we therefore still run the resolver in Order# mode WHEN the
            // value looks like a code (looksLikeReceivingCode) — a true PO/order
            // number returns false there and keeps its lookup-po routing. Only
            // short-circuits on a hit; tracking numbers and anything unrecognised
            // fall through to the normal lookup-po flow below untouched.
            // Internal-handle rung (pure, src/lib/receiving/scan): serial /
            // unit-id / carton-handle (R-/RCV-/H-/L-/U-…) → its receiving line(s),
            // bypassing carrier-tracking intake; the hook owns the effects below.
            const internal = await resolveInternalCode(
              { value: trackingNumber, mode: lookupMode },
              { looksLikeCode: looksLikeReceivingCode, resolveCode: resolveReceivingCodeToLine },
            );
            if (internal) {
              if (internal.rows.length > 0) {
                if (intakeSurfaceRef.current === 'unbox' && internal.pick && internal.receivingId != null) {
                  upsertReceivingRailRows(queryClient, [
                    {
                      ...internal.pick,
                      client_event_id: receivingRailCartonKey(internal.receivingId),
                    },
                  ]);
                  deferInvalidateUnboxReceivingFeeds(queryClient);
                  dispatchReceivingUnboxRefresh();
                } else {
                  dispatchReceivingLinesPrepended({
                    segments: ['scanned', 'triage-combined'],
                    scope: 'triage',
                    intakeSurface: 'triage',
                    rows: internal.rows,
                  });
                  const pick = internal.pick ?? internal.rows[0];
                  if (pick && internal.receivingId != null) {
                    upsertUnboxQueueRows(queryClient, [
                      {
                        ...pick,
                        client_event_id: receivingRailCartonKey(internal.receivingId),
                      },
                    ]);
                  }
                  deferInvalidateTriageAndUnboxQueueFeeds(queryClient);
                }
              }
              // Echo the resolution back to the caller (phone-paired scans listen
              // for this to render their matched/unmatched result) — the code
              // short-circuit must too, or a phone scan of an R-/unit handle never
              // reports back.
              fireResult({
                tracking: trackingNumber,
                matched: true,
                po_ids: internal.poIds,
                receiving_id: internal.receivingId,
              });
              if (internal.receivingId != null && intakeSurfaceRef.current === 'unbox') {
                void fetch('/api/receiving/touch-scan', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    receiving_id: internal.receivingId,
                    tracking_number: trackingNumber,
                    intakeSurface: 'unbox',
                  }),
                }).catch(() => {});
              }
              setScanMatchedRows(internal.rows);
              setLineAccordionBootstrap(accordionBootstrapRef.current);
              setSelectedLine(internal.pick);
              setScanDriven(true);
              if (internal.via === 'serial') {
                toast.success('Found via serial number', {
                  description: 'Jumped to the PO that received this unit.',
                });
              }
              window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
              return;
            }
          } catch {
            /* fall through to carrier tracking intake */
          }

          // Phase 0 — Recent-list instant select (zero fetch, no loader). If the
          // scanned PO/tracking is already a MATERIALIZED carton (receiving_id
          // set) sitting in any receiving-feed cache — the Recent/Unboxed rail,
          // Prioritize, or the History table, all keyed under
          // ['receiving-lines-table'] — open it straight from cache exactly like
          // clicking that rail row (dispatchSelectLine). EXPECTED-only incoming
          // lines (receiving_id null) are intentionally skipped so they still
          // flow through the lookup-po adopt/stamp path below.
          try {
            // Phase-0 rung (pure, src/lib/receiving/scan): read the feed caches
            // and resolve to a materialized carton; the hook owns the effects.
            const cached = resolveCachedCarton(
              { value: trackingNumber, mode: lookupMode },
              { readCachedRows: () => collectCachedReceivingRows(queryClient) },
            );
            if (cached) {
              fireResult({
                tracking: trackingNumber,
                matched: true,
                po_ids: cached.poIds,
                receiving_id: cached.receivingId,
              });
              // Stamp scanned_by for the signed-in operator (same lightweight
              // touch-scan the local-tracking short-circuit uses) — no blocking
              // lookup-po round-trip. Use the carton's own tracking number.
              void fetch('/api/receiving/touch-scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  receiving_id: cached.receivingId,
                  tracking_number: cached.row.tracking_number ?? trackingNumber,
                  ...(intakeSurfaceRef.current === 'unbox' ? { intakeSurface: 'unbox' } : {}),
                }),
              }).catch(() => {});
              // Open via the rail's own select event so the sidebar selectedLine,
              // rail highlight, and right-pane workspace stay in lockstep — this
              // is the identical path a Recent-rail row click takes.
              // Stale-guard: only open if the operator hasn't switched modes
              // mid-scan. The row is already in the feed cache either way, so a
              // stale scan simply stays visible in the queue rather than yanking
              // the current view to it.
              if (isCurrent()) dispatchSelectLine(cached.row);
              window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
              return;
            }
          } catch {
            /* cache miss / shape mismatch — fall through to lookup-po */
          }

          // Local-first tracking short-circuit: a carton already in the system
          // (door-scanned, or otherwise carrying a receiving package) resolves
          // straight from the local receiving feed — open it immediately and
          // skip lookup-po entirely (no Zoho fallback, no "Opening your PO"
          // takeover; the fast resolve lands inside the loader's grace delay).
          // Rows without a receiving_id (incoming EXPECTED lines that were never
          // scanned in) still fall through: lookup-po owns creating/adopting the
          // receiving carton and stamping received_at on first scan.
          // Defaults for the lookup-po call below. The local-first block may
          // re-target these to the order-mode local-adopt path (no Zoho) when
          // the scanned tracking is already linked to a known incoming PO.
          let lookupValueForCall = trackingNumber;
          let lookupModeForCall: ScanResolutionMode = lookupMode;
          // Local-first tracking rung (pure, src/lib/receiving/scan): a carton
          // already in the system resolves straight from the local feed — open it
          // and skip lookup-po (no Zoho fallback / "Opening your PO" takeover). A
          // miss may re-target the lookup-po call to the order-mode local-adopt
          // path when the tracking is a single known incoming PO. The hook owns
          // the effects; the resolver owns the resolution.
          let local: LocalTrackingResolution | null = null;
          try {
            local = await resolveLocalTracking(
              { value: trackingNumber, mode: lookupMode },
              { fetchLinesByTracking },
            );
          } catch {
            /* local miss/error — fall through to lookup-po */
          }
          if (local?.kind === 'local-matched') {
            // Client short-circuit skips lookup-po — still stamp scanned_by for
            // the signed-in operator via the lightweight touch-scan route.
            void fetch('/api/receiving/touch-scan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                receiving_id: local.receivingId,
                tracking_number: trackingNumber,
                ...(intakeSurfaceRef.current === 'unbox' ? { intakeSurface: 'unbox' } : {}),
              }),
            }).catch(() => {});
            fireResult({
              tracking: trackingNumber,
              matched: true,
              po_ids: local.poIds,
              receiving_id: local.receivingId,
            });
            // Feed refresh for triage; unbox upserts the rail cache in place.
            if (intakeSurfaceRef.current === 'unbox' && local.pick) {
              upsertReceivingRailRows(queryClient, [
                {
                  ...local.pick,
                  client_event_id: receivingRailCartonKey(local.receivingId),
                },
              ]);
              deferInvalidateUnboxReceivingFeeds(queryClient);
            } else {
              dispatchReceivingLinesPrepended({
                segments: ['scanned', 'triage-combined'],
                scope: 'triage',
                intakeSurface: 'triage',
                rows: local.rows,
              });
              if (local.pick && local.receivingId != null) {
                upsertUnboxQueueRows(queryClient, [
                  {
                    ...local.pick,
                    client_event_id: receivingRailCartonKey(local.receivingId),
                  },
                ]);
              }
              deferInvalidateTriageAndUnboxQueueFeeds(queryClient);
            }
            if (isCurrent()) {
              setScanMatchedRows(local.rows);
              setLineAccordionBootstrap(accordionBootstrapRef.current);
              setSelectedLine(local.pick);
              setScanDriven(true);
              // Same unbox ritual as the lookup-po matched path: nudge the paired
              // phone's camera open and arm the serial input.
              if (autoPushCameraRef.current) void publishPhotoRequestFor(local.receivingId, trackingNumber);
              if (autoFocusSerialRef.current) setTimeout(() => serialInputRef.current?.focus(), 60);
            }
            window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
            return;
          }
          if (local?.kind === 'retarget') {
            lookupModeForCall = local.mode;
            lookupValueForCall = local.value;
          }

          // Build the apply context once for this scan — every cell the open /
          // promote effects need. The effectful open logic lives in scan-apply.ts
          // now (applyMatchedCarton / applyUnmatchedCarton); this hook resolves
          // the rung and hands the result to the apply layer.
          const applyCtx: ScanApplyCtx = {
            trackingNumber,
            staffId,
            isCurrent,
            onResult: fireResult,
            queryClient,
            publishPhotoRequestFor,
            serialInputRef,
            accordionBootstrapRef,
            autoPushCameraRef,
            autoFocusSerialRef,
            setSelectedLine,
            setScanMatchedRows,
            setLineAccordionBootstrap,
            setScanDriven,
            setPoContext,
            setArmedLineId,
            setPendingCandidates,
            intakeSurface: intakeSurfaceRef.current,
          };

          // lookup-po rung (pure fetch ladder, src/lib/receiving/scan): Phase 1
          // resolves from LOCAL data only; an order-mode local miss escalates to
          // the live Zoho lookup (the one loader-bearing call). The hook owns
          // every effect below; the resolver throws on a hard failure, caught by
          // the outer catch exactly as the inline fetch did.
          const resolution = await resolveViaLookupPo(
            {
              callValue: lookupValueForCall,
              callMode: lookupModeForCall,
              originalMode: lookupMode,
              staffId: Number(staffId),
              intakeSurface: intakeSurfaceRef.current,
            },
            {
              lookupPo: async (body) => {
                const r = await fetch('/api/receiving/lookup-po', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ...body,
                    intakeSurface: intakeSurfaceRef.current,
                  }),
                });
                return r.json();
              },
              showLoader: showZohoLoader,
            },
          );
          const data = resolution.data;

          // The PO header matched but its line items could not import because the
          // Zoho integration isn't connected — surface the real cause and route
          // the operator to reconnect (else it reads as a misleading "No PO found").
          if (resolution.kind === 'integration-error') {
            fireResult({
              tracking: trackingNumber,
              matched: false,
              po_ids: Array.isArray(data.po_ids) ? (data.po_ids as string[]) : [],
              receiving_id: Number(data.receiving_id) || undefined,
            });
            window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
            toast.error('Zoho not connected — PO matched but items could not load. Reconnect Zoho in Settings → Integrations.');
            return;
          }

          // Order# lookups that resolve to nothing report a clean not-found —
          // surface a toast instead of falling into the unmatched-carton flow
          // (a mistyped PO/order number must not create a phantom box).
          if (resolution.kind === 'not_found') {
            fireResult({ tracking: trackingNumber, matched: false, po_ids: [] });
            window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
            toast.error(
              (typeof data?.error === 'string' ? data.error : '') || `No PO found for “${trackingNumber}”`,
            );
            return;
          }

          if (resolution.kind === 'matched') {
            applyMatchedCarton(applyCtx, data);
          } else {
            applyUnmatchedCarton(applyCtx, data);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Network error';
          fireResult({
            tracking: trackingNumber,
            matched: false,
            po_ids: [],
            error: message,
          });
          window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
          toast.error(message);
        } finally {
          setTrackingLookupInFlight((n) => Math.max(0, n - 1));
        }
      })();
    },
    [
      bulkTracking,
      staffId,
      queryClient,
      publishPhotoRequestFor,
      serialInputRef,
      setSelectedLine,
      setScanMatchedRows,
      setLineAccordionBootstrap,
      setScanDriven,
      setPoContext,
      setArmedLineId,
      setPendingCandidates,
    ],
  );

  return {
    bulkTracking,
    setBulkTracking,
    unboxScanMode,
    setUnboxScanMode,
    trackingLookupInFlight,
    submitTrackingScan,
  };
}
