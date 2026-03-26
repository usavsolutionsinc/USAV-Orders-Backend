'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { ChevronDown, Loader2, RefreshCw, X } from '@/components/Icons';
import { DateGroupHeader } from '@/components/shipped/DateGroupHeader';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import WeekHeader from '@/components/ui/WeekHeader';
import type { StationTheme } from '@/utils/staff-colors';
import { stationThemeColors, fbaWorkspaceScanChrome } from '@/utils/staff-colors';
import { FbaLoadingState, FbaErrorState } from '@/components/fba/FbaStateShells';
import { StatusBadge } from '@/design-system/components/StatusBadge';

export interface FbaShippedHistoryProps {
  refreshTrigger?: number;
  stationTheme?: StationTheme;
}

type TrackingEntry = {
  link_id: number;
  tracking_id: number;
  tracking_number: string;
  carrier: string;
  status_category: string | null;
  status_description: string | null;
  is_delivered: boolean;
  is_in_transit: boolean;
  has_exception: boolean;
  latest_event_at: string | null;
  label: string | null;
};

type ShipmentRow = {
  id: number;
  shipment_ref: string;
  destination_fc: string | null;
  due_date: string | null;
  status: string;
  notes: string | null;
  shipped_at: string | null;
  created_at: string | null;
  total_items: string | number;
  shipped_items: string | number;
  total_expected_qty: string | number;
  total_actual_qty: string | number;
  created_by_name?: string | null;
  tracking_numbers: TrackingEntry[];
};

type ItemRow = {
  id: number;
  fnsku: string;
  product_title: string | null;
  status: string;
  expected_qty: number;
  actual_qty: number | null;
};

