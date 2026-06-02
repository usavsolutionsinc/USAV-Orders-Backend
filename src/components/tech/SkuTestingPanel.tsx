'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Printer,
  ExternalLink,
  Search,
  X,
  Unlink,
  FileText,
} from '@/components/Icons';

/**
 * Testing-centered panel for one receiving line. Resolves the line's SKU
 * catalog (scanned unit → SKU string crosswalk) and lets a tech:
 *   • view + add/edit/delete the checklist steps (template, per-SKU)
 *   • record each step per scanned unit (who/when) once a serial exists
 *   • see the SKU's manuals, pair one from the library, and open/print it
 *
 * Plain fetch + local state (no React Query) so it never refetches on window
 * focus and clobbers an in-progress edit.
 */

interface ChecklistStep {
  step_id: number;
  step_label: string;
  step_type: string;
  sort_order: number;
}

interface ManualRow {
  id: number;
  display_name: string | null;
  type: string | null;
  source_url: string | null;
  thumbnail_url: string | null;
  file_name: string | null;
}

interface UnitResult {
  step_id: number;
  passed: boolean | null;
  verified_by_name: string | null;
}

interface Bundle {
  skuCatalogId: number | null;
  sku: string | null;
  title: string | null;
  checklist: ChecklistStep[];
  manuals: ManualRow[];
}

interface Props {
  receivingLineId: number;
  sku: string;
  title: string;
  /** Active scanned unit, if any — enables per-unit step recording. */
  serialUnitId?: number | null;
}

// Mirrors the surface tokens in TechTestingWorkspace — flat hairline card +
// quieted section label. Keep these in sync (see /design-demo).
const SECTION = 'rounded-2xl bg-white p-4 ring-1 ring-gray-200/70';
const EYEBROW = 'text-caption font-semibold text-gray-400';

