'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, Loader2, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { framerTransition } from '@/design-system/foundations/motion-framer';
import { sectionLabel, fieldLabel, microBadge, dataValue } from '@/design-system/tokens/typography/presets';
import { TrackingChip, OrderIdChip, SkuScanRefChip, getLast4 } from '@/components/ui/CopyChip';
import type {
  ExceptionsTabState,
  OrderExceptionResolutionDetail,
  SyncTaskStatus,
  TransferOrderDetail,
  TransferTabState,
} from '@/lib/orders-sync/types';

interface OrderSyncDialogProps {
  open: boolean;
  onClose: () => void;
  isRunning: boolean;
  elapsedMs: number;
  onCancel?: () => void;
  sheets: TransferTabState;
  ecwid: TransferTabState;
  exceptions: ExceptionsTabState;
}

type TabId = 'sheets' | 'ecwid' | 'exceptions';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'sheets', label: 'Google Sheets' },
  { id: 'ecwid', label: 'Ecwid Direct' },
  { id: 'exceptions', label: 'Resolved Exceptions' },
];

function statusDot(status: SyncTaskStatus) {
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />;
  if (status === 'done') return <Check className="w-3.5 h-3.5 text-emerald-600" />;
  if (status === 'error') return <AlertTriangle className="w-3.5 h-3.5 text-red-500" />;
  return <span className="block w-2 h-2 rounded-full bg-surface-strong" />;
}

function statusLabel(status: SyncTaskStatus, summary?: string) {
  if (status === 'running') return 'Running…';
  if (status === 'done') return summary || 'Done';
  if (status === 'error') return summary || 'Error';
  return summary || 'Queued';
}

function badge(kind: 'inserted' | 'updated' | 'deleted' | 'unknown' | 'resolved' | 'open') {
  const map: Record<string, string> = {
    inserted: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    updated: 'bg-blue-50 text-blue-700 ring-blue-200',
    deleted: 'bg-surface-canvas text-text-muted ring-border-soft',
    unknown: 'bg-amber-50 text-amber-700 ring-amber-200',
    resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    open: 'bg-red-50 text-red-700 ring-red-200',
  };
  return `inline-flex items-center rounded-md px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide ring-1 ring-inset ${map[kind]}`;
}

function TransferTab({ tab, label }: { tab: TransferTabState; label: string }) {
  const details = tab.details;
  const totalInserted = tab.inserted ?? details?.inserted.length ?? 0;
  const totalUpdated = tab.updated ?? details?.updated.length ?? 0;
  const totalDeleted = tab.deleted ?? details?.deleted.length ?? 0;
  const unknownTitles = details?.unknownTitle ?? [];

  if (tab.status === 'idle') {
    return (
      <div className="flex h-full flex-col items-center justify-center py-12 text-text-faint">
        <p className={fieldLabel}>{label} sync hasn’t started yet.</p>
      </div>
    );
  }

  if (tab.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50/60 px-4 py-4">
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle className="w-4 h-4" />
          <span className={sectionLabel}>{label} failed</span>
        </div>
        <p className={`${fieldLabel} text-red-700`}>{tab.error || tab.summary || 'Unknown error.'}</p>
      </div>
    );
  }

  const noRows = !details || (
    totalInserted === 0 && totalUpdated === 0 && totalDeleted === 0
  );

  // Rollup: when updates dominate, show *where* those existing orders
  // originally came from. Answers "why is everything updated instead of
  // inserted?" — usually it's because Ecwid or a prior sheet run already
  // brought them in.
  const updateProvenance = (() => {
    const updated = details?.updated ?? [];
    if (updated.length === 0 || totalInserted >= updated.length) return null;
    const bySource = new Map<string, number>();
    for (const row of updated) {
      const key = (row.existingAccountSource || 'unknown').toLowerCase();
      bySource.set(key, (bySource.get(key) ?? 0) + 1);
    }
    const sorted = Array.from(bySource.entries()).sort((a, b) => b[1] - a[1]);
    return sorted;
  })();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        <SummaryStat label="Inserted" value={totalInserted} tone="emerald" />
        <SummaryStat label="Updated" value={totalUpdated} tone="blue" />
        <SummaryStat label="Removed duplicates" value={totalDeleted} tone="gray" />
      </div>

      {updateProvenance && updateProvenance.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2.5">
          <p className={`${microBadge} text-blue-700`}>Why so many updates?</p>
          <p className={`${fieldLabel} text-blue-700 mt-0.5 normal-case tracking-normal`}>
            These orders already existed in the database — the sheet only filled in blanks. Originally inserted by:{' '}
            {updateProvenance.map(([src, n], i) => (
              <span key={src}>
                {i > 0 ? ', ' : ''}
                <span className="font-semibold">{src}</span> ({n})
              </span>
            ))}
            .
          </p>
        </div>
      )}

      {unknownTitles.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5">
          <p className={`${microBadge} text-amber-700`}>
            {unknownTitles.length} row{unknownTitles.length === 1 ? '' : 's'} still missing a product title
          </p>
          <p className={`${fieldLabel} text-amber-700 mt-0.5`}>
            These will appear as “Unknown Product” in the dashboard until the SKU is added to the catalog.
          </p>
        </div>
      )}

      {tab.status === 'running' && noRows ? (
        <p className={`${fieldLabel} text-text-soft`}>Waiting for {label} to finish…</p>
      ) : noRows ? (
        <p className={`${fieldLabel} text-text-soft`}>No changes — already up to date.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-soft">
          <DetailTable
            rows={[
              ...(details?.inserted ?? []).map((r) => ({ kind: 'inserted' as const, row: r })),
              ...(details?.updated ?? []).map((r) => ({ kind: 'updated' as const, row: r })),
              ...(details?.deleted ?? []).map((r) => ({ kind: 'deleted' as const, row: r })),
            ]}
          />
        </div>
      )}
    </div>
  );
}

