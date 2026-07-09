'use client';

/**
 * Main pane for /admin?section=bose_models.
 *
 * Reads ?model=<id|'new'> from the URL (set by BoseModelsSidebarPanel):
 *   - 'new'    → create form
 *   - <id>     → editable model fields + inline compatible-parts manager
 *   - (none)   → empty state
 *
 * Compatibility edits go through /api/part-compatibility; model edits through
 * /api/bose-models. All mutations invalidate the broad qk prefixes so the
 * sidebar counts + lookup stay coherent.
 */

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Button } from '@/design-system/primitives/Button';
import { AdminEmptyDetail } from '../shared';
import { Cpu } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

// ─── Types (mirror the API responses) ───────────────────────────────────────

interface BoseModel {
  id: number;
  model_number: string;
  model_name: string;
  family: string | null;
  product_type: string | null;
  release_year: number | null;
  eol_date: string | null;
  image_url: string | null;
  notes: string | null;
  is_active: boolean;
}

interface CompatiblePart {
  compatibility_id: number;
  sku_id: number;
  sku: string;
  product_title: string;
  part_role: string;
  is_oem: boolean;
  fit: string;
  confidence: string;
  lifecycle_status: string;
  on_hand: number;
  open_alert_count: number;
}

const PART_ROLES = ['battery', 'ear_cushion', 'driver', 'pcb', 'power_supply', 'remote', 'antenna', 'cable', 'headband', 'other'];
const FITS = ['exact', 'equivalent', 'salvage'] as const;

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

// ─── Entry point ────────────────────────────────────────────────────────────

export function BoseModelsManagementTab() {
  const searchParams = useSearchParams();
  const selected = searchParams.get('model') ?? '';

  if (selected === 'new') return <CreateModelForm />;
  if (/^\d+$/.test(selected)) return <ModelDetail id={Number(selected)} />;
  return (
    <AdminEmptyDetail
      icon={<Cpu className="h-6 w-6" />}
      title="Select a Bose model"
      hint="Pick a model on the left to edit it and manage its compatible parts, or add a new one."
    />
  );
}

// ─── Create ─────────────────────────────────────────────────────────────────

function CreateModelForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [modelNumber, setModelNumber] = useState('');
  const [modelName, setModelName] = useState('');
  const [family, setFamily] = useState('');

  const create = useMutation({
    mutationFn: () =>
      jsonFetch('/api/bose-models', {
        method: 'POST',
        body: JSON.stringify({
          modelNumber: modelNumber.trim(),
          modelName: modelName.trim(),
          family: family.trim() || null,
        }),
      }),
    onSuccess: (body) => {
      queryClient.invalidateQueries({ queryKey: qk.boseModels.all });
      const next = new URLSearchParams(searchParams.toString());
      next.set('model', String(body.model.id));
      router.replace(`/admin?${next.toString()}`);
    },
  });

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto p-6">
      <h2 className="text-lg font-bold text-text-default">New Bose model</h2>
      <Field label="Model number" required>
        <input className={inputCls} value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} placeholder="e.g. 423816" />
      </Field>
      <Field label="Model name" required>
        <input className={inputCls} value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="e.g. SoundLink Mini II" />
      </Field>
      <Field label="Family">
        <input className={inputCls} value={family} onChange={(e) => setFamily(e.target.value)} placeholder="SoundLink, QuietComfort, Wave…" />
      </Field>
      {create.isError ? <p className="text-caption text-red-600">{(create.error as Error).message}</p> : null}
      <div className="flex gap-2">
        <Button
          variant="primary"
          loading={create.isPending}
          disabled={!modelNumber.trim() || !modelName.trim()}
          onClick={() => create.mutate()}
        >
          Create model
        </Button>
        <Button variant="ghost" onClick={() => router.replace('/admin?section=bose_models')}>Cancel</Button>
      </div>
    </div>
  );
}

// ─── Detail + edit + compatibility ──────────────────────────────────────────

