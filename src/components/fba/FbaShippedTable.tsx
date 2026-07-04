'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { fbaPaths } from '@/lib/fba/api-paths';
import { Check, ChevronDown, Loader2, Boxes } from '@/components/Icons';
import { framerPresence, framerTransition, SkeletonList } from '@/design-system';
import { Button } from '@/design-system/primitives';
import { FbaShipmentTracePanel } from './FbaShipmentTracePanel';
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

/**
 * Strict UPS link lookup for the SAVE path.
 *
 * `getPrimaryUps` falls back to the first tracking entry of ANY carrier for
 * display, but the save handler must NOT reuse a non-UPS link — PATCHing it
 * would overwrite that link's number and force its carrier to UPS, mangling a
 * different (e.g. USPS) tracking row. When no true UPS link exists we return
 * null so the caller POSTs a fresh UPS link instead.
 */
function findUpsLink(tracking: TrackingEntry[]): TrackingEntry | null {
  if (!Array.isArray(tracking)) return null;
  return tracking.find((t) => String(t.carrier || '').toUpperCase() === 'UPS') || null;
}

export function FbaShippedTable({ stationTheme = 'green', searchQuery = '', embedded = true }: FbaShippedTableProps) {
  const theme = stationThemeColors[stationTheme];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [tracing, setTracing] = useState<Set<number>>(new Set());
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

  const toggleTrace = useCallback((shipmentId: number) => {
    setTracing((prev) => {
      const next = new Set(prev);
      if (next.has(shipmentId)) next.delete(shipmentId);
      else next.add(shipmentId);
      return next;
    });
  }, []);

  const saveShipment = useCallback(async (row: ShipmentRow) => {
    // Fall back to the row's current values when the user opens the form but
    // hasn't typed anything yet — avoids accidentally clearing amazon_shipment_id
    // or skipping the tracking update on an unchanged save.
    const primaryUps = getPrimaryUps(row.tracking_numbers || []);
    const draft = shipmentDrafts[row.id] ?? {
      amazon: String(row.amazon_shipment_id || '').toUpperCase(),
      ups: String(primaryUps?.tracking_number || '').toUpperCase(),
    };
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
        // Only reuse an existing link when it is a real UPS link; otherwise add
        // a new UPS link so we never clobber a different carrier's tracking row.
        const upsLink = findUpsLink(row.tracking_numbers || []);
        if (upsLink?.link_id) {
          const trackingRes = await fetch(fbaPaths.planTracking(row.id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              link_id: upsLink.link_id,
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
    <div className={embedded ? 'flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-card' : 'flex min-h-0 flex-1 flex-col bg-surface-card'}>
      {error ? (
        <div className="mx-3 my-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-caption font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <div className="px-4 py-10 text-center text-caption font-bold uppercase tracking-wider text-text-faint">
            No shipped rows
          </div>
        ) : (
          <div className="divide-y divide-border-hairline">
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
                  className="bg-surface-card"
                >
                  {/* ds-raw-button: multi-line text-left master-detail expand row */}
                  <button
                    type="button"
                    onClick={() => void toggleExpand(row.id)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-caption font-black text-text-default">
                        {String(row.amazon_shipment_id || row.shipment_ref || `#${row.id}`).toUpperCase()}
                      </p>
                      <p className="mt-0.5 truncate text-micro font-bold text-text-soft">
                        UPS {String(primaryUps?.tracking_number || '—')} · {Number(row.shipped_items || 0)}/{Number(row.total_items || 0)}
                      </p>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-text-faint transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isOpen ? (
                    <div className="space-y-2 border-t border-border-hairline px-3 py-2.5">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="min-w-0">
                          <span className="mb-1 block text-micro font-black uppercase tracking-widest text-text-soft">
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
                            className="h-9 w-full rounded-lg border border-border-default px-2 font-mono text-xs font-bold text-text-default outline-none focus:border-gray-500"
                            placeholder="FBA17XXXXXXXX"
                          />
                        </label>
                        <label className="min-w-0">
                          <span className="mb-1 block text-micro font-black uppercase tracking-widest text-text-soft">
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
                            className="h-9 w-full rounded-lg border border-border-default px-2 font-mono text-xs font-bold text-text-default outline-none focus:border-gray-500"
                            placeholder="1Z..."
                          />
                        </label>
                      </div>

                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void saveShipment(row)}
                        disabled={savingShipmentId === row.id}
                        loading={savingShipmentId === row.id}
                        icon={<Check />}
                      >
                        Save Shipment
                      </Button>

                      {itemLoadingId === row.id ? (
                        <div className="flex items-center gap-2 py-2 text-caption font-semibold text-text-soft">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading FNSKUs…
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {(itemsByShipment[row.id] || []).map((item) => (
                            <div
                              key={item.id}
                              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border-hairline bg-surface-canvas px-2 py-2"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    value={itemFnskuDrafts[item.id] ?? item.fnsku}
                                    onChange={(e) =>
                                      setItemFnskuDrafts((prev) => ({ ...prev, [item.id]: e.target.value.toUpperCase() }))
                                    }
                                    className="h-8 w-40 max-w-full rounded-md border border-border-default bg-surface-card px-2 font-mono text-caption font-bold text-text-default outline-none focus:border-gray-500"
                                  />
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => void saveItemFnsku(row.id, item)}
                                    disabled={savingItemId === item.id}
                                    loading={savingItemId === item.id}
                                  >
                                    Save
                                  </Button>
                                </div>
                                <p className="mt-1 truncate text-micro font-semibold text-text-muted">
                                  {item.display_title || 'No title'}
                                </p>
                              </div>
                              <div className={`text-right text-micro font-black tabular-nums ${theme.text}`}>
                                {Number(item.actual_qty || 0)}/{Number(item.expected_qty || 0)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Audit trace — shipment → FNSKU → unit path (P2-FBA-01) */}
                      <div className="border-t border-border-hairline pt-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => toggleTrace(row.id)}
                          icon={<Boxes />}
                          iconRight={
                            <ChevronDown
                              className={`text-text-faint transition-transform ${tracing.has(row.id) ? 'rotate-180' : ''}`}
                            />
                          }
                        >
                          {tracing.has(row.id) ? 'Hide Trace' : 'Trace Units'}
                        </Button>
                        {tracing.has(row.id) ? (
                          <FbaShipmentTracePanel shipmentId={row.id} className="mt-2" />
                        ) : null}
                      </div>
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
