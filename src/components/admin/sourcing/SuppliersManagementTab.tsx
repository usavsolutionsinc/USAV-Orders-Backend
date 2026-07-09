'use client';

/**
 * Main pane for /admin?section=suppliers. Reads ?supplier=<id|'new'> and shows
 * a create form or an editable supplier card. eBay sellers are auto-created on
 * import; the rest are entered here.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Button } from '@/design-system/primitives/Button';
import { AdminEmptyDetail } from '../shared';
import { Link2 } from '@/components/Icons';

interface Supplier {
  id: number;
  name: string;
  supplier_type: string;
  email: string | null;
  phone: string | null;
  url: string | null;
  ebay_seller_id: string | null;
  rating: number | null;
  lead_time_days: number | null;
  notes: string | null;
}

const TYPES = ['ebay_seller', 'distributor', 'salvage', 'oem', 'marketplace', 'other'];

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

export function SuppliersManagementTab() {
  const searchParams = useSearchParams();
  const selected = searchParams.get('supplier') ?? '';

  if (selected === 'new') return <SupplierForm mode="create" />;
  if (/^\d+$/.test(selected)) return <SupplierLoader id={Number(selected)} />;
  return (
    <AdminEmptyDetail
      icon={<Link2 className="h-6 w-6" />}
      title="Select a supplier"
      hint="Pick a vendor on the left to edit it, or add a new third-party source."
    />
  );
}

function SupplierLoader({ id }: { id: number }) {
  const { data, isLoading } = useQuery<{ supplier: Supplier }>({
    queryKey: qk.suppliers.detail(id),
    queryFn: () => jsonFetch(`/api/suppliers/${id}`),
  });
  if (isLoading) return <div className="p-6 text-sm text-text-faint">Loading…</div>;
  if (!data?.supplier) return <AdminEmptyDetail title="Supplier not found" />;
  return <SupplierForm mode="edit" supplier={data.supplier} />;
}

function SupplierForm({ mode, supplier }: { mode: 'create' | 'edit'; supplier?: Supplier }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    supplierType: supplier?.supplier_type ?? 'other',
    email: supplier?.email ?? '',
    phone: supplier?.phone ?? '',
    url: supplier?.url ?? '',
    leadTimeDays: supplier?.lead_time_days ? String(supplier.lead_time_days) : '',
    rating: supplier?.rating ? String(supplier.rating) : '',
    notes: supplier?.notes ?? '',
  });

  const payload = () => ({
    name: form.name.trim(),
    supplierType: form.supplierType,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    url: form.url.trim() || null,
    leadTimeDays: form.leadTimeDays ? Number(form.leadTimeDays) : null,
    rating: form.rating ? Number(form.rating) : null,
    notes: form.notes.trim() || null,
  });

  const save = useMutation({
    mutationFn: () =>
      mode === 'create'
        ? jsonFetch('/api/suppliers', { method: 'POST', body: JSON.stringify(payload()) })
        : jsonFetch(`/api/suppliers/${supplier!.id}`, { method: 'PATCH', body: JSON.stringify(payload()) }),
    onSuccess: (body) => {
      queryClient.invalidateQueries({ queryKey: qk.suppliers.all });
      if (mode === 'create') {
        const next = new URLSearchParams(searchParams.toString());
        next.set('supplier', String(body.supplier.id));
        router.replace(`/admin?${next.toString()}`);
      } else {
        queryClient.invalidateQueries({ queryKey: qk.suppliers.detail(supplier!.id) });
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => jsonFetch(`/api/suppliers/${supplier!.id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qk.suppliers.all }); router.replace('/admin?section=suppliers'); },
  });

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto p-6">
      <h2 className="text-lg font-bold text-text-default">{mode === 'create' ? 'New supplier' : form.name}</h2>
      {supplier?.ebay_seller_id ? <p className="-mt-2 text-caption text-text-soft">eBay seller · {supplier.ebay_seller_id}</p> : null}
      <Field label="Name" required><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <select className={inputCls} value={form.supplierType} onChange={(e) => setForm({ ...form, supplierType: e.target.value })}>
            {TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Lead time (days)"><input className={inputCls} value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} inputMode="numeric" /></Field>
        <Field label="Email"><input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Phone"><input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="URL"><input className={inputCls} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
        <Field label="Rating (1–5)"><input className={inputCls} value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} inputMode="numeric" /></Field>
      </div>
      <Field label="Notes"><input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      {save.isError ? <p className="text-caption text-red-600">{(save.error as Error).message}</p> : null}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant="primary" loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>{mode === 'create' ? 'Create' : 'Save changes'}</Button>
          {mode === 'create' ? <Button variant="ghost" onClick={() => router.replace('/admin?section=suppliers')}>Cancel</Button> : null}
        </div>
        {mode === 'edit' ? <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => { if (confirm('Deactivate this supplier?')) remove.mutate(); }}>Deactivate</Button> : null}
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-border-default px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-caption font-semibold text-text-muted">{label}{required ? <span className="text-red-500"> *</span> : null}</span>
      {children}
    </label>
  );
}