function ModelDetail({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data, isLoading } = useQuery<{ model: BoseModel; parts: CompatiblePart[] }>({
    queryKey: qk.boseModels.detail(id),
    queryFn: () => jsonFetch(`/api/bose-models/${id}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.boseModels.all });
    queryClient.invalidateQueries({ queryKey: qk.partCompatibility.all });
  };

  if (isLoading) return <div className="p-6 text-sm text-text-faint">Loading…</div>;
  if (!data?.model) return <AdminEmptyDetail title="Model not found" />;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <ModelEditCard model={data.model} onSaved={invalidate} onDeleted={() => { invalidate(); router.replace('/admin?section=bose_models'); }} />
        <CompatibilityManager modelId={id} parts={data.parts} onChanged={() => { invalidate(); queryClient.invalidateQueries({ queryKey: qk.boseModels.detail(id) }); }} />
      </div>
    </div>
  );
}

function ModelEditCard({ model, onSaved, onDeleted }: { model: BoseModel; onSaved: () => void; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    modelName: model.model_name,
    family: model.family ?? '',
    productType: model.product_type ?? '',
    releaseYear: model.release_year ? String(model.release_year) : '',
    eolDate: model.eol_date ?? '',
    notes: model.notes ?? '',
  });

  const save = useMutation({
    mutationFn: () =>
      jsonFetch(`/api/bose-models/${model.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          modelName: form.modelName.trim(),
          family: form.family.trim() || null,
          productType: form.productType.trim() || null,
          releaseYear: form.releaseYear ? Number(form.releaseYear) : null,
          eolDate: form.eolDate.trim() || null,
          notes: form.notes.trim() || null,
        }),
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qk.boseModels.detail(model.id) }); onSaved(); },
  });

  const remove = useMutation({
    mutationFn: () => jsonFetch(`/api/bose-models/${model.id}`, { method: 'DELETE' }),
    onSuccess: onDeleted,
  });

  return (
    <section className="rounded-xl border border-border-soft bg-surface-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-default">{model.model_name}</h2>
          <p className="text-caption text-text-soft">Model #{model.model_number}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Model name"><input className={inputCls} value={form.modelName} onChange={(e) => setForm({ ...form, modelName: e.target.value })} /></Field>
        <Field label="Family"><input className={inputCls} value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value })} /></Field>
        <Field label="Product type"><input className={inputCls} value={form.productType} onChange={(e) => setForm({ ...form, productType: e.target.value })} placeholder="speaker, headphone…" /></Field>
        <Field label="Release year"><input className={inputCls} value={form.releaseYear} onChange={(e) => setForm({ ...form, releaseYear: e.target.value })} inputMode="numeric" /></Field>
        <Field label="EOL date"><input className={inputCls} value={form.eolDate} onChange={(e) => setForm({ ...form, eolDate: e.target.value })} placeholder="YYYY-MM-DD" /></Field>
        <Field label="Notes"><input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
      {save.isError ? <p className="mt-2 text-caption text-red-600">{(save.error as Error).message}</p> : null}
      <div className="mt-4 flex items-center justify-between">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>
        <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => { if (confirm('Deactivate this model? Compatibility edges are preserved.')) remove.mutate(); }}>
          Deactivate
        </Button>
      </div>
    </section>
  );
}

// ─── Compatibility manager (add / remove compatible parts) ──────────────────

