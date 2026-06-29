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
import { type UnboxScanMode } from '@/components/sidebar/receiving/ReceivingUnboxScanBar';

/**
 * The mode threaded into a scan resolution. `'auto'` (the default for an
 * un-armed scan) tells the server to resolve the value as EITHER a PO# or a
 * tracking# before creating any carton; an armed `'order'`/`'tracking'` is
 * strict. Only `UnboxScanMode` values can be armed in the UI.
 */
export type ScanResolutionMode = UnboxScanMode | 'auto';
import {
  buildUnmatchedStubRow,
  mapApiLineToPoSummary,
  parseReceivingPackage,
  type PoContext,
  type PoLineSummary,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { dispatchSelectLine } from '@/components/station/receiving-lines-table-helpers';
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
    opts?: { mode?: ScanResolutionMode; onResult?: (result: TrackingScanResult) => void },
  ) => void;
}

/**
 * Uppercase + strip non-alphanumerics — the same normal form the PO mirror keys
 * on (`zoho_purchaseorder_number_norm`), so a scanned `po-1234` matches a stored
 * `PO-1234`. Also used for an exact tracking compare.
 */
function normalizeScanKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
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

/**
 * Phase 0 resolver — find an already-MATERIALIZED carton row (`receiving_id`
 * set) in the receiving-feed caches that matches the scanned value: PO number in
 * order mode, tracking number in tracking mode. Among multiple lines of the same
 * carton, prefer an OPEN line so the workspace lands on something actionable.
 * Returns null on no confident match (caller falls through to lookup-po).
 * EXPECTED-only incoming lines (`receiving_id` null) never match here — they
 * still need the lookup-po adopt/stamp pass.
 */
