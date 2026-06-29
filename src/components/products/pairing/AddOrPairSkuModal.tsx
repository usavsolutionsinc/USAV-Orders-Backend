'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Loader2, Check, Link2, Plus, AlertCircle } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { useBodyScrollLock, useEscapeClose } from '@/design-system/hooks';
import { platformStyle } from './platform-style';
import type { UnmappedPlatformId } from './types';

interface CatalogSearchRow {
  id: number;
  sku: string;
  product_title: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** The current sidebar search term. Seeds the new Zoho SKU field in the
   *  add-to-catalog flow (no pending id), and the "pair to existing" search. */
  query: string;
  /** When set, the modal links this account-source identifier after create, or
   *  lets the operator pair it to an existing canonical SKU. */
  pending: UnmappedPlatformId | null;
  /** Called with the canonical SKU after a successful add/pair so the caller can
   *  open it (`?sku=`). */
  onDone: (sku: string) => void;
}

type Mode = 'create' | 'existing';

/**
 * Closes the two gaps the canonical pairing queue can't:
 *   1. Add a Zoho SKU that isn't in sku_catalog yet (POST /api/sku-catalog).
 *   2. Pair an unmapped account-source identifier (Amazon ASIN, eBay/Walmart
 *      item id, Ecwid SKU) to a canonical SKU — either the brand-new one or an
 *      existing one (POST /api/sku-catalog/pair, which also backfills orders).
 */
