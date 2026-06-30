/**
 * Receiving scan — the effectful APPLY layer.
 *
 * Once a rung resolves (see the pure pipeline in `src/lib/receiving/scan`), these
 * two functions perform every side-effect needed to OPEN the carton: PO context,
 * row hydration, optimistic select, feed refresh, phone-camera nudge, and the
 * background Zoho self-promote. They were lifted verbatim out of the
 * `submitTrackingScan` closure; the closure's captured cells are now passed in as
 * a {@link ScanApplyCtx}, so the open/promote logic is readable and isolated
 * while behaving identically. These are intentionally NOT pure (they touch React
 * state, the DOM event bus, and the network); the pure resolution lives in `lib`.
 */

import {
  deferInvalidateTriageAndUnboxQueueFeeds,
  deferInvalidateTriageReceivingFeeds,
  deferInvalidateUnboxReceivingFeeds,
  dispatchReceivingLinesPrepended,
  dispatchReceivingUnboxRefresh,
  dispatchReceivingTriageRefresh,
  receivingSiblingsQueryKey,
  seedReceivingSiblingsCache,
  upsertReceivingRailRows,
  upsertUnboxQueueRows,
  receivingRailCartonKey,
} from '@/lib/queries/receiving-queries';
import { toast } from '@/lib/toast';
import type { LookupPoData } from '@/lib/receiving/scan';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import {
  buildMatchedStubRow,
  buildUnmatchedStubRow,
  buildUnboxRailUnmatchedRow,
  mapApiLineToPoSummary,
  parseReceivingPackage,
  type PoContext,
  type PoLineSummary,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import type { ScanApplyCtx } from './scan-types';

function dispatchTriageMatchedFeedRows(
  ctx: ScanApplyCtx,
  rows: ReceivingLineRow[],
): void {
  if (rows.length === 0) return;
  dispatchReceivingLinesPrepended({
    segments: ['scanned', 'triage-combined'],
    scope: 'triage',
    intakeSurface: 'triage',
    rows,
  });
  const byCarton = rows.find((r) => r.receiving_id != null) ?? rows[0];
  if (byCarton) {
    upsertUnboxQueueRows(ctx.queryClient, [
      { ...byCarton, client_event_id: receivingRailCartonKey(byCarton.receiving_id!) },
    ]);
  }
  deferInvalidateTriageAndUnboxQueueFeeds(ctx.queryClient);
}

function pickPoLineSummary(lines: PoLineSummary[]): PoLineSummary | null {
  const open = lines.filter(
    (l) => l.quantity_expected == null || l.quantity_received < (l.quantity_expected ?? 0),
  );
  return open[0] ?? lines[0] ?? null;
}

function buildUnboxRailMatchedRow(
  receivingId: number,
  tracking: string,
  line: PoLineSummary,
): ReceivingLineRow {
  const now = new Date().toISOString();
  return {
    ...buildMatchedStubRow(receivingId, tracking, line),
    client_event_id: receivingRailCartonKey(receivingId),
    scanned_at: now,
    last_activity_at: now,
  };
}

/**
 * Open a MATCHED carton from a lookup-po response: set PO context, hydrate full
 * rows, open the line. Shared by the instant local-match path and the background
 * Zoho follow-up that upgrades an unfound carton to found in place (so a late
 * Zoho match needs no re-scan).
 */
export function applyMatchedCarton(ctx: ScanApplyCtx, d: LookupPoData): void {
  const recvId = Number(d.receiving_id);
  const poIds = Array.isArray(d.po_ids) ? (d.po_ids as string[]) : [];
  ctx.onResult?.({ tracking: ctx.trackingNumber, matched: true, po_ids: poIds, receiving_id: recvId });

  const poCtx: PoContext = {
    receiving_id: recvId,
    po_ids: poIds,
    lines: ((d.lines as Record<string, unknown>[]) || []).map((l) =>
      mapApiLineToPoSummary(l as Parameters<typeof mapApiLineToPoSummary>[0]),
    ),
    receiving_package: parseReceivingPackage(d.receiving_package),
  };
  // Arming serial-scan context + the active line only makes sense if the operator
  // is still on this scan's mode. If they moved on, skip arming — the feed refresh
  // below still surfaces the carton in queue.
  if (ctx.isCurrent()) {
    ctx.setPoContext(poCtx);
    ctx.setPendingCandidates([]);

    const openLines = poCtx.lines.filter(
      (l) => l.quantity_expected == null || l.quantity_received < (l.quantity_expected ?? 0),
    );
    ctx.setArmedLineId(openLines.length === 1 ? openLines[0].id : null);

    // Optimistic OPEN: with exactly one open line, drop the operator into its
    // workspace immediately from a matched stub built off the lookup-po line —
    // no wait on the include=serials hydration fetch below. Keyed on receiving_id,
    // so that fetch reconciles to the full row IN PLACE (no remount). Multi-line
    // cartons skip this and let the scan-line picker render after hydration.
    if (openLines.length === 1) {
      ctx.setLineAccordionBootstrap(ctx.accordionBootstrapRef.current);
      ctx.setSelectedLine(buildMatchedStubRow(poCtx.receiving_id, ctx.trackingNumber, openLines[0]));
      ctx.setScanDriven(true);
    }
  }

  // Seed the siblings cache from lookup-po so PoLinesAccordion paints on first
  // frame — the hydration fetch below reconciles serials in the background.
  const stubRows = poCtx.lines.map((l) =>
    buildMatchedStubRow(poCtx.receiving_id, ctx.trackingNumber, l),
  );
  seedReceivingSiblingsCache(
    ctx.queryClient,
    poCtx.receiving_id,
    stubRows,
    poCtx.receiving_package,
  );

  const unboxRailLine = pickPoLineSummary(poCtx.lines);
  if (ctx.intakeSurface === 'unbox' && unboxRailLine) {
    upsertReceivingRailRows(ctx.queryClient, [
      buildUnboxRailMatchedRow(poCtx.receiving_id, ctx.trackingNumber, unboxRailLine),
    ]);
    deferInvalidateUnboxReceivingFeeds(ctx.queryClient);
    dispatchReceivingUnboxRefresh();
  }

  if (ctx.isCurrent()) {
    if (ctx.autoPushCameraRef.current) void ctx.publishPhotoRequestFor(poCtx.receiving_id, ctx.trackingNumber);
    if (ctx.autoFocusSerialRef.current) setTimeout(() => ctx.serialInputRef.current?.focus(), 60);
  }
  // Clear the takeover loader immediately — the optimistic stub + seeded siblings
  // cache are enough to paint the workspace; hydration reconciles in the background.
  window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));

  // Fetch full ReceivingLineRow[] so the unified LineEditPanel can open directly.
  // Single open line → auto-select; multiple → the scan-line picker renders above
  // LineEditPanel. Surface every matched line at the top of the History table and
  // refresh every receiving feed atomically.
  void (async () => {
    try {
      // include=serials matches PoLinesAccordion's own query exactly, so the cache
      // this seeds is a drop-in — the accordion mounts with full data (serials
      // included) and never does a cold fetch. Routed through queryClient.fetchQuery
      // on the SAME ['receiving-siblings', receivingId] key the triage
      // select-on-resolve path uses, so the two concurrent identical requests on a
      // matched triage scan DEDUPE into one round-trip. retry:false keeps the old
      // one-shot behavior.
      const linesData = await ctx.queryClient.fetchQuery({
        queryKey: receivingSiblingsQueryKey(poCtx.receiving_id),
        queryFn: async () => {
          const r = await fetch(
            `/api/receiving-lines?receiving_id=${poCtx.receiving_id}&include=serials`,
          );
          return r.json();
        },
        retry: false,
      });
      const rows = Array.isArray(linesData?.receiving_lines)
        ? (linesData.receiving_lines as ReceivingLineRow[])
        : [];
      if (rows.length > 0) {
        if (ctx.intakeSurface === 'unbox') {
          const openRows = rows.filter(
            (r) => r.quantity_expected == null || r.quantity_received < (r.quantity_expected ?? 0),
          );
          const railPick = openRows[0] ?? rows[0];
          if (railPick) {
            upsertReceivingRailRows(ctx.queryClient, [
              { ...railPick, client_event_id: receivingRailCartonKey(poCtx.receiving_id) },
            ]);
          }
        } else {
          dispatchTriageMatchedFeedRows(ctx, rows);
        }
      }
      // Open/select only if still on this scan's mode (stale-guard).
      if (ctx.isCurrent()) {
        ctx.setScanMatchedRows(rows);
        const openRows = rows.filter(
          (r) => r.quantity_expected == null || r.quantity_received < (r.quantity_expected ?? 0),
        );
        // Fall back to the first line when all are received; only null when the
        // carton has no lines (avoids a blank workspace).
        const pick = openRows[0] ?? rows[0] ?? null;
        ctx.setLineAccordionBootstrap(ctx.accordionBootstrapRef.current);
        ctx.setSelectedLine(pick);
        ctx.setScanDriven(true);
      }
    } catch {
      /* silent — sidebar still has poContext for serial scans */
    }
  })();
}

