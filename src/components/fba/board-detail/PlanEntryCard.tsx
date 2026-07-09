'use client';

import { useCallback, useEffect, useState } from 'react';
import { patchFbaItem, deleteFbaItem } from '@/lib/fba/patch';
import {
  Calendar, Check, ChevronDown,
  ClipboardList, Loader2, Minus, Plus, Trash2,
} from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { Button, DeferredQtyInput, IconButton } from '@/design-system/primitives';
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
    <div className="rounded-xl border border-border-soft bg-surface-card">
      {/* ds-raw-button: full-width multi-line card-header expand toggle (left-aligned, composite content) */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Calendar className="h-3 w-3 shrink-0 text-purple-500" />
            <span className="text-label font-black text-text-default">
              {entry.shipment_ref || formatPlanDate(entry.due_date)}
            </span>
          </div>
          <div className="flex items-center gap-3 pl-5 text-caption">
            <span className="flex items-center gap-1 font-bold text-text-soft">
              <ClipboardList className="h-3 w-3 text-purple-400" />
              <span className="tabular-nums">{entry.expected_qty}</span>
            </span>
            <span className="flex items-center gap-1 font-bold text-emerald-700">
              <Check className="h-3 w-3 text-emerald-500" />
              <span className="tabular-nums">{entry.actual_qty}</span>
            </span>
            <span className="text-micro font-bold text-text-faint">
              {formatCreatedAt(entry.plan_created_at)}
            </span>
          </div>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-text-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border-hairline px-3 py-3">
          <div>
            <p className={`mb-2 ${sectionLabel}`}>Quantity</p>
            <div className="flex items-center gap-3">
              <IconButton
                icon={<Minus className="h-3.5 w-3.5" />}
                ariaLabel="Decrease quantity"
                onClick={() => void saveQty(qty - 1)}
                disabled={saving || qty <= 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-soft text-text-soft hover:bg-surface-hover disabled:opacity-40"
              />
              <DeferredQtyInput
                value={qty}
                min={1}
                max={9999}
                onChange={(v) => void saveQty(v)}
                className="h-10 w-16 rounded-lg border border-border-soft bg-surface-card text-center text-lg font-black tabular-nums text-text-default outline-none transition-colors focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <IconButton
                icon={<Plus className="h-3.5 w-3.5" />}
                ariaLabel="Increase quantity"
                onClick={() => void saveQty(qty + 1)}
                disabled={saving}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-soft text-text-soft hover:bg-surface-hover disabled:opacity-40"
              />
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-faint" />}
            </div>
          </div>

          <dl className="space-y-1 text-caption">
            {entry.destination_fc && (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-text-soft">Destination FC</dt>
                <dd className="font-black text-text-default">{entry.destination_fc}</dd>
              </div>
            )}
            {entry.amazon_shipment_id && (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-text-soft">Amazon Shipment</dt>
                <dd className="font-black text-text-default">{entry.amazon_shipment_id}</dd>
              </div>
            )}
            {entry.condition && (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-text-soft">Condition</dt>
                <dd className="font-black text-text-default">{entry.condition}</dd>
              </div>
            )}
            {entry.item_notes && (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-text-soft">Notes</dt>
                <dd className="max-w-[200px] text-right font-bold text-text-muted">{entry.item_notes}</dd>
              </div>
            )}
          </dl>

          {entry.tracking_numbers.length > 0 && (
            <div>
              <p className={`mb-1.5 ${sectionLabel}`}>Tracking</p>
              <div className="space-y-0.5">
                {entry.tracking_numbers.map((t, i) => (
                  <p key={i} className="font-mono text-micro font-bold text-text-muted">
                    {t.carrier && <span className="text-text-faint">{t.carrier} </span>}
                    {t.tracking_number}
                  </p>
                ))}
              </div>
            </div>
          )}

          {!confirmDelete ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 className="h-3 w-3" />}
              onClick={() => setConfirmDelete(true)}
              className="h-auto gap-1.5 px-0 text-micro font-bold text-red-500 hover:bg-transparent hover:text-red-700"
            >
              Remove entry
            </Button>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-caption font-bold text-red-800">
                Remove this entry from {entry.shipment_ref || 'plan'}?
              </p>
              {deleteError && (
                <p className="mt-1 text-micro font-semibold text-red-600">{deleteError}</p>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
                  className="h-7 w-full rounded-md text-eyebrow font-black uppercase tracking-wider text-text-muted"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  icon={<Trash2 className="h-2.5 w-2.5" />}
                  loading={deleting}
                  onClick={() => void handleDelete()}
                  className="h-7 w-full gap-1 rounded-md bg-red-600 text-eyebrow font-black uppercase tracking-wider hover:bg-red-700"
                >
                  {deleting ? 'Removing...' : 'Remove'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
