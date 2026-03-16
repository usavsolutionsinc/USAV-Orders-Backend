'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Plus, Trash2 } from '@/components/Icons';
import type { FavoriteSkuRecord, FavoriteWorkspaceKey } from '@/lib/favorites/sku-favorites';

interface EcwidSearchProduct {
  id: string;
  name: string;
  sku: string;
  price: number | null;
  thumbnailUrl: string | null;
  enabled: boolean;
  inStock: boolean;
}

interface FavoriteDraft {
  label: string;
  issueTemplate: string;
  notes: string;
}

interface FavoritesWorkspaceSectionProps {
  workspaceKey: FavoriteWorkspaceKey;
  accent: 'orange' | 'blue';
  title: string;
  description: string;
  emptyLabel: string;
  useLabel: string;
  onUseFavorite: (favorite: FavoriteSkuRecord) => void;
  allowRepairDefaults?: boolean;
  hideHeading?: boolean;
  inlineRows?: boolean;
  buttonAccent?: 'orange' | 'blue';
}

const EMPTY_DRAFT: FavoriteDraft = {
  label: '',
  issueTemplate: '',
  notes: '',
};

function getAccentClasses(accent: 'orange' | 'blue') {
  return accent === 'orange'
    ? {
        pill: 'bg-orange-50 text-orange-700 border-orange-100',
        button: 'bg-orange-500 hover:bg-orange-600 text-white',
        subtleButton: 'border-orange-200 text-orange-700 hover:bg-orange-50',
      }
    : {
        pill: 'bg-blue-50 text-blue-700 border-blue-100',
        button: 'bg-blue-600 hover:bg-blue-700 text-white',
        subtleButton: 'border-blue-200 text-blue-700 hover:bg-blue-50',
      };
}

