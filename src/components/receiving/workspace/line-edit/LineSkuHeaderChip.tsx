'use client';

/**
 * SKU identity band for the line-edit panel header — renders the line's SKU as
 * the copyable house SKU chip ({@link SkuScanRefChip}, yellow `sku` tone) just
 * below the toolbar, with an in-place pencil → input override that PATCHes the
 * same `/api/receiving-lines` route the rest of the panel uses for line fields
 * (its text allowlist already accepts `sku`, org-scoped).
 *
 * Optimistic per house: the chip and every listening surface update
 * immediately via `dispatchLineUpdated`, and roll back on failure. The local
 * override clears when the `sku` prop reconciles (the workspace pane merges
 * the same event back into the row). Enter commits, Esc cancels.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { SkuScanRefChip } from '@/components/ui/CopyChip';
import { dispatchLineUpdated } from '@/components/station/receiving-lines-table-helpers';
import { toast } from '@/lib/toast';

export function LineSkuHeaderChip({
  lineId,
  sku,
}: {
  lineId: number;
  /** Current line SKU (null when the line has none yet). */
  sku: string | null;
}) {
  // Optimistic override while a PATCH is in flight. `undefined` = no override;
  // cleared when the `sku` prop reconciles via the line-updated event merge.
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // New line selected, or the server value landed → drop local overrides.
  useEffect(() => {
    setPending(undefined);
    setEditing(false);
  }, [lineId, sku]);

  const propSku = (sku ?? '').trim() || null;
  const shown = pending !== undefined ? pending : propSku;
  // Synthetic unfound placeholders carry a negative id — nothing to PATCH yet.
  const canEdit = Number.isFinite(lineId) && lineId > 0;

  const openEditor = () => {
    setDraft(shown ?? '');
    setEditing(true);
    queueMicrotask(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const cancel = () => setEditing(false);

  const commit = async () => {
    const next = draft.trim() || null;
    setEditing(false);
    if (!canEdit || next === shown) return;
    const prev = shown;
    // Optimistic: paint the chip + broadcast to the table/rails immediately.
    setPending(next);
    dispatchLineUpdated({ id: lineId, sku: next });
    try {
      const res = await fetch('/api/receiving-lines', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lineId, sku: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(String(data?.error || 'Could not update SKU'));
      }
      // Reconcile with the server's normalized row (carries catalog joins).
      if (data.receiving_line) dispatchLineUpdated(data.receiving_line);
    } catch (err) {
      // Rollback the optimistic paint everywhere.
      setPending(undefined);
      dispatchLineUpdated({ id: lineId, sku: prev });
      toast.error(err instanceof Error ? err.message : 'Could not update SKU');
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-eyebrow font-black uppercase tracking-widest text-text-soft">
        SKU
      </span>
      {editing ? (
        <span className="flex min-w-0 items-center gap-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            placeholder="SKU"
            aria-label="Edit SKU"
            className="w-36 min-w-0 rounded border border-border-soft bg-surface-card px-1.5 py-0.5 font-mono text-caption font-semibold text-text-default outline-none focus:ring-1 focus:ring-inset focus:ring-blue-400"
          />
          <HoverTooltip label="Save SKU (Enter)" asChild focusable={false}>
            <IconButton
              icon={<Check className="h-3.5 w-3.5" />}
              onClick={() => void commit()}
              ariaLabel="Save SKU"
              className="rounded p-0.5 text-emerald-600 hover:bg-emerald-50"
            />
          </HoverTooltip>
          <HoverTooltip label="Cancel (Esc)" asChild focusable={false}>
            <IconButton
              icon={<X className="h-3.5 w-3.5" />}
              onClick={cancel}
              ariaLabel="Cancel SKU edit"
              className="rounded p-0.5 text-red-500 hover:bg-red-50"
            />
          </HoverTooltip>
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1">
          <SkuScanRefChip value={shown ?? ''} display={shown ?? ''} dense />
          {canEdit ? (
            <HoverTooltip label={shown ? 'Edit SKU' : 'Set SKU'} asChild>
              <IconButton
                icon={<Pencil className="h-3.5 w-3.5" />}
                onClick={openEditor}
                ariaLabel={shown ? 'Edit SKU' : 'Set SKU'}
                className="rounded p-0.5 hover:bg-surface-hover"
              />
            </HoverTooltip>
          ) : null}
        </span>
      )}
    </div>
  );
}
