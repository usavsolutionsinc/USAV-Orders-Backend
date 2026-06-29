'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Edit, Trash2, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';
import { toast } from '@/lib/toast';
import { sectionLabel, fieldLabel, tableHeader, tableCell } from '@/design-system/tokens/typography/presets';

/** Mirrors a row from GET /api/inventory/bins-overview (BinsOverviewRow). */
interface BinRow {
  id: number;
  barcode: string | null;
  name: string;
  room: string | null;
  row_label: string | null;
  col_label: string | null;
  capacity: number | null;
  bin_type: string | null;
  total_qty: number;
  sku_count: number;
  fill_pct: number | null;
  is_empty: boolean;
  is_stale: boolean;
  has_low_stock: boolean;
  is_over_capacity: boolean;
}

interface BinFormState {
  name: string;
  barcode: string;
  binType: string;
  capacity: string;
}

const inputClass =
  'h-10 w-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-gray-400';

const ALL_ROOMS = '__all__';

function fillLabel(row: BinRow): string {
  if (row.fill_pct == null) return '-';
  return `${Math.round(row.fill_pct * 100)}%`;
}

function statusOf(row: BinRow): { label: string; cls: string } {
  if (row.is_over_capacity) return { label: 'Over cap', cls: 'text-rose-700' };
  if (row.has_low_stock) return { label: 'Low', cls: 'text-amber-700' };
  if (row.is_empty) return { label: 'Empty', cls: 'text-gray-400' };
  if (row.is_stale) return { label: 'Stale', cls: 'text-amber-600' };
  return { label: 'OK', cls: 'text-emerald-700' };
}

/**
 * Browse + edit individual bins: name, barcode, type, capacity. Deleting a bin
 * soft-deletes it and is refused (409) while it still holds stock. Loads the
 * full bins overview once and filters room + search client-side.
 */
