'use client';

/**
 * Manual "Sync shipped orders to Zoho" control for the dashboard shipped view.
 *
 * Opening the popover runs a DRY-RUN preview (POST /api/zoho/fulfillment-sync,
 * dryRun:true) so the user can see exactly what will be synced — and that each
 * shipped order is pushed to Zoho as one bundle created together:
 *
 *     Sales order → Package → Shipment → Invoice
 *
 * "Sync now" (two-click confirm) runs it live. Gated by the `integrations.zoho`
 * permission, matching the API route's guard.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import {
  RefreshCw,
  Info,
  X,
  FileText,
  Package,
  Truck,
  AlertCircle,
  Loader2,
  ChevronDown,
} from '@/components/Icons';
import { Can } from '@/components/auth/Can';
import { toast } from '@/lib/toast';

interface OrderActionResult {
  referenceNumber: string;
  status: 'completed' | 'error' | 'skipped' | 'dry_run';
  delivered: boolean;
  actions: string[];
  error?: string;
}

interface SyncReport {
  dryRun: boolean;
  invoiceMode: string;
  scanned: number;
  completed: number;
  skipped: number;
  errored: number;
  results: OrderActionResult[];
  errors: string[];
}

const PREVIEW_LIMIT = 50;

async function postSync(body: Record<string, unknown>): Promise<SyncReport> {
  const res = await fetch('/api/zoho/fulfillment-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `Zoho sync failed (HTTP ${res.status})`);
  }
  return data.report as SyncReport;
}

const pendingResults = (report: SyncReport | null) =>
  report ? report.results.filter((r) => r.status === 'dry_run' || r.status === 'completed' || r.status === 'error') : [];

export function ZohoSyncButton({ variant = 'sidebar' }: { variant?: 'sidebar' | 'chip' }) {
  return (
    <Can perm="integrations.zoho">
      <ZohoSyncButtonInner variant={variant} />
    </Can>
  );
}

function ZohoSyncButtonInner({ variant }: { variant: 'sidebar' | 'chip' }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [confirming, setConfirming] = useState(false);

  const preview = useMutation({
    mutationFn: () => postSync({ dryRun: true, mode: 'delta', limit: PREVIEW_LIMIT }),
    onSuccess: (r) => {
      setReport(r);
      setConfirming(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Preview failed'),
  });

  const runLive = useMutation({
    mutationFn: () => postSync({ dryRun: false, mode: 'delta', limit: PREVIEW_LIMIT }),
    onSuccess: (r) => {
      setReport(r);
      setConfirming(false);
      toast.success(
        `Synced ${r.completed} order${r.completed === 1 ? '' : 's'} to Zoho` +
          (r.errored ? ` · ${r.errored} failed` : ''),
      );
    },
    onError: (e: unknown) => {
      setConfirming(false);
      toast.error(e instanceof Error ? e.message : 'Sync failed');
    },
  });

  const busy = preview.isPending || runLive.isPending;
  const pending = pendingResults(report);
  const pendingCount = report ? report.results.filter((r) => r.status === 'dry_run').length : 0;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    setConfirming(false);
    if (next && !preview.isPending) preview.mutate();
  };

  const handleSyncClick = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    runLive.mutate();
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        {variant === 'sidebar' ? (
          <button
            type="button"
            aria-label="Sync shipped orders to Zoho"
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
            className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-caption font-bold text-gray-600 transition-colors hover:bg-gray-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin text-blue-500' : ''}`} />
            Zoho
          </button>
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align={variant === 'sidebar' ? 'start' : 'end'}
          sideOffset={6}
          className="z-[60] w-80 rounded-xl border border-gray-200 bg-white p-3 shadow-lg ring-1 ring-black/5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Info className="h-4 w-4 text-blue-500" />
              <h3 className="text-sm font-semibold text-gray-800">Sync shipped orders to Zoho</h3>
            </div>
            <Popover.Close
              className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Popover.Close>
          </div>

          <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
            Each shipped order is pushed to Zoho as one bundle, created together:
          </p>

          <div className="mt-2 flex items-center justify-between">
            <ChainStep icon={<FileText className="h-3.5 w-3.5" />} label="Sales order" />
            <Arrow />
            <ChainStep icon={<Package className="h-3.5 w-3.5" />} label="Package" />
            <Arrow />
            <ChainStep icon={<Truck className="h-3.5 w-3.5" />} label="Shipment" />
            <Arrow />
            <ChainStep icon={<FileText className="h-3.5 w-3.5" />} label="Invoice" />
          </div>

          <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/60 p-2">
            {preview.isPending ? (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking what’s pending…
              </div>
            ) : report ? (
              <PreviewSummary report={report} pending={pending} pendingCount={pendingCount} />
            ) : (
              <div className="text-xs text-gray-500">No preview yet.</div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => preview.mutate()}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${preview.isPending ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button
              type="button"
              onClick={handleSyncClick}
              disabled={busy || pendingCount === 0}
              className={`inline-flex h-8 items-center gap-1 rounded-md px-3 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                confirming ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {runLive.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {confirming
                ? 'Confirm sync'
                : pendingCount > 0
                  ? `Sync ${pendingCount} now`
                  : 'Sync now'}
            </button>
          </div>

          <p className="mt-2 text-[10px] leading-snug text-gray-400">
            Preview is a dry run (no changes). “Sync now” creates the records in Zoho.
            {report ? ` Invoice mode: ${report.invoiceMode}.` : ''}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ChainStep({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex flex-col items-center gap-0.5 rounded-md bg-white px-1.5 py-1 ring-1 ring-gray-200">
      <span className="text-gray-500">{icon}</span>
      <span className="text-[9px] font-medium text-gray-500">{label}</span>
    </span>
  );
}

function Arrow() {
  return <span className="px-0.5 text-gray-300">→</span>;
}

function PreviewSummary({
  report,
  pending,
  pendingCount,
}: {
  report: SyncReport;
  pending: OrderActionResult[];
  pendingCount: number;
}) {
  if (report.scanned === 0) {
    return (
      <div className="text-xs text-gray-500">
        Nothing pending — all recent shipped orders are already in Zoho.
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-3 text-xs">
        <span className="font-semibold text-gray-700">
          {pendingCount} pending
        </span>
        {report.skipped > 0 ? (
          <span className="text-gray-400">{report.skipped} already synced</span>
        ) : null}
        {report.errored > 0 ? (
          <span className="inline-flex items-center gap-1 text-rose-600">
            <AlertCircle className="h-3 w-3" />
            {report.errored}
          </span>
        ) : null}
      </div>
      {pending.length > 0 ? (
        <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
          {pending.map((r) => (
            <li key={r.referenceNumber} className="rounded border border-gray-100 bg-white px-1.5 py-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[11px] text-gray-700">{r.referenceNumber}</span>
                <span className={`text-[10px] ${r.status === 'error' ? 'text-rose-600' : 'text-gray-400'}`}>
                  {r.delivered ? 'delivered' : r.status === 'dry_run' ? 'pending' : r.status}
                </span>
              </div>
              {r.error ? <p className="mt-0.5 text-[10px] text-rose-500">{r.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