export function AddOrPairSkuModal({ open, onClose, query, pending, onDone }: Props) {
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<Mode>('create');

  // Create-form fields.
  const identifier = pending?.platformItemId || pending?.platformSku || '';
  const [sku, setSku] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [upc, setUpc] = useState('');

  // Pair-to-existing search.
  const [existingQuery, setExistingQuery] = useState('');
  const [results, setResults] = useState<CatalogSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CatalogSearchRow | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setPortal(document.body), []);
  useBodyScrollLock(open);
  useEscapeClose(open, onClose);

  // Reset whenever the modal (re)opens or the target changes.
  useEffect(() => {
    if (!open) return;
    setMode('create');
    // Add-to-catalog flow (no pending id): the operator searched the Zoho SKU
    // itself, so seed the field with it. Pairing an unmapped identifier (pending)
    // means the search term is an ASIN / platform id — NOT a Zoho SKU — so leave
    // it blank for the operator to enter the real canonical SKU.
    setSku(pending ? '' : query.trim());
    setTitle(pending?.suggestedTitle || '');
    setCategory('');
    setUpc('');
    setExistingQuery(pending?.suggestedTitle?.split(/\s+/).slice(0, 2).join(' ') || query.trim());
    setResults([]);
    setSelected(null);
    setError(null);
  }, [open, pending, query]);

  // Debounced catalog search for the "pair to existing" mode.
  useEffect(() => {
    if (!open || mode !== 'existing') return;
    const term = existingQuery.trim();
    if (!term) { setResults([]); return; }
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/sku-catalog/search?q=${encodeURIComponent(term)}&searchField=zoho_catalog&limit=20`,
          { credentials: 'same-origin' },
        );
        const body = await res.json();
        if (!cancelled && body.success) setResults(body.items || []);
      } catch {
        /* best-effort */
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [open, mode, existingQuery]);

  const pendingPlatform = pending?.platform || '';

  const linkPending = async (skuCatalogId: number) => {
    if (!pending) return;
    const res = await fetch('/api/sku-catalog/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        skuCatalogId,
        itemNumber: identifier,
        platform: pendingPlatform,
        accountName: pending.accountName,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) throw new Error(body.error || 'Pairing failed');
  };

  const handleCreate = async () => {
    const trimmedSku = sku.trim();
    const trimmedTitle = title.trim();
    if (!trimmedSku) { setError('Zoho SKU is required.'); return; }
    if (!trimmedTitle) { setError('Product title is required.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/sku-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          sku: trimmedSku,
          productTitle: trimmedTitle,
          category: category.trim() || undefined,
          upc: upc.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Failed to create SKU');
      if (pending) await linkPending(body.catalog.id);
      window.dispatchEvent(new CustomEvent('sku-pairing-updated'));
      onDone(body.catalog.sku);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePairExisting = async () => {
    if (!selected) { setError('Pick a SKU to pair to.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await linkPending(selected.id);
      window.dispatchEvent(new CustomEvent('sku-pairing-updated'));
      onDone(selected.sku);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pair');
    } finally {
      setSubmitting(false);
    }
  };

  const headerLabel = pending ? 'Pair identifier' : 'Add Zoho SKU';
  const style = useMemo(() => (pending ? platformStyle(pending.platform) : null), [pending]);

  if (!open || !portal) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-modal bg-black/30" onClick={onClose} />
      <div className="pointer-events-none fixed inset-0 z-modal flex items-start justify-center p-3 sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          className="pointer-events-auto mt-[6vh] flex max-h-[84vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
            <p className="text-micro font-black uppercase tracking-[0.16em] text-slate-500">
              {headerLabel}
            </p>
            <IconButton
              icon={<X className="h-4 w-4" />}
              ariaLabel="Close"
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            />
          </div>

          {/* Pending identifier banner */}
          {pending && style && (
            <div className="shrink-0 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded border px-1.5 py-0 text-eyebrow font-semibold uppercase tracking-wider ${style.chip}`}>
                  {style.label}
                </span>
                <span className="font-mono text-xs font-bold text-slate-900">{identifier}</span>
                {pending.orderCount > 0 && (
                  <span className="text-micro font-semibold text-amber-700">
                    links {pending.orderCount} order{pending.orderCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              {pending.suggestedTitle && (
                <p className="mt-1 truncate text-caption text-slate-500">{pending.suggestedTitle}</p>
              )}
            </div>
          )}

          {/* Mode tabs (only meaningful when pairing an identifier) */}
          {pending && (
            <div className="flex shrink-0 gap-1 border-b border-slate-100 px-3 py-2">
              <ModeTab active={mode === 'create'} onClick={() => setMode('create')} icon={<Plus className="h-3.5 w-3.5" />} label="Create new SKU" />
              <ModeTab active={mode === 'existing'} onClick={() => setMode('existing')} icon={<Link2 className="h-3.5 w-3.5" />} label="Pair to existing" />
            </div>
          )}

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {mode === 'create' ? (
              <div className="space-y-3">
                <Field label="Zoho SKU" required>
                  <input
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="e.g. 00326-P-2"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm font-bold text-slate-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  />
                </Field>
                <Field label="Product title" required>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Canonical product name"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Category">
                    <input
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                    />
                  </Field>
                  <Field label="UPC">
                    <input
                      value={upc}
                      onChange={(e) => setUpc(e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                    />
                  </Field>
                </div>
                {pending && (
                  <p className="rounded-lg bg-emerald-50 px-3 py-2 text-micro font-semibold text-emerald-700">
                    Creating this SKU will also link <span className="font-mono">{identifier}</span> and backfill its {pending.orderCount} order{pending.orderCount === 1 ? '' : 's'}.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={existingQuery}
                    onChange={(e) => { setExistingQuery(e.target.value); setSelected(null); }}
                    placeholder="Search canonical SKU or title…"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-sm font-semibold text-slate-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  />
                  {searching && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-400" />}
                </div>
                <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-100">
                  {results.length === 0 ? (
                    <p className="px-3 py-6 text-center text-caption text-slate-400">
                      {existingQuery.trim() ? 'No matches' : 'Type to search the catalog'}
                    </p>
                  ) : (
                    results.map((r) => {
                      const isSel = selected?.id === r.id;
                      return (
                        // ds-raw-button: text-left master-detail picker row (SKU + title), not a standard action button
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setSelected(isSel ? null : r)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${isSel ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                        >
                          {isSel && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                          <span className="font-mono text-xs font-black text-slate-900">{r.sku}</span>
                          <span className="truncate text-caption text-slate-500">{r.product_title}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex shrink-0 items-center gap-1.5 border-t border-red-100 bg-red-50 px-4 py-2 text-micro font-semibold text-red-700">
              <AlertCircle className="h-3.5 w-3.5" />{error}
            </div>
          )}

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="brand"
              size="md"
              loading={submitting}
              disabled={submitting || (mode === 'existing' && !selected)}
              onClick={mode === 'create' ? handleCreate : handlePairExisting}
              icon={mode === 'create' ? <Plus className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
            >
              {mode === 'create' ? (pending ? 'Create & pair' : 'Add SKU') : 'Pair SKU'}
            </Button>
          </div>
        </div>
      </div>
    </>,
    portal,
  );
}

function ModeTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    // ds-raw-button: segmented mode toggle (conditional active fill), not a single DS variant
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-micro font-bold uppercase tracking-wider transition-colors ${
        active ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {icon}{label}
    </button>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-micro font-bold uppercase tracking-wider text-slate-500">
        {label}{required && <span className="text-red-400"> *</span>}
      </span>
      {children}
    </label>
  );
}
