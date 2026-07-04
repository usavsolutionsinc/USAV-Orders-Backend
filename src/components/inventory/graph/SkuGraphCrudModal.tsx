'use client';

import { useState } from 'react';
import { Search, Trash2, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { cn } from '@/utils/_cn';
import { useSkuCatalogSearch, type SkuCatalogItem } from '@/hooks/useSkuCatalogSearch';
import { useSkuChildren, useSkuParents, useSkuRelationshipMutations } from './useSkuGraph';
import type { RelationshipDirection } from './types';

interface SkuGraphCrudModalProps {
  focused: { sku_id: number; sku: string; product_title: string };
  onClose: () => void;
}

export function SkuGraphCrudModal({ focused, onClose }: SkuGraphCrudModalProps) {
  const { create, update, remove } = useSkuRelationshipMutations();
  const { data: parents = [] } = useSkuParents(focused.sku_id);
  const { data: children = [] } = useSkuChildren(focused.sku_id);

  const [direction, setDirection] = useState<RelationshipDirection>('child');
  const [picked, setPicked] = useState<SkuCatalogItem | null>(null);
  const [query, setQuery] = useState('');
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: results = [] } = useSkuCatalogSearch(picked ? '' : query, { limit: 10 });

  const submit = async () => {
    if (!picked) return;
    setError(null);
    const payload =
      direction === 'child'
        ? { parentSkuId: focused.sku_id, childSkuId: picked.id, qty, notes: notes || null }
        : { parentSkuId: picked.id, childSkuId: focused.sku_id, qty, notes: notes || null };
    try {
      await create.mutateAsync(payload);
      setPicked(null);
      setQuery('');
      setQty(1);
      setNotes('');
    } catch (e: any) {
      setError(e?.message || 'Failed to add connection');
    }
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-hairline px-5 py-3.5">
          <div>
            <h2 className="text-[14px] font-bold text-text-default">Edit Connections</h2>
            <p className="text-label text-text-soft">{focused.sku}</p>
          </div>
          <IconButton
            type="button"
            onClick={onClose}
            ariaLabel="Close"
            className="rounded-lg p-1.5 text-text-faint hover:bg-surface-sunken"
            icon={<X className="h-4 w-4" />}
          />
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Add */}
          <section className="space-y-3">
            <div className="inline-flex rounded-xl border border-border-soft bg-surface-canvas p-0.5">
              {(['child', 'parent'] as RelationshipDirection[]).map((d) => (
                // ds-raw-button: segmented direction toggle (conditional active fill), not a single DS variant
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-label font-medium capitalize transition-colors',
                    direction === d ? 'bg-surface-card text-text-default shadow-sm' : 'text-text-soft hover:text-text-default',
                  )}
                >
                  {d === 'child' ? 'Add child' : 'Add parent'}
                </button>
              ))}
            </div>

            {picked ? (
              <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-text-default">{picked.sku}</span>
                  <span className="block truncate text-caption text-text-soft">{picked.product_title}</span>
                </span>
                {/* ds-raw-button: minimal inline underlined text link, not a DS Button control */}
                <button type="button" onClick={() => setPicked(null)} className="text-caption text-blue-700 underline">
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search SKU to add as ${direction}…`}
                  className="h-9 w-full rounded-xl border border-border-soft bg-surface-canvas pl-8 pr-3 text-[13px] outline-none focus:border-blue-400 focus:bg-surface-card"
                />
                {query.trim().length > 0 && results.length > 0 && (
                  <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border-soft bg-surface-card py-1 shadow-lg">
                    {results
                      .filter((r) => r.id !== focused.sku_id)
                      .map((r) => (
                        <li key={r.id}>
                          {/* ds-raw-button: multi-line text-left master-detail result row (sku + title), not a Button shape */}
                          <button
                            type="button"
                            onClick={() => setPicked(r)}
                            className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-surface-hover"
                          >
                            <span className="text-[13px] font-semibold text-text-default">{r.sku}</span>
                            <span className="line-clamp-1 text-caption text-text-soft">{r.product_title}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-label text-text-muted">
                Qty
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                  className="h-8 w-16 rounded-lg border border-border-soft px-2 text-[13px] tabular-nums outline-none focus:border-blue-400"
                />
              </label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="h-8 flex-1 rounded-lg border border-border-soft px-2.5 text-[13px] outline-none focus:border-blue-400"
              />
            </div>

            {error && <p className="text-label text-rose-600">{error}</p>}

            <Button size="sm" variant="primary" onClick={submit} disabled={!picked || create.isPending} loading={create.isPending}>
              Add {direction}
            </Button>
          </section>

          {/* Existing */}
          <section className="mt-6 space-y-4">
            {[
              { title: 'Parents', items: parents },
              { title: 'Children', items: children },
            ].map(({ title, items }) => (
              <div key={title}>
                <h3 className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-text-faint">{title}</h3>
                {items.length === 0 ? (
                  <p className="text-label text-text-faint">None</p>
                ) : (
                  <ul className="space-y-1">
                    {items.map((it) => (
                      <li
                        key={it.relationship_id}
                        className="flex items-center justify-between rounded-lg border border-border-hairline px-2.5 py-1.5"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-label font-medium text-text-default">{it.sku}</span>
                          <span className="block truncate text-caption text-text-soft">{it.product_title}</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            defaultValue={it.qty}
                            onBlur={(e) => {
                              const next = Math.max(1, Number(e.target.value) || 1);
                              if (next !== it.qty) update.mutate({ id: it.relationship_id, qty: next });
                            }}
                            className="h-7 w-14 rounded-md border border-border-soft px-1.5 text-label tabular-nums outline-none focus:border-blue-400"
                          />
                          <IconButton
                            type="button"
                            onClick={() => remove.mutate(it.relationship_id)}
                            className="rounded-md p-1 text-text-faint hover:bg-rose-50 hover:text-rose-600"
                            ariaLabel="Remove connection"
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
