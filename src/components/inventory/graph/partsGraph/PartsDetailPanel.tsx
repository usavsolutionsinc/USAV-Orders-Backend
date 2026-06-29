'use client';

import { useState } from 'react';
import { Check, Plus, Search, Unlink } from '@/components/Icons';
import { Button } from '@/design-system/primitives/Button';
import { cn } from '@/utils/_cn';
import type { PartsNodeMeta } from './partsGraphTransform';
import type { ItemSearchResult } from './useItemsSearch';
import { useItemsSearch } from './useItemsSearch';
import { usePartLinkMutations } from './usePartLinkMutations';
import type { PartReviewState } from './types';

const TIER_BADGE = {
  base: 'bg-purple-50 text-purple-700 ring-purple-200',
  part: 'bg-amber-50 text-amber-700 ring-amber-200',
} as const;

const REVIEW_BADGE: Record<PartReviewState, { label: string; cls: string }> = {
  unreviewed: { label: 'Needs review', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  confirmed: { label: 'Confirmed', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  not_a_part: { label: 'Not a part', cls: 'bg-gray-100 text-gray-500 ring-gray-200' },
};

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <div className="text-caption uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-2xl font-bold tabular-nums text-gray-900">{value}</div>
    </div>
  );
}

/** Inline items search for picking a (different / additional) parent. */
function ParentPicker({ onPick, disabled }: { onPick: (item: ItemSearchResult) => void; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const { data = [], isFetching } = useItemsSearch(q);
  return (
    <div className="space-y-1.5 rounded-lg border border-gray-200 p-2">
      <div className="flex items-center gap-1.5">
        <Search className="h-3.5 w-3.5 text-gray-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search items by SKU or name…"
          className="w-full bg-transparent text-label text-gray-900 outline-none placeholder:text-gray-400"
        />
        {isFetching && <span className="text-micro text-gray-400">…</span>}
      </div>
      {data.length > 0 && (
        <ul className="max-h-44 space-y-0.5 overflow-y-auto">
          {data.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(it)}
                className="ds-raw-button flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-gray-50 disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-label font-medium text-gray-900">{it.sku}</span>
                  <span className="block truncate text-caption text-gray-500">{it.name}</span>
                </span>
                <Plus className="ml-2 h-3.5 w-3.5 shrink-0 text-gray-400" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PartsDetailPanel({ meta }: { meta: PartsNodeMeta | null }) {
  const { assignParent, markNotAPart, removeLink } = usePartLinkMutations();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!meta) {
    return (
      <aside className="flex w-80 shrink-0 items-center justify-center border-l border-gray-200 bg-white p-6 text-center">
        <p className="text-label text-gray-400">Select a base unit or a part to inspect and pair it.</p>
      </aside>
    );
  }

  if (meta.kind === 'base') {
    const { base } = meta;
    return (
      <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-200 bg-white p-4">
        <div>
          <span className={cn('rounded-md px-1.5 py-0.5 text-micro font-semibold uppercase ring-1', TIER_BADGE.base)}>
            Base unit
          </span>
          <h2 className="mt-1.5 text-[15px] font-bold text-gray-900">{base.base}</h2>
          {base.baseUnit ? (
            <p className="text-label text-gray-500">{base.baseUnit.name || base.baseUnit.sku}</p>
          ) : (
            <p className="text-label italic text-gray-400">
              No matching whole-unit item — candidate parent unverified.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Parts" value={base.partCount} />
          <StatTile label="On hand" value={base.totalStockOnHand} />
        </div>

        <div>
          <h3 className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-gray-400">
            Logical parts ({base.parts.length})
          </h3>
          <ul className="space-y-1">
            {base.parts.map((p) => (
              <li key={p.logicalKey} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-label">
                <span className="min-w-0 truncate text-gray-900">
                  {['Part', p.colorLabel, p.conditionLabel, ...p.unknownTokens].filter(Boolean).join(' · ')}
                </span>
                <span
                  className={cn('ml-2 h-1.5 w-1.5 shrink-0 rounded-full',
                    p.reviewState === 'confirmed' ? 'bg-emerald-500' : p.reviewState === 'not_a_part' ? 'bg-gray-300' : 'bg-amber-400')}
                />
              </li>
            ))}
          </ul>
        </div>
      </aside>
    );
  }

  const { part, base } = meta;
  const review = REVIEW_BADGE[part.reviewState];
  const suggested = base.baseUnit;
  const suggestedAssigned = suggested ? part.assignedParents.some((p) => p.parentItemId === suggested.itemId) : false;
  const busy = assignParent.isPending || markNotAPart.isPending || removeLink.isPending;

  const doAssign = (parentItemId: string) =>
    assignParent.mutate({ childLogicalKey: part.logicalKey, childBase: part.base, parentItemId });

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-200 bg-white p-4">
      <div>
        <div className="flex items-center gap-1.5">
          <span className={cn('rounded-md px-1.5 py-0.5 text-micro font-semibold uppercase ring-1', TIER_BADGE.part)}>
            Part
          </span>
          <span className={cn('rounded-md px-1.5 py-0.5 text-micro font-semibold uppercase ring-1', review.cls)}>
            {review.label}
          </span>
        </div>
        <h2 className="mt-1.5 text-[15px] font-bold text-gray-900">{part.logicalLabel}</h2>
        <p className="text-label text-gray-500">Base unit {part.base}</p>
      </div>

      {/* ── Pairing ─────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h3 className="text-caption font-semibold uppercase tracking-wide text-gray-400">Parent pairing</h3>

        {part.reviewState === 'not_a_part' ? (
          <div className="space-y-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3">
            <p className="text-label text-gray-500">Marked as <strong>not a part</strong>.</p>
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() => part.notAPartLinkId != null && removeLink.mutate(part.notAPartLinkId)}
            >
              Undo
            </Button>
          </div>
        ) : (
          <>
            {/* Confirmed parents */}
            {part.assignedParents.length > 0 && (
              <ul className="space-y-1">
                {part.assignedParents.map((ap) => (
                  <li
                    key={ap.linkId}
                    className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-2 py-1.5 ring-1 ring-inset ring-emerald-200"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-label font-medium text-gray-900">{ap.parentSku ?? '—'}</span>
                      <span className="block truncate text-caption text-gray-500">{ap.parentName ?? ''}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Unlink />}
                      ariaLabel="Remove parent"
                      iconOnly
                      loading={busy}
                      onClick={() => removeLink.mutate(ap.linkId)}
                    />
                  </li>
                ))}
              </ul>
            )}

            {/* Suggested parent (same-base whole-unit) — one-click confirm */}
            {suggested && !suggestedAssigned && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-2 py-1.5">
                <span className="min-w-0">
                  <span className="block text-micro uppercase tracking-wide text-gray-400">Suggested</span>
                  <span className="block truncate text-label font-medium text-gray-900">{suggested.sku}</span>
                  <span className="block truncate text-caption text-gray-500">{suggested.name}</span>
                </span>
                <Button size="sm" variant="primary" icon={<Check />} loading={busy} onClick={() => doAssign(suggested.itemId)}>
                  Confirm
                </Button>
              </div>
            )}

            {pickerOpen ? (
              <ParentPicker
                disabled={busy}
                onPick={(it) => {
                  doAssign(it.id);
                  setPickerOpen(false);
                }}
              />
            ) : (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setPickerOpen(true)} disabled={busy}>
                  Choose parent…
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy}
                  onClick={() => markNotAPart.mutate({ childLogicalKey: part.logicalKey, childBase: part.base })}
                >
                  Not a part
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
