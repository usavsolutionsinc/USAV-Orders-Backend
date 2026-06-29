'use client';

/**
 * CRUD manager for the org's storefront accounts (platform_accounts), grouped
 * under their platform. Each platform shows its active accounts with inline
 * rename + hide, a hidden/restore section, and an "add account" row; backed by
 * /api/catalog/platform-accounts. Lives in the /settings catalog section beside
 * {@link CatalogManagerList} (platforms + types).
 *
 * Accounts are entirely org-defined (seeded from ebay_accounts + one default per
 * platform), so there is no built-in read-only fallback — before the migration
 * the lists are simply empty and the platform shows its add row.
 */

import { useState } from 'react';
import { toast } from '@/lib/toast';
import { Check, Loader2, Pencil, Plus, Trash2, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import type { PlatformAccountRow } from '@/lib/neon/catalog-queries';
import { usePlatformAccountCatalog, usePlatformCatalog, useInvalidateCatalog } from '@/hooks/useCatalog';

const TEXT_INPUT =
  'w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-label text-gray-900 outline-none transition-colors focus:border-blue-500';

const BASE = '/api/catalog/platform-accounts';

export function PlatformAccountsManager() {
  const invalidate = useInvalidateCatalog();
  const { rows: platforms, isLoading: platformsLoading } = usePlatformCatalog();
  const { rows: accounts, isLoading: accountsLoading } = usePlatformAccountCatalog({ includeInactive: true });

  const [addingFor, setAddingFor] = useState<number | null>(null);
  const [addLabel, setAddLabel] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [busyId, setBusyId] = useState<number | 'new' | null>(null);

  // Catalog isn't editable until the migration has seeded platforms.
  const editable = platforms.some((p) => p.id != null);

  async function call(method: string, path: string, body?: unknown): Promise<boolean> {
    const res = await fetch(`${BASE}${path}`, {
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

  async function add(platformId: number) {
    const label = addLabel.trim();
    if (!label || busyId != null) return;
    setBusyId('new');
    if (await call('POST', '', { platformId, label })) {
      setAddLabel('');
      setAddingFor(null);
    }
    setBusyId(null);
  }

  async function saveRename(id: number) {
    const label = editLabel.trim();
    if (!label) return;
    setBusyId(id);
    if (await call('PATCH', `/${id}`, { label })) setEditingId(null);
    setBusyId(null);
  }

  async function setActive(a: PlatformAccountRow, next: boolean) {
    if (busyId != null) return;
    if (!next && !window.confirm(`Remove "${a.label}"? It will stop appearing as a channel.`)) return;
    setBusyId(a.id);
    await call(next ? 'PATCH' : 'DELETE', `/${a.id}`, next ? { isActive: true } : undefined);
    setBusyId(null);
  }

  if (platformsLoading || accountsLoading) {
    return (
      <div className="flex items-center gap-2 px-1 py-3 text-label text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
      </div>
    );
  }

  if (!editable) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-micro font-semibold text-amber-800">
        Apply migration <code>2026-06-13g</code> + <code>2026-06-14f</code> to seed and edit storefront accounts.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {platforms.map((p) => {
        const list = accounts.filter((a) => a.platform_id === p.id);
        const activeList = list.filter((a) => a.is_active);
        const hiddenList = list.filter((a) => !a.is_active);
        const isAdding = addingFor === p.id;
        return (
          <div key={p.id}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-eyebrow font-black uppercase tracking-widest text-gray-400">{p.label}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAddingFor(isAdding ? null : p.id);
                  setAddLabel('');
                }}
                className="text-blue-600 hover:bg-blue-50"
                icon={<Plus />}
              >
                Account
              </Button>
            </div>

            <ul className="space-y-1.5">
              {activeList.length === 0 && !isAdding ? (
                <li className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-2.5 py-1.5 text-label text-gray-400">
                  No accounts yet.
                </li>
              ) : null}

              {activeList.map((a) => {
                const rowBusy = busyId === a.id;
                const isEditing = editingId === a.id;
                return (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5"
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editLabel}
                        onChange={(ev) => setEditLabel(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') void saveRename(a.id);
                          if (ev.key === 'Escape') setEditingId(null);
                        }}
                        className={`${TEXT_INPUT} flex-1`}
                      />
                    ) : (
                      <span className="flex flex-1 items-center gap-2 truncate text-label font-semibold text-gray-900">
                        {a.label}
                        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-eyebrow text-gray-500">
                          {a.slug}
                        </span>
                      </span>
                    )}

                    {rowBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : isEditing ? (
                      <>
                        <IconButton
                          onClick={() => void saveRename(a.id)}
                          ariaLabel="Save"
                          className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                          icon={<Check className="h-4 w-4" />}
                        />
                        <IconButton
                          onClick={() => setEditingId(null)}
                          ariaLabel="Cancel"
                          className="rounded p-1 text-gray-400 hover:bg-gray-100"
                          icon={<X className="h-4 w-4" />}
                        />
                      </>
                    ) : (
                      <>
                        <IconButton
                          onClick={() => {
                            setEditingId(a.id);
                            setEditLabel(a.label);
                          }}
                          ariaLabel={`Rename ${a.label}`}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          icon={<Pencil className="h-3.5 w-3.5" />}
                        />
                        <IconButton
                          onClick={() => void setActive(a, false)}
                          ariaLabel={`Remove ${a.label}`}
                          className="rounded p-1 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                        />
                      </>
                    )}
                  </li>
                );
              })}

              {isAdding ? (
                <li className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={addLabel}
                    onChange={(e) => setAddLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void add(p.id);
                      if (e.key === 'Escape') setAddingFor(null);
                    }}
                    placeholder={`New ${p.label} account…`}
                    className={`${TEXT_INPUT} flex-1`}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void add(p.id)}
                    disabled={!addLabel.trim() || busyId != null}
                    loading={busyId === 'new'}
                    icon={<Plus />}
                  >
                    Add
                  </Button>
                </li>
              ) : null}
            </ul>

            {hiddenList.length > 0 ? (
              <ul className="mt-1.5 space-y-1.5">
                {hiddenList.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-2.5 py-1.5"
                  >
                    <span className="flex-1 truncate text-label font-semibold text-gray-400 line-through">{a.label}</span>
                    {busyId === a.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void setActive(a, true)}
                        className="text-blue-600 hover:bg-blue-50"
                      >
                        Restore
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