export function FavoritesWorkspaceSection({
  workspaceKey,
  accent,
  title,
  description,
  emptyLabel,
  useLabel,
  onUseFavorite,
  allowRepairDefaults = false,
  hideHeading = false,
  inlineRows = false,
  buttonAccent,
}: FavoritesWorkspaceSectionProps) {
  const [favorites, setFavorites] = useState<FavoriteSkuRecord[]>([]);
  const [draft, setDraft] = useState<FavoriteDraft>(EMPTY_DRAFT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [searchResults, setSearchResults] = useState<EcwidSearchProduct[]>([]);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<EcwidSearchProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const accentClasses = useMemo(() => getAccentClasses(accent), [accent]);
  const buttonClasses = useMemo(() => getAccentClasses(buttonAccent ?? accent), [accent, buttonAccent]);

  const loadFavorites = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/favorites?workspace=${encodeURIComponent(workspaceKey)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.details || data?.error || 'Failed to load favorites');
      setFavorites(Array.isArray(data?.favorites) ? data.favorites : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load favorites');
      setFavorites([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadFavorites();
  }, [workspaceKey]);

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT);
    setSearchValue('');
    setSearchResults([]);
    setSelectedProduct(null);
    setShowForm(false);
  };

  useEffect(() => {
    if (!showForm) return;
    const trimmed = searchValue.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }

    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      setSearchingProducts(true);
      try {
        const res = await fetch(`/api/ecwid/products/search?q=${encodeURIComponent(trimmed)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed to search products');
        setSearchResults(Array.isArray(data?.products) ? data.products : []);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setError(err?.message || 'Failed to search products');
        setSearchResults([]);
      } finally {
        setSearchingProducts(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [searchValue, showForm]);

  const handleCreate = async () => {
    if (!selectedProduct || !selectedProduct.sku.trim() || !draft.label.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceKey,
          ecwidProductId: selectedProduct.id,
          sku: selectedProduct.sku.trim(),
          label: draft.label.trim(),
          productTitle: selectedProduct.name.trim() || null,
          issueTemplate: draft.issueTemplate.trim() || null,
          defaultPrice: selectedProduct.price != null ? selectedProduct.price.toFixed(2) : null,
          notes: draft.notes.trim() || null,
          sortOrder: favorites.length * 10 + 10,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.details || data?.error || 'Failed to create favorite');
      resetDraft();
      await loadFavorites();
    } catch (err: any) {
      setError(err?.message || 'Failed to create favorite');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (favoriteId: number) => {
    const confirmed = window.confirm('Remove this favorite from this workspace?');
    if (!confirmed) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/favorites/${favoriteId}?workspace=${encodeURIComponent(workspaceKey)}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.details || data?.error || 'Failed to delete favorite');
      await loadFavorites();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete favorite');
    }
  };

  return (
    <section className={inlineRows ? 'space-y-3' : 'space-y-3 rounded-[1.75rem] border border-gray-200 bg-white p-4'}>
      <div className="flex items-center justify-between gap-3">
        {hideHeading ? <div /> : (
          <div>
            <h3 className={`${inlineRows ? 'text-base' : 'text-sm'} font-black tracking-tight text-gray-900`}>{title}</h3>
            {description ? (
              <p className="mt-1 text-[11px] font-medium leading-relaxed text-gray-500">{description}</p>
            ) : null}
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowForm((prev) => !prev)}
          className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl transition-colors ${buttonClasses.button}`}
          aria-label="Add favorite"
          title="Add favorite"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {showForm && (
        <div className={inlineRows ? 'space-y-3 border-y border-gray-200 py-3' : 'space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-3'}>
          <div className="grid grid-cols-1 gap-2">
            <div className={inlineRows ? '' : 'rounded-2xl border border-gray-200 bg-white p-2'}>
              <input
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Search Ecwid product"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-semibold text-gray-900 outline-none focus:border-gray-300"
              />
              {searchingProducts ? (
                <div className="flex items-center gap-2 px-1 py-3 text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <p className="text-[10px] font-black uppercase tracking-[0.16em]">Searching Ecwid…</p>
                </div>
              ) : searchResults.length > 0 ? (
                <div className="mt-2 max-h-56 divide-y divide-gray-200 overflow-y-auto border-t border-gray-200">
                  {searchResults.map((product) => {
                    const isSelected = selectedProduct?.id === product.id;
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => {
                          setSelectedProduct(product);
                          if (!draft.label.trim()) {
                            setDraft((prev) => ({ ...prev, label: product.name }));
                          }
                        }}
                        className={`flex w-full items-center justify-between px-1 py-2 text-left transition-colors ${
                          isSelected ? 'text-blue-700' : 'text-gray-900 hover:bg-gray-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-black tracking-tight">{product.name}</p>
                          <p className={`mt-1 text-[9px] font-bold uppercase tracking-[0.16em] ${isSelected ? 'text-blue-500' : 'text-gray-400'}`}>
                            {product.sku || 'No SKU'}
                          </p>
                        </div>
                        <div className="ml-3 text-right">
                          <p className={`text-[10px] font-black ${isSelected ? 'text-blue-600' : 'text-emerald-600'}`}>
                            {product.price != null ? `$${product.price.toFixed(2)}` : 'No price'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : searchValue.trim() ? (
                <div className="px-1 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                  No Ecwid products found
                </div>
              ) : null}
            </div>
            <input
              value={draft.label}
              onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))}
              placeholder="Label"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-semibold text-gray-900 outline-none focus:border-gray-300"
            />
            {allowRepairDefaults && (
              <>
                <input
                  value={draft.issueTemplate}
                  onChange={(e) => setDraft((prev) => ({ ...prev, issueTemplate: e.target.value }))}
                  placeholder="Issue template"
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-semibold text-gray-900 outline-none focus:border-gray-300"
                />
              </>
            )}
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Notes"
              rows={2}
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-semibold text-gray-900 outline-none focus:border-gray-300"
            />
          </div>
          {selectedProduct && (
            <div className="space-y-1 border-t border-gray-200 pt-3">
              <div className="flex items-center justify-between gap-3 text-[11px]">
                <span className="font-black text-gray-900">Ecwid Product</span>
                <span className="truncate text-right font-semibold text-gray-600">{selectedProduct.name}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-[10px]">
                <span className="font-black uppercase tracking-[0.16em] text-gray-400">SKU</span>
                <span className="font-bold uppercase tracking-[0.12em] text-gray-700">{selectedProduct.sku || 'No SKU'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-[10px]">
                <span className="font-black uppercase tracking-[0.16em] text-gray-400">Price</span>
                <span className="font-bold text-emerald-600">
                  {selectedProduct.price != null ? `$${selectedProduct.price.toFixed(2)}` : 'No price'}
                </span>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={isSaving || !selectedProduct || !selectedProduct.sku.trim() || !draft.label.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-2xl px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-gray-400"
            >
              <Check className="h-4 w-4" />
              {isSaving ? 'Saving…' : 'Save Favorite'}
            </button>
            <button
              type="button"
              onClick={resetDraft}
              className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500 transition-colors hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]">{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-gray-200 px-3 py-8 text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : favorites.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">{emptyLabel}</p>
        </div>
      ) : (
        <div className={inlineRows ? 'divide-y divide-gray-200 border-t border-gray-200' : 'space-y-2'}>
          {favorites.map((favorite) => (
            <div
              key={`${favorite.workspaceKey}-${favorite.id}`}
              className={inlineRows ? 'flex items-center justify-between gap-3 py-3' : 'rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3'}
            >
              <div className="min-w-0">
                <p className="text-[12px] font-black tracking-tight text-black">{favorite.label}</p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">
                  {favorite.sku || 'No SKU'}
                  {favorite.defaultPrice ? ` · $${favorite.defaultPrice}` : ''}
                </p>
                {!inlineRows && favorite.productTitle && (
                  <p className="mt-1 text-[11px] font-semibold text-gray-500">{favorite.productTitle}</p>
                )}
                {favorite.issueTemplate && (
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                    {favorite.issueTemplate}
                  </p>
                )}
              </div>
              <div className="ml-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onUseFavorite(favorite)}
                  className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-blue-700"
                >
                  {useLabel}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(favorite.id)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-400 transition-colors hover:border-red-200 hover:text-red-500"
                  aria-label={`Delete ${favorite.label}`}
                  title="Delete favorite"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
