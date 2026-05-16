'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { Loader2, Search, ChevronRight, MapPin } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import SkuDetailView from './SkuDetailView';
import { SkuScanRefChip, TrackingChip, SerialChip } from '@/components/ui/CopyChip';
import { DesktopDateGroupHeader } from '@/components/ui/DesktopDateGroupHeader';

export type SkuView = 'sku_stock' | 'sku_history' | 'location';

function parseSkuView(raw: string | null): SkuView {
  if (raw === 'sku_history') return 'sku_history';
  if (raw === 'location') return 'location';
  return 'sku_stock';
}

export { parseSkuView };

type SkuStockRow = {
  id: number;
  stock: string | null;
  sku: string | null;
  product_title: string | null;
};

type SkuHistoryRow = {
  id: number;
  updated_at: string | null;
  static_sku: string | null;
  product_title: string | null;
  serial_number: string | null;
  location: string | null;
  shipping_tracking_number: string | null;
  notes: string | null;
};

// ─── Activity dot (audit row indicator) ──────────────────────────────────

function activityDot(row: SkuHistoryRow): { color: string; label: string } {
  if (String(row.shipping_tracking_number || '').trim()) return { color: 'bg-blue-500', label: 'Shipped' };
  if (String(row.location || '').trim()) return { color: 'bg-emerald-500', label: 'Located' };
  if (String(row.notes || '').trim()) return { color: 'bg-amber-500', label: 'Noted' };
  return { color: 'bg-gray-300', label: 'Updated' };
}

// ─── Time formatting + date-key grouping ─────────────────────────────────

