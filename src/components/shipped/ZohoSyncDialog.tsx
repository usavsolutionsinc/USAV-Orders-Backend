'use client';

/**
 * Rich "what was synced to Zoho" modal for the dashboard shipped view.
 *
 * Mirrors the Google Sheets transfer popover (OrderSyncDialog): summary stat
 * cards + a scrollable detail table showing each packer-scanned shipped order
 * that was pushed to a Zoho sales order (→ package → shipment → invoice).
 *
 * It is a presentational component — the ZohoSyncButton owns the data fetching
 * (dry-run preview + live run) and feeds the report/phase/elapsed in as props.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Loader2,
  X,
  RefreshCw,
  FileText,
  Package,
  Truck,
  User,
} from '@/components/Icons';
import { framerTransition } from '@/design-system/foundations/motion-framer';
import { sectionLabel, fieldLabel, microBadge, dataValue } from '@/design-system/tokens/typography/presets';
import { TrackingChip, OrderIdChip, SkuScanRefChip, getLast4 } from '@/components/ui/CopyChip';

// ─── Shared report shape (mirrors the API's SyncRunReport / OrderSyncResult) ──

export interface ZohoSyncLine {
  sku: string | null;
  quantity: number;
  productTitle: string | null;
  itemNumber: string | null;
}

export interface ZohoSyncPacker {
  id: number | null;
  name: string | null;
  packedAt: string | null;
}

export interface ZohoOrderResult {
  referenceNumber: string;
  status: 'completed' | 'error' | 'skipped' | 'dry_run';
  delivered: boolean;
  channel: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  orderDate: string | null;
  deliveredAt: string | null;
  packer: ZohoSyncPacker | null;
  lines: ZohoSyncLine[];
  actions: string[];
  error?: string;
}

export interface ZohoSyncReport {
  dryRun: boolean;
  invoiceMode: string;
  scanned: number;
  completed: number;
  skipped: number;
  errored: number;
  results: ZohoOrderResult[];
  errors: string[];
}

export type ZohoSyncPhase = 'previewing' | 'preview' | 'syncing' | 'done';

interface ZohoSyncDialogProps {
  open: boolean;
  onClose: () => void;
  report: ZohoSyncReport | null;
  phase: ZohoSyncPhase;
  elapsedMs: number;
  confirming: boolean;
  pendingCount: number;
  onRefresh: () => void;
  onSync: () => void;
}

// ─── Small presentational helpers ─────────────────────────────────────────────

/** Best available date for a synced order — when the packer scanned it, else
 *  delivered/order date — formatted month + day only (e.g. "Jun 3"). */
