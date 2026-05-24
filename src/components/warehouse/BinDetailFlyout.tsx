'use client';

/**
 * Slide-in flyout for a single bin. Lighter than full /bin/[barcode] —
 * preserves the user's filter state in the table behind it.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { BinsOverviewRow } from '@/hooks/useBinsOverview';
import { AuditTimeline } from '@/components/audit/AuditTimeline';
import { FillBar } from './FillBar';
import { StatusChips } from './StatusChip';
import { X, ExternalLink } from '@/components/Icons';

interface BinContentRow {
  id: number;
  sku: string;
  qty: number;
  minQty: number | null;
  maxQty: number | null;
  lastCounted: string | null;
  productTitle: string | null;
}

interface Props {
  row: BinsOverviewRow | null;
  onClose: () => void;
}

export function BinDetailFlyout({ row, onClose }: Props) {
  const [contents, setContents] = useState<BinContentRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!row?.barcode) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/locations/${encodeURIComponent(row.barcode!)}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        setContents(Array.isArray(data?.contents) ? data.contents : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [row?.barcode]);

  if (!row) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-label={`Bin ${row.barcode ?? row.name}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-gray-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-micro font-bold uppercase tracking-wider text-gray-500">
              Bin
            </div>
            <div className="truncate font-mono text-lg font-semibold text-gray-900">
              {row.barcode ?? row.name}
            </div>
            <div className="mt-0.5 text-caption text-gray-500">
              {row.room ?? '—'}{row.zone_letter ? ` [${row.zone_letter}]` : ''} · Row {row.row_label ?? '—'} · Col {row.col_label ?? '—'}
            </div>
          </div>
          {row.barcode && (
            <Link
              href={`/bin/${encodeURIComponent(row.barcode)}`}
              className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
              aria-label="Open full bin page"
              title="Open full bin page"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
            aria-label="Close bin detail"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4 p-4">
            {/* Summary */}
            <section className="rounded-2xl border border-gray-200 bg-white p-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                <Stat label="Total qty" value={String(row.total_qty)} />
                <Stat label="SKUs" value={String(row.sku_count)} />
                <Stat label="Capacity" value={row.capacity != null ? String(row.capacity) : '—'} />
              </div>
              <div className="mt-3">
                <FillBar pct={row.fill_pct} current={row.total_qty} max={row.capacity} />
              </div>
              <div className="mt-2">
                <StatusChips
                  is_empty={row.is_empty}
                  has_low_stock={row.has_low_stock}
                  is_over_capacity={row.is_over_capacity}
                  is_stale={row.is_stale}
                />
              </div>
            </section>

            {/* Contents */}
            <section>
              <h3 className="mb-2 text-micro font-bold uppercase tracking-[0.16em] text-gray-500">
                Contents
              </h3>
              {loading && (
                <div className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-400">
                  Loading…
                </div>
              )}
              {!loading && contents.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-center text-xs text-gray-400">
                  No SKUs in this bin.
                </div>
              )}
              {!loading && contents.length > 0 && (
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
                  {contents.map((c) => (
                    <li key={c.id} className="px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <Link
                          href={`/inventory?sku=${encodeURIComponent(c.sku)}`}
                          className="font-mono text-xs text-blue-700 hover:underline"
                        >
                          {c.sku}
                        </Link>
                        <span className="font-mono text-sm font-semibold tabular-nums text-gray-900">
                          {c.qty}
                        </span>
                      </div>
                      {c.productTitle && (
                        <div className="mt-0.5 line-clamp-1 text-caption text-gray-500">
                          {c.productTitle}
                        </div>
                      )}
                      {(c.minQty != null || c.maxQty != null) && (
                        <div className="mt-0.5 text-micro text-gray-400">
                          min {c.minQty ?? '—'} · max {c.maxQty ?? '—'}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* History */}
            <section>
              <h3 className="mb-2 text-micro font-bold uppercase tracking-[0.16em] text-gray-500">
                Recent history
              </h3>
              <AuditTimeline binId={row.id} limit={20} compact noHeader />
            </section>
          </div>
        </div>
      </aside>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-eyebrow font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
        {value}
      </div>
    </div>
  );
}
