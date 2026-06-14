'use client';

/**
 * Reusable CRUD list for one org catalog kind (platform | type): active rows
 * with inline rename, reorder (up/down), hide, and delete; a "Hidden" section
 * with Restore; and an add row. Backed by /api/catalog/{platforms,types} and
 * the catalog query factory.
 *
 * Built-in (`is_system`) rows are protected — badged "Default", slug immutable
 * (rename edits the label only), hide-only — while custom rows are removable.
 * All deletes are soft, so anything hidden/removed is restorable below.
 *
 * Layout-agnostic (no overlay/card chrome): the {@link CatalogManagerPopover}
 * wraps it in a RightPaneOverlay; the /settings catalog section drops it into a
 * card. When the catalog has no DB rows yet (migration unapplied) it shows the
 * built-in defaults read-only with a one-line notice.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Check, ChevronDown, ChevronUp, Loader2, Pencil, Plus, Trash2, X } from '@/components/Icons';
import { platformsQuery, typesQuery } from '@/lib/queries/catalog-queries';
import type { PlatformRow, TypeRow } from '@/lib/neon/catalog-queries';
import { useInvalidateCatalog } from '@/hooks/useCatalog';
import { SOURCE_PLATFORM_OPTS, RECEIVING_TYPE_OPTS } from '@/components/sidebar/receiving/receiving-sidebar-shared';

export type CatalogKind = 'platform' | 'type';

const API_BASE: Record<CatalogKind, string> = {
  platform: '/api/catalog/platforms',
  type: '/api/catalog/types',
};

const TEXT_INPUT =
  'w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-label text-gray-900 outline-none transition-colors focus:border-blue-500';

interface Entry {
  id: number;
  label: string;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
}

export function CatalogManagerList({ kind, enabled = true }: { kind: CatalogKind; enabled?: boolean }) {
  const invalidate = useInvalidateCatalog();
  const base = API_BASE[kind];

  // Manager shows EVERYTHING (active + hidden) so a hidden default can be
  // restored — unlike the pickers, which read active-only via useCatalog.
  const platformQ = useQuery({ ...platformsQuery({ includeInactive: true }), enabled: enabled && kind === 'platform' });
  const typeQ = useQuery({ ...typesQuery({ includeInactive: true }), enabled: enabled && kind === 'type' });
  const rawRows: Array<PlatformRow | TypeRow> = kind === 'platform' ? platformQ.data ?? [] : typeQ.data ?? [];

  const entries: Entry[] = rawRows.map((r) => ({
    id: r.id,
    label: r.label,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    isSystem: r.is_system,
  }));
  const editable = entries.length > 0;
  const active = entries.filter((e) => e.isActive);
  const hidden = entries.filter((e) => !e.isActive);
  const fallbackLabels =
    kind === 'platform' ? SOURCE_PLATFORM_OPTS.map((o) => o.label) : RECEIVING_TYPE_OPTS.map((o) => o.label);

  const [adding, setAdding] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [busyId, setBusyId] = useState<number | 'new' | null>(null);

  async function call(method: string, path: string, body?: unknown): Promise<boolean> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      toast.error(data?.error || `${method} failed (${res.status})`);
      return false;
    }
    invalidate();
    return true;
  }

  async function add() {
    const label = adding.trim();
    if (!label || busyId != null) return;
    setBusyId('new');
    if (await call('POST', '', { label })) setAdding('');
    setBusyId(null);
  }

  async function saveRename(id: number) {
    const label = editLabel.trim();
    if (!label) return;
    setBusyId(id);
    if (await call('PATCH', `/${id}`, { label })) setEditingId(null);
    setBusyId(null);
  }

  async function setActive(e: Entry, next: boolean) {
    if (busyId != null) return;
    if (!next && !window.confirm(`${e.isSystem ? 'Hide' : 'Remove'} "${e.label}"? It will stop appearing in pickers.`))
      return;
    setBusyId(e.id);
    await call(next ? 'PATCH' : 'DELETE', `/${e.id}`, next ? { isActive: true } : undefined);
    setBusyId(null);
  }

  async function move(index: number, dir: -1 | 1) {
    const a = active[index];
    const b = active[index + dir];
    if (!a || !b || busyId != null) return;
    setBusyId(a.id);
    const ok = await call('PATCH', `/${a.id}`, { sortOrder: b.sortOrder });
    if (ok) await call('PATCH', `/${b.id}`, { sortOrder: a.sortOrder });
    setBusyId(null);
  }

  return (
    <div>
      {!editable ? (
        <>
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-micro font-semibold text-amber-800">
            Showing built-in defaults. Apply migration <code>2026-06-13g</code> to add or edit your own.
          </div>
          <ul className="space-y-1.5">
            {fallbackLabels.map((label) => (
              <li
                key={label}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-label font-semibold text-gray-400"
              >
                {label}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="space-y-1.5">
          {active.map((e, i) => {
            const rowBusy = busyId === e.id;
            const isEditing = editingId === e.id;
            return (
              <li key={e.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5">
                <div className="flex flex-col">
                  <button
                    type="button"
                    disabled={i === 0 || busyId != null}
                    onClick={() => void move(i, -1)}
                    aria-label="Move up"
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-30"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={i === active.length - 1 || busyId != null}
                    onClick={() => void move(i, 1)}
                    aria-label="Move down"
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-30"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                {isEditing ? (
                  <input
                    autoFocus
                    value={editLabel}
                    onChange={(ev) => setEditLabel(ev.target.value)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') void saveRename(e.id);
                      if (ev.key === 'Escape') setEditingId(null);
                    }}
                    className={`${TEXT_INPUT} flex-1`}
                  />
                ) : (
                  <span className="flex flex-1 items-center gap-2 truncate text-label font-semibold text-gray-900">
                    {e.label}
                    {e.isSystem ? (
                      <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wider text-gray-500">
                        Default
                      </span>
                    ) : null}
                  </span>
                )}

                {rowBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                ) : isEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void saveRename(e.id)}
                      aria-label="Save"
                      className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      aria-label="Cancel"
                      className="rounded p-1 text-gray-400 hover:bg-gray-100"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(e.id);
                        setEditLabel(e.label);
                      }}
                      aria-label={`Rename ${e.label}`}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void setActive(e, false)}
                      aria-label={`${e.isSystem ? 'Hide' : 'Remove'} ${e.label}`}
                      title={e.isSystem ? 'Hide (restorable below)' : 'Remove'}
                      className="rounded p-1 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hidden.length > 0 ? (
        <div className="mt-4">
          <p className="mb-1.5 text-eyebrow font-black uppercase tracking-widest text-gray-400">Hidden</p>
          <ul className="space-y-1.5">
            {hidden.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-2.5 py-1.5"
              >
                <span className="flex-1 truncate text-label font-semibold text-gray-400 line-through">{e.label}</span>
                {busyId === e.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                ) : (
                  <button
                    type="button"
                    onClick={() => void setActive(e, true)}
                    className="rounded px-2 py-0.5 text-mini font-bold uppercase tracking-wider text-blue-600 hover:bg-blue-50"
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Add */}
      <div className="mt-3 flex items-center gap-2">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
          disabled={!editable}
          placeholder={editable ? `New ${kind}…` : 'Apply the migration to add'}
          className={`${TEXT_INPUT} flex-1 disabled:cursor-not-allowed disabled:opacity-60`}
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={!editable || !adding.trim() || busyId != null}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-mini font-bold uppercase tracking-wider text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busyId === 'new' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add
        </button>
      </div>
    </div>
  );
}