export function LocationsManagementTab() {
  const queryClient = useQueryClient();
  const [room, setRoom] = useState<string>(ALL_ROOMS);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<BinRow | null>(null);
  const [form, setForm] = useState<BinFormState>({ name: '', barcode: '', binType: '', capacity: '' });

  const { data, isLoading } = useQuery<{ rows: BinRow[] }>({
    queryKey: qk.locationsAdmin.bins(),
    queryFn: async () => {
      const res = await fetch('/api/inventory/bins-overview');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to load bins');
      return { rows: Array.isArray(body.rows) ? body.rows : [] };
    },
    staleTime: 30_000,
  });

  const allRows = data?.rows ?? [];

  const rooms = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) if (r.room) set.add(r.room);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return allRows.filter((r) => {
      if (room !== ALL_ROOMS && r.room !== room) return false;
      if (!q) return true;
      return (
        (r.barcode ?? '').toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.room ?? '').toLowerCase().includes(q) ||
        `${r.row_label ?? ''}${r.col_label ?? ''}`.toLowerCase().includes(q) ||
        (r.bin_type ?? '').toLowerCase().includes(q)
      );
    });
  }, [allRows, room, filter]);

  const updateMutation = useMutation({
    mutationFn: async ({ barcode, payload }: { barcode: string; payload: BinFormState }) => {
      const capTrim = payload.capacity.trim();
      const res = await fetch(`/api/locations/${encodeURIComponent(barcode)}/properties`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name.trim(),
          barcode: payload.barcode.trim() || null,
          binType: payload.binType.trim() || null,
          capacity: capTrim === '' ? null : Number(capTrim),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) throw new Error(body?.error || 'Another bin already uses that name or barcode');
        throw new Error(body?.error || 'Failed to update bin');
      }
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.locationsAdmin.all });
      toast.success('Bin updated');
      closeForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (barcode: string) => {
      const res = await fetch(`/api/locations/${encodeURIComponent(barcode)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          const skus = Array.isArray(body?.skus) ? ` (${body.skus.join(', ')})` : '';
          throw new Error(`Bin still holds stock${skus} — move or remove it first`);
        }
        throw new Error(body?.error || 'Failed to delete bin');
      }
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.locationsAdmin.all });
      toast.success('Bin removed');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const closeForm = () => {
    setEditing(null);
    setForm({ name: '', barcode: '', binType: '', capacity: '' });
  };

  const openEdit = (row: BinRow) => {
    setEditing(row);
    setForm({
      name: row.name ?? '',
      barcode: row.barcode ?? '',
      binType: row.bin_type ?? '',
      capacity: row.capacity == null ? '' : String(row.capacity),
    });
  };

  const handleSubmit = () => {
    if (!editing?.barcode) return;
    if (!form.name.trim()) return toast.error('Name is required');
    const capTrim = form.capacity.trim();
    if (capTrim !== '' && (!Number.isFinite(Number(capTrim)) || Number(capTrim) < 0)) {
      return toast.error('Capacity must be a non-negative number');
    }
    updateMutation.mutate({ barcode: editing.barcode, payload: form });
  };

  const handleDelete = (row: BinRow) => {
    if (!row.barcode) return;
    if (!window.confirm(`Remove bin "${row.name}" (${row.barcode})? It will be deactivated; bins holding stock are refused.`)) {
      return;
    }
    deleteMutation.mutate(row.barcode);
  };

  const tableGridClass =
    'grid grid-cols-[150px_minmax(160px,1.5fr)_130px_90px_120px_80px_70px_70px_90px_96px] gap-x-3';

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#ffffff_0%,#f5f7fa_100%)]">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} flex-wrap gap-y-2 px-4`}>
          <div className="flex items-center gap-4">
            <p className={`${sectionLabel} truncate text-gray-900`}>Locations</p>
            <select
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              className="h-8 border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-800 outline-none focus:border-gray-400"
            >
              <option value={ALL_ROOMS}>All rooms</option>
              {rooms.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className={`${sectionLabel} flex flex-wrap items-center gap-4`}>
            <span>{filtered.length} bins</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter barcode / name / type"
              className="h-8 w-64 border border-gray-200 bg-white px-3 text-xs font-medium text-gray-900 outline-none focus:border-gray-400"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-hidden border-y border-gray-200 bg-white">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[1100px]">
              <div className={`${tableGridClass} ${tableHeader} border-b border-gray-200 px-4 py-3`}>
                <p>Barcode</p>
                <p>Name</p>
                <p>Room</p>
                <p>Pos</p>
                <p>Type</p>
                <p>Cap</p>
                <p>Qty</p>
                <p>Fill</p>
                <p>Status</p>
                <p className="text-right">Actions</p>
              </div>

              {isLoading ? (
                <div className="px-6 py-10 text-sm font-medium text-gray-500">Loading bins...</div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <p className={sectionLabel}>No Bins</p>
                  <p className="mt-2 text-sm font-medium text-gray-500">
                    {allRows.length === 0 ? 'No bins found.' : 'No bins match your filter.'}
                  </p>
                </div>
              ) : (
                filtered.map((row) => {
                  const status = statusOf(row);
                  const pos = [row.row_label, row.col_label].filter(Boolean).join('-') || '-';
                  return (
                    <div key={row.id} className={`${tableGridClass} items-center border-b border-gray-100 px-4 py-2.5 text-sm last:border-b-0`}>
                      {/* ds-allow-title: native tooltip shows full value when truncated */}
                      <p className={`${tableCell} truncate font-mono`} title={row.barcode ?? ''}>{row.barcode || '-'}</p>
                      {/* ds-allow-title: native tooltip shows full value when truncated */}
                      <p className={`${tableCell} truncate`} title={row.name}>{row.name}</p>
                      <p className={`${tableCell} truncate text-gray-600`}>{row.room || '-'}</p>
                      <p className={`${tableCell} text-gray-600`}>{pos}</p>
                      <p className={`${tableCell} truncate text-gray-600`}>{row.bin_type || '-'}</p>
                      <p className={`${tableCell} text-gray-600`}>{row.capacity ?? '-'}</p>
                      <p className={`${tableCell} text-gray-600`}>{row.total_qty}</p>
                      <p className={`${tableCell} text-gray-600`}>{fillLabel(row)}</p>
                      <p className={`${tableHeader} ${status.cls}`}>{status.label}</p>
                      <div className="flex items-center justify-end gap-2">
                        <HoverTooltip label={row.barcode ? 'Edit bin' : 'Bin has no barcode — cannot edit here'} asChild>
                          <IconButton
                            icon={<Edit className="h-3.5 w-3.5" />}
                            ariaLabel={`Edit ${row.name}`}
                            onClick={() => openEdit(row)}
                            disabled={!row.barcode}
                            className="inline-flex h-8 w-8 items-center justify-center border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-40"
                          />
                        </HoverTooltip>
                        <HoverTooltip label={row.barcode ? 'Remove bin' : 'Bin has no barcode — cannot delete here'} asChild>
                          <IconButton
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                            ariaLabel={`Remove ${row.name}`}
                            onClick={() => handleDelete(row)}
                            disabled={!row.barcode || deleteMutation.isPending}
                            className="inline-flex h-8 w-8 items-center justify-center border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                          />
                        </HoverTooltip>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
          {/* ds-raw-button: full-bleed modal scrim/overlay dismiss target, not a DS Button */}
          <button type="button" className="absolute inset-0 bg-gray-950/30" onClick={closeForm} aria-label="Close bin form" />
          <div className="relative flex w-full max-w-xl flex-col overflow-hidden border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <p className={sectionLabel}>Edit Bin</p>
                <h3 className="mt-1 text-base font-semibold text-gray-900">
                  {editing.room ? `${editing.room} · ` : ''}{editing.name}
                </h3>
              </div>
              <IconButton
                icon={<X className="h-4 w-4" />}
                ariaLabel="Close"
                onClick={closeForm}
                className="inline-flex h-9 w-9 items-center justify-center border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              />
            </div>

            <div className="grid gap-4 border-b border-gray-200 px-5 py-5 md:grid-cols-2">
              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Name</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                  className={inputClass}
                />
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Barcode</span>
                <input
                  type="text"
                  value={form.barcode}
                  onChange={(e) => setForm((c) => ({ ...c, barcode: e.target.value }))}
                  className={`${inputClass} font-mono`}
                />
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Bin Type</span>
                <input
                  type="text"
                  value={form.binType}
                  onChange={(e) => setForm((c) => ({ ...c, binType: e.target.value }))}
                  placeholder="Optional"
                  className={inputClass}
                />
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Capacity</span>
                <input
                  type="number"
                  min={0}
                  value={form.capacity}
                  onChange={(e) => setForm((c) => ({ ...c, capacity: e.target.value }))}
                  placeholder="Blank = no limit"
                  className={inputClass}
                />
              </label>

              <p className={`md:col-span-2 ${fieldLabel} text-gray-400`}>
                Position (row/col) and room moves are structural — manage those from the location tools, not here.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4">
              <Button variant="secondary" onClick={closeForm}>
                Cancel
              </Button>
              <Button
                variant="brand"
                onClick={handleSubmit}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
