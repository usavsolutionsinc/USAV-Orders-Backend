'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { fbaPaths } from '@/lib/fba/api-paths';
import { Check, ChevronDown, Loader2 } from '@/components/Icons';
import { framerPresence, framerTransition, SkeletonList } from '@/design-system';
import { stationThemeColors } from '@/utils/staff-colors';
import type { StationTheme } from '@/utils/staff-colors';


type TrackingEntry = {
  link_id: number;
  tracking_id: number;
  tracking_number: string;
  carrier: string;
  label: string | null;
};

type ShipmentRow = {
  id: number;
  shipment_ref: string;
  amazon_shipment_id?: string | null;
  destination_fc: string | null;
  status: string;
  created_at: string | null;
  shipped_at: string | null;
  tracking_numbers: TrackingEntry[];
  total_items: string | number;
  shipped_items: string | number;
};

type ShipmentItem = {
  id: number;
  shipment_id: number;
  fnsku: string;
  display_title: string | null;
  expected_qty: number;
  actual_qty: number;
  status: string;
};

interface FbaShippedTableProps {
  stationTheme?: StationTheme;
  searchQuery?: string;
  embedded?: boolean;
}

function getPrimaryUps(tracking: TrackingEntry[]): TrackingEntry | null {
  if (!Array.isArray(tracking) || tracking.length === 0) return null;
  const ups = tracking.find((t) => String(t.carrier || '').toUpperCase() === 'UPS');
  return ups || tracking[0] || null;
}

