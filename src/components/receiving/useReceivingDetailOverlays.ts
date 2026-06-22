'use client';

/**
 * Overlay state for `/receiving`: the carton details stack (with lazy enrich),
 * the local-pickup review panel, and the Incoming-mode details slide-over.
 * Owns the `receiving-open-details-overlay` bridge, the Incoming row-select →
 * panel bridge, and the mode-flip cleanup. Extracted from ReceivingDashboard;
 * behaviour is unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import {
  fetchReceivingDetailsEnrich,
  receivingDetailsInstantSeed,
} from '@/lib/receiving/receiving-details-overlay';
import type { ReceivingDetailsLog } from '@/components/station/receiving-details-log';
import type { ReceivingDetailsOverlayDetail } from '@/utils/events';
import {
  shipmentIdFromDeliveredUnscannedRow,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';

export interface IncomingDetailsTarget {
  poId: string | null;
  poNumber: string | null;
  shipmentId: number | null;
}

export interface ReceivingDetailOverlays {
  overlayLog: ReceivingDetailsLog | null;
  setOverlayLog: React.Dispatch<React.SetStateAction<ReceivingDetailsLog | null>>;
  pickupReviewOrderId: number | null;
  setPickupReviewOrderId: React.Dispatch<React.SetStateAction<number | null>>;
  incomingDetails: IncomingDetailsTarget | null;
  setIncomingDetails: React.Dispatch<React.SetStateAction<IncomingDetailsTarget | null>>;
  /** Re-fetch + merge the open overlay log (or hand off to the pickup review). */
  enrichOverlayLog: (receivingId: number) => Promise<void>;
}

export function useReceivingDetailOverlays(isIncomingMode: boolean): ReceivingDetailOverlays {
  const [overlayLog, setOverlayLog] = useState<ReceivingDetailsLog | null>(null);
  // A finalized local pickup PO opens its own review/reprint panel instead of
  // the generic carton details stack (it has no receiving_lines).
  const [pickupReviewOrderId, setPickupReviewOrderId] = useState<number | null>(null);
  // Incoming-mode details panel — populated when a row is selected in
  // mode=incoming. {po_id, po_number} so the panel renders its header label
  // immediately, then re-keys its details query on po_id change.
  const [incomingDetails, setIncomingDetails] = useState<IncomingDetailsTarget | null>(null);

  const overlayLogIdRef = useRef<string | null>(null);
  useEffect(() => {
    overlayLogIdRef.current = overlayLog?.id ?? null;
  }, [overlayLog?.id]);

  const enrichOverlayLog = useCallback(async (receivingId: number) => {
    try {
      const result = await fetchReceivingDetailsEnrich(receivingId);
      if (overlayLogIdRef.current !== String(receivingId)) return;

      if (result.kind === 'local_pickup') {
        setOverlayLog(null);
        setPickupReviewOrderId(result.orderId);
        return;
      }
      if (result.kind === 'missing') return;

      setPickupReviewOrderId(null);
      setOverlayLog((prev) =>
        prev?.id === String(receivingId) ? { ...prev, ...result.log } : prev,
      );
    } catch {
      // Keep the instant seed visible when enrichment fails.
    }
  }, []);

  // Incoming-mode row select → open the IncomingDetailsPanel overlay. Listens on
  // the same `receiving-select-line` event the table dispatches; the mode check
  // gates so a select in Receiving keeps opening the workspace.
  useEffect(() => {
    if (!isIncomingMode) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const row =
        detail && typeof detail === 'object' && 'row' in detail
          ? ((detail as { row: ReceivingLineRow | null }).row)
          : (detail as ReceivingLineRow | null);
      if (!row) {
        setIncomingDetails(null);
        return;
      }
      const poId = (row.zoho_purchaseorder_id || '').trim();
      // A "Delivered · not scanned" box that never resolved to a PO is shipment-
      // anchored (synthetic row, receiving_id null). Recover its shipment id so
      // the panel can still open (shipment-only mode) and offer a hard delete.
      const shipmentId = shipmentIdFromDeliveredUnscannedRow(row);
      if (!poId && shipmentId == null) {
        // Neither a PO nor a shipment-anchored delivered box → nothing the panel
        // can render. Deterministic feedback instead of a silent dead click.
        const tracking = (row.tracking_number || '').trim();
        toast.info(tracking ? 'Delivered box not linked to a PO yet' : 'No linked PO for this row yet');
        return;
      }
      setIncomingDetails({
        poId: poId || null,
        poNumber: row.zoho_purchaseorder_number ?? null,
        // Prefer the richer PO view when a PO exists; only fall back to the
        // shipment-only view when there's no PO.
        shipmentId: poId ? null : shipmentId,
      });
    };
    window.addEventListener('receiving-select-line', handler);
    return () => window.removeEventListener('receiving-select-line', handler);
  }, [isIncomingMode]);

  // Mode flip → close any open incoming panel so it doesn't leak into Receiving.
  useEffect(() => {
    if (!isIncomingMode) setIncomingDetails(null);
  }, [isIncomingMode]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ReceivingDetailsOverlayDetail>).detail;
      const receivingId = Number(detail?.receivingId);
      if (!Number.isFinite(receivingId) || receivingId <= 0) return;

      setPickupReviewOrderId(null);
      setOverlayLog(receivingDetailsInstantSeed(receivingId, detail?.seed));
      void enrichOverlayLog(receivingId);
    };
    window.addEventListener('receiving-open-details-overlay', handler);
    return () => window.removeEventListener('receiving-open-details-overlay', handler);
  }, [enrichOverlayLog]);

  return {
    overlayLog,
    setOverlayLog,
    pickupReviewOrderId,
    setPickupReviewOrderId,
    incomingDetails,
    setIncomingDetails,
    enrichOverlayLog,
  };
}
