'use client';

/**
 * Rail-feed block component — a selectable worklist rail (queue slot). Renders
 * resolved rows one-per-line (title → ref chip → meta), newest-first; clicking a
 * row dispatches a `station:select` CustomEvent `{ id }`. Receives rows + bound
 * actions as props; never fetches or knows which integration feeds it.
 */

import { useState } from 'react';
import { Loader2 } from '@/components/Icons';
import type { BlockProps, FieldKind } from '@/lib/stations/contract';

export interface StationSelectEventDetail {
  id: string;
}

function RefChip({ value, kind }: { value: unknown; kind: FieldKind | undefined }) {
  if (value == null || value === '') return null;
  const tone =
    kind === 'po_ref'
      ? 'bg-blue-50 text-blue-700 ring-blue-200'
      : kind === 'tracking_ref'
        ? 'bg-violet-50 text-violet-700 ring-violet-200'
        : kind === 'sku_ref'
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
          : 'bg-surface-canvas text-text-muted ring-border-soft';
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

export function RailFeedBlock({ rows, isLoading, mapping, fieldKinds, display }: BlockProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const emptyText = (display.empty_text as string) || 'Nothing in the queue.';
  const showCount = display.show_count !== false;

  const titleKey = mapping.title;
  const refKey = mapping.ref;
  const metaKey = mapping.meta;
  const timeKey = Object.keys(fieldKinds).find((k) => fieldKinds[k] === 'timestamp');

  const sorted = [...rows].sort((a, b) => {
    const ta = String((timeKey && a[timeKey]) ?? '');
    const tb = String((timeKey && b[timeKey]) ?? '');
    return tb.localeCompare(ta);
  });

  const select = (id: string) => {
    setSelected(id);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<StationSelectEventDetail>('station:select', { detail: { id } }));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-caption font-semibold text-text-faint">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
      </div>
    );
  }

  if (sorted.length === 0) {
    return <p className="px-2.5 py-3 text-caption font-semibold text-text-faint">{emptyText}</p>;
  }

  return (
    <div>
      {showCount ? (
        <p className="px-2.5 pb-1 pt-2 text-eyebrow font-black uppercase tracking-widest text-text-faint">
          {sorted.length} in queue
        </p>
      ) : null}
      <ul className="divide-y divide-border-hairline">
        {sorted.map((row) => {
          const isSel = selected === row.id;
          const date = shortDate(timeKey ? row[timeKey] : null);
          return (
            <li key={row.id}>
              {/* ds-raw-button: a full-row select target (the whole row is the hit-box), not a standard action button — Button/IconButton don't model a full-width list row. */}
              <button
                type="button"
                onClick={() => select(row.id)}
                className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors ${
                  isSel ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : 'hover:bg-surface-hover'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label font-bold text-text-default">
                    {String((titleKey && row[titleKey]) ?? '—')}
                  </p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {refKey ? <RefChip value={row[refKey]} kind={refKey ? fieldKinds[refKey] : undefined} /> : null}
                    {metaKey && typeof row[metaKey] === 'string' && fieldKinds[metaKey] !== 'timestamp' ? (
                      <span className="truncate text-mini font-semibold text-text-faint">{String(row[metaKey])}</span>
                    ) : null}
                    {date ? (
                      <span className="ml-auto shrink-0 text-mini font-semibold tabular-nums text-text-faint">{date}</span>
                    ) : null}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