function parseTimestamp(raw: string | null): Date | null {
  if (!raw) return null;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRelativeTime(raw: string | null): { relative: string; absolute: string } {
  const date = parseTimestamp(raw);
  if (!date) return { relative: '—', absolute: '' };
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  let relative: string;
  if (diffMin < 1) relative = 'just now';
  else if (diffMin < 60) relative = `${diffMin}m ago`;
  else if (diffMin < 1440) relative = `${Math.floor(diffMin / 60)}h ago`;
  else if (diffMin < 10080) relative = `${Math.floor(diffMin / 1440)}d ago`;
  else relative = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const absolute = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return { relative, absolute };
}

function dateKeyFor(date: Date | null): string {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function groupByDate(rows: SkuHistoryRow[]): Array<{ key: string; rows: SkuHistoryRow[] }> {
  const groups = new Map<string, SkuHistoryRow[]>();
  const order: string[] = [];
  for (const row of rows) {
    const date = parseTimestamp(row.updated_at);
    const key = dateKeyFor(date) || 'no-date';
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(row);
  }
  return order.map((key) => ({ key, rows: groups.get(key)! }));
}

// ─── Stock threshold tint ─────────────────────────────────────────────────

function stockClassFor(value: string | null | undefined): string {
  const n = parseInt(String(value ?? '').trim() || '0', 10) || 0;
  if (n <= 0) return 'text-red-600 bg-red-50/60';
  if (n <= 5) return 'text-amber-600';
  return 'text-gray-900';
}

// ─── Main component ───────────────────────────────────────────────────────

export default function SkuBrowser() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view: SkuView = parseSkuView(searchParams.get('view'));
  const searchQuery = String(searchParams.get('search') || '').trim();
  const openSku = searchParams.get('sku') || null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [skuStockRows, setSkuStockRows] = useState<SkuStockRow[]>([]);
  const [skuHistoryRows, setSkuHistoryRows] = useState<SkuHistoryRow[]>([]);

  const openSkuPanel = useCallback(
    (skuValue: string) => {
      const s = skuValue.trim();
      if (!s) return;
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set('sku', s);
      router.replace(`/sku-stock?${nextParams.toString()}`);
    },
    [router, searchParams],
  );

  const closeSkuPanel = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('sku');
    const qs = nextParams.toString();
    router.replace(qs ? `/sku-stock?${qs}` : '/sku-stock');
  }, [router, searchParams]);

  useEffect(() => {
    let cancelled = false;

    // Location view has no list endpoint — the active bin is loaded by the
    // dedicated /sku-stock/location/[barcode] page.
    if (view === 'location') {
      setLoading(false);
      setError('');
      return () => {
        cancelled = true;
      };
    }

    async function load() {
      setError('');
      if ((view === 'sku_stock' ? skuStockRows.length : skuHistoryRows.length) === 0) {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams();
        params.set('limit', '500');
        if (searchQuery) params.set('q', searchQuery);

        const endpoint = view === 'sku_stock' ? '/api/sku-stock' : '/api/sku';
        const res = await fetch(`${endpoint}?${params.toString()}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.details || data?.error || 'Request failed');
        }

        if (cancelled) return;

        if (view === 'sku_stock') {
          setSkuStockRows(Array.isArray(data?.rows) ? data.rows : []);
        } else {
          setSkuHistoryRows(Array.isArray(data?.rows) ? data.rows : []);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load SKU records');
          if (view === 'sku_stock') setSkuStockRows([]);
          else setSkuHistoryRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [view, searchQuery]);

  const handleRowClick = (skuValue: string | null) => {
    const s = String(skuValue || '').trim();
    if (!s) return;
    openSkuPanel(s);
  };

  const handleSkuFill = useCallback((value: string) => {
    if (!value) return;
    window.dispatchEvent(new CustomEvent('sku:fill', { detail: { sku: value } }));
  }, []);

  const groupedHistory = useMemo(() => groupByDate(skuHistoryRows), [skuHistoryRows]);
  const activeCount = view === 'sku_stock' ? skuStockRows.length : skuHistoryRows.length;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {loading ? (
            <div className="flex h-full items-center justify-center bg-gray-50">
              <div className="text-center">
                <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-600" />
                <p className="text-sm font-semibold text-gray-600">Loading SKU records...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center bg-gray-50 px-6 text-center">
              <p className="text-sm font-semibold text-red-600">{error}</p>
            </div>
          ) : view === 'location' ? (
            <LocationEmptyState />
          ) : activeCount === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-40 text-center">
              <div className="max-w-xs animate-in fade-in zoom-in duration-300">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                  <Search className="h-8 w-8 text-red-400" />
                </div>
                <h3 className="mb-1 text-lg font-black uppercase tracking-tight text-gray-900">
                  {view === 'sku_stock' ? 'No stock records' : 'No activity yet'}
                </h3>
                <p className="text-xs font-bold uppercase tracking-widest leading-relaxed text-gray-500">
                  {searchQuery
                    ? `Nothing matches "${searchQuery}"`
                    : view === 'sku_stock'
                      ? 'There is no stock to display'
                      : 'No SKU updates have been recorded'}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex w-full flex-col">
              {view === 'sku_stock' ? (
                <>
                  <div className="grid grid-cols-[64px_minmax(220px,1fr)_160px_28px] items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-1.5">
                    <div className={sectionLabel}>Stock</div>
                    <div className={sectionLabel}>Product</div>
                    <div className={sectionLabel}>SKU</div>
                    <div />
                  </div>
                  {skuStockRows.map((row, index) => (
                    <div
                      key={row.id}
                      onClick={() => handleRowClick(row.sku)}
                      className={`grid grid-cols-[64px_minmax(220px,1fr)_160px_28px] items-center gap-2 border-b border-gray-50 px-3 py-2 cursor-pointer hover:bg-blue-50/60 transition-colors ${
                        index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                      }`}
                    >
                      <div
                        className={`rounded-md py-0.5 text-left text-[14px] font-black tabular-nums ${stockClassFor(row.stock)}`}
                      >
                        {parseInt(String(row.stock ?? '').trim() || '0', 10) || 0}
                      </div>
                      <div className="truncate text-[12px] font-bold text-gray-900">
                        {String(row.product_title ?? '').trim() || '—'}
                      </div>
                      <SkuScanRefChip
                        value={String(row.sku ?? '')}
                        display={String(row.sku ?? '—')}
                        onCopy={handleSkuFill}
                      />
                      <ChevronRight className="h-4 w-4 text-gray-300" />
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {groupedHistory.map((group) => (
                    <div key={group.key} className="flex flex-col">
                      {group.key !== 'no-date' ? (
                        <DesktopDateGroupHeader date={group.key} total={group.rows.length} />
                      ) : null}
                      {group.rows.map((row, index) => {
                        const { relative, absolute } = formatRelativeTime(row.updated_at);
                        const dot = activityDot(row);
                        const tracking = String(row.shipping_tracking_number || '').trim();
                        const location = String(row.location || '').trim();
                        const notes = String(row.notes || '').trim();
                        const serial = String(row.serial_number || '').trim();
                        const sku = String(row.static_sku ?? '');
                        const productTitle =
                          String(row.product_title ?? '').trim() || 'Unknown Product';

                        return (
                          <div
                            key={row.id}
                            onClick={() => handleRowClick(row.static_sku)}
                            title={absolute}
                            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-gray-200 px-3 py-1.5 cursor-pointer hover:bg-blue-50/40 transition-colors ${
                              index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${dot.color}`}
                                title={dot.label}
                              />
                              <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-gray-500 tabular-nums">
                                {relative}
                              </span>
                              <span className="shrink-0 text-gray-300">·</span>
                              <div className="truncate text-[11px] font-bold text-gray-900">
                                {productTitle}
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center">
                              {location ? (
                                <span className="inline-flex items-center gap-1 px-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-700">
                                  <MapPin className="h-3.5 w-3.5" />
                                  {location}
                                </span>
                              ) : null}
                              {notes && !tracking && !location ? (
                                <span className="max-w-[140px] truncate px-1.5 text-[11px] font-semibold text-amber-700">
                                  {notes}
                                </span>
                              ) : null}
                              {tracking ? (
                                <TrackingChip value={tracking} display={tracking} />
                              ) : null}
                              <SkuScanRefChip
                                value={sku}
                                display={sku || '—'}
                                onCopy={handleSkuFill}
                              />
                              {serial ? <SerialChip value={serial} display={serial} /> : null}
                              <ChevronRight className="ml-1 h-4 w-4 text-gray-300" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail panel overlay ── */}
      <AnimatePresence>
        {openSku && (
          <SkuDetailView
            key={openSku}
            sku={decodeURIComponent(openSku)}
            variant="panel"
            onClose={closeSkuPanel}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Location empty state ──────────────────────────────────────────────────

function LocationEmptyState() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const submit = useCallback(() => {
    const code = value.trim();
    if (!code) return;
    router.push(`/sku-stock/location/${encodeURIComponent(code)}`);
  }, [router, value]);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-20 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
          <Search className="h-8 w-8 text-blue-400" />
        </div>
        <h3 className="mb-1 text-lg font-black uppercase tracking-tight text-gray-900">
          Scan a bin label
        </h3>
        <p className="mb-6 text-xs font-bold uppercase tracking-widest leading-relaxed text-gray-500">
          Open this page from a bin QR, or type a barcode below.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex w-full items-stretch gap-2"
        >
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            autoFocus
            placeholder="Bin barcode (e.g. Z1-A-03)"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 px-3 py-3 text-center font-mono text-base font-bold text-gray-900 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className="rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white active:bg-blue-700 disabled:opacity-50"
          >
            Open
          </button>
        </form>
      </div>
    </div>
  );
}
