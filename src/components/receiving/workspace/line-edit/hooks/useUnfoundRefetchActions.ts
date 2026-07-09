'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import {
  dispatchSelectLine,
  dispatchLineUpdated,
} from '@/components/station/receiving-lines-table-helpers';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { toast } from '@/lib/toast';
import {
  classifyZohoRetry,
  classifyAmazonLookup,
  type RefetchStatus,
  type RefetchState,
} from './useUnfoundRefetchActions.classify';

// Re-exported so consumers can import state types from the hook module.
export type { RefetchStatus, RefetchState } from './useUnfoundRefetchActions.classify';

/**
 * Operator-initiated live integration re-checks for an UNFOUND carton — the data
 * layer behind {@link UnfoundMatchStrip}. Shared by POUnboxingSection (desktop)
 * and the mobile carton sheet.
 *
 * SPEED-FIRST invariant: nothing here runs on the scan path. The tracking scan
 * resolves from LOCAL data only (see scan-apply.ts / lookup-po localOnly) and
 * opens the unfound workspace instantly; these requests fire ONLY when the
 * operator taps a button. Passive freshness stays on the reconcile / incoming-PO
 * crons — the operator is never blocked waiting for an integration.
 *
 *   • checkZoho  → POST /api/receiving/unfound-queue/retry-pair
 *       (reconcileUnmatchedReceiving). On promote it invalidates the receiving
 *       feeds and RE-SELECTS the promoted carton's real primary line, so the open
 *       workspace swaps UnmatchedItemsSection → PoLinesAccordion in place with no
 *       re-scan.
 *   • checkAmazon → POST /api/receiving/[id]/amazon-return-lookup
 *       (SP-API listReturns by reverseTrackingId). Stamps the carton as an
 *       AMAZON_RETURN + persists return facts.
 */

const IDLE: RefetchState = { status: 'idle', message: null };

export interface UnfoundRefetchActions {
  zoho: RefetchState;
  amazon: RefetchState;
  /** Epoch ms of the last completed manual re-check, or null. */
  lastCheckedAt: number | null;
  /** True while either request is in flight (gates both buttons). */
  busy: boolean;
  checkZoho: () => Promise<void>;
  checkAmazon: () => Promise<void>;
}

/**
 * After a Zoho promote, re-select the carton's real primary line so the open
 * pane remounts as a matched PO carton (PoLinesAccordion) — no re-scan. Best
 * effort: the feed invalidation already refreshed the rails, so a failure here
 * just means the operator reopens the (now-matched) carton from the list.
 */
async function promoteInPlace(receivingId: number): Promise<void> {
  try {
    const res = await fetch(
      `/api/receiving-lines?receiving_id=${receivingId}&include=serials`,
    );
    const data = await res.json().catch(() => null);
    const rows: ReceivingLineRow[] = Array.isArray(data?.receiving_lines)
      ? data.receiving_lines
      : [];
    if (rows.length === 0) return;
    const openRows = rows.filter(
      (r) => r.quantity_expected == null || r.quantity_received < (r.quantity_expected ?? 0),
    );
    const pick = openRows[0] ?? rows[0] ?? null;
    if (pick) dispatchSelectLine(pick);
  } catch {
    /* rails already refreshed via invalidateReceivingFeeds */
  }
}

export function useUnfoundRefetchActions(
  receivingId: number | null,
  trackingNumber: string | null,
): UnfoundRefetchActions {
  const queryClient = useQueryClient();
  const [zoho, setZoho] = useState<RefetchState>(IDLE);
  const [amazon, setAmazon] = useState<RefetchState>(IDLE);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  const busy = zoho.status === 'loading' || amazon.status === 'loading';

  const checkZoho = useCallback(async () => {
    if (receivingId == null || busy) return;
    setZoho({ status: 'loading', message: null });
    try {
      const res = await fetch('/api/receiving/unfound-queue/retry-pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiving_id: receivingId }),
      });
      const data = await res.json().catch(() => ({}));
      setLastCheckedAt(Date.now());
      const { state, promote } = classifyZohoRetry(res.ok, data);
      setZoho(state);
      if (promote) {
        // Toast carries the result across the pane remount below.
        toast.success(state.message ?? 'Matched to a PO');
        invalidateReceivingFeeds(queryClient);
        await promoteInPlace(receivingId);
      }
    } catch (err) {
      setLastCheckedAt(Date.now());
      setZoho({ status: 'error', message: err instanceof Error ? err.message : 'Re-check failed' });
    }
  }, [receivingId, busy, queryClient]);

  const checkAmazon = useCallback(async () => {
    if (receivingId == null || busy) return;
    if (!trackingNumber || !trackingNumber.trim()) {
      setAmazon({ status: 'error', message: 'Add a tracking number to this carton first.' });
      return;
    }
    setAmazon({ status: 'loading', message: null });
    try {
      const res = await fetch(`/api/receiving/${receivingId}/amazon-return-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      setLastCheckedAt(Date.now());
      // 403 / unsupported = the connection lacks External Fulfillment (Seller
      // Flex) authorization, or no Amazon account is connected — a config gap,
      // not a scan failure.
      const { state, promote } = classifyAmazonLookup(res.status, res.ok, data);
      setAmazon(state);
      if (promote) {
        // Apply the server line_patch immediately so PO#/order + listing fill in
        // place (no wait for feed refetch). Shape matches ReturnLinkageLinePatch.
        const patch = data?.line_patch as
          | (Partial<ReceivingLineRow> & { id: number })
          | null
          | undefined;
        if (patch?.id) dispatchLineUpdated(patch);
        toast.success(
          data?.customer_order_id
            ? `Amazon return matched · order ${data.customer_order_id}`
            : 'Amazon return matched',
        );
        invalidateReceivingFeeds(queryClient);
      }
    } catch (err) {
      setLastCheckedAt(Date.now());
      setAmazon({ status: 'error', message: err instanceof Error ? err.message : 'Amazon lookup failed' });
    }
  }, [receivingId, trackingNumber, busy, queryClient]);

  return { zoho, amazon, lastCheckedAt, busy, checkZoho, checkAmazon };
}
