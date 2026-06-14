'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dispatchUsavRefreshData, invalidateDashboardOrderQueries } from '@/lib/dashboard-query-invalidation';
import { streamNdjson } from '@/lib/orders-sync/client';
import type {
  ExceptionsTabState,
  OrderExceptionResolutionDetail,
  SyncPhase,
  TransferOrderDetails,
  TransferTabState,
} from '@/lib/orders-sync/types';

/**
 * The "Import Latest Orders" sync orchestration — Google Sheets + Ecwid Direct
 * transfers run in parallel, then the Resolved Exceptions pass, all streamed as
 * NDJSON with live per-tab progress. Extracted from `DashboardManagementPanel`
 * so the merged Unshipped sidebar's combined Sync/Backfill popover and the
 * legacy panel share ONE implementation (and one {@link OrderSyncDialog} state
 * surface) instead of drifting.
 */
export interface OrdersSyncStatus {
  type: 'success' | 'error';
  message: string;
  details?: {
    tabName?: string;
    inserted?: number;
    updated?: number;
    trackingAttached?: number;
    unresolvedTracking?: number;
    processedRows?: number;
    exceptionsResolved?: number;
    ecwidInserted?: number;
    durationMs?: number;
  };
}

function phaseSummary(phase: SyncPhase, count?: number): string {
  switch (phase) {
    case 'starting': return 'Starting…';
    case 'fetching_sheet': return 'Fetching sheet…';
    case 'fetching_ecwid': return 'Fetching Ecwid orders…';
    case 'resolving_tracking': return count ? `Resolving ${count} tracking number${count === 1 ? '' : 's'}…` : 'Resolving tracking…';
    case 'matching_orders': return 'Matching orders…';
    case 'inserting': return count ? `Inserting ${count} order${count === 1 ? '' : 's'}…` : 'Inserting…';
    case 'updating': return count ? `Updating ${count} order${count === 1 ? '' : 's'}…` : 'Updating…';
    case 'publishing': return 'Publishing changes…';
    case 'scanning_exceptions': return count ? `Scanning ${count} open exception${count === 1 ? '' : 's'}…` : 'Scanning exceptions…';
    case 'done': return 'Done';
    default: return 'Working…';
  }
}

function emptyTransferDetails(): TransferOrderDetails {
  return { inserted: [], updated: [], deleted: [], unknownTitle: [], unresolvedTracking: [] };
}

function cloneDetails(d: TransferOrderDetails): TransferOrderDetails {
  return {
    inserted: [...d.inserted],
    updated: [...d.updated],
    deleted: [...d.deleted],
    unknownTitle: [...d.unknownTitle],
    unresolvedTracking: [...(d.unresolvedTracking ?? [])],
  };
}

