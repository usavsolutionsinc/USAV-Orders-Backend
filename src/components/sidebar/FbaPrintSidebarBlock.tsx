'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ClipboardList, Clock, Loader2 } from '@/components/Icons';
import type { EnrichedItem } from '@/components/fba/table/types';

const FBA_ID_RE = /^FBA[0-9A-Z]{8,}$/i;
const UPS_RE = /^1Z[A-Z0-9]{16}$/i;

const sectionLabelClass = 'block text-[9px] font-bold uppercase tracking-widest text-gray-600';
const fieldClass =
  'mt-1 w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:opacity-50';
function normalizeFbaId(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeUps(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function defaultPrintQty(item: EnrichedItem): number {
  return Math.max(1, Number(item.expected_qty) || 0, Number(item.actual_qty) || 0);
}

interface FbaPrintSidebarBlockProps {
  planRefById: Map<number, string>;
}

export function FbaPrintSidebarBlock({ planRefById }: FbaPrintSidebarBlockProps) {
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [shipmentIds, setShipmentIds] = useState<number[]>([]);

  const [trackingByShipment, setTrackingByShipment] = useState<
    Record<number, { amazon: string; ups: string }>
  >({});

  const [qtyByItem, setQtyByItem] = useState<Record<number, string>>({});
  const qtyDirtyRef = useRef<Set<number>>(new Set());

  const [savingShipment, setSavingShipment] = useState<number | null>(null);
  const [savingItemQty, setSavingItemQty] = useState<number | null>(null);

  useEffect(() => {
    const h = (ev: Event) => {
      const e = ev as CustomEvent<{
        selectedItems?: EnrichedItem[];
        shipmentIds?: number[];
      }>;
      const d = e.detail || {};
      const nextItems = Array.isArray(d.selectedItems) ? (d.selectedItems as EnrichedItem[]) : [];
      const nextSids = Array.isArray(d.shipmentIds)
        ? (d.shipmentIds as number[]).filter((n) => Number.isFinite(n))
        : [];
      setItems(nextItems);
      setShipmentIds(nextSids);

      setTrackingByShipment((prev) => {
        const next: Record<number, { amazon: string; ups: string }> = { ...prev };
        for (const it of nextItems) {
          const sid = it.shipment_id;
          if (!next[sid]) {
            next[sid] = {
              amazon: it.amazon_shipment_id ? String(it.amazon_shipment_id) : '',
              ups: '',
            };
          } else if (it.amazon_shipment_id && !next[sid].amazon) {
            next[sid] = { ...next[sid], amazon: String(it.amazon_shipment_id) };
          }
        }
        for (const sid of nextSids) {
          if (!next[sid]) next[sid] = { amazon: '', ups: '' };
        }
        return next;
      });
    };
    window.addEventListener('fba-print-selection', h);
    return () => window.removeEventListener('fba-print-selection', h);
  }, []);

  const itemKeySig = useMemo(() => items.map((i) => i.item_id).sort((a, b) => a - b).join(','), [items]);

  useEffect(() => {
    setQtyByItem((prev) => {
      const next = { ...prev };
      const ids = new Set(items.map((i) => i.item_id));
      for (const id of Object.keys(next).map(Number)) {
        if (!ids.has(id)) delete next[id];
      }
      for (const it of items) {
        if (!qtyDirtyRef.current.has(it.item_id) || next[it.item_id] === undefined) {
          next[it.item_id] = String(defaultPrintQty(it));
        }
      }
      return next;
    });
  }, [itemKeySig, items]);

  const uniqueShipmentIds = useMemo(() => {
    const s = new Set<number>();
    shipmentIds.forEach((id) => s.add(id));
    items.forEach((it) => s.add(it.shipment_id));
    return Array.from(s).sort((a, b) => a - b);
  }, [items, shipmentIds]);

  const readyByShipmentId = useMemo(() => {
    const m: Record<number, boolean> = {};
    for (const sid of uniqueShipmentIds) {
      const t = trackingByShipment[sid];
      const am = t?.amazon ? normalizeFbaId(t.amazon) : '';
      const up = t?.ups ? normalizeUps(t.ups) : '';
      m[sid] = FBA_ID_RE.test(am) && UPS_RE.test(up);
    }
    return m;
  }, [trackingByShipment, uniqueShipmentIds]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('fba-print-sidebar-ready', { detail: { readyByShipmentId } })
    );
  }, [readyByShipmentId]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(
        new CustomEvent('fba-print-sidebar-ready', { detail: { readyByShipmentId: {} } })
      );
    };
  }, []);

  const persistAmazon = useCallback(async (shipmentId: number, amazonRaw: string) => {
    const amazon = normalizeFbaId(amazonRaw);
    if (!FBA_ID_RE.test(amazon)) return;
    setSavingShipment(shipmentId);
    try {
      const res = await fetch(`/api/fba/shipments/${shipmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amazon_shipment_id: amazon }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success && !res.ok) return;
      window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
    } finally {
      setSavingShipment(null);
    }
  }, []);

  const persistUps = useCallback(async (shipmentId: number, upsRaw: string) => {
    const tracking_number = normalizeUps(upsRaw);
    if (!UPS_RE.test(tracking_number)) return;
    setSavingShipment(shipmentId);
    try {
      const res = await fetch(`/api/fba/shipments/${shipmentId}/tracking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_number, carrier: 'UPS', label: 'Print queue' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success && !res.ok) return;
      window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
    } finally {
      setSavingShipment(null);
    }
  }, []);

  const commitItemQty = useCallback(async (item: EnrichedItem) => {
    const raw = qtyByItem[item.item_id];
    const n = Math.max(1, Math.floor(Number(raw) || 0));
    if (n === Number(item.expected_qty)) return;
    setSavingItemQty(item.item_id);
    try {
      const res = await fetch(`/api/fba/shipments/${item.shipment_id}/items/${item.item_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_qty: n }),
      });
      if (res.ok) {
        qtyDirtyRef.current.delete(item.item_id);
        window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
      }
    } finally {
      setSavingItemQty(null);
    }
  }, [qtyByItem]);

  return (
    <div className="flex h-full min-h-0 flex-col border-b border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-black uppercase tracking-tight text-gray-900">Print queue</h2>
            <p className="mt-0.5 text-[10px] font-bold text-gray-500">
              Add Amazon FBA IDs and UPS tracking before printing labels.
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {uniqueShipmentIds.length > 0 ? (
          <div className="divide-y divide-gray-200">
            {uniqueShipmentIds.map((sid) => {
              const t = trackingByShipment[sid] || { amazon: '', ups: '' };
              const amazonOk = FBA_ID_RE.test(normalizeFbaId(t.amazon));
              const upsOk = UPS_RE.test(normalizeUps(t.ups));
              return (
                <div key={sid} className="px-4 py-4">
                  <div className="flex items-center gap-2 text-[10px] text-gray-500">
                    <span className={sectionLabelClass}>Shipment</span>
                    <span className="font-mono font-bold text-gray-900">
                      {planRefById.get(sid) || `#${sid}`}
                    </span>
                    {savingShipment === sid ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" /> : null}
                    {readyByShipmentId[sid] ? (
                      <span title="Ready" aria-label="Ready" className="inline-flex items-center text-emerald-700">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    ) : null}
                  </div>
                  <label className="mt-3 block">
                    <span className={sectionLabelClass}>Amazon FBA ID</span>
                    <input
                      value={t.amazon}
                      onChange={(e) =>
                        setTrackingByShipment((prev) => ({
                          ...prev,
                          [sid]: { ...t, amazon: e.target.value },
                        }))
                      }
                      onBlur={() => void persistAmazon(sid, t.amazon)}
                      placeholder="FBA17XXXXXXXX"
                      className={`${fieldClass} font-mono text-xs ${t.amazon && !amazonOk ? 'border-amber-400' : ''} ${
                        !t.amazon ? 'text-gray-500' : ''
                      }`}
                    />
                  </label>
                  <label className="mt-3 block">
                    <span className={sectionLabelClass}>UPS tracking</span>
                    <input
                      value={t.ups}
                      onChange={(e) =>
                        setTrackingByShipment((prev) => ({
                          ...prev,
                          [sid]: { ...t, ups: e.target.value },
                        }))
                      }
                      onBlur={() => void persistUps(sid, t.ups)}
                      placeholder="1Z999AA10123456784"
                      className={`${fieldClass} font-mono text-xs ${t.ups && !upsOk ? 'border-amber-400' : ''} ${
                        !t.ups ? 'text-gray-500' : ''
                      }`}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-4">
            <p className="text-[11px] leading-5 text-gray-500">
              Select rows in the print table to load shipment details here.
            </p>
          </div>
        )}

        <div className="border-t border-gray-200 px-0 py-4">
          <div className="flex items-center justify-between px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
            <div className="flex items-center gap-1.5">
              <ClipboardList className="h-3.5 w-3.5" />
              <span>Selected products</span>
            </div>
            <span className="text-[9px] font-bold tracking-[0.12em] text-gray-500">{items.length}</span>
          </div>
          {items.length === 0 ? (
            <p className="px-4 pt-2 text-[11px] leading-5 text-gray-500">No rows selected.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3 px-4 pb-3">
              {items.map((it) => {
                const qStr = qtyByItem[it.item_id] ?? String(defaultPrintQty(it));
                const qNum = Math.max(1, Math.floor(Number(qStr) || 0));
                const planned = Number(it.expected_qty) || 0;
                const isDirty = qtyDirtyRef.current.has(it.item_id);
                const abovePlan = qNum > planned;
                return (
                  <li
                    key={it.item_id}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-3 transition-colors ${
                      isDirty ? 'border-blue-200 bg-blue-50/70' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-gray-900">
                        {it.display_title}
                      </p>
                      <p className="mt-1 font-mono text-[10px] font-semibold tracking-[0.2em] text-gray-500">
                        {it.fnsku}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-500">Qty</span>
                      <input
                        type="number"
                        min={1}
                        value={qStr}
                        disabled={savingItemQty === it.item_id}
                        onChange={(e) => {
                          qtyDirtyRef.current.add(it.item_id);
                          setQtyByItem((prev) => ({ ...prev, [it.item_id]: e.target.value }));
                        }}
                        onBlur={() => void commitItemQty(it)}
                        className="w-16 rounded-xl border border-gray-200 bg-white px-2 py-2 text-center text-sm font-mono font-bold tabular-nums text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-blue-500"
                      />
                      {abovePlan ? (
                        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                          <Clock className="h-3 w-3" />
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
