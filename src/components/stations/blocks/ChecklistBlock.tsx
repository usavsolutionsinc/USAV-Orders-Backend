'use client';

/**
 * Checklist block — generic check/act list. Registered in
 * src/lib/stations/blocks/checklist.block.ts; receives resolved rows + bound
 * actions as props and never fetches or knows which integration feeds it.
 */

import { useState } from 'react';
import { Check, Loader2 } from '@/components/Icons';
import type { BlockProps, FieldKind, SourceRow } from '@/lib/stations/contract';

/** Kind-aware inline renderer for the `ref` role (PO#, tracking#, SKU…). */
function RefChip({ value, kind }: { value: unknown; kind: FieldKind | undefined }) {
  if (value == null || value === '') return null;
  const tone =
    kind === 'po_ref'
      ? 'bg-blue-50 text-blue-700 ring-blue-200'
      : kind === 'tracking_ref'
        ? 'bg-violet-50 text-violet-700 ring-violet-200'
        : kind === 'sku_ref'
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
          : 'bg-gray-50 text-gray-600 ring-gray-200';
  return (
    <span className={`inline-flex max-w-[9rem] items-center truncate rounded px-1 py-px font-mono text-mini font-bold ring-1 ring-inset ${tone}`}>
      {String(value)}
    </span>
  );
}

function shortDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ChecklistBlock({
  rows,
  isLoading,
  mapping,
  fieldKinds,
  display,
  actions,
  doneWhen,
}: BlockProps) {
  // Manual ticks (check_only variant) are ephemeral UI state — completion
  // that must persist is the done_when action's job (the source stops
  // returning the row).
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  const variant = (display.variant as string) || 'check_act';
  const sort = (display.sort as string) || 'newest';
  const emptyText = (display.empty_text as string) || 'All clear — nothing to do.';

  const titleKey = mapping.title;
  const refKey = mapping.ref;
  const metaKey = mapping.meta;
  // The block stays integration-blind: "when did this row happen" is whatever
  // field the bound source declared as a timestamp kind.
  const timeKey = Object.keys(fieldKinds).find((k) => fieldKinds[k] === 'timestamp');

  const sorted = [...rows].sort((a, b) => {
    const ta = String((timeKey && a[timeKey]) ?? '');
    const tb = String((timeKey && b[timeKey]) ?? '');
    return sort === 'oldest' ? ta.localeCompare(tb) : tb.localeCompare(ta);
  });

  const toggleTick = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runAction = async (actionId: string, row: SourceRow) => {
    const bound = actions.find((a) => a.def.id === actionId);
    if (!bound) return;
    if (bound.def.confirm === 'soft' && !window.confirm(`${bound.def.label} — are you sure?`)) return;
    await bound.run(row);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-caption font-semibold text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
      </div>
    );
  }

  if (sorted.length === 0) {
    return <p className="px-2.5 py-3 text-caption font-semibold text-gray-400">{emptyText}</p>;
  }

  return (
    <ul className="divide-y divide-gray-100">
      {sorted.map((row) => {
        const done = ticked.has(row.id);
        const date = shortDate(timeKey ? row[timeKey] : null);
        return (
          <li key={row.id} className={`group flex items-start gap-2 px-2.5 py-2 ${done ? 'opacity-50' : ''}`}>
            {variant === 'check_only' ? (
              <button
                type="button"
                onClick={() => toggleTick(row.id)}
                aria-pressed={done}
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 bg-white hover:border-emerald-400'
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : null}
              </button>
            ) : (
              <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-dashed border-gray-300" title="Completed by its action" />
            )}

            <div className="min-w-0 flex-1">
              <p className={`truncate text-label font-bold text-gray-800 ${done ? 'line-through' : ''}`}>
                {String((titleKey && row[titleKey]) ?? '—')}
              </p>
              <div className="mt-0.5 flex items-center gap-1.5">
                {refKey ? <RefChip value={row[refKey]} kind={refKey ? fieldKinds[refKey] : undefined} /> : null}
                {metaKey && typeof row[metaKey] === 'string' && fieldKinds[metaKey] !== 'timestamp' ? (
                  <span className="truncate text-mini font-semibold text-gray-400">{String(row[metaKey])}</span>
                ) : null}
                {date ? <span className="ml-auto shrink-0 text-mini font-semibold tabular-nums text-gray-400">{date}</span> : null}
              </div>
            </div>

            {actions.length > 0 ? (
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {actions.map((a) => {
                  const pending = a.pendingRowId === row.id;
                  const isDone = doneWhen === a.def.id;
                  return (
                    <button
                      key={a.def.id}
                      type="button"
                      disabled={pending}
                      onClick={() => void runAction(a.def.id, row)}
                      title={a.def.label}
                      className={`rounded px-1.5 py-0.5 text-mini font-bold ring-1 ring-inset transition-colors disabled:opacity-50 ${
                        isDone
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100'
                          : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : a.def.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