/**
 * Open an UNMATCHED (unfound) carton from a lookup-po response: echo the result,
 * announce the new entry, optimistically open the workspace from a synthetic
 * stub, reconcile to the real row in the background, then run the instant-unfound
 * Zoho self-promote (which upgrades this same carton to found in place via
 * {@link applyMatchedCarton}).
 */
export function applyUnmatchedCarton(ctx: ScanApplyCtx, d: LookupPoData): void {
  const exceptionId = typeof d.exception_id === 'number' ? d.exception_id : null;
  const exceptionReason = typeof d.exception_reason === 'string' ? d.exception_reason : null;
  ctx.onResult?.({
    tracking: ctx.trackingNumber,
    matched: false,
    po_ids: [],
    receiving_id: typeof d.receiving_id === 'number' ? d.receiving_id : undefined,
    exception_id: exceptionId,
    exception_reason: exceptionReason,
  });
  const unmatchedReceivingId = typeof d.receiving_id === 'number' ? d.receiving_id : null;
  const isUnbox = ctx.intakeSurface === 'unbox';

  if (unmatchedReceivingId != null && !isUnbox) {
    dispatchReceivingTriageRefresh();
    dispatchReceivingLinesPrepended({
      segments: ['triage-combined'],
      intakeSurface: 'triage',
      rows: [buildUnmatchedStubRow(unmatchedReceivingId, ctx.trackingNumber)],
    });
    deferInvalidateTriageReceivingFeeds(ctx.queryClient);
  }

  if (unmatchedReceivingId != null && isUnbox) {
    upsertReceivingRailRows(ctx.queryClient, [
      buildUnboxRailUnmatchedRow(unmatchedReceivingId, ctx.trackingNumber),
    ]);
    deferInvalidateUnboxReceivingFeeds(ctx.queryClient);
    dispatchReceivingUnboxRefresh();
  }

  // Auto-open the unfound workspace so the operator can immediately add items via
  // the Ecwid popover — no extra click on the NO PO chip.
  if (unmatchedReceivingId != null) {
    // Open the same staff's phone camera for this unmatched carton too — a tracking
    // scan still needs unboxing photos even with no PO. Stale-guard: skip if the
    // operator moved on mid-scan.
    if (ctx.isCurrent() && ctx.autoPushCameraRef.current) void ctx.publishPhotoRequestFor(unmatchedReceivingId, ctx.trackingNumber);
    // Optimistic open: drop the operator into the unfound carton's workspace
    // INSTANTLY from a synthetic stub — no round-trip wait before they can start
    // adding items. receiving-scan-resolved fires now so the scan loader clears
    // immediately. The carton is already in the feed (receiving-entry-added).
    if (ctx.isCurrent()) {
      ctx.setLineAccordionBootstrap(ctx.accordionBootstrapRef.current);
      ctx.setSelectedLine(
        isUnbox
          ? buildUnboxRailUnmatchedRow(unmatchedReceivingId, ctx.trackingNumber)
          : buildUnmatchedStubRow(unmatchedReceivingId, ctx.trackingNumber),
      );
      ctx.setScanDriven(true);
    }
    window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));

    // Triage only: optional background reconcile when the carton already has lines.
    if (!isUnbox) {
      void (async () => {
        try {
          const linesRes = await fetch(
            `/api/receiving-lines?receiving_id=${unmatchedReceivingId}`,
          );
          const linesData = await linesRes.json();
          const rows = Array.isArray(linesData?.receiving_lines)
            ? (linesData.receiving_lines as ReceivingLineRow[])
            : [];
          const realRow = rows[0] ?? null;
          if (realRow && ctx.isCurrent()) {
            ctx.setSelectedLine(realRow);
          }
        } catch {
          /* keep the optimistic stub — it mounts the right receiving_id */
        }
      })();
    }

    // Instant-unfound follow-up: the first call was localOnly (no Zoho), so this
    // carton is unfound only against LOCAL data. Run the real Zoho search in the
    // BACKGROUND — if it resolves a PO the route promotes THIS same carton in
    // place, so swap the open unfound view to found with no re-scan. If Zoho also
    // misses, the view stays unfound (the route logged the exception for the
    // reconcile worker).
    if (d.zoho_pending === true) {
      void (async () => {
        try {
          const res2 = await fetch('/api/receiving/lookup-po', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trackingNumber: ctx.trackingNumber,
              staffId: Number(ctx.staffId),
              mode: 'tracking',
              ...(ctx.intakeSurface === 'unbox' ? { intakeSurface: 'unbox' } : {}),
            }),
          });
          const d2 = await res2.json();
          const upgraded =
            d2?.success &&
            Boolean(d2.matched) &&
            Array.isArray(d2.lines) &&
            d2.lines.length > 0;
          // Only swap when Zoho promoted THIS carton in place (same receiving_id)
          // — a conflict-fallback that lands a different row shouldn't yank the
          // operator off the carton they have open; the feed refresh surfaces it.
          if (upgraded && Number(d2.receiving_id) === unmatchedReceivingId) {
            toast.success(`PO matched for “${ctx.trackingNumber}”`);
            applyMatchedCarton(ctx, d2);
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
