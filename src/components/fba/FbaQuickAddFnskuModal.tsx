'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, X } from '@/components/Icons';
import { SidebarIntakeFormField } from '@/design-system/components';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';
import { normalizeFnsku } from '@/lib/tracking-format';

export const FBA_OPEN_QUICK_ADD_FNSKU_EVENT = 'fba-open-quick-add-fnsku';
export const FBA_FNSKU_SAVED_EVENT = 'fba-fnsku-saved';

interface OpenQuickAddFnskuDetail {
  fnsku?: string | null;
  product_title?: string | null;
  asin?: string | null;
  sku?: string | null;
  condition?: string | null;
}

interface SavedQuickAddFnskuDetail {
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  condition: string | null;
}


export function emitOpenQuickAddFnsku(detail: OpenQuickAddFnskuDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(FBA_OPEN_QUICK_ADD_FNSKU_EVENT, {
      detail,
    }),
  );
}

function emitSavedQuickAddFnsku(detail: SavedQuickAddFnskuDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(FBA_FNSKU_SAVED_EVENT, {
      detail,
    }),
  );
}

export function FbaQuickAddFnskuModal({ stationTheme = 'blue' }: { stationTheme?: StationTheme }) {
  const chrome = fbaSidebarThemeChrome[stationTheme];
  const [open, setOpen] = useState(false);
  const [fnsku, setFnsku] = useState('');
  const [productTitle, setProductTitle] = useState('');
  const [asin, setAsin] = useState('');
  const [sku, setSku] = useState('');
  const [condition, setCondition] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenQuickAddFnskuDetail>).detail || {};
      setFnsku(normalizeFnsku(String(detail.fnsku || '')));
      setProductTitle(String(detail.product_title || '').trim());
      setAsin(String(detail.asin || '').trim());
      setSku(String(detail.sku || '').trim());
      setCondition(String(detail.condition || '').trim());
      setError(null);
      setOpen(true);
    };
    window.addEventListener(FBA_OPEN_QUICK_ADD_FNSKU_EVENT, handleOpen as EventListener);
    return () => window.removeEventListener(FBA_OPEN_QUICK_ADD_FNSKU_EVENT, handleOpen as EventListener);
  }, []);

  const canSubmit = useMemo(() => Boolean(normalizeFnsku(fnsku)), [fnsku]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/35"
        aria-label="Close quick add FNSKU popup"
        onClick={() => {
          if (saving) return;
          setOpen(false);
        }}
      />
      <div className="relative z-[81] w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/15">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div>
            <p className={`text-[10px] font-black uppercase tracking-[0.16em] ${chrome.sectionLabel}`}>Quick add</p>
            <h2 className="mt-1 text-sm font-black text-zinc-900">Add FNSKU details</h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={saving}
            className="rounded-full border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-800 disabled:opacity-40"
            aria-label="Close quick add FNSKU popup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <SidebarIntakeFormField label="Product title" optionalHint="(Optional)">
            <input
              type="text"
              value={productTitle}
              onChange={(event) => setProductTitle(event.target.value)}
              placeholder="Product title"
              className={chrome.input}
            />
          </SidebarIntakeFormField>

          <SidebarIntakeFormField label="Condition" optionalHint="(Optional)">
            <select
              value={condition}
              onChange={(event) => setCondition(event.target.value)}
              className={chrome.input}
            >
              <option value="">Select condition</option>
              <option value="New">New</option>
              <option value="Used - Like New">Used - Like New</option>
              <option value="Used - Very Good">Used - Very Good</option>
              <option value="Used - Good">Used - Good</option>
              <option value="Used - Acceptable">Used - Acceptable</option>
              <option value="Refurbished">Refurbished</option>
            </select>
          </SidebarIntakeFormField>

          <SidebarIntakeFormField
            label="FNSKU"
            required
            hintBelow={
              <p className="text-[10px] leading-snug text-zinc-500">
                Save the FNSKU now and fill in more catalog details later if needed.
              </p>
            }
          >
            <input
              type="text"
              value={fnsku}
              onChange={(event) => setFnsku(normalizeFnsku(event.target.value))}
              placeholder="X00..."
              className={chrome.monoInput}
            />
          </SidebarIntakeFormField>

          <SidebarIntakeFormField label="ASIN" optionalHint="(Optional)">
            <input
              type="text"
              value={asin}
              onChange={(event) => setAsin(event.target.value.toUpperCase())}
              placeholder="B0XXXXXXXXXX"
              className={chrome.monoInput}
            />
          </SidebarIntakeFormField>

          <SidebarIntakeFormField label="SKU" optionalHint="(Optional)">
            <input
              type="text"
              value={sku}
              onChange={(event) => setSku(event.target.value)}
              placeholder="SKU"
              className={chrome.monoInput}
            />
          </SidebarIntakeFormField>

          {error ? <p className="text-xs font-semibold text-red-600">{error}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-4">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={saving}
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !canSubmit}
            onClick={async () => {
              const normalizedFnsku = normalizeFnsku(fnsku);
              if (!normalizedFnsku) {
                setError('FNSKU is required.');
                return;
              }
              setSaving(true);
              setError(null);
              try {
                const response = await fetch('/api/fba/fnskus', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    fnsku: normalizedFnsku,
                    product_title: productTitle.trim() || null,
                    asin: asin.trim() || null,
                    sku: sku.trim() || null,
                    condition: condition.trim() || null,
                  }),
                });
                const json = await response.json().catch(() => ({}));
                if (!response.ok || json?.success === false) {
                  setError(json?.error || 'Could not save this FNSKU.');
                  return;
                }
                const saved = json?.fnsku || {};
                emitSavedQuickAddFnsku({
                  fnsku: normalizeFnsku(String(saved.fnsku || normalizedFnsku)),
                  product_title: saved.product_title ?? (productTitle.trim() || null),
                  asin: saved.asin ?? null,
                  sku: saved.sku ?? null,
                  condition: saved.condition ?? (condition.trim() || null),
                });
                window.dispatchEvent(new Event('fba-plan-created'));
                setOpen(false);
              } catch {
                setError('Could not save this FNSKU.');
              } finally {
                setSaving(false);
              }
            }}
            className={chrome.primaryButton}
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Plus className="h-4 w-4" />
                Save FNSKU
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
