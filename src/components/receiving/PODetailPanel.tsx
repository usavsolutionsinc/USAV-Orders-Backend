'use client';

import { useState } from 'react';
import { Check, Loader2, Package, X } from '@/components/Icons';
import { type ZohoPO, CONDITION_OPTIONS, CHANNEL_OPTIONS, statusColor, fmtDate } from './zoho-po-types';

interface LineFormState {
  quantity_received: string;
  condition_grade: string;
}

interface PODetailPanelProps {
  po: ZohoPO;
  onClose: () => void;
  onReceived: (receivingId: number) => void;
}

export function PODetailPanel({ po, onClose, onReceived }: PODetailPanelProps) {
  const lines = po.line_items ?? [];

  const [lineState, setLineState] = useState<Record<string, LineFormState>>(() =>
    Object.fromEntries(
      lines.map((l) => [
        l.line_item_id,
        { quantity_received: String(l.quantity ?? ''), condition_grade: 'BRAND_NEW' },
      ])
    )
  );
  const [targetChannel, setTargetChannel] = useState('');
  const [needsTest, setNeedsTest]         = useState(false);
  const [submitting, setSubmitting]       = useState(false);
  const [successId, setSuccessId]         = useState<number | null>(null);
  const [error, setError]                 = useState<string | null>(null);

  const updateLine = (id: string, field: keyof LineFormState, value: string) =>
    setLineState((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const handleReceive = async () => {
    setError(null);
    const submitLines = lines
      .map((l) => ({
        line_item_id: l.line_item_id,
        item_id: l.item_id,
        item_name: l.name || null,
        sku: l.sku || null,
        quantity_received: Number(lineState[l.line_item_id]?.quantity_received ?? 0),
        condition_grade: lineState[l.line_item_id]?.condition_grade ?? 'BRAND_NEW',
      }))
      .filter((l) => l.quantity_received > 0);

    if (submitLines.length === 0) {
      setError('Enter a received quantity for at least one item.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/zoho/purchase-orders/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseorder_id: po.purchaseorder_id,
          warehouse_id: po.warehouse_id || undefined,
          line_items: submitLines,
          target_channel: targetChannel || undefined,
          needs_test: needsTest,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Receive failed');
      setSuccessId(Number(json.receiving_id));
      onReceived(Number(json.receiving_id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Receive failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (successId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
        <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center">
          <Check className="h-7 w-7 text-green-600" />
        </div>
        <p className="text-[13px] font-black text-gray-800 uppercase tracking-wide">Items Received</p>
        <p className="text-[11px] text-gray-500">
          Receiving record #{successId} created and saved to Zoho Inventory.
        </p>
        <button
          onClick={onClose}
          className="mt-2 text-[10px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-700 transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-black text-gray-900 uppercase tracking-wide">
              {po.purchaseorder_number || po.purchaseorder_id}
            </span>
            <span
              className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${statusColor(po.status)}`}
            >
              {po.status}
            </span>
          </div>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {po.vendor_name} &middot; {fmtDate(po.date)}
            {po.delivery_date ? ` · Due ${fmtDate(po.delivery_date)}` : ''}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-600 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Line Items Table */}
      <div className="flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
            <Package className="h-10 w-10 mb-3" />
            <p className="text-[10px] font-black uppercase tracking-widest">No line items</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            <div className="grid grid-cols-[1fr_80px_90px_110px] gap-2 px-4 py-1.5 bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
              {['Item', 'Expected', 'Receive', 'Condition'].map((h) => (
                <span key={h} className="text-[8px] font-black uppercase tracking-widest text-gray-500">{h}</span>
              ))}
            </div>

            {lines.map((line) => {
              const ls = lineState[line.line_item_id] ?? { quantity_received: '', condition_grade: 'BRAND_NEW' };
              const remaining = Math.max(0, (line.quantity ?? 0) - (line.quantity_received ?? 0));
              return (
                <div
                  key={line.line_item_id}
                  className="grid grid-cols-[1fr_80px_90px_110px] gap-2 px-4 py-2.5 items-center"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-gray-800 truncate leading-tight">
                      {line.name || line.item_id}
                    </p>
                    {line.sku && <p className="text-[9px] font-mono text-gray-500 mt-0.5">{line.sku}</p>}
                  </div>

                  <div className="text-center">
                    <span className="text-[12px] font-black tabular-nums text-gray-700">{line.quantity ?? '—'}</span>
                    {remaining > 0 && line.quantity_received != null && line.quantity_received > 0 && (
                      <p className="text-[8px] text-orange-500 font-semibold">{remaining} left</p>
                    )}
                  </div>

                  <input
                    type="number"
                    min={0}
                    max={line.quantity ?? 9999}
                    value={ls.quantity_received}
                    onChange={(e) => updateLine(line.line_item_id, 'quantity_received', e.target.value)}
                    placeholder="0"
                    className="w-full text-center text-[12px] font-black tabular-nums border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors bg-white"
                  />

                  <select
                    value={ls.condition_grade}
                    onChange={(e) => updateLine(line.line_item_id, 'condition_grade', e.target.value)}
                    className="w-full text-[10px] font-bold border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors bg-white text-gray-700"
                  >
                    {CONDITION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-4 py-3 bg-white">
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Channel</span>
            <select
              value={targetChannel}
              onChange={(e) => setTargetChannel(e.target.value)}
              className="text-[10px] font-bold border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:border-blue-400 bg-white text-gray-700"
            >
              {CHANNEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <div
              onClick={() => setNeedsTest((v) => !v)}
              className={`h-4 w-8 rounded-full transition-colors relative ${needsTest ? 'bg-blue-500' : 'bg-gray-200'}`}
            >
              <div
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                  needsTest ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Needs Test</span>
          </label>
        </div>

        {error && <p className="text-[10px] font-semibold text-red-500 mb-2">{error}</p>}

        <button
          onClick={handleReceive}
          disabled={submitting || lines.length === 0}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-black uppercase tracking-widest transition-colors"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {submitting ? 'Receiving…' : 'Receive Items'}
        </button>
      </div>
    </div>
  );
}