export function SkuTestingPanel({ receivingLineId, sku, title, serialUnitId }: Props) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Record<number, UnitResult>>({});
  const canRecord = serialUnitId != null;

  const loadBundle = useCallback(async () => {
    const res = await fetch(`/api/receiving-lines/${receivingLineId}/testing-bundle`, {
      cache: 'no-store',
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) {
      setBundle({
        skuCatalogId: data.skuCatalogId ?? null,
        sku: data.sku ?? sku,
        title: data.title ?? title,
        checklist: (data.checklist ?? []) as ChecklistStep[],
        manuals: (data.manuals ?? []) as ManualRow[],
      });
    } else {
      setBundle({ skuCatalogId: null, sku, title, checklist: [], manuals: [] });
    }
  }, [receivingLineId, sku, title]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadBundle().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadBundle]);

  // Per-unit recorded results, loaded when a serial is on the active slot.
  useEffect(() => {
    if (serialUnitId == null) {
      setResults({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/serial-units/${serialUnitId}/checklist`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (cancelled || !res.ok || !data?.ok) return;
      const map: Record<number, UnitResult> = {};
      for (const s of data.steps as Array<UnitResult & { step_id: number }>) {
        map[s.step_id] = { step_id: s.step_id, passed: s.passed, verified_by_name: s.verified_by_name };
      }
      setResults(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [serialUnitId]);

  if (loading) {
    return (
      <section className={SECTION}>
        <div className="flex items-center gap-2 py-2 text-caption text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading testing details…
        </div>
      </section>
    );
  }
  if (!bundle) return null;

  return (
    <div className="flex flex-col gap-3">
      <ChecklistSection
        receivingLineId={receivingLineId}
        bundle={bundle}
        results={results}
        canRecord={canRecord}
        serialUnitId={serialUnitId ?? null}
        onChanged={loadBundle}
        onResultChange={(stepId, next) =>
          setResults((m) => ({ ...m, [stepId]: { ...(m[stepId] ?? { step_id: stepId, verified_by_name: null }), ...next } }))
        }
      />
      <ManualsSection
        receivingLineId={receivingLineId}
        bundle={bundle}
        onChanged={loadBundle}
      />
    </div>
  );
}

/* ─────────────────────────── Checklist ─────────────────────────── */

function ChecklistSection({
  receivingLineId,
  bundle,
  results,
  canRecord,
  serialUnitId,
  onChanged,
  onResultChange,
}: {
  receivingLineId: number;
  bundle: Bundle;
  results: Record<number, UnitResult>;
  canRecord: boolean;
  serialUnitId: number | null;
  onChanged: () => Promise<void>;
  onResultChange: (stepId: number, next: Partial<UnitResult>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [recordingStep, setRecordingStep] = useState<number | null>(null);

  const steps = bundle.checklist;
  const done = steps.filter((s) => results[s.step_id]?.passed === true).length;

  const addStep = useCallback(async () => {
    const label = draft.trim();
    if (!label) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/receiving-lines/${receivingLineId}/qc-checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepLabel: label, sortOrder: steps.length }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Add failed (${res.status})`);
      setDraft('');
      setAdding(false);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add step');
    } finally {
      setBusy(false);
    }
  }, [draft, receivingLineId, steps.length, onChanged]);

  const saveEdit = useCallback(async () => {
    if (editingId == null) return;
    const label = editLabel.trim();
    if (!label) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/receiving-lines/${receivingLineId}/qc-checks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkId: editingId, stepLabel: label }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Save failed (${res.status})`);
      setEditingId(null);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save step');
    } finally {
      setBusy(false);
    }
  }, [editingId, editLabel, receivingLineId, onChanged]);

  const removeStep = useCallback(
    async (stepId: number) => {
      if (!window.confirm('Remove this checklist step for the whole SKU?')) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/receiving-lines/${receivingLineId}/qc-checks`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkId: stepId }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error || `Delete failed (${res.status})`);
        await onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not delete step');
      } finally {
        setBusy(false);
      }
    },
    [receivingLineId, onChanged],
  );

  const toggleRecord = useCallback(
    async (step: ChecklistStep) => {
      if (serialUnitId == null) return;
      const nextPassed = results[step.step_id]?.passed !== true;
      setRecordingStep(step.step_id);
      onResultChange(step.step_id, { passed: nextPassed });
      try {
        const res = await fetch(`/api/serial-units/${serialUnitId}/checklist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stepId: step.step_id, passed: nextPassed }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error || `Save failed (${res.status})`);
      } catch (err) {
        onResultChange(step.step_id, { passed: !nextPassed });
        toast.error(err instanceof Error ? err.message : 'Could not record step');
      } finally {
        setRecordingStep(null);
      }
    },
    [serialUnitId, results, onResultChange],
  );

  return (
    <section className={SECTION}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={EYEBROW}>Testing checklist</h3>
        <div className="flex items-center gap-2">
          {steps.length > 0 ? (
            <span
              className={`rounded-md px-2 py-0.5 text-micro font-bold uppercase tracking-wider ${
                canRecord && done === steps.length
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {done}/{steps.length} done
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setAdding((v) => !v);
              setDraft('');
            }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-micro font-bold uppercase tracking-wider text-blue-600 transition-colors duration-150 hover:bg-blue-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      </div>

      {bundle.skuCatalogId == null ? (
        <NoCatalogNotice receivingLineId={receivingLineId} sku={bundle.sku ?? ''} onCreated={onChanged} />
      ) : null}

      <ul className="flex flex-col gap-1.5">
        {steps.map((step) => {
          const checked = results[step.step_id]?.passed === true;
          const recording = recordingStep === step.step_id;
          const isEditing = editingId === step.step_id;
          return (
            <li
              key={step.step_id}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 transition-colors duration-150 ${
                checked ? 'border-emerald-200 bg-emerald-50/60' : 'border-gray-200/70 bg-white'
              }`}
            >
              <button
                type="button"
                onClick={() => void toggleRecord(step)}
                disabled={!canRecord || recording || isEditing}
                aria-pressed={checked}
                title={canRecord ? 'Mark for this unit' : 'Scan a serial to record results'}
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-black transition-all duration-150 active:scale-95 ${
                  checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300 bg-white text-transparent'
                } ${!canRecord ? 'cursor-default opacity-90' : ''}`}
              >
                {recording ? <Loader2 className="h-3 w-3 animate-spin text-gray-400" /> : '✓'}
              </button>

              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveEdit();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      className="w-full rounded-md border border-blue-300 px-2 py-1 text-caption font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
                    />
                    <button type="button" onClick={() => void saveEdit()} disabled={busy} className="rounded-md p-1 text-emerald-600 hover:bg-emerald-50">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-xs font-black">✓</span>}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="block text-caption font-semibold leading-snug text-gray-900">
                      {step.step_label}
                    </span>
                    {checked && results[step.step_id]?.verified_by_name ? (
                      <span className="mt-0.5 block text-micro font-medium uppercase tracking-wide text-emerald-700">
                        {results[step.step_id]?.verified_by_name}
                      </span>
                    ) : null}
                  </>
                )}
              </div>

              {!isEditing ? (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(step.step_id);
                      setEditLabel(step.step_label);
                    }}
                    className="rounded-md p-1 text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700"
                    title="Edit step"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeStep(step.step_id)}
                    className="rounded-md p-1 text-gray-400 transition-colors duration-150 hover:bg-rose-50 hover:text-rose-600"
                    title="Delete step"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {adding ? (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addStep();
              if (e.key === 'Escape') setAdding(false);
            }}
            autoFocus
            placeholder="New checklist step…"
            className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-caption font-medium text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
          />
          <button
            type="button"
            onClick={() => void addStep()}
            disabled={busy || !draft.trim()}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-caption font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
          </button>
        </div>
      ) : null}

      {steps.length === 0 && !adding ? (
        <p className="text-caption text-gray-400">No checklist steps yet. Use “Add” to create one.</p>
      ) : null}

      {steps.length > 0 && !canRecord ? (
        <p className="mt-2.5 text-micro font-medium uppercase tracking-wide text-gray-400">
          Scan a serial to record results
        </p>
      ) : null}
    </section>
  );
}

