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
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import { toast } from '@/lib/toast';
import {
  fetchLinesByTracking,
  resolveReceivingCodeToLine,
  looksLikeReceivingCode,
} from '@/lib/testing/resolve-testing-scan';
import {
  classifyUnboxScan,
  type UnboxScanMode,
} from '@/components/sidebar/receiving/ReceivingUnboxScanBar';
import {
  buildUnmatchedStubRow,
  mapApiLineToPoSummary,
  parseReceivingPackage,
  type PoContext,
  type PoLineSummary,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import type { PhotoRequestPublisher } from '@/components/sidebar/receiving/usePhotoRequestPublisher';
import { useSetting } from '@/hooks/useSettings';

export interface TrackingScanResult {
  tracking: string;
  matched: boolean;
  po_ids: string[];
  receiving_id?: number;
  exception_id?: number | null;
  exception_reason?: string | null;
  error?: string;
}

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
    opts?: { mode?: UnboxScanMode; onResult?: (result: TrackingScanResult) => void },
  ) => void;
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
}: UseTrackingScanArgs): TrackingScanState {
  const [bulkTracking, setBulkTracking] = useState('');
  const [unboxScanMode, setUnboxScanMode] = useState<UnboxScanMode | null>(null);
  const [trackingLookupInFlight, setTrackingLookupInFlight] = useState(0);

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

  const submitTrackingScan = useCallback(
    (
      rawTracking?: string,
      opts?: { mode?: UnboxScanMode; onResult?: (result: TrackingScanResult) => void },
    ) => {
      const trackingNumber = (rawTracking ?? bulkTracking).trim();
      if (!trackingNumber) return;

      // Resolve the scan route: explicit opts.mode wins, else auto-classify
      // (a value with a dash is an order/PO reference number).
      const lookupMode: UnboxScanMode = opts?.mode ?? classifyUnboxScan(trackingNumber);

      setBulkTracking('');
      const scanStartedAt = Date.now();
      setTrackingLookupInFlight((n) => n + 1);

      // Tell the right pane to show the "Opening your PO" skeleton loader
      // while the Zoho lookup is in flight. ReceivingDashboard listens for
      // `receiving-scan-in-flight` and clears 500ms after `…-resolved`.
      window.dispatchEvent(
        new CustomEvent('receiving-scan-in-flight', {
          detail: { tracking: trackingNumber, startedAt: scanStartedAt },
        }),
      );

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
            const runCodeResolve =
              lookupMode !== 'order' || looksLikeReceivingCode(trackingNumber);
            const code = runCodeResolve ? await resolveReceivingCodeToLine(trackingNumber) : null;
            if (code && (code.kind === 'line' || code.kind === 'multi')) {
              const rows = code.kind === 'line' ? [code.row] : code.rows;
              if (rows.length > 0) {
                window.dispatchEvent(
                  new CustomEvent('receiving-lines-prepended', { detail: rows }),
                );
                // Refresh every receiving feed atomically. The Prioritize rail
                // does NOT listen to `receiving-lines-prepended`, so without an
                // explicit invalidation a freshly scanned-in carton never
                // surfaced there until a global refresh.
                invalidateReceivingFeeds(queryClient);
              }
              // Echo the resolution back to the caller (phone-paired scans listen
              // for this to render their matched/unmatched result). The tracking
              // + lookup-po branches below already call onResult; the code
              // short-circuit must too, or a phone scan of an R-/unit handle
              // never reports back. po_ids/receiving_id are derived from the
              // resolved rows the same way the local-tracking branch does.
              const codeReceivingId = rows.find((r) => r.receiving_id != null)?.receiving_id;
              const codePoIds = [
                ...new Set(
                  rows
                    .map((r) => (r.zoho_purchaseorder_id || '').trim())
                    .filter((x) => x.length > 0),
                ),
              ];
              opts?.onResult?.({
                tracking: trackingNumber,
                matched: true,
                po_ids: codePoIds,
                receiving_id: codeReceivingId ?? undefined,
              });
              const openRows = rows.filter(
                (r) =>
                  r.quantity_expected == null ||
                  r.quantity_received < (r.quantity_expected ?? 0),
              );
              const pick =
                code.kind === 'line'
                  ? code.row
                  : openRows.length === 1
                    ? openRows[0]
                    : openRows[0] ?? rows[0] ?? null;
              setScanMatchedRows(rows);
              setLineAccordionBootstrap(accordionBootstrapRef.current);
              setSelectedLine(pick);
              setScanDriven(true);
              if (code.via === 'serial') {
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
          let lookupModeForCall: UnboxScanMode = lookupMode;
          if (lookupMode === 'tracking') {
            try {
              const trackingRows = await fetchLinesByTracking(trackingNumber);
              const localRows = trackingRows.filter((r) => r.receiving_id != null);
              if (localRows.length > 0) {
                const receivingId = localRows[0].receiving_id as number;
                // Client short-circuit skips lookup-po — still stamp scanned_by
                // for the signed-in operator via the lightweight touch-scan route.
                void fetch('/api/receiving/touch-scan', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    receiving_id: receivingId,
                    tracking_number: trackingNumber,
                  }),
                }).catch(() => {});
                const poIds = [
                  ...new Set(
                    localRows
                      .map((r) => (r.zoho_purchaseorder_id || '').trim())
                      .filter((x) => x.length > 0),
                  ),
                ];
                opts?.onResult?.({
                  tracking: trackingNumber,
                  matched: true,
                  po_ids: poIds,
                  receiving_id: receivingId,
                });
                window.dispatchEvent(
                  new CustomEvent('receiving-lines-prepended', { detail: localRows }),
                );
                invalidateReceivingFeeds(queryClient);
                const openRows = localRows.filter(
                  (r) =>
                    r.quantity_expected == null ||
                    r.quantity_received < (r.quantity_expected ?? 0),
                );
                const pick = openRows[0] ?? localRows[0];
                setScanMatchedRows(localRows);
                setLineAccordionBootstrap(accordionBootstrapRef.current);
                setSelectedLine(pick);
                setScanDriven(true);
                // Same unbox ritual as the lookup-po matched path: nudge the
                // paired phone's camera open and arm the serial input.
                if (autoPushCameraRef.current) void publishPhotoRequestFor(receivingId, trackingNumber);
                if (autoFocusSerialRef.current) setTimeout(() => serialInputRef.current?.focus(), 60);
                window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
                return;
              }
              // No local carton yet, but the tracking is already linked to a
              // known PO in the Incoming feed (EXPECTED lines: PO number set,
              // receiving_id NULL). Re-target the lookup to the order-mode
              // local-adopt path (resolvePoIdLocally → linkLocalPoLinesToReceiving):
              // it reuses the existing incoming receiving row, adopts the local
              // lines, and skips the Zoho tracking search entirely — so the
              // "Opening your PO" loader never takes over for an already-known
              // incoming carton. Only when the tracking maps to exactly one PO;
              // a multi-PO tracking still needs the Zoho path (resolves up to 3).
              const incomingPoNumbers = [
                ...new Set(
                  trackingRows
                    .map((r) => (r.zoho_purchaseorder_number || '').trim())
                    .filter((x) => x.length > 0),
                ),
              ];
              if (incomingPoNumbers.length === 1) {
                lookupModeForCall = 'order';
                lookupValueForCall = incomingPoNumbers[0];
              }
            } catch {
              /* local miss/error — fall through to lookup-po */
            }
          }

          const res = await fetch('/api/receiving/lookup-po', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trackingNumber: lookupValueForCall,
              staffId: Number(staffId),
              mode: lookupModeForCall,
            }),
          });
          const data = await res.json();

          if (!data?.success) {
            throw new Error(data?.error || 'Lookup failed');
          }

          // The PO header matched but its line items could not import because the
          // Zoho integration isn't connected. Without this, the carton comes back
          // matched-but-empty and reads as a misleading "No PO found". Surface the
          // real cause and route the operator to reconnect.
          if (data.integration_error === 'zoho_not_connected') {
            opts?.onResult?.({
              tracking: trackingNumber,
              matched: false,
              po_ids: Array.isArray(data.po_ids) ? data.po_ids : [],
              receiving_id: Number(data.receiving_id) || undefined,
            });
            window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
            toast.error('Zoho not connected — PO matched but items could not load. Reconnect Zoho in Settings → Integrations.');
            return;
          }

          const isMatched =
            Boolean(data.matched) && Array.isArray(data.lines) && data.lines.length > 0;

          // Order# lookups that resolve to nothing report a clean not-found —
          // surface a toast instead of falling into the unmatched-carton flow
          // (a mistyped PO/order number must not create a phantom box).
          if (!isMatched && (lookupMode === 'order' || data?.not_found)) {
            opts?.onResult?.({ tracking: trackingNumber, matched: false, po_ids: [] });
            window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
            toast.error(data?.error || `No PO found for “${trackingNumber}”`);
            return;
          }

          if (isMatched) {
            opts?.onResult?.({
              tracking: trackingNumber,
              matched: true,
              po_ids: Array.isArray(data.po_ids) ? data.po_ids : [],
              receiving_id: Number(data.receiving_id),
            });

            const ctx: PoContext = {
              receiving_id: Number(data.receiving_id),
              po_ids: Array.isArray(data.po_ids) ? data.po_ids : [],
              lines: (data.lines || []).map((l: Record<string, unknown>) =>
                mapApiLineToPoSummary(l as Parameters<typeof mapApiLineToPoSummary>[0]),
              ),
              receiving_package: parseReceivingPackage(data.receiving_package),
            };

            setPoContext(ctx);
            setPendingCandidates([]);

            const openLines = ctx.lines.filter(
              (l) =>
                l.quantity_expected == null ||
                l.quantity_received < (l.quantity_expected ?? 0),
            );
            setArmedLineId(openLines.length === 1 ? openLines[0].id : null);

            // Fetch full ReceivingLineRow[] so the unified LineEditPanel can
            // open directly. Single open line → auto-select. Multiple open →
            // render the scan-line picker above LineEditPanel so the user picks.
            void (async () => {
              try {
                const linesRes = await fetch(
                  `/api/receiving-lines?receiving_id=${ctx.receiving_id}`,
                );
                const linesData = await linesRes.json();
                const rows = Array.isArray(linesData?.receiving_lines)
                  ? (linesData.receiving_lines as ReceivingLineRow[])
                  : [];
                setScanMatchedRows(rows);
                // Simpler workflow: surface every matched line at the top of the
                // History table immediately. The sidebar's deeper edit flow still
                // runs, but the user no longer has to scroll/search for what just
                // scanned in — and multi-line cartons show in full instead of
                // showing one at a time in the picker.
                if (rows.length > 0) {
                  window.dispatchEvent(
                    new CustomEvent('receiving-lines-prepended', { detail: rows }),
                  );
                  // Refresh every receiving feed atomically (Prioritize + Recent
                  // rails, main table, Unfound list, Incoming tiles). The matched
                  // path only fired `receiving-lines-prepended` (table-only), so
                  // a found scan never appeared in Prioritize until a global
                  // refresh — the reported bug.
                  invalidateReceivingFeeds(queryClient);
                }
                const openRows = rows.filter(
                  (r) =>
                    r.quantity_expected == null ||
                    r.quantity_received < (r.quantity_expected ?? 0),
                );
                // Open LineEditPanel on the first open line (fall back to the first
                // line when all are received). PoLinesAccordion inside the panel
                // lists every line on the PO, so a multi-line carton shows in full
                // — matching the serial-scan path. Previously a multi-open carton
                // left `pick` null, which opened the right-pane overlay with no
                // selected line → a BLANK workspace (a single-line PO worked, two
                // line items did not). Only stays null when the carton has no lines.
                const pick = openRows[0] ?? rows[0] ?? null;
                setLineAccordionBootstrap(accordionBootstrapRef.current);
                setSelectedLine(pick);
                setScanDriven(true);
              } catch {
                /* silent — sidebar still has poContext for serial scans */
              }
            })();

            // Signal any phone listening on station:{staffId} that this carton
            // is the active one — the phone will auto-open its camera page.
            if (autoPushCameraRef.current) void publishPhotoRequestFor(ctx.receiving_id, trackingNumber);
            if (autoFocusSerialRef.current) setTimeout(() => serialInputRef.current?.focus(), 60);

            // Tell the right-pane loader we're done — workspace open will
            // cover the swap once the line picker resolves.
            window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
          } else {
            const exceptionId = typeof data.exception_id === 'number' ? data.exception_id : null;
            const exceptionReason =
              typeof data.exception_reason === 'string' ? data.exception_reason : null;
            opts?.onResult?.({
              tracking: trackingNumber,
              matched: false,
              po_ids: [],
              receiving_id: typeof data.receiving_id === 'number' ? data.receiving_id : undefined,
              exception_id: exceptionId,
              exception_reason: exceptionReason,
            });
            window.dispatchEvent(
              new CustomEvent('receiving-entry-added', {
                detail: { id: String(data.receiving_id), tracking: trackingNumber },
              }),
            );
            // Auto-open the unfound workspace so the operator can immediately
            // add items via the Ecwid popover — no extra click on the NO PO
            // chip. Fetch any existing lines (a re-scan of the same tracking
            // could have lines from a prior session); fall back to a stub row
            // so UnfoundLineEditPanel mounts with the right receiving_id.
            const unmatchedReceivingId =
              typeof data.receiving_id === 'number' ? data.receiving_id : null;
            if (unmatchedReceivingId != null) {
              // Open the same staff's phone camera for this unmatched carton too
              // — a tracking scan still needs unboxing photos even with no PO.
              if (autoPushCameraRef.current) void publishPhotoRequestFor(unmatchedReceivingId, trackingNumber);
              void (async () => {
                let openRow: ReceivingLineRow | null = null;
                try {
                  const linesRes = await fetch(
                    `/api/receiving-lines?receiving_id=${unmatchedReceivingId}`,
                  );
                  const linesData = await linesRes.json();
                  const rows = Array.isArray(linesData?.receiving_lines)
                    ? (linesData.receiving_lines as ReceivingLineRow[])
                    : [];
                  openRow = rows[0] ?? null;
                } catch {
                  /* fall through to synthetic stub below */
                }
                if (!openRow) {
                  openRow = buildUnmatchedStubRow(unmatchedReceivingId, trackingNumber);
                }
                setLineAccordionBootstrap(accordionBootstrapRef.current);
                setSelectedLine(openRow);
                setScanDriven(true);
                window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
              })();
            } else {
              window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Network error';
          opts?.onResult?.({
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
