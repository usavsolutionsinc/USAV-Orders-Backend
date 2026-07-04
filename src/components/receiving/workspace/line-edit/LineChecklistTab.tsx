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
import { Button, IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
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
      <div className="flex items-center justify-center gap-2 py-6 text-caption text-text-faint">
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
        <p className="text-micro font-black uppercase tracking-widest text-text-soft">
          Receiving checklist
        </p>
        <div className="flex items-center gap-2">
          {items.length > 0 ? (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-micro font-black uppercase tracking-wider tabular-nums ${
                allDone ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-sunken text-text-soft'
              }`}
            >
              {doneCount}/{items.length}
            </span>
          ) : null}
          <HoverTooltip label={managing ? 'Done editing' : 'Edit checklist steps'} asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setManaging((v) => !v)}
              ariaLabel={managing ? 'Done editing' : 'Edit checklist steps'}
              icon={managing ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
              className={managing ? 'bg-blue-50 text-blue-600' : ''}
            >
              {managing ? 'Done' : 'Edit'}
            </Button>
          </HoverTooltip>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center">
          <p className="text-caption text-text-soft">No checklist steps yet.</p>
          <Button
            variant="primary"
            size="sm"
            onClick={seedDefaults}
            disabled={busy}
            loading={busy}
            icon={<Plus className="h-3 w-3" />}
            className="mt-2"
          >
            Add default steps
          </Button>
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
                  : 'bg-surface-canvas'
              }`}
            >
              {!managing ? (
                // ds-raw-button: composite checkbox-row toggle (checkbox + index + label), not a DS Button
                <button
                  type="button"
                  onClick={() => toggle(it.id)}
                  aria-pressed={isDone}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ring-1 ring-inset transition-colors ${
                      isDone ? 'bg-emerald-500 text-white ring-emerald-500' : 'bg-surface-card text-transparent ring-border-default'
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className="shrink-0 w-4 text-center text-micro font-black text-text-faint tabular-nums">
                    {idx + 1}
                  </span>
                  <span
                    className={`flex-1 min-w-0 text-caption font-bold ${
                      isDone ? 'text-emerald-800 line-through decoration-emerald-300' : 'text-text-default'
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
                    className="min-w-0 flex-1 rounded-lg border border-border-soft bg-surface-card px-2 py-1 text-caption font-bold text-text-default"
                  />
                  <Button
                    variant="brand"
                    size="sm"
                    onClick={() => void renameStep(it.id, editLabel)}
                    disabled={busy}
                    className="shrink-0"
                  >
                    Save
                  </Button>
                  <IconButton
                    onClick={() => setEditingId(null)}
                    className="shrink-0 rounded-lg p-1 hover:bg-surface-sunken"
                    ariaLabel="Cancel editing"
                    icon={<X className="h-3.5 w-3.5" />}
                  />
                </div>
              ) : (
                <>
                  <span className="shrink-0 w-4 text-center text-micro font-black text-text-faint tabular-nums">
                    {idx + 1}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-caption font-bold text-text-default">
                    {it.step_label}
                  </span>
                  <HoverTooltip label="Rename step" asChild>
                    <IconButton
                      onClick={() => {
                        setEditingId(it.id);
                        setEditLabel(it.step_label);
                      }}
                      ariaLabel="Rename step"
                      tone="accent"
                      className="shrink-0 rounded-lg p-1 text-text-faint transition-colors hover:bg-blue-50"
                      icon={<Pencil className="h-3 w-3" />}
                    />
                  </HoverTooltip>
                  <HoverTooltip label="Delete step" asChild>
                    <IconButton
                      onClick={() => void removeStep(it.id)}
                      disabled={busy}
                      ariaLabel="Delete step"
                      className="shrink-0 rounded-lg p-1 text-text-faint transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                      icon={<Trash2 className="h-3 w-3" />}
                    />
                  </HoverTooltip>
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
            className="min-w-0 flex-1 rounded-lg border border-border-soft bg-surface-card px-2.5 py-1.5 text-caption font-bold text-text-default placeholder:text-text-faint"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => void addStep(newLabel)}
            disabled={busy || !newLabel.trim()}
            loading={busy}
            icon={<Plus className="h-3 w-3" />}
            className="shrink-0"
          >
            Add
          </Button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <p className="px-1 pt-1 text-micro font-semibold text-text-faint">
          Global checklist — per-SKU checklists coming soon.
        </p>
      ) : null}
    </div>
  );
}

export default LineChecklistTab;