function NoCatalogNotice({
  receivingLineId,
  sku,
  onCreated,
}: {
  receivingLineId: number;
  sku: string;
  onCreated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const create = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/receiving-lines/${receivingLineId}/ensure-catalog`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Failed (${res.status})`);
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create catalog entry');
    } finally {
      setBusy(false);
    }
  }, [receivingLineId, onCreated]);

  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
      <span className="text-caption font-medium text-amber-800">
        No catalog entry for {sku || 'this SKU'} yet.
      </span>
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy}
        className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Create entry'}
      </button>
    </div>
  );
}

/* ─────────────────────────── Manuals ─────────────────────────── */

function ManualsSection({
  receivingLineId,
  bundle,
  onChanged,
}: {
  receivingLineId: number;
  bundle: Bundle;
  onChanged: () => Promise<void>;
}) {
  const [pairing, setPairing] = useState(false);
  const manuals = bundle.manuals;

  const unpair = useCallback(
    async (manualId: number) => {
      try {
        const res = await fetch(`/api/receiving-lines/${receivingLineId}/manuals`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manualId }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error || `Unpair failed (${res.status})`);
        await onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not unpair manual');
      }
    },
    [receivingLineId, onChanged],
  );

  return (
    <section className={SECTION}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={EYEBROW}>Manuals</h3>
        <button
          type="button"
          onClick={() => setPairing((v) => !v)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-micro font-bold uppercase tracking-wider text-blue-600 transition-colors duration-150 hover:bg-blue-50"
        >
          <Plus className="h-3.5 w-3.5" /> Pair
        </button>
      </div>

      {pairing ? (
        <ManualPicker
          receivingLineId={receivingLineId}
          onPaired={async () => {
            setPairing(false);
            await onChanged();
          }}
        />
      ) : null}

      {manuals.length === 0 ? (
        <p className="text-caption text-gray-400">No manuals paired to this SKU yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {manuals.map((m) => {
            const name = m.display_name || m.file_name || `Manual #${m.id}`;
            return (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200/70 bg-white px-3 py-2"
              >
                {m.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.thumbnail_url} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-gray-200" />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-400">
                    <FileText className="h-4 w-4" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-caption font-semibold text-gray-900">{name}</span>
                  {m.type ? (
                    <span className="block text-micro font-medium uppercase tracking-wide text-gray-400">{m.type}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {m.source_url ? (
                    <a
                      href={m.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md p-1.5 text-gray-500 hover:bg-blue-50 hover:text-blue-600"
                      title="Open / print manual"
                    >
                      <Printer className="h-4 w-4" />
                    </a>
                  ) : null}
                  {m.source_url ? (
                    <a
                      href={m.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      title="Open in new tab"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void unpair(m.id)}
                    className="rounded-md p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Unpair manual"
                  >
                    <Unlink className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ManualPicker({
  receivingLineId,
  onPaired,
}: {
  receivingLineId: number;
  onPaired: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ManualRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [pairingId, setPairingId] = useState<number | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(() => {
      setSearching(true);
      void (async () => {
        try {
          const res = await fetch(`/api/product-manuals?search=${encodeURIComponent(q)}&limit=10`, {
            cache: 'no-store',
          });
          const data = await res.json().catch(() => null);
          const list: ManualRow[] = Array.isArray(data)
            ? data
            : data?.rows ?? data?.manuals ?? data?.results ?? [];
          setResults(list);
        } catch {
          setResults([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  const pair = useCallback(
    async (manualId: number) => {
      setPairingId(manualId);
      try {
        const res = await fetch(`/api/receiving-lines/${receivingLineId}/manuals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manualId }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error || `Pair failed (${res.status})`);
        toast.success('Manual paired');
        await onPaired();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not pair manual');
      } finally {
        setPairingId(null);
      }
    },
    [receivingLineId, onPaired],
  );

  return (
    <div className="mb-3 rounded-lg border border-gray-200/70 bg-gray-50/60 p-2">
      <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5">
        <Search className="h-4 w-4 shrink-0 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          placeholder="Search manuals library…"
          className="w-full bg-transparent text-caption font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none"
        />
        {searching ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-300" /> : null}
      </div>
      {results.length > 0 ? (
        <ul className="mt-1.5 flex max-h-56 flex-col gap-1 overflow-y-auto">
          {results.map((m) => {
            const name = m.display_name || m.file_name || `Manual #${m.id}`;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => void pair(m.id)}
                  disabled={pairingId === m.id}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white"
                >
                  <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1 truncate text-caption font-medium text-gray-800">{name}</span>
                  {pairingId === m.id ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-blue-500" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : query.trim() && !searching ? (
        <p className="mt-2 px-2 text-caption text-gray-400">No matches.</p>
      ) : null}
    </div>
  );
}