function syncRowDate(r: ZohoOrderResult): string {
  const raw = r.packer?.packedAt || r.deliveredAt || r.orderDate;
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statusBadge(status: ZohoOrderResult['status'], delivered: boolean) {
  const map: Record<ZohoOrderResult['status'], { label: string; cls: string }> = {
    completed: { label: delivered ? 'synced · delivered' : 'synced', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
    dry_run: { label: 'pending', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
    skipped: { label: 'already synced', cls: 'bg-gray-50 text-gray-600 ring-gray-200' },
    error: { label: 'error', cls: 'bg-red-50 text-red-700 ring-red-200' },
  };
  const { label, cls } = map[status];
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${cls}`}>
      {label}
    </span>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'blue' | 'emerald' | 'gray' | 'red';
}) {
  const toneMap = {
    blue: 'border-blue-200 bg-blue-50/60 text-blue-700',
    emerald: 'border-emerald-200 bg-emerald-50/60 text-emerald-700',
    gray: 'border-gray-200 bg-gray-50/60 text-gray-700',
    red: 'border-red-200 bg-red-50/60 text-red-700',
  } as const;
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneMap[tone]}`}>
      <p className={microBadge}>{label}</p>
      <p className={`${dataValue} mt-0.5 tabular-nums text-xl`}>{value}</p>
    </div>
  );
}

function ChainStep({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-1 ring-1 ring-gray-200">
      <span className="text-gray-500">{icon}</span>
      <span className="text-[10px] font-medium text-gray-600">{label}</span>
    </span>
  );
}

function DetailTable({ rows }: { rows: ZohoOrderResult[] }) {
  return (
    <div className="max-h-[42vh] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-gray-50 text-left shadow-[0_1px_0_0_rgb(229_231_235)]">
          <tr className="text-[10px] uppercase tracking-wide text-gray-500">
            <th className="px-3 py-2 font-semibold">Date</th>
            <th className="px-3 py-2 font-semibold">Product</th>
            <th className="px-3 py-2 font-semibold">Packer</th>
            <th className="px-3 py-2 font-semibold">Order</th>
            <th className="px-3 py-2 font-semibold">SKU</th>
            <th className="px-3 py-2 font-semibold">Tracking</th>
            <th className="px-3 py-2 font-semibold text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => {
            const first = r.lines[0];
            const extra = r.lines.length - 1;
            return (
              <tr key={r.referenceNumber} className="hover:bg-gray-50/60">
                <td className="px-3 py-2 align-top text-xs tabular-nums text-gray-600 whitespace-nowrap">
                  {syncRowDate(r)}
                </td>
                <td className="px-3 py-2 align-top text-gray-700">
                  {first?.productTitle || <span className="text-amber-700">Unknown product</span>}
                  {extra > 0 ? (
                    <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                      +{extra} more
                    </span>
                  ) : null}
                  {r.error ? <div className="mt-0.5 text-[10px] text-red-500">{r.error}</div> : null}
                </td>
                <td className="px-3 py-2 align-top text-xs text-gray-700">
                  {r.packer?.name ? (
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3 text-gray-400" />
                      {r.packer.name}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  {r.referenceNumber ? (
                    <OrderIdChip value={r.referenceNumber} display={getLast4(r.referenceNumber)} />
                  ) : (
                    <span className="font-mono text-xs text-gray-400">—</span>
                  )}
                  {r.channel ? (
                    <div className="mt-0.5 pl-1.5 text-[10px] font-normal uppercase tracking-wide text-gray-400">
                      {r.channel}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 align-top">
                  {first?.sku || first?.itemNumber ? (
                    <SkuScanRefChip
                      value={(first?.sku || first?.itemNumber) as string}
                      display={getLast4(first?.sku || first?.itemNumber)}
                    />
                  ) : (
                    <span className="font-mono text-xs text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  {r.trackingNumber ? (
                    <TrackingChip value={r.trackingNumber} display={getLast4(r.trackingNumber)} />
                  ) : (
                    <span className="font-mono text-xs text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right align-top">{statusBadge(r.status, r.delivered)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────────

export function ZohoSyncDialog({
  open,
  onClose,
  report,
  phase,
  elapsedMs,
  confirming,
  pendingCount,
  onRefresh,
  onSync,
}: ZohoSyncDialogProps) {
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalNode(document.body);
  }, []);

  const busy = phase === 'previewing' || phase === 'syncing';

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!portalNode || !open) return null;

  const title =
    phase === 'syncing'
      ? 'Syncing shipped orders to Zoho'
      : phase === 'done'
        ? 'Sync complete'
        : phase === 'previewing'
          ? 'Checking what’s pending'
          : 'Ready to sync';

  const synced = report?.completed ?? 0;
  const skipped = report?.skipped ?? 0;
  const errored = report?.errored ?? 0;
  const noRows = !report || report.results.length === 0;

  const overlay = (
    <motion.div
      key="zoho-sync-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={framerTransition.overlayScrim}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-gray-950/40 px-4 py-6"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <motion.div
        key="zoho-sync-card"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320, mass: 0.55 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_80px_-20px_rgba(15,23,42,0.35)] ring-1 ring-gray-200"
      >
        <header className="flex items-start gap-3 border-b border-gray-200 px-5 py-3.5">
          <div className="flex-1 min-w-0">
            <p className={`${microBadge} text-gray-500`}>Zoho Fulfillment Sync</p>
            <h2 className={`${sectionLabel} text-gray-900 mt-0.5`}>{title}</h2>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <motion.span
              key={Math.floor(elapsedMs / 100)}
              initial={{ opacity: 0.4 }}
              animate={{ opacity: 1 }}
              className="text-caption font-mono font-semibold text-blue-600 tabular-nums"
            >
              {(elapsedMs / 1000).toFixed(1)}s
            </motion.span>
            <button
              type="button"
              onClick={onClose}
              className={`rounded-lg p-1.5 transition ${
                busy
                  ? 'text-red-600 hover:bg-red-50 hover:text-red-700'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
              aria-label={busy ? 'Cancel sync' : 'Close'}
              title={busy ? 'Cancel' : 'Close'}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 bg-gray-50/60 px-5 py-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Each order →</span>
          <ChainStep icon={<FileText className="h-3.5 w-3.5" />} label="Sales order" />
          <span className="text-gray-300">→</span>
          <ChainStep icon={<Package className="h-3.5 w-3.5" />} label="Package" />
          <span className="text-gray-300">→</span>
          <ChainStep icon={<Truck className="h-3.5 w-3.5" />} label="Shipment" />
          {report && report.invoiceMode !== 'none' ? (
            <>
              <span className="text-gray-300">→</span>
              <ChainStep icon={<FileText className="h-3.5 w-3.5" />} label="Invoice" />
            </>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase === 'previewing' && noRows ? (
            <div className="flex items-center justify-center gap-2 py-12 text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className={fieldLabel}>Checking what’s pending…</span>
            </div>
          ) : report && report.scanned === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-gray-500">
              <Check className="h-6 w-6 text-emerald-500" />
              <p className={fieldLabel}>Nothing pending — all recent shipped orders are already in Zoho.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-4 gap-2">
                <SummaryStat label="Pending" value={pendingCount} tone="blue" />
                <SummaryStat label="Synced" value={synced} tone="emerald" />
                <SummaryStat label="Already synced" value={skipped} tone="gray" />
                <SummaryStat label="Errored" value={errored} tone="red" />
              </div>

              {report && report.errors.length > 0 ? (
                <div className="rounded-xl border border-red-200 bg-red-50/60 px-3 py-2.5">
                  <p className={`${microBadge} text-red-700`}>
                    {report.errors.length} order{report.errors.length === 1 ? '' : 's'} failed
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {report.errors.slice(0, 4).map((e, i) => (
                      <li key={i} className="text-[11px] text-red-600">
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <AnimatePresence mode="wait">
                <motion.div
                  key={`${phase}:${report?.results.length ?? 0}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={framerTransition.overlayScrim}
                >
                  {noRows ? (
                    <p className={`${fieldLabel} text-gray-500`}>No orders to show.</p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      <DetailTable rows={report!.results} />
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-2.5">
          <p className="text-[10px] leading-snug text-gray-400">
            {report?.dryRun !== false
              ? 'Preview is a dry run (no changes).'
              : 'Records created in Zoho.'}
            {report ? ` Invoice mode: ${report.invoiceMode}.` : ''}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${phase === 'previewing' ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button
              type="button"
              onClick={onSync}
              disabled={busy || pendingCount === 0}
              className={`inline-flex h-8 items-center gap-1 rounded-md px-3 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                confirming ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {phase === 'syncing' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {confirming ? 'Confirm sync' : pendingCount > 0 ? `Sync ${pendingCount} now` : 'Sync now'}
            </button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  );

  return createPortal(overlay, portalNode);
}
