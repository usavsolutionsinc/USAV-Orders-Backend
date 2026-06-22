'use client';

import { useCallback, useEffect, useState } from 'react';
import { patchFbaItem, deleteFbaItem } from '@/lib/fba/patch';
import {
  Calendar, Check, ChevronDown,
  ClipboardList, Loader2, Minus, Plus, Trash2,
} from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { DeferredQtyInput } from '@/design-system/primitives';
import { formatCreatedAt, formatPlanDate, type PlanEntry } from './board-detail-shared';

/* ── Entry Card (one plan row) ─────────────────────────────────────── */

export function PlanEntryCard({
  entry,
  onQtySaved,
  onDeleted,
}: {
  entry: PlanEntry;
  onQtySaved: () => void;
  onDeleted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [qty, setQty] = useState(entry.expected_qty);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setQty(entry.expected_qty);
    setConfirmDelete(false);
    setDeleteError(null);
  }, [entry.item_id, entry.expected_qty]);

  const saveQty = useCallback(
    async (next: number) => {
      const clamped = Math.max(1, next);
      setQty(clamped);
      setSaving(true);
      const ok = await patchFbaItem(entry.shipment_id, entry.item_id, { expected_qty: clamped });
      setSaving(false);
      if (ok) onQtySaved();
      else setQty(entry.expected_qty);
    },
    [entry.shipment_id, entry.item_id, entry.expected_qty, onQtySaved],
  );

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteFbaItem(entry.shipment_id, entry.item_id);
    setDeleting(false);
    if (result.ok) {
      onDeleted();
      window.dispatchEvent(new Event('usav-refresh-data'));
    } else {
      setDeleteError(result.error || 'Failed to remove');
    }
  }, [entry.shipment_id, entry.item_id, onDeleted]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Calendar className="h-3 w-3 shrink-0 text-purple-500" />
            <span className="text-label font-black text-gray-900">
              {entry.shipment_ref || formatPlanDate(entry.due_date)}
            </span>
          </div>
          <div className="flex items-center gap-3 pl-5 text-caption">
            <span className="flex items-center gap-1 font-bold text-gray-500">
              <ClipboardList className="h-3 w-3 text-purple-400" />
              <span className="tabular-nums">{entry.expected_qty}</span>
            </span>
            <span className="flex items-center gap-1 font-bold text-emerald-700">
              <Check className="h-3 w-3 text-emerald-500" />
              <span className="tabular-nums">{entry.actual_qty}</span>
            </span>
            <span className="text-micro font-bold text-gray-400">
              {formatCreatedAt(entry.plan_created_at)}
            </span>
          </div>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-gray-100 px-3 py-3">
          <div>
            <p className={`mb-2 ${sectionLabel}`}>Quantity</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void saveQty(qty - 1)}
                disabled={saving || qty <= 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40"
                aria-label="Decrease quantity"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <DeferredQtyInput
                value={qty}
                min={1}
                max={9999}
                onChange={(v) => void saveQty(v)}
                className="h-10 w-16 rounded-lg border border-gray-200 bg-white text-center text-lg font-black tabular-nums text-gray-900 outline-none transition-colors focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => void saveQty(qty + 1)}
                disabled={saving}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40"
                aria-label="Increase quantity"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
            </div>
          </div>

          <dl className="space-y-1 text-caption">
            {entry.destination_fc && (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-gray-500">Destination FC</dt>
                <dd className="font-black text-gray-800">{entry.destination_fc}</dd>
              </div>
            )}
            {entry.amazon_shipment_id && (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-gray-500">Amazon Shipment</dt>
                <dd className="font-black text-gray-800">{entry.amazon_shipment_id}</dd>
              </div>
            )}
            {entry.condition && (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-gray-500">Condition</dt>
                <dd className="font-black text-gray-800">{entry.condition}</dd>
              </div>
            )}
            {entry.item_notes && (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-gray-500">Notes</dt>
                <dd className="max-w-[200px] text-right font-bold text-gray-700">{entry.item_notes}</dd>
              </div>
            )}
          </dl>

          {entry.tracking_numbers.length > 0 && (
            <div>
              <p className={`mb-1.5 ${sectionLabel}`}>Tracking</p>
              <div className="space-y-0.5">
                {entry.tracking_numbers.map((t, i) => (
                  <p key={i} className="font-mono text-micro font-bold text-gray-600">
                    {t.carrier && <span className="text-gray-400">{t.carrier} </span>}
                    {t.tracking_number}
                  </p>
                ))}
              </div>
            </div>
          )}

          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-micro font-bold text-red-500 transition-colors hover:text-red-700"
            >
              <Trash2 className="h-3 w-3" />
              Remove entry
            </button>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-caption font-bold text-red-800">
                Remove this entry from {entry.shipment_ref || 'plan'}?
              </p>
              {deleteError && (
                <p className="mt-1 text-micro font-semibold text-red-600">{deleteError}</p>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
                  className="h-7 rounded-md border border-gray-200 bg-white text-eyebrow font-black uppercase tracking-wider text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-red-600 text-eyebrow font-black uppercase tracking-wider text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Trash2 className="h-2.5 w-2.5" />}
                  {deleting ? 'Removing...' : 'Remove'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
