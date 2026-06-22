'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import { streamNdjson } from '@/lib/orders-sync/client';
import { EMPTY_CARRIER_TABS, type CarrierTabsState } from '@/components/sidebar/receiving/CarrierSyncDialog';
import type { IncomingSyncKind, IncomingSyncResult } from '@/components/sidebar/receiving/IncomingSyncDialog';
import type { CarrierSyncResult, CarrierSyncStreamEvent } from '@/lib/carrier-sync/types';

/**
 * The three Incoming refresh actions and the two result dialogs they drive:
 *   • Zoho  — re-pull issued POs + mirror status (single POST → IncomingSyncDialog)
 *   • Email — rescan the PO mailbox (single POST → IncomingSyncDialog)
 *   • Tracking — re-poll UPS/USPS/FedEx (NDJSON stream → CarrierSyncDialog)
 * All three invalidate every receiving feed through the shared helper so this
 * view and the scan path never drift on what counts as "a receiving feed".
 */
export function useIncomingSyncActions() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [zohoRefreshing, setZohoRefreshing] = useState(false);
  const [rescanning, setRescanning] = useState(false);

  // Live carrier stream — per-carrier tabs streamed from /refresh/stream.
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [carrierTabs, setCarrierTabs] = useState<CarrierTabsState>(EMPTY_CARRIER_TABS);
  const [syncResult, setSyncResult] = useState<CarrierSyncResult | null>(null);
  const [syncElapsedMs, setSyncElapsedMs] = useState(0);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncAbortRef = useRef<AbortController | null>(null);

  // Zoho / Email single-shot dialog.
  const [incSyncOpen, setIncSyncOpen] = useState(false);
  const [incSyncKind, setIncSyncKind] = useState<IncomingSyncKind>('zoho');
  const [incSyncRunning, setIncSyncRunning] = useState(false);
  const [incSyncResult, setIncSyncResult] = useState<IncomingSyncResult | null>(null);
  const [incSyncElapsedMs, setIncSyncElapsedMs] = useState(0);
  const incSyncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const beginIncSync = useCallback((kind: IncomingSyncKind) => {
    setIncSyncKind(kind);
    setIncSyncResult(null);
    setIncSyncRunning(true);
    setIncSyncElapsedMs(0);
    setIncSyncOpen(true);
    const t0 = Date.now();
    if (incSyncTimerRef.current) clearInterval(incSyncTimerRef.current);
    incSyncTimerRef.current = setInterval(() => setIncSyncElapsedMs(Date.now() - t0), 100);
  }, []);

  const finishIncSync = useCallback((result: IncomingSyncResult) => {
    if (incSyncTimerRef.current) {
      clearInterval(incSyncTimerRef.current);
      incSyncTimerRef.current = null;
    }
    setIncSyncRunning(false);
    setIncSyncResult(result);
  }, []);

  useEffect(() => () => {
    if (incSyncTimerRef.current) clearInterval(incSyncTimerRef.current);
  }, []);

  useEffect(() => () => {
    if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    syncAbortRef.current?.abort();
  }, []);

  const invalidateIncoming = useCallback(async () => {
    invalidateReceivingFeeds(queryClient);
  }, [queryClient]);

  const refreshZoho = useCallback(async () => {
    if (zohoRefreshing) return;
    setZohoRefreshing(true);
    beginIncSync('zoho');
    try {
      const res = await fetch('/api/receiving-lines/incoming/zoho-refresh', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error || `Zoho refresh failed (${res.status})`);
      await invalidateIncoming();
      const created = data?.issued?.created ?? 0;
      const updated = data?.issued?.updated ?? 0;
      const linked = data?.issued?.linked ?? 0;
      const processed = data?.issued?.processed ?? 0;
      const failed = data?.issued?.failed ?? 0;
      const statusUpdates = data?.mirror?.upserted ?? 0;
      const fetched = data?.mirror?.fetched ?? 0;
      const mirrorMode = data?.mirror?.mode ?? '—';
      const mirrorErrors: string[] = Array.isArray(data?.mirror?.errors) ? data.mirror.errors : [];
      const nothingChanged = created + updated + linked + statusUpdates === 0;
      finishIncSync({
        ok: true,
        tiles: [
          { label: 'New', value: created, tone: 'emerald' },
          { label: 'Refreshed', value: updated, tone: 'blue' },
          { label: 'Cleared', value: statusUpdates, tone: 'gray' },
          { label: 'Errors', value: failed + mirrorErrors.length, tone: 'red' },
        ],
        updated: [
          created > 0 ? `${created} new PO${created === 1 ? '' : 's'} added` : null,
          updated > 0 ? `${updated} PO${updated === 1 ? '' : 's'} refreshed` : null,
          linked > 0 ? `${linked} PO${linked === 1 ? '' : 's'} linked to a shipment` : null,
          statusUpdates > 0 ? `${statusUpdates} received PO${statusUpdates === 1 ? '' : 's'} cleared from Incoming` : null,
        ].filter(Boolean) as string[],
        sections: [
          { label: 'Issued sync', rows: [
            { k: 'Checked', v: processed },
            { k: 'Created', v: created },
            { k: 'Updated', v: updated },
            { k: 'Linked', v: linked },
            { k: 'Failed', v: failed },
          ] },
          { label: 'Mirror sync', rows: [
            { k: 'Mode', v: mirrorMode },
            { k: 'Fetched', v: fetched },
            { k: 'Updated', v: statusUpdates },
            { k: 'Errors', v: mirrorErrors.length },
          ] },
        ],
        errors: mirrorErrors,
        note: nothingChanged ? 'Already up to date — no Zoho changes since last sync.' : null,
      });
    } catch (err) {
      finishIncSync({ ok: false, tiles: [], updated: [], sections: [], errors: [], note: err instanceof Error ? err.message : 'Could not reach Zoho. Try again.' });
    } finally {
      setZohoRefreshing(false);
    }
  }, [zohoRefreshing, invalidateIncoming, beginIncSync, finishIncSync]);

  const rescanEmail = useCallback(async () => {
    if (rescanning) return;
    setRescanning(true);
    beginIncSync('email');
    try {
      const res = await fetch('/api/receiving-lines/incoming/email-rescan?limit=50', { method: 'POST', cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Rescan failed (${res.status})`);
      await invalidateIncoming();
      const scanned = data?.scanned ?? 0;
      const sig = data?.persisted?.delivery_signals ?? 0;
      const upserted = data?.persisted?.upserted ?? 0;
      const resolved = data?.persisted?.resolved ?? 0;
      const trackingLinked = data?.persisted?.tracking_linked ?? 0;
      const trackingAlready = data?.persisted?.tracking_already_linked ?? 0;
      const trackingRejected = data?.persisted?.tracking_rejected ?? 0;
      const counts = data?.counts ?? {};
      const nothingChanged = sig + upserted + resolved + trackingLinked === 0;
      finishIncSync({
        ok: true,
        tiles: [
          { label: 'Delivered', value: sig, tone: 'emerald' },
          { label: 'Added', value: upserted, tone: 'blue' },
          { label: 'Resolved', value: resolved, tone: 'gray' },
          { label: 'Tracking', value: trackingLinked, tone: 'emerald' },
        ],
        updated: [
          sig > 0 ? `${sig} “Order delivered” signal${sig === 1 ? '' : 's'} logged` : null,
          upserted > 0 ? `${upserted} missing PO${upserted === 1 ? '' : 's'} added to worklist` : null,
          resolved > 0 ? `${resolved} worklist row${resolved === 1 ? '' : 's'} resolved` : null,
          trackingLinked > 0 ? `${trackingLinked} tracking #${trackingLinked === 1 ? '' : 's'} linked` : null,
        ].filter(Boolean) as string[],
        sections: [
          { label: 'Mailbox scan', rows: [
            { k: 'Scanned', v: scanned },
            { k: 'Missing', v: counts?.missing ?? 0 },
            { k: 'In Zoho', v: counts?.in_zoho ?? 0 },
            { k: 'Received', v: counts?.received ?? 0 },
            { k: 'No match', v: counts?.no_match ?? 0 },
          ] },
          { label: 'Tracking', rows: [
            { k: 'Linked', v: trackingLinked },
            { k: 'Already linked', v: trackingAlready },
            { k: 'Rejected', v: trackingRejected },
          ] },
        ],
        errors: [],
        note: nothingChanged ? 'Already up to date — nothing new in the mailbox.' : null,
      });
    } catch (err) {
      finishIncSync({ ok: false, tiles: [], updated: [], sections: [], errors: [], note: err instanceof Error ? err.message : 'Could not reach the PO mailbox. Try again.' });
    } finally {
      setRescanning(false);
    }
  }, [rescanning, invalidateIncoming, beginIncSync, finishIncSync]);

  const handleCancelSync = useCallback(() => {
    syncAbortRef.current?.abort();
  }, []);

  const refreshTracking = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setSyncResult(null);
    setCarrierTabs(EMPTY_CARRIER_TABS);
    setSyncElapsedMs(0);
    setSyncDialogOpen(true);

    const t0 = Date.now();
    if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    syncTimerRef.current = setInterval(() => setSyncElapsedMs(Date.now() - t0), 100);

    const abort = new AbortController();
    syncAbortRef.current = abort;

    let streamError: string | null = null;
    let result: CarrierSyncResult | null = null;

    try {
      await streamNdjson<CarrierSyncStreamEvent>(
        '/api/receiving-lines/incoming/refresh/stream',
        { method: 'POST', signal: abort.signal },
        (event) => {
          if (event.type === 'carrier-start') {
            setCarrierTabs((prev) => ({ ...prev, [event.carrier]: { ...prev[event.carrier], status: 'running', total: event.total } }));
          } else if (event.type === 'detail') {
            setCarrierTabs((prev) => {
              const tab = prev[event.carrier];
              return { ...prev, [event.carrier]: { ...tab, status: 'running', rows: [...tab.rows, event.row] } };
            });
          } else if (event.type === 'carrier-done') {
            setCarrierTabs((prev) => ({ ...prev, [event.carrier]: { ...prev[event.carrier], status: 'done' } }));
          } else if (event.type === 'result') {
            result = event.result;
          } else if (event.type === 'error') {
            streamError = event.error;
          }
        },
      );
    } catch (err) {
      streamError = (err as Error)?.name === 'AbortError'
        ? 'Cancelled'
        : err instanceof Error ? err.message : 'Sync failed';
    } finally {
      if (syncTimerRef.current) {
        clearInterval(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      syncAbortRef.current = null;
      setRefreshing(false);
    }

    // Settle each carrier tab.
    setCarrierTabs((prev) => {
      const anyRan = Object.values(prev).some((t) => t.status !== 'idle');
      const next = { ...prev };
      (Object.keys(next) as Array<keyof CarrierTabsState>).forEach((k) => {
        const tab = next[k];
        if (tab.status === 'running') {
          next[k] = { ...tab, status: streamError ? 'error' : 'done', error: streamError ?? tab.error };
        } else if (tab.status === 'idle') {
          if (streamError && !anyRan) {
            next[k] = { ...tab, status: 'error', error: streamError };
          } else if (result?.throttled) {
            next[k] = { ...tab, status: 'done', summary: 'Just refreshed' };
          }
        }
      });
      return next;
    });

    if (result) setSyncResult(result);
    if (streamError && streamError !== 'Cancelled') toast.error(streamError);

    await invalidateIncoming();
  }, [refreshing, invalidateIncoming]);

  return {
    // single-shot buttons
    zohoRefreshing, rescanning, refreshZoho, rescanEmail,
    // carrier stream
    refreshing, refreshTracking, handleCancelSync,
    // carrier dialog
    syncDialogOpen, setSyncDialogOpen, carrierTabs, syncResult, syncElapsedMs, isSyncing: refreshing,
    // single-shot dialog
    incSyncOpen, setIncSyncOpen, incSyncKind, incSyncRunning, incSyncResult, incSyncElapsedMs,
  };
}
