'use client';

import { useEffect, useState } from 'react';
import type { Dispatch } from 'react';
import type { EnrichedItem, ItemStatus, TableAction } from './types';
import { RemoveFromPlanButton } from './RemoveFromPlanButton';
import { enrichFromApi } from './utils';
import type { PrintQueueItem } from './types';

async function patchItem(
  planId: number,
  itemId: number,
  body: Record<string, unknown>
): Promise<{ ok: boolean; item?: PrintQueueItem }> {
  const res = await fetch(`/api/fba/shipments/${planId}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) return { ok: false };
  return { ok: true, item: data.item };
}

function buildNotesForStatus(status: ItemStatus, reason: 'qc_fail' | 'out_of_stock', note: string): string | null {
  if (status === 'pending_qc_fail' || reason === 'qc_fail') {
    const t = note.trim();
    return t ? `QC_FAIL:${t}` : 'QC_FAIL:';
  }
  if (status === 'pending_out_of_stock' || reason === 'out_of_stock') {
    return note.trim() || null;
  }
  return null;
}

export function ItemExpandPanel({
  item,
  dispatch,
  onRequestRemove,
}: {
  item: EnrichedItem;
  dispatch: Dispatch<TableAction>;
  onRequestRemove: (item: EnrichedItem) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [localStatus, setLocalStatus] = useState<ItemStatus>(item.status);
  const [localNote, setLocalNote] = useState(item.pending_reason_note || '');

  useEffect(() => {
    setLocalStatus(item.status);
    setLocalNote(item.pending_reason_note || '');
  }, [item.item_id, item.status, item.pending_reason, item.pending_reason_note]);

  const canRemoveSingle = item.expected_qty === 1 && item.actual_qty === 0;
  const statusOptions: { value: ItemStatus; label: string; hint: string }[] = [
    { value: 'ready_to_print', label: 'Ready', hint: 'Queued for label print' },
    { value: 'needs_print', label: 'Needs print', hint: 'Relabel before shipping' },
    { value: 'pending_out_of_stock', label: 'Out of stock', hint: 'Waiting on inventory' },
    { value: 'pending_qc_fail', label: 'QC fail', hint: 'Blocked by quality review' },
  ];

  const applyServerItem = (raw: Record<string, unknown>) => {
    const merged = {
      ...item,
      ...raw,
      item_status: String(raw.status ?? item.item_status ?? ''),
      item_notes: (raw.notes as string | null | undefined) ?? item.item_notes ?? null,
    } as PrintQueueItem & { status?: string; notes?: string | null };
    const enriched = enrichFromApi(merged);
    dispatch({ type: 'PATCH_ITEM', id: item.item_id, patch: { ...enriched, expanded: item.expanded } });
  };

  const savePatch = async (body: Record<string, unknown>, optimistic: Partial<EnrichedItem>) => {
    setSaving(true);
    dispatch({ type: 'PATCH_ITEM', id: item.item_id, patch: optimistic });
    const response = await patchItem(item.plan_id, item.item_id, body);
    setSaving(false);
    if (response.ok && response.item) applyServerItem(response.item as unknown as Record<string, unknown>);
  };

  const commitStatus = async (next: ItemStatus) => {
    setLocalStatus(next);
    if (next === 'ready_to_print') {
      await savePatch({ status: 'READY_TO_GO', notes: null }, { status: 'ready_to_print', pending_reason: null, pending_reason_note: undefined });
      setLocalNote('');
      return;
    }
    if (next === 'needs_print') {
      await savePatch({ status: 'PACKING' }, { status: 'needs_print', pending_reason: null });
      return;
    }
    if (next === 'pending_out_of_stock') {
      await savePatch(
        { status: 'OUT_OF_STOCK', notes: localNote.trim() || null },
        { status: 'pending_out_of_stock', pending_reason: 'out_of_stock', pending_reason_note: localNote || undefined }
      );
      return;
    }
    if (next === 'pending_qc_fail') {
      const notes = buildNotesForStatus('pending_qc_fail', 'qc_fail', localNote);
      await savePatch(
        { status: 'OUT_OF_STOCK', notes },
        { status: 'pending_qc_fail', pending_reason: 'qc_fail', pending_reason_note: localNote || undefined }
      );
    }
  };

  return (
    <div
      className="border-t border-zinc-100 bg-stone-50/95 px-4 py-4"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-sky-700">FNSKU details</p>
      <div className="grid gap-2 md:grid-cols-3">
        {item.asin ? (
          <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-2.5">
            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-400">Catalog</p>
            <p className="mt-1 text-[11px] font-mono text-zinc-700">
              <span>
                ASIN <span className="text-zinc-900">{item.asin}</span>
              </span>
            </p>
          </div>
        ) : null}
        <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-2.5">
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-400">Plan</p>
          <p className="mt-1 text-[11px] font-mono text-zinc-700">
            <span className="text-zinc-900">{item.plan_ref}</span>
            {item.amazon_shipment_id ? (
              <>
                {' '}
                <span>
                  | Amazon <span className="text-zinc-900">{item.amazon_shipment_id}</span>
                </span>
              </>
            ) : null}
          </p>
        </div>
        {item.destination_fc ? (
          <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-2.5">
            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-400">Destination</p>
            <p className="mt-1 text-[11px] font-mono text-zinc-900">{item.destination_fc}</p>
          </div>
        ) : null}
      </div>

      <p className="mb-2 mt-4 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Status</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {statusOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={saving}
            onClick={() => void commitStatus(option.value)}
            className={`rounded-2xl border px-3 py-2.5 text-left transition-colors ${
              localStatus === option.value
                ? 'border-sky-300 bg-sky-50 text-sky-950 shadow-sm shadow-sky-100/80'
                : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
            } ${saving ? 'cursor-wait opacity-70' : ''}`}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.14em]">{option.label}</p>
            <p className="mt-1 text-[10px] font-medium text-zinc-500">{option.hint}</p>
          </button>
        ))}
      </div>

      {(localStatus === 'pending_out_of_stock' || localStatus === 'pending_qc_fail') && (
        <div className="mt-3 flex max-w-md flex-col gap-1.5">
          <label className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">Note for team</label>
          <textarea
            value={localNote}
            disabled={saving}
            onChange={(e) => setLocalNote(e.target.value)}
            onBlur={() => {
              if (localStatus === 'pending_out_of_stock') {
                void savePatch(
                  { notes: localNote.trim() || null, status: 'OUT_OF_STOCK' },
                  { pending_reason_note: localNote || undefined }
                );
              }
              if (localStatus === 'pending_qc_fail') {
                void savePatch(
                  { notes: buildNotesForStatus('pending_qc_fail', 'qc_fail', localNote), status: 'OUT_OF_STOCK' },
                  { pending_reason_note: localNote || undefined }
                );
              }
            }}
            rows={2}
            className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 outline-none transition-colors focus:border-sky-400 focus:ring-2 focus:ring-sky-400/15"
            placeholder="Restock expected, QC notes..."
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canRemoveSingle ? (
          <RemoveFromPlanButton fnsku={item.fnsku} onConfirm={() => onRequestRemove(item)} />
        ) : null}
      </div>
      {saving ? <p className="mt-2 text-[10px] font-medium text-zinc-400">Saving changes...</p> : null}
    </div>
  );
}