export function useOrdersSync() {
  const queryClient = useQueryClient();
  const [sheetsTask, setSheetsTask] = useState<TransferTabState>({ status: 'idle' });
  const [ecwidTask, setEcwidTask] = useState<TransferTabState>({ status: 'idle' });
  const [exceptionsTask, setExceptionsTask] = useState<ExceptionsTabState>({ status: 'idle' });
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [manualSheetName, setManualSheetName] = useState('');
  const [status, setStatus] = useState<OrdersSyncStatus | null>(null);

  const isTransferring =
    sheetsTask.status === 'running' ||
    ecwidTask.status === 'running' ||
    exceptionsTask.status === 'running';

  const handleCancelTransfer = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    setSheetsTask({ status: 'idle' });
    setEcwidTask({ status: 'idle' });
    setExceptionsTask({ status: 'idle' });
    setStatus({ type: 'error', message: 'Import cancelled' });
  };

  const handleTransfer = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setSheetsTask({ status: 'running', details: emptyTransferDetails() });
    setEcwidTask({ status: 'running', details: emptyTransferDetails() });
    // Exceptions sync runs AFTER sheets+ecwid finish so that rows just inserted
    // are visible to the matcher. Keep it idle/queued until then.
    setExceptionsTask({ status: 'idle', summary: 'Queued' });
    setStatus(null);
    setElapsedMs(0);
    setIsSyncDialogOpen(true);
    const t0 = Date.now();
    elapsedRef.current = setInterval(() => setElapsedMs(Date.now() - t0), 100);

    let sheetsResultPayload: Record<string, unknown> | null = null;
    let ecwidResultPayload: Record<string, unknown> | null = null;
    let exceptionsResultPayload: Record<string, unknown> | null = null;

    // Fires React Query invalidate + global refresh event so the dashboard
    // tables refetch *as soon as* a stream produces real changes.
    const refreshDashboard = async () => {
      await invalidateDashboardOrderQueries(queryClient);
      dispatchUsavRefreshData();
    };

    const consumeTransferStream = async (
      url: string,
      init: RequestInit,
      setter: typeof setSheetsTask,
    ): Promise<{ payload: Record<string, unknown> | null; error?: string }> => {
      const acc: TransferOrderDetails = emptyTransferDetails();
      let payload: Record<string, unknown> | null = null;
      let lastError: string | undefined;
      let hasWrites = false;

      try {
        await streamNdjson(url, init, (event) => {
          if (event.type === 'phase') {
            if (event.phase === 'publishing' && hasWrites) void refreshDashboard();
            setter((prev) => ({
              ...prev,
              status: 'running',
              summary: phaseSummary(event.phase, event.count),
              phase: event.phase,
              details: cloneDetails(acc),
            } as TransferTabState));
          } else if (event.type === 'detail') {
            acc[event.kind].push(event.row);
            if (event.kind === 'inserted' || event.kind === 'updated' || event.kind === 'deleted') {
              hasWrites = true;
            }
            setter((prev) => ({
              ...prev,
              details: cloneDetails(acc),
              inserted: acc.inserted.length,
              updated: acc.updated.length,
              deleted: acc.deleted.length,
              unresolvedTracking: acc.unresolvedTracking.length,
            } as TransferTabState));
          } else if (event.type === 'result') {
            payload = event.result;
            if (hasWrites) void refreshDashboard();
          } else if (event.type === 'error') {
            lastError = event.error;
          }
        });
      } catch (err: any) {
        lastError = err?.name === 'AbortError' ? 'Cancelled' : (err?.message || 'Network error');
      }

      const data = payload ?? {};
      const success = !lastError && (data as any).success !== false;
      const ins = Number((data as any).insertedOrders ?? acc.inserted.length);
      const upd = Number((data as any).updatedOrdersFields ?? acc.updated.length);
      const trk = Number((data as any).updatedOrdersTracking ?? 0);
      const unresolved = Number((data as any).unresolvedTrackingCount ?? acc.unresolvedTracking.length);
      const parts = [
        ins && `${ins} inserted`,
        upd && `${upd} updated${trk ? ` (${trk} tracking)` : ''}`,
        unresolved && `⚠ ${unresolved} tracking not recognized`,
      ].filter(Boolean);
      setter({
        status: success ? 'done' : 'error',
        summary: success
          ? (parts.length > 0 ? (parts.join(', ') as string) : 'Up to date')
          : (lastError || (data as any).error || 'Failed'),
        error: success ? undefined : (lastError || (data as any).error || 'Failed'),
        details: cloneDetails(acc),
        inserted: ins,
        updated: upd,
        trackingAttached: trk,
        unresolvedTracking: unresolved,
        deleted: Number((data as any).deletedDuplicateOrders ?? acc.deleted.length),
        processedRows: Number((data as any).processedRows || 0),
        tabName: (data as any).tabName,
        phase: 'done',
      } as TransferTabState);
      return { payload: data, error: lastError };
    };

    const consumeExceptionsStream = async (
      url: string,
      init: RequestInit,
    ): Promise<{ payload: Record<string, unknown> | null; error?: string }> => {
      const resolved: OrderExceptionResolutionDetail[] = [];
      const stillOpen: OrderExceptionResolutionDetail[] = [];
      let payload: Record<string, unknown> | null = null;
      let lastError: string | undefined;

      try {
        await streamNdjson(url, init, (event) => {
          if (event.type === 'phase') {
            setExceptionsTask((prev) => ({
              ...prev,
              status: 'running',
              summary: phaseSummary(event.phase, event.count),
              phase: event.phase,
              resolved: [...resolved],
              stillOpen: [...stillOpen],
            }));
          } else if (event.type === 'exception') {
            if (event.kind === 'resolved') {
              resolved.push(event.row);
            } else {
              stillOpen.push(event.row);
            }
            setExceptionsTask((prev) => ({
              ...prev,
              resolved: [...resolved],
              stillOpen: [...stillOpen],
              matched: resolved.length,
              scanned: resolved.length + stillOpen.length,
            }));
          } else if (event.type === 'result') {
            payload = event.result;
            if (resolved.length > 0) void refreshDashboard();
          } else if (event.type === 'error') {
            lastError = event.error;
          }
        });
      } catch (err: any) {
        lastError = err?.name === 'AbortError' ? 'Cancelled' : (err?.message || 'Network error');
      }

      const data = payload ?? {};
      const success = !lastError && (data as any).success !== false;
      const matched = Number((data as any).matched ?? resolved.length);
      setExceptionsTask({
        status: success ? 'done' : 'error',
        summary: success
          ? (matched > 0 ? `${matched} resolved` : 'None pending')
          : (lastError || (data as any).error || 'Failed'),
        error: success ? undefined : (lastError || (data as any).error || 'Failed'),
        resolved: [...resolved],
        stillOpen: [...stillOpen],
        scanned: Number((data as any).scanned ?? (resolved.length + stillOpen.length)),
        matched,
        phase: 'done',
      });
      return { payload: data, error: lastError };
    };

    try {
      const [sheetsR, ecwidR] = await Promise.all([
        consumeTransferStream(
          '/api/google-sheets/transfer-orders',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manualSheetName: manualSheetName.trim() || undefined }),
            signal: controller.signal,
          },
          setSheetsTask,
        ),
        consumeTransferStream(
          '/api/ecwid/transfer-orders',
          { method: 'POST', signal: controller.signal },
          setEcwidTask,
        ),
      ]);
      sheetsResultPayload = sheetsR.payload;
      ecwidResultPayload = ecwidR.payload;

      setExceptionsTask({ status: 'running', phase: 'starting' });
      const exceptionsR = await consumeExceptionsStream('/api/orders-exceptions/sync', {
        method: 'POST',
        signal: controller.signal,
      });
      exceptionsResultPayload = exceptionsR.payload;

      const totalInserted = Number(sheetsResultPayload?.insertedOrders || 0)
        + Number(ecwidResultPayload?.insertedOrders || 0);
      const totalUpdated = Number(sheetsResultPayload?.updatedOrdersFields || 0)
        + Number(ecwidResultPayload?.updatedOrdersFields || 0);
      const totalTracking = Number(sheetsResultPayload?.updatedOrdersTracking || 0)
        + Number(ecwidResultPayload?.updatedOrdersTracking || 0);
      const totalUnresolved = Number(sheetsResultPayload?.unresolvedTrackingCount || 0)
        + Number(ecwidResultPayload?.unresolvedTrackingCount || 0);
      const exceptionsResolved = Number(exceptionsResultPayload?.matched || 0);

      await invalidateDashboardOrderQueries(queryClient);
      dispatchUsavRefreshData();

      const anyFailed = [sheetsR, ecwidR, exceptionsR].some(
        (r) => Boolean(r.error) || (r.payload && (r.payload as any).success === false),
      );
      const parts = [];
      if (totalInserted > 0) parts.push(`${totalInserted} inserted`);
      if (totalUpdated > 0) parts.push(`${totalUpdated} updated${totalTracking ? ` (${totalTracking} tracking)` : ''}`);
      if (totalUnresolved > 0) parts.push(`⚠ ${totalUnresolved} tracking not recognized`);

      setStatus({
        type: anyFailed ? 'error' : 'success',
        message: parts.length > 0 ? `Orders synced: ${parts.join(', ')}` : 'Orders already up to date',
        details: {
          tabName: sheetsResultPayload?.tabName as string | undefined,
          inserted: totalInserted,
          updated: totalUpdated,
          trackingAttached: totalTracking,
          unresolvedTracking: totalUnresolved,
          processedRows: Number(sheetsResultPayload?.processedRows || 0)
            + Number(ecwidResultPayload?.processedRows || 0),
          exceptionsResolved,
          ecwidInserted: Number(ecwidResultPayload?.insertedOrders || 0),
          durationMs: Date.now() - t0,
        },
      });
    } catch (_error: any) {
      if (_error?.name === 'AbortError') return;
      setStatus({ type: 'error', message: 'Network error occurred' });
    } finally {
      abortRef.current = null;
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    }
  };

  return {
    sheetsTask,
    ecwidTask,
    exceptionsTask,
    isSyncDialogOpen,
    setIsSyncDialogOpen,
    elapsedMs,
    isTransferring,
    manualSheetName,
    setManualSheetName,
    status,
    setStatus,
    handleTransfer,
    handleCancelTransfer,
  };
}
