'use client';

/**
 * Manual "Sync shipped orders to Zoho" control for the dashboard shipped view.
 *
 * Clicking the button opens the ZohoSyncDialog and runs a DRY-RUN preview
 * (POST /api/zoho/fulfillment-sync, dryRun:true) so the user can see exactly
 * what will be synced — each packer-scanned shipped order is pushed to Zoho as
 * one bundle created together:
 *
 *     Sales order → Package → Shipment → Invoice
 *
 * "Sync now" (two-click confirm) runs it live and the dialog updates to show
 * the synced result per order (with the packer who scanned it). Gated by the
 * `integrations.zoho` permission, matching the API route's guard.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { RefreshCw, ChevronDown } from '@/components/Icons';
import { Can } from '@/components/auth/Can';
import { toast } from '@/lib/toast';
import {
  ZohoSyncDialog,
  type ZohoSyncReport,
  type ZohoSyncPhase,
} from '@/components/shipped/ZohoSyncDialog';

const PREVIEW_LIMIT = 50;

async function postSync(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ZohoSyncReport> {
  const res = await fetch('/api/zoho/fulfillment-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `Zoho sync failed (HTTP ${res.status})`);
  }
  return data.report as ZohoSyncReport;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

const countPending = (report: ZohoSyncReport | null) =>
  report ? report.results.filter((r) => r.status === 'dry_run').length : 0;

export function ZohoSyncButton({ variant = 'sidebar' }: { variant?: 'sidebar' | 'chip' }) {
  return (
    <Can perm="integrations.zoho">
      <ZohoSyncButtonInner variant={variant} />
    </Can>
  );
}

function ZohoSyncButtonInner({ variant }: { variant: 'sidebar' | 'chip' }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<ZohoSyncReport | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<ZohoSyncPhase>('preview');
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const freshSignal = () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    return ctrl.signal;
  };

  const preview = useMutation({
    mutationFn: () => postSync({ dryRun: true, mode: 'delta', limit: PREVIEW_LIMIT }, freshSignal()),
    onSuccess: (r) => {
      setReport(r);
      setConfirming(false);
      setPhase('preview');
    },
    onError: (e: unknown) => {
      if (isAbort(e)) return; // user cancelled — dialog already closing
      setPhase('preview');
      toast.error(e instanceof Error ? e.message : 'Preview failed');
    },
  });

  const runLive = useMutation({
    mutationFn: () => postSync({ dryRun: false, mode: 'delta', limit: PREVIEW_LIMIT }, freshSignal()),
    onSuccess: (r) => {
      setReport(r);
      setConfirming(false);
      setPhase('done');
      toast.success(
        `Synced ${r.completed} order${r.completed === 1 ? '' : 's'} to Zoho` +
          (r.errored ? ` · ${r.errored} failed` : ''),
      );
    },
    onError: (e: unknown) => {
      if (isAbort(e)) return; // user cancelled mid-sync
      setConfirming(false);
      setPhase('preview');
      toast.error(e instanceof Error ? e.message : 'Sync failed');
    },
  });

  const busy = preview.isPending || runLive.isPending;
  const pendingCount = countPending(report);

  // Elapsed timer — ticks while a preview/live run is in flight, then freezes.
  useEffect(() => {
    if (!busy) {
      startRef.current = null;
      return;
    }
    if (startRef.current == null) startRef.current = Date.now();
    const id = setInterval(() => {
      if (startRef.current != null) setElapsedMs(Date.now() - startRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [busy]);

  const beginTimer = () => {
    startRef.current = null;
    setElapsedMs(0);
  };

  const openDialog = () => {
    setOpen(true);
    setConfirming(false);
    setPhase('previewing');
    beginTimer();
    if (!preview.isPending) preview.mutate();
  };

  const handleRefresh = () => {
    setConfirming(false);
    setPhase('previewing');
    beginTimer();
    preview.mutate();
  };

  const handleSync = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setPhase('syncing');
    beginTimer();
    runLive.mutate();
  };

  const handleClose = () => {
    // The X cancels any in-flight preview/sync (aborts the request), then closes.
    abortRef.current?.abort();
    setOpen(false);
    setConfirming(false);
    setPhase('preview');
  };

  return (
    <>
      {variant === 'sidebar' ? (
        <button
          type="button"
          aria-label="Sync shipped orders to Zoho"
          onClick={openDialog}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-label font-bold text-gray-700 ring-1 ring-inset ring-gray-200 transition-colors hover:ring-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          <RefreshCw className={`h-4 w-4 shrink-0 ${busy ? 'animate-spin text-blue-500' : 'text-gray-500'}`} />
          <span className="flex-1 text-left">Sync to Zoho</span>
          {pendingCount > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-mini font-black text-white">
              {pendingCount}
            </span>
          ) : null}
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <button
          type="button"
          aria-label="Sync shipped orders to Zoho"
          onClick={openDialog}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-caption font-bold text-gray-600 transition-colors hover:bg-gray-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin text-blue-500' : ''}`} />
          Zoho
        </button>
      )}

      <ZohoSyncDialog
        open={open}
        onClose={handleClose}
        report={report}
        phase={phase}
        elapsedMs={elapsedMs}
        confirming={confirming}
        pendingCount={pendingCount}
        onRefresh={handleRefresh}
        onSync={handleSync}
      />
    </>
  );
}