function CompatibilityManager({ modelId, parts, onChanged }: { modelId: number; parts: CompatiblePart[]; onChanged: () => void }) {
  const [skuId, setSkuId] = useState<number | null>(null);
  const [skuLabel, setSkuLabel] = useState('');
  const [partRole, setPartRole] = useState('battery');
  const [fit, setFit] = useState<(typeof FITS)[number]>('exact');
  const [isOem, setIsOem] = useState(true);

  const add = useMutation({
    mutationFn: () =>
      jsonFetch('/api/part-compatibility', {
        method: 'POST',
        body: JSON.stringify({ boseModelId: modelId, skuId, partRole, fit, isOem }),
      }),
    onSuccess: () => { setSkuId(null); setSkuLabel(''); onChanged(); },
  });

  const remove = useMutation({
    mutationFn: (compatibilityId: number) => jsonFetch(`/api/part-compatibility/${compatibilityId}`, { method: 'DELETE' }),
    onSuccess: onChanged,
  });

  return (
    <section className="rounded-xl border border-border-soft bg-surface-card p-5">
      <h3 className="mb-3 text-sm font-bold text-text-default">Compatible parts ({parts.length})</h3>

      {parts.length === 0 ? (
        <p className="mb-4 text-caption text-text-faint">No compatible parts linked yet.</p>
      ) : (
        <ul className="mb-4 divide-y divide-border-hairline">
          {parts.map((p) => (
            <li key={p.compatibility_id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text-default">{p.product_title}</p>
                <p className="truncate text-caption text-text-soft">{p.sku}</p>
              </div>
              <RoleChip role={p.part_role} />
              <FitChip fit={p.fit} oem={p.is_oem} />
              <StockBadge onHand={p.on_hand} lifecycle={p.lifecycle_status} alerts={p.open_alert_count} />
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => remove.mutate(p.compatibility_id)}
                className="text-rose-600 hover:text-rose-700"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Add a part */}
      <div className="rounded-lg border border-dashed border-border-default p-3">
        <p className="mb-2 text-caption font-semibold text-text-muted">Add a compatible part</p>
        <SkuSearchField
          value={skuLabel}
          onSelect={(s) => { setSkuId(s.id); setSkuLabel(`${s.product_title} (${s.sku})`); }}
          onClear={() => { setSkuId(null); setSkuLabel(''); }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select className={selectCls} value={partRole} onChange={(e) => setPartRole(e.target.value)}>
            {PART_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className={selectCls} value={fit} onChange={(e) => setFit(e.target.value as typeof fit)}>
            {FITS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <label className="flex items-center gap-1 text-caption text-text-muted">
            <input type="checkbox" checked={isOem} onChange={(e) => setIsOem(e.target.checked)} /> OEM
          </label>
          <Button variant="primary" size="sm" loading={add.isPending} disabled={!skuId} onClick={() => add.mutate()}>
            Add part
          </Button>
        </div>
        {add.isError ? <p className="mt-2 text-caption text-red-600">{(add.error as Error).message}</p> : null}
      </div>
    </section>
  );
}

// ─── SKU search field (autocomplete over /api/sku-catalog) ──────────────────

interface SkuHit { id: number; sku: string; product_title: string }

function SkuSearchField({ value, onSelect, onClear }: { value: string; onSelect: (s: SkuHit) => void; onClear: () => void }) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);

  const { data } = useQuery<{ items: SkuHit[] }>({
    queryKey: ['sku-catalog-search', term],
    queryFn: () => jsonFetch(`/api/sku-catalog?q=${encodeURIComponent(term)}&limit=8`),
    enabled: open && term.trim().length >= 2,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border-soft bg-surface-canvas px-3 py-2">
        <span className="truncate text-sm text-text-default">{value}</span>
        <Button variant="ghost" size="sm" type="button" onClick={onClear}>Change</Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        className={inputCls}
        value={term}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search a SKU by sku or title…"
      />
      {open && (data?.items?.length ?? 0) > 0 ? (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border-soft bg-surface-card shadow-lg">
          {data!.items.map((s) => (
            <li key={s.id}>
              {/* ds-raw-button: full-width left-aligned dropdown menu row (composite content) */}
              <button
                type="button"
                onClick={() => { onSelect(s); setOpen(false); setTerm(''); }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50"
              >
                <span className="font-semibold text-text-default">{s.product_title}</span>
                <span className="ml-1 text-caption text-text-soft">{s.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ─── Small presentational bits ──────────────────────────────────────────────

const inputCls = 'w-full rounded-md border border-border-default px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const selectCls = 'rounded-md border border-border-default px-2 py-1.5 text-caption focus:border-blue-500 focus:outline-none';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-caption font-semibold text-text-muted">{label}{required ? <span className="text-red-500"> *</span> : null}</span>
      {children}
    </label>
  );
}

function RoleChip({ role }: { role: string }) {
  return <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-text-muted">{role}</span>;
}

function FitChip({ fit, oem }: { fit: string; oem: boolean }) {
  const tone = fit === 'exact' ? 'bg-emerald-50 text-emerald-700' : fit === 'equivalent' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700';
  return <span className={`rounded-full px-2 py-0.5 text-micro font-semibold ${tone}`}>{oem ? 'OEM ' : ''}{fit}</span>;
}

function StockBadge({ onHand, lifecycle, alerts }: { onHand: number; lifecycle: string; alerts: number }) {
  const eol = lifecycle !== 'active';
  const out = onHand <= 0;
  const tone = out || (eol && onHand < 2) ? 'bg-red-50 text-red-700' : eol ? 'bg-amber-50 text-amber-700' : 'bg-surface-sunken text-text-muted';
  const label = out ? '0 in stock' : `${onHand} in stock`;
  const badge = (
    <span className={`rounded-full px-2 py-0.5 text-micro font-semibold ${tone}`}>
      {label}{eol ? ` · ${lifecycle}` : ''}
    </span>
  );
  if (!eol) return badge;
  return (
    <HoverTooltip label={`lifecycle: ${lifecycle}${alerts ? ` · ${alerts} open alert(s)` : ''}`} asChild>
      {badge}
    </HoverTooltip>
  );
}
