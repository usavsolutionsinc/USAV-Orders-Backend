'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dispatchUsavRefreshData, invalidateDashboardOrderQueries } from '@/lib/dashboard-query-invalidation';
import { streamNdjson } from '@/lib/orders-sync/client';
import type {
  ExceptionsTabState,
  OrderExceptionResolutionDetail,
  TransferOrderDetails,
  TransferTabState,
} from '@/lib/orders-sync/types';
import { cloneDetails, emptyTransferDetails, phaseSummary, type ImportStatus } from './dashboard-management-shared';

/**
 * Owns the multi-source order import: streams the Google-Sheets + Ecwid transfer
 * jobs in parallel (each accumulating its own detail tab), then the exceptions
 * sync after they finish, surfacing live progress + a final status banner. Fires
 * an early dashboard refetch the moment a stream produces real writes.
 */
export function useOrdersImport() {
  const queryClient = useQueryClient();
  const [sheetsTask, setSheetsTask] = useState<TransferTabState>({ status: 'idle' });
  const [ecwidTask, setEcwidTask] = useState<TransferTabState>({ status: 'idle' });
  const [exceptionsTask, setExceptionsTask] = useState<ExceptionsTabState>({ status: 'idle' });
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [manualSheetName, setManualSheetName] = useState('');
  const [status, setStatus] = useState<ImportStatus | null>(null);

  const isTransferring =
    sheetsTask.status === 'running' || ecwidTask.status === 'running' || exceptionsTask.status === 'running';

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
    // Exceptions sync runs AFTER sheets+ecwid finish so rows just inserted are
    // visible to the matcher. Keep it idle/queued until then.
    setExceptionsTask({ status: 'idle', summary: 'Queued' });
    setStatus(null);
    setElapsedMs(0);
    setIsSyncDialogOpen(true);
    const t0 = Date.now();
    elapsedRef.current = setInterval(() => setElapsedMs(Date.now() - t0), 100);

    let sheetsResultPayload: Record<string, unknown> | null = null;
    let ecwidResultPayload: Record<string, unknown> | null = null;
    let exceptionsResultPayload: Record<string, unknown> | null = null;

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
        summary: success ? (parts.length > 0 ? (parts.join(', ') as string) : 'Up to date') : (lastError || (data as any).error || 'Failed'),
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
        summary: success ? (matched > 0 ? `${matched} resolved` : 'None pending') : (lastError || (data as any).error || 'Failed'),
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
        consumeTransferStream('/api/ecwid/transfer-orders', { method: 'POST', signal: controller.signal }, setEcwidTask),
      ]);
      sheetsResultPayload = sheetsR.payload;
      ecwidResultPayload = ecwidR.payload;

      setExceptionsTask({ status: 'running', phase: 'starting' });
      const exceptionsR = await consumeExceptionsStream('/api/orders-exceptions/sync', { method: 'POST', signal: controller.signal });
      exceptionsResultPayload = exceptionsR.payload;

      const totalInserted = Number(sheetsResultPayload?.insertedOrders || 0) + Number(ecwidResultPayload?.insertedOrders || 0);
      const totalUpdated = Number(sheetsResultPayload?.updatedOrdersFields || 0) + Number(ecwidResultPayload?.updatedOrdersFields || 0);
      const totalTracking = Number(sheetsResultPayload?.updatedOrdersTracking || 0) + Number(ecwidResultPayload?.updatedOrdersTracking || 0);
      const totalUnresolved = Number(sheetsResultPayload?.unresolvedTrackingCount || 0) + Number(ecwidResultPayload?.unresolvedTrackingCount || 0);
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
          processedRows: Number(sheetsResultPayload?.processedRows || 0) + Number(ecwidResultPayload?.processedRows || 0),
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
    sheetsTask, ecwidTask, exceptionsTask,
    isSyncDialogOpen, setIsSyncDialogOpen,
    elapsedMs,
    manualSheetName, setManualSheetName,
    status, setStatus,
    isTransferring,
    handleTransfer, handleCancelTransfer,
  };
}

export type OrdersImportController = ReturnType<typeof useOrdersImport>;