function ExceptionsTab({ tab }: { tab: ExceptionsTabState }) {
  if (tab.status === 'idle') {
    return (
      <div className="flex h-full flex-col items-center justify-center py-12 text-text-faint">
        <p className={fieldLabel}>Exceptions sync runs after Google Sheets and Ecwid finish.</p>
      </div>
    );
  }

  if (tab.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50/60 px-4 py-4">
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle className="w-4 h-4" />
          <span className={sectionLabel}>Exceptions sync failed</span>
        </div>
        <p className={`${fieldLabel} text-red-700`}>{tab.error || tab.summary || 'Unknown error.'}</p>
      </div>
    );
  }

  const resolved = tab.resolved ?? [];
  const stillOpen = tab.stillOpen ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <SummaryStat label="Resolved" value={resolved.length || (tab.matched ?? 0)} tone="emerald" />
        <SummaryStat label="Still open" value={stillOpen.length} tone="red" />
      </div>

      {resolved.length === 0 && stillOpen.length === 0 ? (
        <p className={`${fieldLabel} text-text-soft`}>
          {tab.status === 'running' ? 'Looking for matches…' : 'No open exceptions to process.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-soft">
          <ExceptionTable resolved={resolved} stillOpen={stillOpen} />
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'blue' | 'gray' | 'red' }) {
  const toneMap = {
    emerald: 'border-emerald-200 bg-emerald-50/60 text-emerald-700',
    blue: 'border-blue-200 bg-blue-50/60 text-blue-700',
    gray: 'border-border-soft bg-surface-canvas/60 text-text-muted',
    red: 'border-red-200 bg-red-50/60 text-red-700',
  } as const;
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneMap[tone]}`}>
      <p className={`${microBadge}`}>{label}</p>
      <p className={`${dataValue} mt-0.5 tabular-nums text-xl`}>{value}</p>
    </div>
  );
}

function formatExistingProvenance(row: TransferOrderDetail): string | null {
  const src = row.existingAccountSource?.trim();
  const at = row.existingCreatedAt ? new Date(row.existingCreatedAt) : null;
  const datePart = at && !Number.isNaN(at.getTime())
    ? at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  if (src && datePart) return `from ${src} · ${datePart}`;
  if (src) return `from ${src}`;
  if (datePart) return `first seen ${datePart}`;
  return null;
}

function DetailTable({
  rows,
}: {
  rows: Array<{ kind: 'inserted' | 'updated' | 'deleted'; row: TransferOrderDetail }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="max-h-[40vh] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-surface-canvas text-left shadow-[0_1px_0_0_rgb(229_231_235)]">
          <tr className="text-micro uppercase tracking-wide text-text-soft">
            <th className="px-3 py-2 font-semibold">Order</th>
            <th className="px-3 py-2 font-semibold">Product</th>
            <th className="px-3 py-2 font-semibold">SKU</th>
            <th className="px-3 py-2 font-semibold">Tracking</th>
            <th className="px-3 py-2 font-semibold text-right">Kind</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-hairline">
          {rows.map(({ kind, row }, i) => {
            const provenance = kind !== 'inserted' ? formatExistingProvenance(row) : null;
            return (
              <tr key={`${kind}:${row.orderId}:${i}`} className="hover:bg-surface-canvas/60">
                <td className="px-3 py-2 align-top">
                  {row.orderId ? (
                    <OrderIdChip value={row.orderId} display={getLast4(row.orderId)} />
                  ) : (
                    <span className="font-mono text-xs text-text-faint">—</span>
                  )}
                  {provenance ? (
                    <div className="mt-0.5 pl-1.5 text-micro font-normal text-text-faint">{provenance}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-text-muted align-top">
                  {row.productTitle || (
                    <span className="text-amber-700">Unknown Product</span>
                  )}
                  {row.titleSource && row.titleSource !== 'sheet' && row.productTitle ? (
                    <span className="ml-1 text-micro uppercase tracking-wide text-text-faint">
                      · {row.titleSource.replace('_', ' ')}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 align-top">
                  {row.sku || row.itemNumber ? (
                    <SkuScanRefChip
                      value={(row.sku || row.itemNumber) as string}
                      display={getLast4(row.sku || row.itemNumber)}
                    />
                  ) : (
                    <span className="font-mono text-xs text-text-faint">—</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  {row.tracking ? (
                    <TrackingChip value={row.tracking} display={getLast4(row.tracking)} />
                  ) : (
                    <span className="font-mono text-xs text-text-faint">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right align-top">
                  <span className={badge(kind)}>{kind}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExceptionTable({
  resolved,
  stillOpen,
}: {
  resolved: OrderExceptionResolutionDetail[];
  stillOpen: OrderExceptionResolutionDetail[];
}) {
  const rows = [
    ...resolved.map((row) => ({ kind: 'resolved' as const, row })),
    ...stillOpen.map((row) => ({ kind: 'open' as const, row })),
  ];
  return (
    <div className="max-h-[40vh] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-surface-canvas text-left shadow-[0_1px_0_0_rgb(229_231_235)]">
          <tr className="text-micro uppercase tracking-wide text-text-soft">
            <th className="px-3 py-2 font-semibold">Exception</th>
            <th className="px-3 py-2 font-semibold">Tracking</th>
            <th className="px-3 py-2 font-semibold">Source</th>
            <th className="px-3 py-2 font-semibold">Matched order</th>
            <th className="px-3 py-2 font-semibold text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-hairline">
          {rows.map(({ kind, row }) => (
            <tr key={`${kind}:${row.exceptionId}`} className="hover:bg-surface-canvas/60">
              <td className="px-3 py-2 font-mono text-xs text-text-default">#{row.exceptionId}</td>
              <td className="px-3 py-2 font-mono text-xs text-text-muted">{row.tracking || '—'}</td>
              <td className="px-3 py-2 text-xs text-text-muted">{row.sourceStation || '—'}</td>
              <td className="px-3 py-2 font-mono text-xs text-text-muted">
                {row.matchedOrderId != null ? `#${row.matchedOrderId}` : '—'}
              </td>
              <td className="px-3 py-2 text-right">
                <span className={badge(kind)}>{kind === 'resolved' ? 'resolved' : 'still open'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OrderSyncDialog({
  open,
  onClose,
  isRunning,
  elapsedMs,
  onCancel,
  sheets,
  ecwid,
  exceptions,
}: OrderSyncDialogProps) {
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('sheets');

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

  const tabBadges: Record<TabId, { status: SyncTaskStatus; count: number }> = useMemo(() => ({
    sheets: {
      status: sheets.status,
      count: (sheets.details?.inserted.length ?? sheets.inserted ?? 0)
        + (sheets.details?.updated.length ?? sheets.updated ?? 0),
    },
    ecwid: {
      status: ecwid.status,
      count: (ecwid.details?.inserted.length ?? ecwid.inserted ?? 0)
        + (ecwid.details?.updated.length ?? ecwid.updated ?? 0),
    },
    exceptions: {
      status: exceptions.status,
      count: exceptions.resolved?.length ?? exceptions.matched ?? 0,
    },
  }), [sheets, ecwid, exceptions]);

  // Render nothing at all when closed — avoids AnimatePresence + layoutId
  // edge cases that left orphaned DOM nodes blocking scroll inside the page's
  // inner scroll containers. We trade a fade-out for reliability.
  if (!portalNode || !open) return null;

  const overlay = (
    <motion.div
      key="order-sync-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={framerTransition.overlayScrim}
      className="fixed inset-0 z-panelPopover flex items-center justify-center bg-scrim/40 px-4 py-6"
      onClick={() => {
        if (!isRunning) onClose();
      }}
    >
      <motion.div
        key="order-sync-card"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320, mass: 0.55 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-surface-card shadow-[0_24px_80px_-20px_rgba(15,23,42,0.35)] ring-1 ring-border-soft"
      >
            <header className="flex items-start gap-3 border-b border-border-soft px-5 py-3.5">
              <div className="flex-1 min-w-0">
                <p className={`${microBadge} text-text-soft`}>Order Sync</p>
                <h2 className={`${sectionLabel} text-text-default mt-0.5`}>
                  {isRunning ? 'Importing latest orders' : 'Import complete'}
                </h2>
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
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onCancel}
                    className="bg-red-50 text-red-700 ring-red-200 ring-inset hover:bg-red-100"
                  >
                    Cancel
                  </Button>
                ) : null}
                <IconButton
                  icon={<X className="w-4 h-4" />}
                  ariaLabel="Close"
                  onClick={onClose}
                  disabled={isRunning}
                  className="rounded-lg p-1.5 hover:bg-surface-sunken"
                />
              </div>
            </header>

            <nav className="flex items-end gap-1 border-b border-border-soft px-3 pt-2">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                const meta = tabBadges[tab.id];
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    /* ds-raw-button: segmented tab with animated layoutId underline — not a Button shape */
                    className={`ds-raw-button relative flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-semibold transition ${
                      isActive ? 'text-text-default' : 'text-text-soft hover:text-text-muted'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className="inline-flex h-4 w-4 items-center justify-center">
                      {statusDot(meta.status)}
                    </span>
                    {meta.count > 0 ? (
                      <span className="ml-0.5 rounded bg-surface-sunken px-1.5 py-0.5 text-micro font-bold tabular-nums text-text-muted">
                        {meta.count}
                      </span>
                    ) : null}
                    {isActive ? (
                      <motion.span
                        layoutId="ordersync-active-underline"
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
                  {activeTab === 'sheets' ? (
                    <TransferTab tab={sheets} label="Google Sheets" />
                  ) : activeTab === 'ecwid' ? (
                    <TransferTab tab={ecwid} label="Ecwid Direct" />
                  ) : (
                    <ExceptionsTab tab={exceptions} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-border-soft bg-surface-canvas px-5 py-2.5">
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span className="inline-flex items-center gap-1.5">
                  {statusDot(sheets.status)} <span>{statusLabel(sheets.status, sheets.summary)}</span>
                </span>
                <span className="text-text-faint">·</span>
                <span className="inline-flex items-center gap-1.5">
                  {statusDot(ecwid.status)} <span>{statusLabel(ecwid.status, ecwid.summary)}</span>
                </span>
                <span className="text-text-faint">·</span>
                <span className="inline-flex items-center gap-1.5">
                  {statusDot(exceptions.status)} <span>{statusLabel(exceptions.status, exceptions.summary)}</span>
                </span>
              </div>
              <Button variant="brand" size="sm" onClick={onClose} disabled={isRunning}>
                {isRunning ? 'Running…' : 'Close'}
              </Button>
            </footer>
      </motion.div>
    </motion.div>
  );

  return createPortal(overlay, portalNode);
}
