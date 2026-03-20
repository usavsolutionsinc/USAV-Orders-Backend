'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Package,
  Printer,
  PackageCheck,
  Check,
  RefreshCw,
  AlertCircle,
} from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import type { FbaSummaryRow } from '@/components/fba/types';
import { getFbaReadyToPrintQty } from '@/components/fba/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShipmentItem {
  id: number;
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  expected_qty: number;
  actual_qty: number;
  status: string;
  ready_at: string | null;
  ready_by_name: string | null;
}

interface Shipment {
  id: number;
  shipment_ref: string;
  destination_fc: string | null;
  due_date: string | null;
  status: string;
  assigned_packer_name: string | null;
  ready_items: number;
  total_items: number;
}

interface ShipmentWithItems extends Shipment {
  items: ShipmentItem[];
}

interface FallbackReadyRow extends FbaSummaryRow {
  ready_to_print_qty?: number;
}

function getUnitCount(items: ShipmentItem[]): number {
  return items.reduce((sum, item) => sum + Math.max(Number(item.actual_qty || 0), 0), 0);
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PLANNED: 'bg-gray-100 text-gray-600',
    READY_TO_GO: 'bg-gray-900 text-white',
    LABEL_ASSIGNED: 'bg-gray-200 text-gray-700',
    SHIPPED: 'bg-gray-100 text-gray-500',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${map[status] ?? 'bg-gray-100 text-gray-500'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ─── Single shipment card ─────────────────────────────────────────────────────

function ShipmentLabelCard({
  shipment,
  onPrinted,
}: {
  shipment: ShipmentWithItems;
  onPrinted: (shipmentId: number, itemIds: number[]) => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const [marking, setMarking] = useState(false);
  const [markedIds, setMarkedIds] = useState<Set<number>>(new Set());

  const readyItems = shipment.items.filter((i) => i.status === 'READY_TO_GO');

  const handlePrint = () => {
    if (!printRef.current) return;
    const printContents = printRef.current.innerHTML;
    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>FBA Label Queue — ${shipment.shipment_ref}</title>
          <style>
            body { font-family: system-ui, sans-serif; padding: 24px; font-size: 11px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; }
            th { background: #f9fafb; font-weight: 700; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; }
            h2 { font-size: 16px; font-weight: 800; margin: 0 0 4px; }
            .meta { color: #6b7280; margin: 0 0 16px; font-size: 10px; }
            .fnsku { font-family: monospace; font-size: 11px; font-weight: 700; }
          </style>
        </head>
        <body>${printContents}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  };

  const handleMarkPrinted = async () => {
    if (readyItems.length === 0) return;
    setMarking(true);
    const ids: number[] = [];
    try {
      for (const item of readyItems) {
        const res = await fetch(
          `/api/fba/shipments/${shipment.id}/items/${item.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'LABEL_ASSIGNED' }),
          }
        );
        if (res.ok) ids.push(item.id);
      }
      setMarkedIds((prev) => new Set(Array.from(prev).concat(ids)));
      onPrinted(shipment.id, ids);
    } finally {
      setMarking(false);
    }
  };

  const visibleItems = readyItems.filter((i) => !markedIds.has(i.id));
  const combineBoxCount = visibleItems.length;
  const combineUnitCount = getUnitCount(visibleItems);
  const combineLabelBatches = combineBoxCount > 0 ? 1 : 0;

  if (readyItems.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="overflow-hidden border-b border-gray-200 bg-white"
    >
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center border border-gray-200 flex-shrink-0">
            <Package className="w-4 h-4 text-gray-900" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black text-gray-900 truncate">{shipment.shipment_ref}</p>
            <div className="flex items-center gap-2 flex-wrap">
              {shipment.destination_fc && (
                <span className="text-[10px] text-gray-500 font-bold">FC {shipment.destination_fc}</span>
              )}
              {shipment.due_date && (
                <span className="text-[10px] text-gray-400">
                  Due: {new Date(shipment.due_date).toLocaleDateString()}
                </span>
              )}
              <span className="text-[10px] font-black text-gray-900">
                {combineBoxCount} boxes • {combineUnitCount} units • {combineLabelBatches} label batch
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 border border-gray-900 px-3 py-2 text-[10px] font-black text-gray-900 transition-all active:scale-95 hover:bg-gray-900 hover:text-white"
          >
            <Printer className="w-3 h-3" />
            Print
          </button>
          <button
            onClick={handleMarkPrinted}
            disabled={marking || visibleItems.length === 0}
            className="flex items-center gap-1.5 bg-gray-900 px-3 py-2 text-[10px] font-black text-white transition-all active:scale-95 disabled:opacity-50 hover:bg-gray-800"
          >
            {marking ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Check className="w-3 h-3" />
            )}
            Mark Combined
          </button>
        </div>
      </div>

      {/* Printable table area */}
      <div ref={printRef} className="px-4 py-4">
        <h2>{shipment.shipment_ref}</h2>
        <p className="meta">
          {shipment.destination_fc ? `FC: ${shipment.destination_fc} · ` : ''}
          {shipment.due_date ? `Due: ${new Date(shipment.due_date).toLocaleDateString()} · ` : ''}
          Combine {combineBoxCount} boxes ({combineUnitCount} units) into {combineLabelBatches} label batch
        </p>
        <table className="w-full text-xs hidden print:table">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-3 py-2 text-[9px] font-black uppercase tracking-wider text-gray-500">FNSKU</th>
              <th className="text-left px-3 py-2 text-[9px] font-black uppercase tracking-wider text-gray-500">Product</th>
              <th className="text-left px-3 py-2 text-[9px] font-black uppercase tracking-wider text-gray-500">SKU</th>
              <th className="text-center px-3 py-2 text-[9px] font-black uppercase tracking-wider text-gray-500">Exp</th>
              <th className="text-center px-3 py-2 text-[9px] font-black uppercase tracking-wider text-gray-500">Act</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2 font-mono text-xs">{item.fnsku}</td>
                <td className="px-3 py-2">{item.product_title || '—'}</td>
                <td className="px-3 py-2 text-gray-500">{item.sku || '—'}</td>
                <td className="px-3 py-2 text-center tabular-nums">{item.expected_qty}</td>
                <td className="px-3 py-2 text-center tabular-nums font-bold">{item.actual_qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* On-screen item rows */}
      <div className="divide-y divide-gray-200">
        <AnimatePresence>
          {visibleItems.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-gray-900 truncate">
                  {item.product_title || item.fnsku}
                </p>
                <div className="mt-0.5 flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-[10px] text-gray-500">{item.fnsku}</span>
                  {item.sku && (
                    <span className="text-[10px] text-gray-400">SKU: {item.sku}</span>
                  )}
                  {item.ready_by_name && (
                    <span className="text-[10px] text-gray-400">by {item.ready_by_name}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="text-right">
                  <p className="text-xs font-black tabular-nums text-gray-900">
                    {item.actual_qty}
                    <span className="text-gray-300 mx-0.5">/</span>
                    <span className="text-gray-400 font-bold">{item.expected_qty}</span>
                  </p>
                  <p className="text-[8px] font-black text-gray-400 uppercase">qty</p>
                </div>
                <StatusBadge status={item.status} />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {visibleItems.length === 0 && readyItems.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 text-gray-700">
            <PackageCheck className="w-4 h-4" />
            <p className="text-xs font-bold">All items marked as label assigned</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface FbaLabelQueueProps {
  refreshTrigger?: number;
}

export function FbaLabelQueue({ refreshTrigger = 0 }: FbaLabelQueueProps) {
  const [shipments, setShipments] = useState<ShipmentWithItems[]>([]);
  const [fallbackRows, setFallbackRows] = useState<FallbackReadyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  const loadQueue = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Fetch shipments that have at least some ready items
      const shipRes = await fetch(
        '/api/fba/shipments?status=READY_TO_GO,PLANNED,LABEL_ASSIGNED&limit=50'
      );
      const shipData = await shipRes.json();
      if (!shipData.success) throw new Error(shipData.error || 'Failed to fetch shipments');

      const shipmentList: Shipment[] = shipData.shipments || [];

      // Filter to shipments that have ready_items > 0
      const relevant = shipmentList.filter(
        (s) => Number(s.ready_items) > 0
      );

      // Fetch items for each relevant shipment in parallel
      const withItems = await Promise.all(
        relevant.map(async (s) => {
          const itemRes = await fetch(`/api/fba/shipments/${s.id}/items`);
          const itemData = await itemRes.json();
          const items: ShipmentItem[] = (itemData.items || []).filter(
            (i: ShipmentItem) => i.status === 'READY_TO_GO'
          );
          return { ...s, items };
        })
      );

      // Only show shipments that actually have READY_TO_GO items
      const visibleShipments = withItems.filter((s) => s.items.length > 0);
      setShipments(visibleShipments);

      // Fallback mode: surface event-ledger rows that are ready to print but
      // not linked to an open shipment record yet.
      if (visibleShipments.length === 0) {
        const summaryRes = await fetch('/api/fba/logs/summary?mode=READY_TO_GO&limit=300', { cache: 'no-store' });
        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          const rows = Array.isArray(summaryData?.rows) ? (summaryData.rows as FallbackReadyRow[]) : [];
          setFallbackRows(rows.filter((row) => getFbaReadyToPrintQty(row) > 0));
        } else {
          setFallbackRows([]);
        }
      } else {
        setFallbackRows([]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load label queue');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue, refreshTrigger, refreshCount]);

  const handlePrinted = useCallback((shipmentId: number, itemIds: number[]) => {
    setShipments((prev) =>
      prev
        .map((s) => {
          if (s.id !== shipmentId) return s;
          return {
            ...s,
            items: s.items.map((i) =>
              itemIds.includes(i.id) ? { ...i, status: 'LABEL_ASSIGNED' } : i
            ),
          };
        })
        .filter((s) => s.items.some((i) => i.status === 'READY_TO_GO'))
    );
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-gray-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-4 my-4 flex items-center gap-3 border border-red-200 bg-red-50 p-4">
        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
        <p className="text-sm font-bold text-red-700">{error}</p>
        <button
          onClick={() => setRefreshCount((c) => c + 1)}
          className="ml-auto bg-red-600 px-3 py-1.5 text-xs font-black text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className={mainStickyHeaderClass}>
        <div className={mainStickyHeaderRowClass}>
        <div className="flex items-center gap-2 min-w-0">
          <Printer className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-black text-gray-900">Print Queue</span>
        </div>
        <button
          onClick={() => setRefreshCount((c) => c + 1)}
          className="border border-gray-200 p-2 transition-colors hover:bg-gray-50"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4 text-gray-500" />
        </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <AnimatePresence>
          {shipments.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 text-center"
            >
              {fallbackRows.length > 0 ? (
                <div className="w-full max-w-5xl px-4 text-left">
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-800">Event-Ledger Fallback</p>
                    <p className="text-[11px] font-semibold text-amber-800">
                      Ready-to-print FNSKUs exist, but they are not linked to active `fba_shipments` records yet.
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                    <div className="grid grid-cols-[minmax(0,1fr)_120px_120px] gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
                      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-500">FNSKU / Product</p>
                      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-500">Ready Units</p>
                      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-500">Shipment Ref</p>
                    </div>
                    {fallbackRows.map((row) => (
                      <div key={row.fnsku} className="grid grid-cols-[minmax(0,1fr)_120px_120px] gap-2 border-b border-gray-100 px-3 py-2 last:border-b-0">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black text-gray-900">{row.product_title || row.fnsku}</p>
                          <p className="truncate font-mono text-[10px] text-gray-500">{row.fnsku}{row.sku ? ` • ${row.sku}` : ''}</p>
                        </div>
                        <p className="text-xs font-black tabular-nums text-violet-700">{getFbaReadyToPrintQty(row)}</p>
                        <p className="text-[10px] font-bold text-gray-500">{row.shipment_ref || 'Unlinked'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-4 flex h-16 w-16 items-center justify-center border border-gray-200">
                    <PackageCheck className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-sm font-black text-gray-500">No box groups ready to combine</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Items appear here after packing scans move them to READY_TO_GO
                  </p>
                </>
              )}
            </motion.div>
          ) : (
            shipments.map((s) => (
              <ShipmentLabelCard key={s.id} shipment={s} onPrinted={handlePrinted} />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