function findCachedCartonRow(
  queryClient: QueryClient,
  scanned: string,
  mode: ScanResolutionMode,
): ReceivingLineRow | null {
  const key = normalizeScanKey(scanned);
  if (!key) return null;
  // `auto` (un-armed) matches EITHER identity; an armed mode matches only its
  // own field. This is what lets an already-in-system carton win instantly
  // regardless of whether the operator scanned its PO# or its tracking#.
  const matchOrder = mode === 'order' || mode === 'auto';
  const matchTracking = mode === 'tracking' || mode === 'auto';
  const matches = collectCachedReceivingRows(queryClient).filter((r) => {
    if (r.receiving_id == null) return false;
    if (matchOrder && r.zoho_purchaseorder_number && normalizeScanKey(r.zoho_purchaseorder_number) === key) {
      return true;
    }
    if (matchTracking && r.tracking_number && normalizeScanKey(r.tracking_number) === key) {
      return true;
    }
    return false;
  });
  if (matches.length === 0) return null;
  const open = matches.find(
    (r) => r.quantity_expected == null || r.quantity_received < (r.quantity_expected ?? 0),
  );
  return open ?? matches[0];
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

          // Phase 0 — Recent-list instant select (zero fetch, no loader). If the
          // scanned PO/tracking is already a MATERIALIZED carton (receiving_id
          // set) sitting in any receiving-feed cache — the Recent/Unboxed rail,
          // Prioritize, or the History table, all keyed under
          // ['receiving-lines-table'] — open it straight from cache exactly like
          // clicking that rail row (dispatchSelectLine). EXPECTED-only incoming
          // lines (receiving_id null) are intentionally skipped so they still
          // flow through the lookup-po adopt/stamp path below.
          try {
            const cachedRow = findCachedCartonRow(queryClient, trackingNumber, lookupMode);
            if (cachedRow && cachedRow.receiving_id != null) {
              const poIds = cachedRow.zoho_purchaseorder_id?.trim()
                ? [cachedRow.zoho_purchaseorder_id.trim()]
                : [];
              opts?.onResult?.({
                tracking: trackingNumber,
                matched: true,
                po_ids: poIds,
                receiving_id: cachedRow.receiving_id,
              });
              // Stamp scanned_by for the signed-in operator (same lightweight
              // touch-scan the local-tracking short-circuit uses) — no blocking
              // lookup-po round-trip. Use the carton's own tracking number.
              void fetch('/api/receiving/touch-scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  receiving_id: cachedRow.receiving_id,
                  tracking_number: cachedRow.tracking_number ?? trackingNumber,
                }),
              }).catch(() => {});
              // Open via the rail's own select event so the sidebar selectedLine,
              // rail highlight, and right-pane workspace stay in lockstep — this
              // is the identical path a Recent-rail row click takes.
              // Stale-guard: only open if the operator hasn't switched modes
              // mid-scan. The row is already in the feed cache either way, so a
              // stale scan simply stays visible in the queue rather than yanking
              // the current view to it.
              if (isCurrent()) dispatchSelectLine(cachedRow);
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
          if (lookupMode === 'tracking' || lookupMode === 'auto') {
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
                // Feed refresh ALWAYS runs (carton lands in the Unbox Queue);
                // the open/select ritual only runs if the operator is still here.
                window.dispatchEvent(
                  new CustomEvent('receiving-lines-prepended', { detail: localRows }),
                );
                invalidateReceivingFeeds(queryClient);
                if (isCurrent()) {
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
                }
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

          // Open a MATCHED carton from a lookup-po response: set PO context,
          // hydrate full rows, open the line. Shared by the instant local-match
          // path and the background Zoho follow-up that upgrades an unfound
          // carton to found in place (so a late Zoho match needs no re-scan).
          const openMatchedCarton = (d: Record<string, unknown>) => {
            const recvId = Number(d.receiving_id);
            const poIds = Array.isArray(d.po_ids) ? (d.po_ids as string[]) : [];
            opts?.onResult?.({ tracking: trackingNumber, matched: true, po_ids: poIds, receiving_id: recvId });

            const ctx: PoContext = {
              receiving_id: recvId,
              po_ids: poIds,
              lines: ((d.lines as Record<string, unknown>[]) || []).map((l) =>
                mapApiLineToPoSummary(l as Parameters<typeof mapApiLineToPoSummary>[0]),
              ),
              receiving_package: parseReceivingPackage(d.receiving_package),
            };
            // Arming serial-scan context + the active line only makes sense if
            // the operator is still on this scan's mode. If they moved on, skip
            // arming — the feed refresh below still surfaces the carton in queue.
            if (isCurrent()) {
              setPoContext(ctx);
              setPendingCandidates([]);

              const openLines = ctx.lines.filter(
                (l) => l.quantity_expected == null || l.quantity_received < (l.quantity_expected ?? 0),
              );
              setArmedLineId(openLines.length === 1 ? openLines[0].id : null);
            }

            // Fetch full ReceivingLineRow[] so the unified LineEditPanel can open
            // directly. Single open line → auto-select; multiple → the scan-line
            // picker renders above LineEditPanel. Surface every matched line at
            // the top of the History table and refresh every receiving feed
            // (Prioritize + Recent rails, table, Unfound, Incoming) atomically.
            void (async () => {
              try {
                // include=serials matches PoLinesAccordion's own query exactly,
                // so the cache we seed below is a drop-in — the accordion mounts
                // with full data (serials included) and never does a cold fetch.
                const linesRes = await fetch(
                  `/api/receiving-lines?receiving_id=${ctx.receiving_id}&include=serials`,
                );
                const linesData = await linesRes.json();
                const rows = Array.isArray(linesData?.receiving_lines)
                  ? (linesData.receiving_lines as ReceivingLineRow[])
                  : [];
                // Seed PoLinesAccordion's query cache so the matched workspace
                // renders its PO lines instantly on first open — no cold-fetch
                // gap, no empty-frame flicker. Same key + shape the accordion
                // uses (['receiving-siblings', receivingId]).
                queryClient.setQueryData(['receiving-siblings', ctx.receiving_id], linesData);
                // Feed refresh ALWAYS runs so the carton appears in the Unbox
                // Queue (view=scanned) even if the operator switched modes.
                if (rows.length > 0) {
                  window.dispatchEvent(new CustomEvent('receiving-lines-prepended', { detail: rows }));
                  invalidateReceivingFeeds(queryClient);
                }
                // Open/select only if still on this scan's mode (stale-guard).
                if (isCurrent()) {
                  setScanMatchedRows(rows);
                  const openRows = rows.filter(
                    (r) => r.quantity_expected == null || r.quantity_received < (r.quantity_expected ?? 0),
                  );
                  // Fall back to the first line when all are received; only null
                  // when the carton has no lines (avoids a blank workspace).
                  const pick = openRows[0] ?? rows[0] ?? null;
                  setLineAccordionBootstrap(accordionBootstrapRef.current);
                  setSelectedLine(pick);
                  setScanDriven(true);
                }
              } catch {
                /* silent — sidebar still has poContext for serial scans */
              }
            })();

            if (isCurrent()) {
              if (autoPushCameraRef.current) void publishPhotoRequestFor(ctx.receiving_id, trackingNumber);
              if (autoFocusSerialRef.current) setTimeout(() => serialInputRef.current?.focus(), 60);
            }
            window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
          };

          const res = await fetch('/api/receiving/lookup-po', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trackingNumber: lookupValueForCall,
              staffId: Number(staffId),
              mode: lookupModeForCall,
              // Phase 1 — resolve from LOCAL data only (mirror/incoming), never
              // block on Zoho, so this opens with no takeover loader. A local
              // miss returns `zoho_pending`: tracking opens an unfound carton and
              // self-promotes in the background; order escalates to the live Zoho
              // lookup in Phase 2 (the only loader-bearing call) just below.
              localOnly: true,
            }),
          });
          let data = await res.json();

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

          // Phase 2 — Zoho fallback. This is the ONLY phase that shows the
          // takeover loader. An ORDER scan that missed LOCAL data comes back
          // not_found + zoho_pending with NO carton created: the PO may have just
          // been imported by the 15-min mirror cron, so re-ping the source by
          // re-calling WITHOUT localOnly (runs the exact Zoho lookup). Tracking
          // misses do NOT escalate here — they already created an unfound carton
          // to show and self-promote via their own background follow-up below.
          if (data?.not_found === true && data?.zoho_pending === true) {
            showZohoLoader();
            try {
              const zohoRes = await fetch('/api/receiving/lookup-po', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  trackingNumber: lookupValueForCall,
                  staffId: Number(staffId),
                  mode: lookupModeForCall,
                }),
              });
              const zohoData = await zohoRes.json();
              if (zohoData?.success) data = zohoData;
            } catch {
              /* keep the local not_found result — the toast below reports it */
            }
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
            openMatchedCarton(data);
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
              // Stale-guard: skip if the operator moved on mid-scan.
              if (isCurrent() && autoPushCameraRef.current) void publishPhotoRequestFor(unmatchedReceivingId, trackingNumber);
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
                // Only auto-open if still on this scan's mode; the carton is
                // already in the feed (receiving-entry-added) regardless.
                if (isCurrent()) {
                  setLineAccordionBootstrap(accordionBootstrapRef.current);
                  setSelectedLine(openRow);
                  setScanDriven(true);
                }
                window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
              })();

              // Instant-unfound follow-up: the first call was localOnly (no
              // Zoho), so this carton is unfound only against LOCAL data. Run the
              // real Zoho search in the BACKGROUND — if it resolves a PO the route
              // promotes THIS same carton in place (findScanByTracking →
              // preassigned), so swap the open unfound view to found with no
              // re-scan. If Zoho also misses, the view stays unfound (the route
              // already logged the exception for the reconcile worker).
              if (data.zoho_pending === true) {
                void (async () => {
                  try {
                    const res2 = await fetch('/api/receiving/lookup-po', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        trackingNumber,
                        staffId: Number(staffId),
                        mode: 'tracking',
                      }),
                    });
                    const d2 = await res2.json();
                    const upgraded =
                      d2?.success &&
                      Boolean(d2.matched) &&
                      Array.isArray(d2.lines) &&
                      d2.lines.length > 0;
                    // Only swap when Zoho promoted THIS carton in place (same
                    // receiving_id) — a conflict-fallback that lands a different
                    // row shouldn't yank the operator off the carton they have
                    // open; the feed refresh surfaces it instead.
                    if (upgraded && Number(d2.receiving_id) === unmatchedReceivingId) {
                      toast.success(`PO matched for “${trackingNumber}”`);
                      openMatchedCarton(d2);
                    }
                  } catch {
                    /* background best-effort — reconcile worker is the net */
                  }
                })();
              }
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
