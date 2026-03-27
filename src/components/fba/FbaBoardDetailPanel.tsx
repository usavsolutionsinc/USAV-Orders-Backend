'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Minus, Plus, Trash2 } from '@/components/Icons';
import { FnskuChip } from '@/components/ui/CopyChip';
import { DeferredQtyInput } from '@/design-system/primitives';
import { PanelActionBar } from '@/components/shipped/details-panel/PanelActionBar';
import type { FbaBoardItem } from './FbaBoardTable';

interface FbaBoardDetailPanelProps {
  item: FbaBoardItem;
  onClose: () => void;
  onNavigate: (direction: 'up' | 'down') => void;
  onSaved: () => void;
  disableMoveUp?: boolean;
  disableMoveDown?: boolean;
}

async function patchFbaItem(
  shipmentId: number,
  itemId: number,
  body: Record<string, unknown>,
): Promise<boolean> {
  const res = await fetch(`/api/fba/shipments/${shipmentId}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

async function deleteFbaItem(shipmentId: number, itemId: number): Promise<boolean> {
  const res = await fetch(`/api/fba/shipments/${shipmentId}/items/${itemId}`, {
    method: 'DELETE',
  });
  return res.ok;
}

export function FbaBoardDetailPanel({
  item,
  onClose,
  onNavigate,
  onSaved,
  disableMoveUp = false,
  disableMoveDown = false,
}: FbaBoardDetailPanelProps) {
  const [qty, setQty] = useState(item.expected_qty);
  const [notes, setNotes] = useState(item.item_notes || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync when navigating between items
  useEffect(() => {
    setQty(item.expected_qty);
    setNotes(item.item_notes || '');
    setConfirmDelete(false);
  }, [item.item_id, item.expected_qty, item.item_notes]);

  const saveQty = useCallback(async (nextQty: number) => {
    const clamped = Math.max(1, nextQty);
    setQty(clamped);
    setSaving(true);
    const ok = await patchFbaItem(item.shipment_id, item.item_id, { expected_qty: clamped });
    setSaving(false);
    if (ok) onSaved();
    else setQty(item.expected_qty); // revert
  }, [item.shipment_id, item.item_id, item.expected_qty, onSaved]);

  const saveNotes = useCallback(async () => {
    setSaving(true);
    const ok = await patchFbaItem(item.shipment_id, item.item_id, { notes: notes.trim() || null });
    setSaving(false);
    if (ok) onSaved();
  }, [item.shipment_id, item.item_id, notes, onSaved]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    const ok = await deleteFbaItem(item.shipment_id, item.item_id);
    setDeleting(false);
    if (ok) {
      onSaved();
      onClose();
      window.dispatchEvent(new Event('fba-plan-created'));
    }
  }, [item.shipment_id, item.item_id, onSaved, onClose]);

  const panelActions = [
    {
      label: 'Remove from plan',
      onClick: () => setConfirmDelete(true),
      icon: <Trash2 className="h-3.5 w-3.5" />,
      toneClassName: 'text-red-500',
    },
  ];

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 360, mass: 0.45 }}
      className="fixed right-0 top-0 z-[100] flex h-screen w-[400px] flex-col overflow-hidden border-l border-gray-200 bg-white shadow-[-24px_0_48px_rgba(0,0,0,0.06)]"
    >
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 bg-white px-6 py-5">
        <p className="mb-1.5 text-[9px] font-black uppercase tracking-[0.3em] text-purple-700">
          FBA Item
        </p>
        <h2 className="text-[17px] font-black leading-snug tracking-tight text-slate-950">
          {item.display_title}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <FnskuChip value={item.fnsku} />
          <span className="whitespace-nowrap font-mono text-[10px] font-bold text-gray-400">
            {item.shipment_ref || '—'}
          </span>
        </div>
      </div>

      <PanelActionBar
        onClose={onClose}
        onMoveUp={() => onNavigate('up')}
        onMoveDown={() => onNavigate('down')}
        disableMoveUp={disableMoveUp}
        disableMoveDown={disableMoveDown}
        rightActions={panelActions}
      />

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-6">
          {/* Qty editor */}
          <section>
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
              Expected Quantity
            </p>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => void saveQty(qty - 1)}
                disabled={saving || qty <= 1}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40"
                aria-label="Decrease quantity"
              >
                <Minus className="h-4 w-4" />
              </button>
              <DeferredQtyInput
                value={qty}
                min={1}
                max={9999}
                onChange={(v) => void saveQty(v)}
                className="h-12 w-20 rounded-xl border border-gray-200 bg-white text-center text-xl font-black tabular-nums text-gray-900 outline-none transition-colors focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => void saveQty(qty + 1)}
                disabled={saving}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40"
                aria-label="Increase quantity"
              >
                <Plus className="h-4 w-4" />
              </button>
              {saving && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              Scanned: <span className="font-bold text-gray-600">{item.actual_qty}</span>
            </p>
          </section>

          <div className="h-px bg-gray-100" />

          {/* Info cards */}
          <section>
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
              Details
            </p>
            <dl className="space-y-1.5 text-[12px]">
              {[
                { label: 'Plan', value: item.shipment_ref || '—' },
                { label: 'FNSKU', value: item.fnsku },
                ...(item.asin ? [{ label: 'ASIN', value: item.asin }] : []),
                ...(item.sku ? [{ label: 'SKU', value: item.sku }] : []),
                ...(item.destination_fc ? [{ label: 'Destination FC', value: item.destination_fc }] : []),
                ...(item.condition ? [{ label: 'Condition', value: item.condition }] : []),
                ...(item.amazon_shipment_id ? [{ label: 'Amazon Shipment', value: item.amazon_shipment_id }] : []),
                { label: 'Status', value: item.item_status.replace(/_/g, ' ') },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <dt className="font-medium text-slate-400">{label}</dt>
                  <dd className="max-w-[220px] text-right font-black text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="h-px bg-gray-100" />

          {/* Notes */}
          <section>
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
              Notes
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes.trim() !== (item.item_notes || '').trim()) {
                  void saveNotes();
                }
              }}
              rows={3}
              disabled={saving}
              placeholder="Add notes..."
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-900 outline-none transition-colors focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 disabled:opacity-50"
            />
          </section>

          {/* Delete confirmation */}
          {confirmDelete && (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-xs font-bold text-red-900">
                Remove <span className="font-mono">{item.fnsku}</span> from {item.shipment_ref || 'this plan'}?
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="h-8 rounded-lg border border-gray-200 bg-white text-[9px] font-black uppercase tracking-wider text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-red-600 text-[9px] font-black uppercase tracking-wider text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  {deleting ? 'Removing...' : 'Remove'}
                </button>
              </div>
            </section>
          )}

          {/* Tracking numbers */}
          {item.tracking_numbers.length > 0 && (
            <>
              <div className="h-px bg-gray-100" />
              <section>
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                  Tracking
                </p>
                <div className="space-y-1">
                  {item.tracking_numbers.map((t, i) => (
                    <p key={i} className="font-mono text-[11px] font-bold text-gray-700">
                      {t.carrier && <span className="text-gray-400">{t.carrier} </span>}
                      {t.tracking_number}
                    </p>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
