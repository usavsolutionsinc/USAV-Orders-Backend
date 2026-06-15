'use client';

/**
 * One sidebar button → a tabbed popover that unifies the two shipped-view
 * actions that used to be separate full-width buttons:
 *   - **Sync** — push packer-scanned shipped orders to Zoho (dry-run preview →
 *     two-click live sync), via the centered {@link ZohoSyncDialog}. Gated by
 *     `integrations.zoho`.
 *   - **Report** — pick a day and print that day's carrier pickup report.
 *
 * Replaces the old split (ZohoSyncButton + PickupReportButton) so the Shipped
 * sidebar shows a single, compact control.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as Popover from '@radix-ui/react-popover';
import {
  RefreshCw,
  ChevronDown,
  Printer,
  Loader2,
  Calendar as CalendarIcon,
} from '@/components/Icons';
import { Calendar as CalendarPicker } from '@/design-system/components/Calendar';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { printPickupReportForDate } from '@/lib/shipped/printPickupReportForDate';
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

type ActionsTab = 'sync' | 'report';

interface ShippedActionsButtonProps {
  /** PST date key (yyyy-mm-dd) the report calendar opens on. Defaults to today. */
  defaultDateKey?: string;
}

export function ShippedActionsButton({ defaultDateKey }: ShippedActionsButtonProps) {
  const { has } = useAuth();
  const canZoho = has('integrations.zoho');

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ActionsTab>(canZoho ? 'sync' : 'report');

  // ── Zoho fulfillment sync (centered dialog) ────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
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
      if (isAbort(e)) return;
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
      if (isAbort(e)) return;
      setConfirming(false);
      setPhase('preview');
      toast.error(e instanceof Error ? e.message : 'Sync failed');
    },
  });

  const busy = preview.isPending || runLive.isPending;
  const pendingCount = countPending(report);

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

  const openSyncDialog = () => {
    setOpen(false);
    setDialogOpen(true);
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

  const handleDialogClose = () => {
    abortRef.current?.abort();
    setDialogOpen(false);
    setConfirming(false);
    setPhase('preview');
  };

  // ── Pickup report (inline calendar) ────────────────────────────────────────
  const [reportBusy, setReportBusy] = useState(false);
  const defaultMonth = defaultDateKey ? new Date(`${defaultDateKey}T00:00:00`) : new Date();

  const handlePickDate = async (date: Date | undefined) => {
    if (!date || reportBusy) return;
    const dateKey = format(date, 'yyyy-MM-dd');
    setOpen(false);
    setReportBusy(true);
    try {
      await printPickupReportForDate(dateKey);
    } catch (err) {
      console.warn('ShippedActionsButton: pickup report print failed', err);
    } finally {
      setReportBusy(false);
    }
  };

  const triggerBusy = busy || reportBusy;
  const tabs: ActionsTab[] = canZoho ? ['sync', 'report'] : ['report'];

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label="Shipped actions — sync to Zoho or print a pickup report"
            // Plain template literal (not cn/twMerge): the app's custom `text-label`
            // utility is misread by tailwind-merge as a color and dropped on merge.
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-label font-bold text-gray-700 ring-1 ring-inset ring-gray-200 transition-colors hover:ring-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            {triggerBusy ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
            ) : (
              <RefreshCw className="h-4 w-4 shrink-0 text-gray-500" />
            )}
            <span className="flex-1 text-left">Sync &amp; Report</span>
            {canZoho && pendingCount > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-mini font-black text-white">
                {pendingCount}
              </span>
            ) : null}
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            style={{ width: 'var(--radix-popover-trigger-width)' }}
            className="z-dropdown rounded-2xl border border-gray-200 bg-white p-3 shadow-xl ring-1 ring-black/5 focus:outline-none"
          >
            {tabs.length > 1 ? (
              <div className="mb-3 flex items-center gap-1 rounded-xl bg-gray-100 p-1">
                {tabs.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-eyebrow font-black uppercase tracking-wider transition-colors ${
                      tab === t ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t === 'sync' ? 'Sync' : 'Report'}
                  </button>
                ))}
              </div>
            ) : null}

            {tab === 'sync' && canZoho ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={openSyncDialog}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-white transition-all hover:bg-blue-700 active:scale-95 ${sectionLabel}`}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
                  Preview &amp; Sync to Zoho
                  {pendingCount > 0 ? (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/25 px-1.5 text-mini font-black">
                      {pendingCount}
                    </span>
                  ) : null}
                </button>
                <p className="px-1 text-eyebrow leading-relaxed text-gray-400">
                  Pushes each packer-scanned shipped order to Zoho as one bundle
                  (sales order → package → shipment → invoice).
                </p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-1.5 border-b border-gray-100 px-1 pb-2 text-eyebrow font-black uppercase tracking-wider text-slate-500">
                  <CalendarIcon className="h-3.5 w-3.5 text-slate-400" />
                  Print pickup report — pick a date
                  {reportBusy ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-blue-500" /> : <Printer className="ml-auto h-3.5 w-3.5 text-slate-300" />}
                </div>
                <CalendarPicker
                  mode="single"
                  onSelect={handlePickDate}
                  defaultMonth={defaultMonth}
                  disabled={{ after: new Date() }}
                />
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <ZohoSyncDialog
        open={dialogOpen}
        onClose={handleDialogClose}
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
