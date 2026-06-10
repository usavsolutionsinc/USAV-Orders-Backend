'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, Loader2, Truck, X } from '@/components/Icons';
import { framerTransition } from '@/design-system/foundations/motion-framer';
import { sectionLabel, fieldLabel, microBadge, dataValue } from '@/design-system/tokens/typography/presets';
import { TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import type { CarrierCode, NormalizedShipmentStatus } from '@/lib/shipping/types';
import type {
  CarrierSyncResult,
  CarrierSyncShipmentDetail,
  CarrierTabState,
  SyncTaskStatus,
} from '@/lib/carrier-sync/types';

export type CarrierTabsState = Record<CarrierCode, CarrierTabState>;

interface CarrierSyncDialogProps {
  open: boolean;
  onClose: () => void;
  isRunning: boolean;
  elapsedMs: number;
  onCancel?: () => void;
  carriers: CarrierTabsState;
  result?: CarrierSyncResult | null;
}

const TABS: Array<{ id: CarrierCode; label: string }> = [
  { id: 'USPS', label: 'USPS' },
  { id: 'UPS', label: 'UPS' },
  { id: 'FEDEX', label: 'FedEx' },
];

export const EMPTY_CARRIER_TABS: CarrierTabsState = {
  USPS: { status: 'idle', total: 0, rows: [] },
  UPS: { status: 'idle', total: 0, rows: [] },
  FEDEX: { status: 'idle', total: 0, rows: [] },
};

function statusDot(status: SyncTaskStatus) {
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />;
  if (status === 'done') return <Check className="w-3.5 h-3.5 text-emerald-600" />;
  if (status === 'error') return <AlertTriangle className="w-3.5 h-3.5 text-red-500" />;
  return <span className="block w-2 h-2 rounded-full bg-gray-300" />;
}

function statusLabel(status: SyncTaskStatus, summary?: string) {
  if (status === 'running') return 'Polling…';
  if (status === 'done') return summary || 'Done';
  if (status === 'error') return summary || 'Error';
  return summary || 'Queued';
}

// NormalizedShipmentStatus → short label + tone for the prev/new status chips.
const STATUS_META: Record<NormalizedShipmentStatus, { label: string; cls: string }> = {
  LABEL_CREATED: { label: 'Label', cls: 'bg-gray-50 text-gray-600 ring-gray-200' },
  ACCEPTED: { label: 'Accepted', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  IN_TRANSIT: { label: 'In transit', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  OUT_FOR_DELIVERY: { label: 'Out for delivery', cls: 'bg-violet-50 text-violet-700 ring-violet-200' },
  DELIVERED: { label: 'Delivered', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  EXCEPTION: { label: 'Exception', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  RETURNED: { label: 'Returned', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
  UNKNOWN: { label: 'Unknown', cls: 'bg-gray-50 text-gray-500 ring-gray-200' },
};

function StatusChip({ status }: { status: NormalizedShipmentStatus | null }) {
  if (!status) {
    return <span className="font-mono text-[11px] text-gray-400">—</span>;
  }
  const meta = STATUS_META[status] ?? STATUS_META.UNKNOWN;
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function kindBadge(kind: CarrierSyncShipmentDetail['kind']) {
  const map: Record<CarrierSyncShipmentDetail['kind'], string> = {
    delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    updated: 'bg-blue-50 text-blue-700 ring-blue-200',
    unchanged: 'bg-gray-50 text-gray-500 ring-gray-200',
    error: 'bg-red-50 text-red-700 ring-red-200',
  };
  return `inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${map[kind]}`;
}

function countByKind(rows: CarrierSyncShipmentDetail[], kind: CarrierSyncShipmentDetail['kind']) {
  return rows.reduce((n, r) => (r.kind === kind ? n + 1 : n), 0);
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'emerald' | 'blue' | 'gray' | 'red';
}) {
  const toneMap = {
    emerald: 'border-emerald-200 bg-emerald-50/60 text-emerald-700',
    blue: 'border-blue-200 bg-blue-50/60 text-blue-700',
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

function CarrierTab({ tab, label }: { tab: CarrierTabState; label: string }) {
  if (tab.status === 'idle') {
    return (
      <div className="flex h-full flex-col items-center justify-center py-12 text-gray-400">
        <p className={fieldLabel}>No active {label} shipments to re-poll.</p>
      </div>
    );
  }

  if (tab.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50/60 px-4 py-4">
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle className="w-4 h-4" />
          <span className={sectionLabel}>{label} sync failed</span>
        </div>
        <p className={`${fieldLabel} text-red-700`}>{tab.error || tab.summary || 'Unknown error.'}</p>
      </div>
    );
  }

  const delivered = countByKind(tab.rows, 'delivered');
  const updated = countByKind(tab.rows, 'updated');
  const unchanged = countByKind(tab.rows, 'unchanged');
  const errors = countByKind(tab.rows, 'error');
  const remaining = Math.max(0, tab.total - tab.rows.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-2">
        <SummaryStat label="Delivered" value={delivered} tone="emerald" />
        <SummaryStat label="Updated" value={updated} tone="blue" />
        <SummaryStat label="No change" value={unchanged} tone="gray" />
        <SummaryStat label="Errors" value={errors} tone="red" />
      </div>

      {tab.status === 'running' ? (
        <p className={`${fieldLabel} text-gray-500`}>
          Polling {label} · {tab.rows.length}/{tab.total} done{remaining > 0 ? ` · ${remaining} to go` : ''}…
        </p>
      ) : null}

      {tab.rows.length === 0 ? (
        <p className={`${fieldLabel} text-gray-500`}>
          {tab.status === 'running' ? `Contacting ${label}…` : 'No shipments polled.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <ShipmentTable rows={tab.rows} />
        </div>
      )}
    </div>
  );
}

function ShipmentTable({ rows }: { rows: CarrierSyncShipmentDetail[] }) {
  // Surface the rows that moved first; unchanged rows sink to the bottom.
  const order: Record<CarrierSyncShipmentDetail['kind'], number> = {
    delivered: 0,
    updated: 1,
    error: 2,
    unchanged: 3,
  };
  const sorted = [...rows].sort((a, b) => order[a.kind] - order[b.kind]);
  return (
    <div className="max-h-[40vh] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-gray-50 text-left shadow-[0_1px_0_0_rgb(229_231_235)]">
          <tr className="text-[10px] uppercase tracking-wide text-gray-500">
            <th className="px-3 py-2 font-semibold">Tracking</th>
            <th className="px-3 py-2 font-semibold">Was</th>
            <th className="px-3 py-2 font-semibold">Now</th>
            <th className="px-3 py-2 font-semibold text-right">New events</th>
            <th className="px-3 py-2 font-semibold text-right">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((row) => (
            <tr key={row.shipmentId} className="hover:bg-gray-50/60">
              <td className="px-3 py-2 align-top">
                {row.tracking ? (
                  <TrackingChip value={row.tracking} display={getLast4(row.tracking)} />
                ) : (
                  <span className="font-mono text-xs text-gray-400">#{row.shipmentId}</span>
                )}
              </td>
              <td className="px-3 py-2 align-top">
                <StatusChip status={row.previousStatus} />
              </td>
              <td className="px-3 py-2 align-top">
                {row.kind === 'error' ? (
                  <span className="text-[11px] text-red-600" title={row.error}>
                    {row.error ? row.error.slice(0, 40) : 'Poll failed'}
                  </span>
                ) : (
                  <StatusChip status={row.newStatus} />
                )}
              </td>
              <td className="px-3 py-2 text-right align-top tabular-nums text-gray-700">
                {row.kind === 'error' ? '—' : row.eventsInserted || '—'}
              </td>
              <td className="px-3 py-2 text-right align-top">
                <span className={kindBadge(row.kind)}>{row.kind === 'unchanged' ? 'no change' : row.kind}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CarrierSyncDialog({
  open,
  onClose,
  isRunning,
  elapsedMs,
  onCancel,
  carriers,
  result,
}: CarrierSyncDialogProps) {
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const [activeTab, setActiveTab] = useState<CarrierCode>('USPS');

  useEffect(() => {
    setPortalNode(document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isRunning) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isRunning, onClose]);

  const tabBadges = useMemo(() => {
    const out = {} as Record<CarrierCode, { status: SyncTaskStatus; count: number }>;
    for (const { id } of TABS) {
      const tab = carriers[id];
      out[id] = {
        status: tab.status,
        count: countByKind(tab.rows, 'delivered') + countByKind(tab.rows, 'updated'),
      };
    }
    return out;
  }, [carriers]);

  if (!portalNode || !open) return null;

  const overlay = (
    <motion.div
      key="carrier-sync-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={framerTransition.overlayScrim}
      className="fixed inset-0 z-panelPopover flex items-center justify-center bg-gray-950/40 px-4 py-6"
      onClick={() => {
        if (!isRunning) onClose();
      }}
    >
      <motion.div
        key="carrier-sync-card"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320, mass: 0.55 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_80px_-20px_rgba(15,23,42,0.35)] ring-1 ring-gray-200"
      >
        <header className="flex items-start gap-3 border-b border-gray-200 px-5 py-3.5">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Truck className={`h-4 w-4 text-blue-600 ${isRunning ? 'animate-pulse' : ''}`} />
            <div className="min-w-0">
              <p className={`${microBadge} text-gray-500`}>Carrier Sync</p>
              <h2 className={`${sectionLabel} text-gray-900 mt-0.5`}>
                {isRunning ? 'Re-polling carrier tracking' : result?.throttled ? 'Showing latest tracking' : 'Sync complete'}
              </h2>
            </div>
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
            {isRunning && onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200 transition hover:bg-red-100"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              disabled={isRunning}
              className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <nav className="flex items-end gap-1 border-b border-gray-200 px-3 pt-2">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const meta = tabBadges[tab.id];
            const total = carriers[tab.id].total;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-semibold transition ${
                  isActive ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <span>{tab.label}</span>
                <span className="inline-flex h-4 w-4 items-center justify-center">{statusDot(meta.status)}</span>
                {meta.count > 0 ? (
                  <span className="ml-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-gray-700">
                    {meta.count}
                  </span>
                ) : total > 0 ? (
                  <span className="ml-0.5 rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-gray-400">
                    {total}
                  </span>
                ) : null}
                {isActive ? (
                  <motion.span
                    layoutId="carriersync-active-underline"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-600"
                    transition={{ type: 'spring', damping: 30, stiffness: 380 }}
                  />
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={framerTransition.overlayScrim}
            >
              <CarrierTab tab={carriers[activeTab]} label={TABS.find((t) => t.id === activeTab)!.label} />
            </motion.div>
          </AnimatePresence>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-2.5">
          <div className="flex items-center gap-3 text-xs text-gray-600">
            {TABS.map((tab, i) => (
              <span key={tab.id} className="inline-flex items-center gap-1.5">
                {i > 0 ? <span className="text-gray-300">·</span> : null}
                {statusDot(carriers[tab.id].status)}{' '}
                <span>
                  {tab.label} {statusLabel(carriers[tab.id].status, carriers[tab.id].summary)}
                </span>
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isRunning}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {isRunning ? 'Running…' : 'Close'}
          </button>
        </footer>
      </motion.div>
    </motion.div>
  );

  return createPortal(overlay, portalNode);
}
