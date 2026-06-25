'use client';

/**
 * Fill-in receiving checklist — the Checklist tab inside {@link LineNotesTabbedCard}.
 *
 * The checklist DEFINITION is org-wide and DB-backed: it reads the GLOBAL scope
 * of the polymorphic `checklist_templates` table via {@link useChecklist}, and
 * managers can add / rename / remove steps inline (PUT/POST/DELETE /api/checklists,
 * gated by `sku_stock.manage`). The first time an org opens it, a one-click
 * "Add default steps" seeds {@link GLOBAL_RECEIVING_CHECKLIST}.
 *
 * The FILL state (which boxes are ticked) is per line and kept in localStorage —
 * no DB round-trip — so it survives navigating between lines. Per-SKU checklists
 * (scope_type='SKU') will later supersede the GLOBAL list at the data layer.
 */

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, Trash2, Pencil, X } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { useChecklist, checklistQueryKey } from '@/hooks/useChecklist';
import { GLOBAL_RECEIVING_CHECKLIST } from '@/lib/receiving/global-checklist';

const storageKey = (lineId: number) => `receiving-checklist:${lineId}`;

export function LineChecklistTab({ lineId }: { lineId: number; sku?: string | null }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useChecklist('GLOBAL');
  const items = data?.items ?? [];

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');

  // Fill state is per line, persisted locally.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(lineId));
      setChecked(raw ? (JSON.parse(raw) as Record<string, boolean>) : {});
    } catch {
      setChecked({});
    }
  }, [lineId]);

  const toggle = useCallback(
    (id: number) => {
      setChecked((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        try {
          window.localStorage.setItem(storageKey(lineId), JSON.stringify(next));
        } catch {
          /* private-mode / quota — non-fatal */
        }
        return next;
      });
    },
    [lineId],
  );

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: checklistQueryKey('GLOBAL') }),
    [queryClient],
  );

  // ── Manage mutations (sku_stock.manage; 403s surface as a toast) ──────────
  const addStep = useCallback(
    async (label: string) => {
      const stepLabel = label.trim();
      if (!stepLabel) return;
      setBusy(true);
      try {
        const res = await fetch('/api/checklists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scopeType: 'GLOBAL', stepLabel, sortOrder: items.length }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          toast.error(json?.error || 'Could not add step (need manage permission)');
          return;
        }
        setNewLabel('');
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [items.length, refresh],
  );

  const renameStep = useCallback(
    async (id: number, label: string) => {
      const stepLabel = label.trim();
      if (!stepLabel) return;
      setBusy(true);
      try {
        const res = await fetch('/api/checklists', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, stepLabel }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          toast.error(json?.error || 'Could not update step');
          return;
        }
        setEditingId(null);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const removeStep = useCallback(
    async (id: number) => {
      setBusy(true);
      try {
        const res = await fetch('/api/checklists', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          toast.error(json?.error || 'Could not delete step');
          return;
        }
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const seedDefaults = useCallback(async () => {
    setBusy(true);
    try {
      for (let i = 0; i < GLOBAL_RECEIVING_CHECKLIST.length; i++) {
        const step = GLOBAL_RECEIVING_CHECKLIST[i];
        const res = await fetch('/api/checklists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scopeType: 'GLOBAL', stepLabel: step.label, sortOrder: i }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          toast.error(json?.error || 'Could not seed checklist (need manage permission)');
          return;
        }
      }
      toast.success('Default checklist added');
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const doneCount = items.reduce((n, it) => n + (checked[it.id] ? 1 : 0), 0);
  const allDone = items.length > 0 && doneCount === items.length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-caption text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading checklist…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-caption font-medium text-rose-600">
        Couldn&apos;t load the checklist.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
          Receiving checklist
        </p>
        <div className="flex items-center gap-2">
          {items.length > 0 ? (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-micro font-black uppercase tracking-wider tabular-nums ${
                allDone ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {doneCount}/{items.length}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setManaging((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-micro font-black uppercase tracking-wider transition-colors ${
              managing ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
            }`}
            title={managing ? 'Done editing' : 'Edit checklist steps'}
          >
            {managing ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
            {managing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
          <p className="text-caption text-gray-500">No checklist steps yet.</p>
          <button
            type="button"
            onClick={seedDefaults}
            disabled={busy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-micro font-black uppercase tracking-wider text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Add default steps
          </button>
        </div>
      ) : (
        items.map((it, idx) => {
          const isDone = !!checked[it.id];
          const isEditing = editingId === it.id;
          return (
            <div
              key={it.id}
              className={`flex items-center gap-2 rounded-xl px-2.5 py-2 ${
                isDone && !managing
                  ? 'bg-emerald-50/70 ring-1 ring-inset ring-emerald-100'
                  : 'bg-gray-50'
              }`}
            >
              {!managing ? (
                <button
                  type="button"
                  onClick={() => toggle(it.id)}
                  aria-pressed={isDone}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ring-1 ring-inset transition-colors ${
                      isDone ? 'bg-emerald-500 text-white ring-emerald-500' : 'bg-white text-transparent ring-gray-300'
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className="shrink-0 w-4 text-center text-micro font-black text-gray-400 tabular-nums">
                    {idx + 1}
                  </span>
                  <span
                    className={`flex-1 min-w-0 text-caption font-bold ${
                      isDone ? 'text-emerald-800 line-through decoration-emerald-300' : 'text-gray-800'
                    }`}
                  >
                    {it.step_label}
                  </span>
                </button>
              ) : isEditing ? (
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <input
                    autoFocus
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void renameStep(it.id, editLabel);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-caption font-bold text-gray-900"
                  />
                  <button
                    type="button"
                    onClick={() => void renameStep(it.id, editLabel)}
                    disabled={busy}
                    className="shrink-0 rounded-lg bg-gray-900 px-2 py-1 text-micro font-black uppercase tracking-wider text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="shrink-0 w-4 text-center text-micro font-black text-gray-400 tabular-nums">
                    {idx + 1}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-caption font-bold text-gray-800">
                    {it.step_label}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(it.id);
                      setEditLabel(it.step_label);
                    }}
                    className="shrink-0 rounded-lg p-1 text-gray-300 transition-colors hover:bg-blue-50 hover:text-blue-600"
                    title="Rename step"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeStep(it.id)}
                    disabled={busy}
                    className="shrink-0 rounded-lg p-1 text-gray-300 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                    title="Delete step"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          );
        })
      )}

      {managing ? (
        <div className="flex items-center gap-1.5 pt-1">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addStep(newLabel);
            }}
            placeholder="Add a checklist step…"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-caption font-bold text-gray-900 placeholder:text-gray-400"
          />
          <button
            type="button"
            onClick={() => void addStep(newLabel)}
            disabled={busy || !newLabel.trim()}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-micro font-black uppercase tracking-wider text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Add
          </button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <p className="px-1 pt-1 text-micro font-semibold text-gray-400">
          Global checklist — per-SKU checklists coming soon.
        </p>
      ) : null}
    </div>
  );
}

export default LineChecklistTab;
