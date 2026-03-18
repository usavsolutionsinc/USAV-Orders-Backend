'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Pencil, Plus, Trash2, X } from '@/components/Icons';
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
  // null = creating a new favorite; number = editing existing favorite by id
  const [editingFavoriteId, setEditingFavoriteId] = useState<number | null>(null);
  // header pencil toggle — shows trash delete buttons on rows
  const [isManageMode, setIsManageMode] = useState(false);
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
    setEditingFavoriteId(null);
    // keep isManageMode as-is so the user's manage state persists
  };

  const openEditForm = (favorite: FavoriteSkuRecord) => {
    setDraft({
      label: favorite.label,
      issueTemplate: favorite.issueTemplate || '',
      notes: favorite.notes || '',
    });
    // Pre-fill SKU so Ecwid search fires immediately
    setSearchValue(favorite.sku);
    setSearchResults([]);
    setSelectedProduct(
      favorite.ecwidProductId
        ? {
            id: favorite.ecwidProductId,
            name: favorite.productTitle || favorite.label,
            sku: favorite.sku,
            price: favorite.defaultPrice ? parseFloat(favorite.defaultPrice) : null,
            thumbnailUrl: null,
            enabled: true,
            inStock: true,
          }
        : null,
    );
    setEditingFavoriteId(favorite.id);
    setShowForm(true);
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

  const handleSave = async () => {
    if (!selectedProduct || !selectedProduct.sku.trim() || !draft.label.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        workspaceKey,
        ecwidProductId: selectedProduct.id || null,
        sku: selectedProduct.sku.trim(),
        label: draft.label.trim(),
        productTitle: selectedProduct.name.trim() || null,
        issueTemplate: draft.issueTemplate.trim() || null,
        defaultPrice: selectedProduct.price != null ? selectedProduct.price.toFixed(2) : null,
        notes: draft.notes.trim() || null,
      };

      const isEditing = editingFavoriteId !== null;
      const res = await fetch(
        isEditing ? `/api/favorites/${editingFavoriteId}` : '/api/favorites',
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isEditing ? payload : { ...payload, sortOrder: favorites.length * 10 + 10 },
          ),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.details || data?.error || (isEditing ? 'Failed to update favorite' : 'Failed to create favorite'));
      resetDraft();
      await loadFavorites();
    } catch (err: any) {
      setError(err?.message || 'Failed to save favorite');
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
      resetDraft();
      await loadFavorites();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete favorite');
    }
  };

  // Shared form body — used both in the "create" panel at top and inline edit panels
  const renderForm = () => (
    <div className="space-y-2 border-y border-gray-200 py-3">
      {/* Ecwid product search */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <input
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Search Ecwid product by name or SKU"
          className="w-full rounded-xl border-0 bg-transparent px-3 py-2.5 text-[11px] font-semibold text-gray-900 outline-none placeholder:text-gray-400"
        />
        {searchingProducts ? (
          <div className="flex items-center gap-2 border-t border-gray-100 px-3 py-2.5 text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <p className="text-[10px] font-black uppercase tracking-[0.16em]">Searching…</p>
          </div>
        ) : searchResults.length > 0 ? (
          <div className="max-h-44 divide-y divide-gray-100 overflow-y-auto border-t border-gray-100">
            {searchResults.map((product) => {
              const isSelected = selectedProduct?.id === product.id;
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => {
                    setSelectedProduct(product);
                    if (!draft.label.trim()) setDraft((prev) => ({ ...prev, label: product.name }));
                  }}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors ${
                    isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  {isSelected && <Check className="mt-0.5 h-3 w-3 shrink-0 text-blue-600" />}
                  <div className="min-w-0 flex-1">
                    {/* Row 1 — title, no truncate */}
                    <p className={`text-[11px] font-black leading-snug tracking-tight ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                      {product.name}
                    </p>
                    {/* Row 2 — SKU · price */}
                    <p className={`mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${isSelected ? 'text-blue-400' : 'text-gray-400'}`}>
                      {product.sku || 'No SKU'}
                      {product.price != null ? <span className={`ml-1.5 ${isSelected ? 'text-blue-600' : 'text-emerald-600'}`}> · ${product.price.toFixed(2)}</span> : null}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : searchValue.trim() ? (
          <div className="border-t border-gray-100 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
            No products found
          </div>
        ) : null}
      </div>

      {/* Selected product — two rows */}
      {selectedProduct && (
        <div className="rounded-xl border border-blue-200 bg-white px-3 py-2">
          <p className="text-[11px] font-black leading-snug text-blue-900">{selectedProduct.name}</p>
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-blue-400">
            {selectedProduct.sku || 'No SKU'}
            {selectedProduct.price != null ? <span className="ml-1.5 text-emerald-600"> · ${selectedProduct.price.toFixed(2)}</span> : null}
          </p>
        </div>
      )}

      {/* Label */}
      <input
        value={draft.label}
        onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))}
        placeholder="Label"
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[11px] font-semibold text-gray-900 outline-none focus:border-blue-300"
      />

      {allowRepairDefaults && (
        <input
          value={draft.issueTemplate}
          onChange={(e) => setDraft((prev) => ({ ...prev, issueTemplate: e.target.value }))}
          placeholder="Issue template"
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[11px] font-semibold text-gray-900 outline-none focus:border-blue-300"
        />
      )}

      <textarea
        value={draft.notes}
        onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
        placeholder="Notes"
        rows={2}
        className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[11px] font-semibold text-gray-900 outline-none focus:border-blue-300"
      />

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={resetDraft}
          className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500 transition-colors hover:bg-gray-100"
        >
          Cancel
        </button>
        <div className="flex items-center gap-2">
          {editingFavoriteId !== null && (
            <button
              type="button"
              onClick={() => void handleDelete(editingFavoriteId)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-red-100 bg-red-50 text-red-400 transition-colors hover:border-red-300 hover:bg-red-100 hover:text-red-600"
              aria-label="Delete favorite"
              title="Delete favorite"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !selectedProduct || !selectedProduct.sku.trim() || !draft.label.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-blue-600 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-400"
          >
            <Check className="h-4 w-4" />
            {isSaving ? 'Saving…' : editingFavoriteId !== null ? 'Update' : 'Save Favorite'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <section className={inlineRows ? 'space-y-3' : 'space-y-3 rounded-[1.75rem] border border-gray-200 bg-white p-4'}>

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        {hideHeading ? <div /> : (
          <div>
            <h3 className={`${inlineRows ? 'text-base' : 'text-sm'} font-black tracking-tight text-gray-900`}>{title}</h3>
            {description ? (
              <p className="mt-1 text-[11px] font-medium leading-relaxed text-gray-500">{description}</p>
            ) : null}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {/* Pencil/X toggle — reveals trash buttons on rows */}
          <button
            type="button"
            onClick={() => setIsManageMode((prev) => !prev)}
            className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border transition-colors ${
              isManageMode
                ? 'border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200'
                : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50 hover:text-gray-600'
            }`}
            aria-label={isManageMode ? 'Done managing' : 'Manage favorites'}
            title={isManageMode ? 'Done managing' : 'Manage favorites'}
          >
            {isManageMode ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          </button>
          {/* Blue plus — always opens create form */}
          <button
            type="button"
            onClick={() => {
              resetDraft();
              setShowForm((prev) => (editingFavoriteId === null ? !prev : true));
            }}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white transition-colors hover:bg-blue-700"
            aria-label="Add favorite"
            title="Add favorite"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Create form — shown at top when editingFavoriteId is null */}
      {showForm && editingFavoriteId === null && renderForm()}

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
            <div key={`${favorite.workspaceKey}-${favorite.id}`}>
              {/* Favorite row */}
              <div className={inlineRows ? 'py-3' : 'rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3'}>
                {/* Row 1 — label, wraps freely */}
                <p className="text-[12px] font-black leading-snug tracking-tight text-black">{favorite.label}</p>

                {/* Rows 2 & 3 + action buttons */}
                <div className="mt-1 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">
                      {favorite.sku || 'No SKU'}
                      {favorite.defaultPrice ? ` · $${favorite.defaultPrice}` : ''}
                    </p>
                    {favorite.issueTemplate ? (
                      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                        {favorite.issueTemplate}
                      </p>
                    ) : null}
                    {!inlineRows && favorite.productTitle && (
                      <p className="mt-1 text-[11px] font-semibold text-gray-500">{favorite.productTitle}</p>
                    )}
                  </div>

                  {/* Row pencil — opens inline edit form below this row */}
                  <button
                    type="button"
                    onClick={() => {
                      if (editingFavoriteId === favorite.id && showForm) {
                        resetDraft();
                      } else {
                        openEditForm(favorite);
                      }
                    }}
                    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-colors ${
                      editingFavoriteId === favorite.id && showForm
                        ? 'border-blue-200 bg-blue-50 text-blue-600'
                        : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-600'
                    }`}
                    aria-label={`Edit ${favorite.label}`}
                    title="Edit favorite"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>

                  {/* Orange plus (use) ↔ Red trash (delete in manage mode) */}
                  {isManageMode ? (
                    <button
                      type="button"
                      onClick={() => void handleDelete(favorite.id)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-500 transition-colors hover:bg-red-100 hover:text-red-700"
                      aria-label={`Delete ${favorite.label}`}
                      title="Delete favorite"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onUseFavorite(favorite)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-white transition-colors hover:bg-orange-600"
                      aria-label={useLabel}
                      title={useLabel}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Inline edit form — edge to edge below this row */}
              {showForm && editingFavoriteId === favorite.id && renderForm()}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
