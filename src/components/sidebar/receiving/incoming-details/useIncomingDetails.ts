'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getStationChannelName, safeChannelName } from '@/lib/realtime/channels';
import { useAuth } from '@/contexts/AuthContext';
import type { DetailsResponse, IncomingDetailsPanelProps, TabId } from './incoming-details-shared';

/**
 * Owns the incoming-details panel's data + actions: the consolidated details
 * query (PO- or shipment-keyed, with 60s carrier polling), Ably `shipment.changed`
 * live refresh, per-order Sync (Zoho re-pull + carrier re-poll), the two-step
 * delete (PO lines or PO-less shipment row), and the derived header/mode flags.
 * Returns a controller bag the thin panel shell renders from.
 */
export function useIncomingDetails({ zohoPurchaseOrderId, poNumberHint, shipmentId }: IncomingDetailsPanelProps) {
  // Shipment-only mode: a delivered box with no resolved PO. The panel keys on
  // the shipment id instead, defaults to the Shipment tab, hides PO-only actions
  // (Sync), and its delete hard-removes the shipment from Incoming.
  const isShipmentOnly = !zohoPurchaseOrderId && shipmentId != null;
  // Stable react-query key for the details fetch in either mode.
  const detailsKey = zohoPurchaseOrderId ?? (shipmentId != null ? `shipment:${shipmentId}` : '');

  const [tab, setTab] = useState<TabId>(isShipmentOnly ? 'shipment' : 'po');
  const [syncing, setSyncing] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const stationChannel = safeChannelName(() => getStationChannelName(user?.organizationId!));

  // Reset to the default tab when the row changes (PO id or shipment id).
  useEffect(() => setTab(isShipmentOnly ? 'shipment' : 'po'), [zohoPurchaseOrderId, shipmentId, isShipmentOnly]);

  const invalidateIncoming = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['incoming-details', detailsKey] });
    queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
    queryClient.invalidateQueries({ queryKey: ['receiving-lines-incoming-summary'] });
    queryClient.invalidateQueries({ queryKey: ['incoming-delivered-unscanned'] });
  }, [queryClient, detailsKey]);

  // Per-order Sync — re-pull this one PO's Zoho header/status + re-poll its
  // shipment, without running the whole Incoming sweep.
  const syncOne = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/receiving-lines/incoming/sync-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ po_id: zohoPurchaseOrderId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        toast.error(body?.error || `Sync failed (${res.status})`);
        return;
      }
      const status = body?.mirror?.status as string | null;
      const polled = body?.shipment?.polled as boolean | undefined;
      toast.success(
        `Synced${status ? ` · Zoho: ${status}` : ''}${polled ? ' · carrier re-polled' : ''}`,
      );
      invalidateIncoming();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [syncing, zohoPurchaseOrderId, invalidateIncoming]);

  // Delete — clears the Incoming row. For a PO it removes EVERY receiving_line
  // for that PO (Zoho untouched; a future sync may re-add it). For a PO-less
  // delivered box it hard-deletes the shipment row (there's no receiving_line to
  // delete) so the "Delivered · not scanned" entry stops surfacing.
  // Throws on failure so the shared DeleteButton skips its onDeleted (close).
  const handleDelete = useCallback(async () => {
    const url = isShipmentOnly
      ? `/api/receiving-lines?shipment_id=${encodeURIComponent(String(shipmentId))}`
      : `/api/receiving-lines?po_id=${encodeURIComponent(zohoPurchaseOrderId ?? '')}`;
    const res = await fetch(url, { method: 'DELETE' });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      const msg = body?.error || `Delete failed (${res.status})`;
      toast.error(msg);
      throw new Error(msg);
    }
    toast.success(
      isShipmentOnly
        ? 'Removed from Incoming'
        : `Removed from Incoming (${body?.deleted ?? 0} line${body?.deleted === 1 ? '' : 's'})`,
    );
    invalidateIncoming();
  }, [isShipmentOnly, shipmentId, zohoPurchaseOrderId, invalidateIncoming]);

  const { data, isLoading, isError } = useQuery<DetailsResponse>({
    queryKey: ['incoming-details', detailsKey],
    queryFn: async () => {
      const qs = isShipmentOnly
        ? `shipment_id=${encodeURIComponent(String(shipmentId))}`
        : `po_id=${encodeURIComponent(zohoPurchaseOrderId ?? '')}`;
      const res = await fetch(`/api/receiving-lines/incoming/details?${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`details ${res.status}`);
      return res.json();
    },
    enabled: Boolean(detailsKey),
    staleTime: 15_000,
    // Polling fallback so the carrier status stays live (like the carrier's
    // own site) even when realtime/Ably is unavailable. Only this open panel
    // polls — one PO row per minute — and pauses when the tab is hidden, so the
    // DB cost stays negligible.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  // Realtime: a carrier webhook (or poll) that updates this shipment fires
  // `shipment.changed`; refresh the panel + the incoming list/summary instantly
  // so the displayed status matches the carrier's live state without a reload.
  useAblyChannel(stationChannel, 'shipment.changed', () => {
    queryClient.invalidateQueries({ queryKey: ['incoming-details', detailsKey] });
    queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
    queryClient.invalidateQueries({ queryKey: ['receiving-lines-incoming-summary'] });
  }, !!stationChannel);

  const headerPo = poNumberHint || data?.po?.zoho_purchaseorder_number || '';
  // Shipment-only rows have no PO chip — fall back to the tracking# so the
  // header still identifies the box.
  const headerTracking = isShipmentOnly
    ? (data?.shipment?.tracking_number || '').trim()
    : '';

  return {
    isShipmentOnly,
    tab, setTab,
    syncing, syncOne,
    handleDelete,
    data, isLoading, isError,
    headerPo, headerTracking,
  };
}

export type IncomingDetailsController = ReturnType<typeof useIncomingDetails>;