export function FbaShippedHistory({ refreshTrigger = 0, stationTheme: theme = 'green' }: FbaShippedHistoryProps) {
  const themeColors = stationThemeColors[theme];
  const scanChrome = fbaWorkspaceScanChrome[theme];
  const reducedMotion = !!useReducedMotion();
  const searchParams = useSearchParams();
  const searchQuery = (searchParams.get('q') || '').trim();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickyDate, setStickyDate] = useState('');
  const [currentCount, setCurrentCount] = useState(0);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [itemsByShipment, setItemsByShipment] = useState<Record<number, ItemRow[]>>({});
  const [itemsLoadingId, setItemsLoadingId] = useState<number | null>(null);
  // Tracking number inline state
  const [trackingInput, setTrackingInput] = useState<Record<number, string>>({});
  const [trackingAdding, setTrackingAdding] = useState<number | null>(null);
  const [trackingError, setTrackingError] = useState<Record<number, string>>({});

  const formatDate = (dateStr: string) => formatDateWithOrdinal(dateStr);
  const fallbackDate = formatDate(getCurrentPSTDateKey());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('status', 'SHIPPED');
      params.set('limit', '200');
      if (searchQuery) params.set('q', searchQuery);
      const res = await fetch(`/api/fba/shipments?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load shipped FBA shipments');
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Failed to load shipped FBA shipments');
      setShipments(Array.isArray(data.shipments) ? data.shipments : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setShipments([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    load();
  }, [load, refreshTrigger]);

  const grouped = useMemo(() => {
    const map: Record<string, ShipmentRow[]> = {};
    for (const s of shipments) {
      const src = s.shipped_at || s.created_at;
      let key = 'Unknown';
      try {
        key = src ? toPSTDateKey(String(src)) || 'Unknown' : 'Unknown';
      } catch {
        key = 'Unknown';
      }
      if (!map[key]) map[key] = [];
      map[key].push(s);
    }
    return map;
  }, [shipments]);

  const totalCount = shipments.length;

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop } = scrollRef.current;
    const headers = scrollRef.current.querySelectorAll('[data-day-header]');
    let activeDate = '';
    let activeCount = 0;
    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i] as HTMLElement;
      if (header.offsetTop - scrollRef.current.offsetTop <= scrollTop + 5) {
        activeDate = header.getAttribute('data-date') || '';
        activeCount = parseInt(header.getAttribute('data-count') || '0', 10);
      } else {
        break;
      }
    }
    if (activeDate) setStickyDate(formatDate(activeDate));
    setCurrentCount(activeCount || totalCount);
  }, [totalCount]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      window.setTimeout(() => handleScroll(), 100);
    }
    return () => container?.removeEventListener('scroll', handleScroll);
  }, [handleScroll, grouped]);

  const toggleItems = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (itemsByShipment[id]) return;
    setItemsLoadingId(id);
    try {
      const res = await fetch(`/api/fba/shipments/${id}/items`, { cache: 'no-store' });
      const data = await res.json();
      const list = Array.isArray(data?.items) ? data.items : [];
      setItemsByShipment((prev) => ({ ...prev, [id]: list }));
    } catch {
      setItemsByShipment((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setItemsLoadingId(null);
    }
  };

  const addTracking = async (shipmentId: number) => {
    const tn = (trackingInput[shipmentId] || '').trim().toUpperCase();
    if (!tn) return;
    setTrackingAdding(shipmentId);
    setTrackingError((prev) => ({ ...prev, [shipmentId]: '' }));
    try {
      const res = await fetch(`/api/fba/shipments/${shipmentId}/tracking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_number: tn }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTrackingError((prev) => ({ ...prev, [shipmentId]: data?.error || 'Failed to add' }));
        return;
      }
      // Refresh shipment list to get updated tracking_numbers
      setTrackingInput((prev) => ({ ...prev, [shipmentId]: '' }));
      await load();
    } catch (err: any) {
      setTrackingError((prev) => ({ ...prev, [shipmentId]: err?.message || 'Failed' }));
    } finally {
      setTrackingAdding(null);
    }
  };

  const removeTracking = async (shipmentId: number, linkId: number) => {
    try {
      await fetch(`/api/fba/shipments/${shipmentId}/tracking?link_id=${linkId}`, { method: 'DELETE' });
      await load();
    } catch {
      // no-op
    }
  };

  if (loading && shipments.length === 0) {
    return <FbaLoadingState theme={theme} label="Loading shipment close history…" />;
  }

  if (error) {
    return <FbaErrorState message={error} onRetry={load} theme={theme} />;
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <WeekHeader
        stickyDate={stickyDate}
        fallbackDate={fallbackDate}
        count={currentCount || totalCount}
        countClassName={themeColors.text}
        formatDate={formatDate}
        showWeekControls={false}
        rightSlot={(
          <button
            type="button"
            onClick={load}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-300 text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
            title="Refresh shipped history"
            aria-label="Refresh shipped history"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      />

      <div ref={scrollRef} className="no-scrollbar min-h-0 w-full flex-1 overflow-x-auto overflow-y-auto">
        {totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-sm font-black text-gray-900">
              {searchQuery ? 'No closed shipments match this search' : 'No shipped FBA closures yet'}
            </p>
            <p className="mt-1 max-w-sm text-xs font-bold text-gray-400">
              This list only includes shipments closed via ship workflow (<span className="font-mono">status=SHIPPED</span>),
              not pack-station scans.
            </p>
          </div>
        ) : (
          <div className="flex w-full flex-col">
            {Object.entries(grouped)
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([date, dayRows]) => {
                const sorted = [...dayRows].sort((a, b) => {
                  const ta = new Date(a.shipped_at || a.created_at || 0).getTime();
                  const tb = new Date(b.shipped_at || b.created_at || 0).getTime();
                  return tb - ta;
                });
                return (
                  <div key={date} className="flex flex-col">
                    <DateGroupHeader date={date} total={dayRows.length} formatDate={formatDate} />
                    {sorted.map((row, index) => {
                      const shippedItems = Number(row.shipped_items ?? 0);
                      const totalItems = Number(row.total_items ?? 0);
                      const isOpen = expandedId === row.id;
                      return (
                        <div key={row.id} className="border-b border-gray-50">
                          <button
                            type="button"
                            onClick={() => toggleItems(row.id)}
                            className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50 ${
                              index % 2 === 0 ? 'bg-white' : 'bg-gray-50/20'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="truncate text-[12px] font-bold text-gray-900">{row.shipment_ref}</div>
                              <div className="mt-0.5 truncate text-[9px] font-black uppercase tracking-widest text-gray-400">
                                {row.destination_fc ? `FC ${row.destination_fc} · ` : ''}
                                {shippedItems}/{totalItems} items shipped
                                {row.created_by_name ? ` · ${row.created_by_name}` : ''}
                              </div>
                            </div>
                            <ChevronDown
                              className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                            />
                          </button>
                          <AnimatePresence initial={false}>
                            {isOpen ? (
                              <motion.div
                                initial={reducedMotion ? false : framerPresence.collapseHeight.initial}
                                animate={framerPresence.collapseHeight.animate}
                                exit={framerPresence.collapseHeight.exit}
                                transition={reducedMotion ? { duration: 0 } : framerTransition.upNextCollapse}
                                className="overflow-hidden border-t border-gray-100 bg-white"
                              >
                                <div className="px-3 py-2 space-y-3">
                                  {/* Tracking numbers */}
                                  <div>
                                    <p className={`mb-1.5 text-[10px] font-black uppercase tracking-widest ${themeColors.text}`}>
                                      Tracking
                                    </p>
                                    {(row.tracking_numbers || []).length > 0 ? (
                                      <div className="mb-2">
                                        {(row.tracking_numbers || []).map((tn) => (
                                          <div
                                            key={tn.link_id}
                                            className="flex items-center justify-between gap-2 border-b border-gray-100 px-1 py-1.5 last:border-b-0"
                                          >
                                            <div className="min-w-0 flex-1">
                                              <p className="font-mono text-[11px] font-bold text-zinc-900">
                                                {tn.tracking_number}
                                              </p>
                                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] font-semibold text-zinc-400">
                                                <span>{tn.carrier}</span>
                                                {tn.status_description ? <span>{tn.status_description}</span> : null}
                                                {tn.is_delivered ? (
                                                  <StatusBadge status="delivered" />
                                                ) : tn.is_in_transit ? (
                                                  <StatusBadge status="shipped" label="In transit" />
                                                ) : null}
                                                {tn.has_exception ? (
                                                  <StatusBadge status="overdue" label="Exception" />
                                                ) : null}
                                              </div>
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => removeTracking(row.id, tn.link_id)}
                                              className="shrink-0 rounded p-1 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                              aria-label="Remove tracking"
                                            >
                                              <X className="h-3 w-3" />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="mb-2 text-[10px] font-semibold text-zinc-400">No tracking linked</p>
                                    )}
                                    {/* Inline add tracking */}
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="text"
                                        value={trackingInput[row.id] || ''}
                                        onChange={(e) =>
                                          setTrackingInput((prev) => ({ ...prev, [row.id]: e.target.value }))
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') addTracking(row.id);
                                        }}
                                        placeholder="Paste tracking number…"
                                        className={`h-7 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 font-mono text-[11px] font-bold text-zinc-900 outline-none placeholder:font-sans placeholder:font-normal placeholder:text-zinc-400 ${scanChrome.fieldFocusRing}`}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => addTracking(row.id)}
                                        disabled={!trackingInput[row.id]?.trim() || trackingAdding === row.id}
                                        className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-zinc-800 px-2.5 text-[10px] font-black uppercase tracking-wide text-white transition-colors hover:bg-zinc-900 disabled:opacity-40"
                                      >
                                        {trackingAdding === row.id ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          'Add'
                                        )}
                                      </button>
                                    </div>
                                    {trackingError[row.id] ? (
                                      <p className="mt-1 text-[10px] font-semibold text-red-600">
                                        {trackingError[row.id]}
                                      </p>
                                    ) : null}
                                  </div>

                                  {/* Line items */}
                                  {itemsLoadingId === row.id ? (
                                    <div className="flex items-center gap-2 py-1 text-xs text-gray-500">
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      Loading items…
                                    </div>
                                  ) : (
                                    <div>
                                      <p className={`mb-1.5 text-[10px] font-black uppercase tracking-widest ${themeColors.text}`}>
                                        Line items
                                      </p>
                                      <ul className="space-y-1">
                                        {(itemsByShipment[row.id] || []).map((it) => (
                                          <li
                                            key={it.id}
                                            className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]"
                                          >
                                            <span className="min-w-0 font-mono text-[10px] font-bold text-gray-700">
                                              {it.fnsku}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate text-gray-600">
                                              {it.product_title || '—'}
                                            </span>
                                            <span className="shrink-0 text-[9px] font-black uppercase text-gray-400">
                                              {it.status} · {it.actual_qty ?? 0}/{it.expected_qty}
                                            </span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {row.notes ? (
                                    <p className="text-[10px] font-bold text-gray-500">{row.notes}</p>
                                  ) : null}
                                </div>
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