export function FbaShippedTable({ stationTheme = 'green', searchQuery = '', embedded = true }: FbaShippedTableProps) {
  const theme = stationThemeColors[stationTheme];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [itemsByShipment, setItemsByShipment] = useState<Record<number, ShipmentItem[]>>({});
  const [itemLoadingId, setItemLoadingId] = useState<number | null>(null);

  const [savingShipmentId, setSavingShipmentId] = useState<number | null>(null);
  const [savingItemId, setSavingItemId] = useState<number | null>(null);

  const [shipmentDrafts, setShipmentDrafts] = useState<Record<number, { amazon: string; ups: string }>>({});
  const [itemFnskuDrafts, setItemFnskuDrafts] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('status', 'SHIPPED');
      params.set('limit', '200');
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      const res = await fetch(`${fbaPaths.plans()}?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to load shipped rows');
      const rows = Array.isArray(data.shipments) ? (data.shipments as ShipmentRow[]) : [];
      setShipments(rows);
      setShipmentDrafts((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          const primary = getPrimaryUps(row.tracking_numbers || []);
          if (!next[row.id]) {
            next[row.id] = {
              amazon: String(row.amazon_shipment_id || '').toUpperCase(),
              ups: String(primary?.tracking_number || '').toUpperCase(),
            };
          }
        }
        return next;
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to load shipped rows');
      setShipments([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, ShipmentRow[]>();
    for (const row of shipments) {
      const primaryUps = getPrimaryUps(row.tracking_numbers || []);
      const key = `${row.id}::${String(primaryUps?.tracking_number || '').toUpperCase()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries()).map(([key, rows]) => ({ key, rows }));
  }, [shipments]);

  const toggleExpand = useCallback(async (shipmentId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(shipmentId)) next.delete(shipmentId);
      else next.add(shipmentId);
      return next;
    });

    if (itemsByShipment[shipmentId]) return;
    setItemLoadingId(shipmentId);
    try {
      const res = await fetch(fbaPaths.planItems(shipmentId), { cache: 'no-store' });
      const data = await res.json();
      const rows = Array.isArray(data?.items) ? (data.items as ShipmentItem[]) : [];
      setItemsByShipment((prev) => ({ ...prev, [shipmentId]: rows }));
      setItemFnskuDrafts((prev) => {
        const next = { ...prev };
        for (const item of rows) {
          if (!next[item.id]) next[item.id] = String(item.fnsku || '').toUpperCase();
        }
        return next;
      });
    } finally {
      setItemLoadingId(null);
    }
  }, [itemsByShipment]);

  const saveShipment = useCallback(async (row: ShipmentRow) => {
    const draft = shipmentDrafts[row.id] || { amazon: '', ups: '' };
    const amazon = String(draft.amazon || '').trim().toUpperCase();
    const ups = String(draft.ups || '').trim().toUpperCase();

    setSavingShipmentId(row.id);
    setError(null);
    try {
      const shipmentRes = await fetch(fbaPaths.plan(row.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amazon_shipment_id: amazon || null }),
      });
      const shipmentJson = await shipmentRes.json().catch(() => ({}));
      if (!shipmentRes.ok) throw new Error(shipmentJson?.error || 'Failed to save shipment id');

      if (ups) {
        const primary = getPrimaryUps(row.tracking_numbers || []);
        if (primary?.link_id) {
          const trackingRes = await fetch(fbaPaths.planTracking(row.id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              link_id: primary.link_id,
              tracking_number: ups,
              carrier: 'UPS',
              label: 'UPS',
            }),
          });
          const trackingJson = await trackingRes.json().catch(() => ({}));
          if (!trackingRes.ok) throw new Error(trackingJson?.error || 'Failed to update UPS tracking');
        } else {
          const trackingRes = await fetch(fbaPaths.planTracking(row.id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracking_number: ups, carrier: 'UPS', label: 'UPS' }),
          });
          const trackingJson = await trackingRes.json().catch(() => ({}));
          if (!trackingRes.ok) throw new Error(trackingJson?.error || 'Failed to add UPS tracking');
        }
      }

      await load();
      window.dispatchEvent(new CustomEvent('fba-print-shipped'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (e: any) {
      setError(e?.message || 'Failed to save shipment');
    } finally {
      setSavingShipmentId(null);
    }
  }, [load, shipmentDrafts]);

  const saveItemFnsku = useCallback(async (shipmentId: number, item: ShipmentItem) => {
    const nextFnsku = String(itemFnskuDrafts[item.id] || '').trim().toUpperCase();
    if (!nextFnsku) {
      setError('FNSKU is required');
      return;
    }

    setSavingItemId(item.id);
    setError(null);
    try {
      const res = await fetch(fbaPaths.planItem(shipmentId, item.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fnsku: nextFnsku }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to update FNSKU');

      setItemsByShipment((prev) => ({
        ...prev,
        [shipmentId]: (prev[shipmentId] || []).map((line) =>
          line.id === item.id ? { ...line, fnsku: nextFnsku } : line,
        ),
      }));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (e: any) {
      setError(e?.message || 'Failed to update FNSKU');
    } finally {
      setSavingItemId(null);
    }
  }, [itemFnskuDrafts]);

  if (loading && shipments.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <SkeletonList count={12} />
      </div>
    );
  }

  return (
    <div className={embedded ? 'flex min-h-0 flex-1 flex-col overflow-hidden bg-white' : 'flex min-h-0 flex-1 flex-col bg-white'}>
      {error ? (
        <div className="mx-3 my-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <div className="px-4 py-10 text-center text-[11px] font-bold uppercase tracking-wider text-gray-400">
            No shipped rows
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {grouped.map((group) => {
              const row = group.rows[0];
              const isOpen = expanded.has(row.id);
              const primaryUps = getPrimaryUps(row.tracking_numbers || []);
              const shipmentDraft = shipmentDrafts[row.id] || {
                amazon: String(row.amazon_shipment_id || '').toUpperCase(),
                ups: String(primaryUps?.tracking_number || '').toUpperCase(),
              };
              return (
                <motion.div
                  {...framerPresence.tableRow}
                  transition={framerTransition.tableRowMount}
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.998 }}
                  key={group.key}
                  className="bg-white"
                >
                  <button
                    type="button"
                    onClick={() => void toggleExpand(row.id)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px] font-black text-gray-900">
                        {String(row.amazon_shipment_id || row.shipment_ref || `#${row.id}`).toUpperCase()}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] font-bold text-gray-500">
                        UPS {String(primaryUps?.tracking_number || '—')} · {Number(row.shipped_items || 0)}/{Number(row.total_items || 0)}
                      </p>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isOpen ? (
                    <div className="space-y-2 border-t border-gray-100 px-3 py-2.5">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="min-w-0">
                          <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-500">
                            FBA Shipment ID
                          </span>
                          <input
                            value={shipmentDraft.amazon}
                            onChange={(e) =>
                              setShipmentDrafts((prev) => ({
                                ...prev,
                                [row.id]: { ...shipmentDraft, amazon: e.target.value.toUpperCase() },
                              }))
                            }
                            className="h-9 w-full rounded-lg border border-gray-300 px-2 font-mono text-xs font-bold text-gray-900 outline-none focus:border-gray-500"
                            placeholder="FBA17XXXXXXXX"
                          />
                        </label>
                        <label className="min-w-0">
                          <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-500">
                            UPS Tracking
                          </span>
                          <input
                            value={shipmentDraft.ups}
                            onChange={(e) =>
                              setShipmentDrafts((prev) => ({
                                ...prev,
                                [row.id]: { ...shipmentDraft, ups: e.target.value.toUpperCase() },
                              }))
                            }
                            className="h-9 w-full rounded-lg border border-gray-300 px-2 font-mono text-xs font-bold text-gray-900 outline-none focus:border-gray-500"
                            placeholder="1Z..."
                          />
                        </label>
                      </div>

                      <button
                        type="button"
                        onClick={() => void saveShipment(row)}
                        disabled={savingShipmentId === row.id}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 text-[10px] font-black uppercase tracking-wider text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {savingShipmentId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Save Shipment
                      </button>

                      {itemLoadingId === row.id ? (
                        <div className="flex items-center gap-2 py-2 text-[11px] font-semibold text-gray-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading FNSKUs…
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {(itemsByShipment[row.id] || []).map((item) => (
                            <div
                              key={item.id}
                              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2 py-2"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    value={itemFnskuDrafts[item.id] ?? item.fnsku}
                                    onChange={(e) =>
                                      setItemFnskuDrafts((prev) => ({ ...prev, [item.id]: e.target.value.toUpperCase() }))
                                    }
                                    className="h-8 w-40 max-w-full rounded-md border border-gray-300 bg-white px-2 font-mono text-[11px] font-bold text-gray-900 outline-none focus:border-gray-500"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void saveItemFnsku(row.id, item)}
                                    disabled={savingItemId === item.id}
                                    className="inline-flex h-8 items-center rounded-md border border-gray-300 px-2 text-[9px] font-black uppercase tracking-wider text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                                  >
                                    {savingItemId === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                                  </button>
                                </div>
                                <p className="mt-1 truncate text-[10px] font-semibold text-gray-600">
                                  {item.display_title || 'No title'}
                                </p>
                              </div>
                              <div className={`text-right text-[10px] font-black tabular-nums ${theme.text}`}>
                                {Number(item.actual_qty || 0)}/{Number(item.expected_qty || 0)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default FbaShippedTable;
