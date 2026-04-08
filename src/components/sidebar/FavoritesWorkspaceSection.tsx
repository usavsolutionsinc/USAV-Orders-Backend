'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, ChevronRight, Loader2, Pencil, Plus, Trash2, X } from '@/components/Icons';
import type { FavoriteSkuRecord, FavoriteWorkspaceKey } from '@/lib/favorites/sku-favorites';
import { sectionLabel, fieldLabel, tableHeader } from '@/design-system/tokens/typography/presets';

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
  addButtonAccent?: 'orange' | 'green';
  onAddFavorite?: (favorite: FavoriteSkuRecord) => void;
  isFavoriteAdded?: (favorite: FavoriteSkuRecord) => boolean;
  searchSkuSuffixFilter?: string;
  fuzzyTitleSearch?: boolean;
  searchResultsMaxHeightClass?: string;
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

function normalizeSearchText(value: string | null | undefined): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildSearchQueries(
  query: string,
  fuzzyTitleSearch: boolean,
  searchSkuSuffixFilter?: string,
): string[] {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];
  if (!fuzzyTitleSearch) return [trimmed];

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const queries = new Set<string>();
  const addQuery = (value: string | null | undefined) => {
    const next = String(value || '').trim();
    if (next.length >= 2) queries.add(next);
  };

  addQuery(trimmed);
  addQuery(tokens.slice(0, 2).join(' '));
  addQuery(tokens.join(' '));
  addQuery(tokens[0]);

  for (const token of tokens) {
    addQuery(token);
    if (token.length >= 3) addQuery(token.slice(0, 3));
    if (token.length >= 4) addQuery(token.slice(0, 4));
    if (token.length >= 5) addQuery(token.slice(0, 5));
  }

  if (trimmed.length >= 3) addQuery(trimmed.slice(0, 3));
  if (trimmed.length >= 4) addQuery(trimmed.slice(0, 4));
  if (trimmed.length >= 5) addQuery(trimmed.slice(0, 5));

  if (searchSkuSuffixFilter) {
    const suffix = searchSkuSuffixFilter.toUpperCase();
    const strippedSuffix = suffix.replace(/[^A-Z0-9]/g, '');
    addQuery(suffix);
    addQuery(strippedSuffix);
    if (strippedSuffix.endsWith('RS')) addQuery('RS');
  }

  return Array.from(queries).slice(0, 12);
}

function matchesSkuSuffix(sku: string | null | undefined, suffix?: string): boolean {
  const normalizedSku = String(sku || '').trim().toUpperCase();
  const normalizedSuffix = String(suffix || '').trim().toUpperCase();
  if (!normalizedSuffix) return true;
  return normalizedSku.endsWith(normalizedSuffix);
}

function fuzzySubsequenceScore(haystack: string, needle: string): number {
  let needleIndex = 0;
  let gaps = 0;
  let lastMatchIndex = -1;

  for (let i = 0; i < haystack.length && needleIndex < needle.length; i += 1) {
    if (haystack[i] === needle[needleIndex]) {
      if (lastMatchIndex >= 0) gaps += i - lastMatchIndex - 1;
      lastMatchIndex = i;
      needleIndex += 1;
    }
  }

  if (needleIndex !== needle.length) return Number.POSITIVE_INFINITY;
  return gaps;
}

function fuzzyScoreCandidate(candidate: string, query: string): number {
  const normalizedCandidate = normalizeSearchText(candidate);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;
  if (!normalizedCandidate) return Number.POSITIVE_INFINITY;

  if (normalizedCandidate === normalizedQuery) return 0;

  const containsIndex = normalizedCandidate.indexOf(normalizedQuery);
  if (containsIndex >= 0) {
    return 1 + containsIndex / 100 + (normalizedCandidate.length - normalizedQuery.length) / 1000;
  }

  const subsequencePenalty = fuzzySubsequenceScore(normalizedCandidate, normalizedQuery);
  if (Number.isFinite(subsequencePenalty)) {
    return 2 + subsequencePenalty / 30;
  }

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  if (queryTokens.length > 0) {
    let tokenMatches = 0;
    for (const token of queryTokens) {
      if (normalizedCandidate.includes(token)) tokenMatches += 1;
    }
    if (tokenMatches > 0) {
      return 4 + (queryTokens.length - tokenMatches);
    }
  }

  return 10 + Math.abs(normalizedCandidate.length - normalizedQuery.length) / 20;
}

function rankProductsByFuzzyQuery(products: EcwidSearchProduct[], query: string): EcwidSearchProduct[] {
  return [...products].sort((a, b) => {
    const aScore = Math.min(
      fuzzyScoreCandidate(a.name, query),
      fuzzyScoreCandidate(a.sku, query) + 0.5,
    );
    const bScore = Math.min(
      fuzzyScoreCandidate(b.name, query),
      fuzzyScoreCandidate(b.sku, query) + 0.5,
    );
    if (aScore !== bScore) return aScore - bScore;
    return a.name.localeCompare(b.name);
  });
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
  addButtonAccent = 'orange',
  onAddFavorite,
  isFavoriteAdded,
  searchSkuSuffixFilter,
  fuzzyTitleSearch = false,
  searchResultsMaxHeightClass = 'max-h-44',
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
  const [isListOpen, setIsListOpen] = useState(true);
  const accentClasses = useMemo(() => getAccentClasses(accent), [accent]);
  const buttonClasses = useMemo(() => getAccentClasses(buttonAccent ?? accent), [accent, buttonAccent]);

  const loadFavorites = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/favorites?workspace=${encodeURIComponent(workspaceKey)}`);
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
        const queries = buildSearchQueries(trimmed, fuzzyTitleSearch, searchSkuSuffixFilter);
        const settledSearches = await Promise.allSettled(
          queries.map(async (query) => {
            const limit = fuzzyTitleSearch ? 100 : 12;
            const res = await fetch(
              `/api/ecwid/products/search?q=${encodeURIComponent(query)}&limit=${limit}`,
              { signal: controller.signal },
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Failed to search products');
            return Array.isArray(data?.products) ? data.products as EcwidSearchProduct[] : [];
          }),
        );

        const successfulProducts = settledSearches
          .filter((result): result is PromiseFulfilledResult<EcwidSearchProduct[]> => result.status === 'fulfilled')
          .flatMap((result) => result.value);

        if (successfulProducts.length === 0) {
          const firstRejected = settledSearches.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
          if (firstRejected) throw firstRejected.reason;
        }

        const dedupedProducts = new Map<string, EcwidSearchProduct>();
        for (const product of successfulProducts) {
          const id = String(product?.id || '').trim();
          if (!id || dedupedProducts.has(id)) continue;
          dedupedProducts.set(id, product);
        }

        let nextResults = Array.from(dedupedProducts.values());
        if (searchSkuSuffixFilter) {
          nextResults = nextResults.filter((product) => matchesSkuSuffix(product.sku, searchSkuSuffixFilter));
        }
        if (fuzzyTitleSearch) {
          nextResults = rankProductsByFuzzyQuery(nextResults, trimmed);
        }

        setError(null);
        setSearchResults(nextResults);
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
  }, [fuzzyTitleSearch, searchSkuSuffixFilter, searchValue, showForm]);

  const handleSave = async () => {
    const normalizedSku = selectedProduct?.sku?.trim() || '';
    if (!selectedProduct || !normalizedSku || !draft.label.trim()) return;
    if (searchSkuSuffixFilter && !matchesSkuSuffix(normalizedSku, searchSkuSuffixFilter)) {
      setError(`Favorites in this panel must use SKUs ending in ${searchSkuSuffixFilter.toUpperCase()}`);
      return;
    }
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
          className="w-full rounded-xl border-0 bg-transparent px-3 py-2.5 text-[11px] font-semibold text-gray-900 outline-none placeholder:text-gray-500"
        />
        {searchingProducts ? (
          <div className="flex items-center gap-2 border-t border-gray-100 px-3 py-2.5 text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <p className={tableHeader}>Searching…</p>
          </div>
        ) : searchResults.length > 0 ? (
          <div className={`${searchResultsMaxHeightClass} divide-y divide-gray-100 overflow-y-auto border-t border-gray-100`}>
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
                    {/* Row 2 — price (green), SKU immediately to the right */}
                    <div className="mt-0.5 flex w-full min-w-0 items-center justify-start gap-2">
                      <span className="shrink-0 text-[10px] font-bold tabular-nums text-emerald-600">
                        {product.price != null ? `$${product.price.toFixed(2)}` : ''}
                      </span>
                      <span
                        className={`min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.14em] ${
                          isSelected ? 'text-blue-500' : 'text-gray-500'
                        }`}
                      >
                        {product.sku || 'No SKU'}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : searchValue.trim() ? (
          <div className={`border-t border-gray-100 px-3 py-2.5 ${tableHeader}`}>
            {searchSkuSuffixFilter ? `No ${searchSkuSuffixFilter.toUpperCase()} SKUs found` : 'No products found'}
          </div>
        ) : null}
      </div>

      {/* Selected product — two rows */}
      {selectedProduct && (
        <div className="rounded-xl border border-blue-200 bg-white px-3 py-2">
          <p className="text-[11px] font-black leading-snug text-blue-900">{selectedProduct.name}</p>
          <div className="mt-0.5 flex w-full min-w-0 items-center justify-start gap-2">
            <span className="shrink-0 text-[10px] font-bold tabular-nums text-emerald-600">
              {selectedProduct.price != null ? `$${selectedProduct.price.toFixed(2)}` : ''}
            </span>
            <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-blue-500">
              {selectedProduct.sku || 'No SKU'}
            </span>
          </div>
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
          className={`inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-3 py-2 ${sectionLabel} transition-colors hover:bg-gray-100`}
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
            disabled={
              isSaving
              || !selectedProduct
              || !selectedProduct.sku.trim()
              || !draft.label.trim()
              || (searchSkuSuffixFilter ? !matchesSkuSuffix(selectedProduct.sku, searchSkuSuffixFilter) : false)
            }
            className={`inline-flex items-center justify-center gap-1.5 rounded-2xl bg-blue-600 px-3 py-2 ${sectionLabel} text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500`}
          >
            <Check className="h-4 w-4" />
            {isSaving ? 'Saving…' : editingFavoriteId !== null ? 'Update' : 'Save Favorite'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <section className={inlineRows ? 'space-y-2' : 'space-y-3 rounded-[1.75rem] border border-gray-200 bg-white p-4'}>

      {/* Header — click title area to collapse/expand list */}
      <div className="flex items-center justify-between gap-3">
        {hideHeading ? <div /> : (
          <button
            type="button"
            onClick={() => setIsListOpen((prev) => !prev)}
            className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
            aria-expanded={isListOpen}
          >
            <motion.span
              animate={{ rotate: isListOpen ? 90 : 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className="shrink-0 text-gray-500 group-hover:text-gray-600"
            >
              <ChevronRight className={inlineRows ? 'h-3 w-3' : 'h-4 w-4'} />
            </motion.span>
            <div className="min-w-0">
              <h3 className={`${inlineRows ? 'text-base' : 'text-sm'} font-black tracking-tight text-gray-900`}>
                {title}
                {favorites.length > 0 && (
                  <span className="ml-1.5 text-[10px] font-semibold tabular-nums text-gray-500">
                    {favorites.length}
                  </span>
                )}
              </h3>
              {description && isListOpen ? (
                <p className="mt-0.5 text-[11px] font-semibold leading-relaxed text-gray-500">{description}</p>
              ) : null}
            </div>
          </button>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Pencil/X toggle — reveals trash buttons on rows */}
          <button
            type="button"
            onClick={() => setIsManageMode((prev) => !prev)}
            className={`inline-flex ${inlineRows ? 'h-7 w-7 rounded-lg' : 'h-10 w-10 rounded-2xl'} items-center justify-center border transition-colors ${
              isManageMode
                ? 'border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200'
                : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-600'
            }`}
            aria-label={isManageMode ? 'Done managing' : 'Manage favorites'}
            title={isManageMode ? 'Done managing' : 'Manage favorites'}
          >
            {isManageMode ? (
              <X className={inlineRows ? 'h-3 w-3' : 'h-4 w-4'} />
            ) : (
              <Pencil className={inlineRows ? 'h-3 w-3' : 'h-4 w-4'} />
            )}
          </button>
          {/* Blue plus — always opens create form */}
          <button
            type="button"
            onClick={() => {
              resetDraft();
              setShowForm((prev) => (editingFavoriteId === null ? !prev : true));
              setIsListOpen(true); // ensure list is visible when adding
            }}
            className={`inline-flex ${inlineRows ? 'h-7 w-7 rounded-lg' : 'h-10 w-10 rounded-2xl'} items-center justify-center bg-blue-600 text-white transition-colors hover:bg-blue-700`}
            aria-label="Add favorite"
            title="Add favorite"
          >
            <Plus className={inlineRows ? 'h-3 w-3' : 'h-4 w-4'} />
          </button>
        </div>
      </div>

      {/* Collapsible body */}
      <AnimatePresence initial={false}>
        {isListOpen && (
          <motion.div
            key="list-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className={inlineRows ? 'space-y-0' : 'space-y-3 pt-1'}>

      {/* Create form — shown at top when editingFavoriteId is null */}
      {showForm && editingFavoriteId === null && renderForm()}

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className={fieldLabel}>{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-gray-200 px-3 py-8 text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : favorites.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center">
          <p className={sectionLabel}>{emptyLabel}</p>
        </div>
      ) : (
        <div className={inlineRows ? 'divide-y divide-gray-200 border-t border-gray-200' : 'space-y-2'}>
          {favorites.map((favorite) => {
            const isAdded = isFavoriteAdded?.(favorite) ?? false;
            const addButtonClassName = isAdded
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : addButtonAccent === 'green'
                ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                : 'bg-orange-500 text-white hover:bg-orange-600';
            const addButtonSizeClass = inlineRows ? 'h-7 w-7 rounded-lg' : 'h-10 w-10 rounded-2xl';
            const addIconSizeClass = inlineRows ? 'h-3 w-3' : 'h-4 w-4';
            const subButtonSizeClass = inlineRows ? 'h-6 w-6 rounded-md' : 'h-10 w-10 rounded-2xl';
            const subIconSizeClass = inlineRows ? 'h-2.5 w-2.5' : 'h-4 w-4';

            return (
              <div key={`${favorite.workspaceKey}-${favorite.id}`}>
                <div className={inlineRows ? 'py-1.5' : 'rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3'}>
                  <p className={`${inlineRows ? 'text-[10px] leading-tight' : 'text-[12px] leading-snug'} font-black tracking-tight text-black`}>
                    {favorite.label}
                  </p>

                  <div className={`${inlineRows ? 'mt-0.5 gap-1' : 'mt-1 gap-2'} flex items-start`}>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`flex w-full min-w-0 items-center justify-start gap-2 font-bold ${
                          inlineRows ? 'text-[8px] tracking-[0.12em]' : 'text-[10px] tracking-[0.16em]'
                        }`}
                      >
                        <span className="shrink-0 tabular-nums text-emerald-600">
                          {favorite.defaultPrice ? `$${favorite.defaultPrice}` : ''}
                        </span>
                        <span className="min-w-0 truncate uppercase text-gray-500">
                          {favorite.sku || 'No SKU'}
                        </span>
                      </div>
                      {favorite.issueTemplate ? (
                        <p className={`${inlineRows ? 'mt-0 text-[8px]' : 'mt-0.5 text-[10px]'} font-semibold uppercase tracking-[0.14em] text-gray-500`}>
                          {favorite.issueTemplate}
                        </p>
                      ) : null}
                      {!inlineRows && favorite.productTitle && (
                        <p className="mt-1 text-[11px] font-semibold text-gray-500">{favorite.productTitle}</p>
                      )}
                    </div>
                    <div className={`${inlineRows ? 'flex items-center gap-1 pt-0.5' : 'flex items-center gap-2'}`}>
                      <button
                        type="button"
                        onClick={() => {
                          if (editingFavoriteId === favorite.id && showForm) {
                            resetDraft();
                          } else {
                            openEditForm(favorite);
                          }
                        }}
                        className={`inline-flex ${subButtonSizeClass} shrink-0 items-center justify-center border transition-colors ${
                          editingFavoriteId === favorite.id && showForm
                            ? 'border-blue-200 bg-blue-50 text-blue-600'
                            : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-600'
                        }`}
                        aria-label={`Edit ${favorite.label}`}
                        title="Edit favorite"
                      >
                        <Pencil className={subIconSizeClass} />
                      </button>

                      {isManageMode ? (
                        <button
                          type="button"
                          onClick={() => void handleDelete(favorite.id)}
                          className={`inline-flex ${subButtonSizeClass} shrink-0 items-center justify-center border border-red-200 bg-red-50 text-red-500 transition-colors hover:bg-red-100 hover:text-red-700`}
                          aria-label={`Delete ${favorite.label}`}
                          title="Delete favorite"
                        >
                          <Trash2 className={subIconSizeClass} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            onUseFavorite(favorite);
                            onAddFavorite?.(favorite);
                          }}
                          className={`inline-flex ${addButtonSizeClass} shrink-0 items-center justify-center transition-colors ${addButtonClassName}`}
                          aria-label={useLabel}
                          title={useLabel}
                        >
                          {isAdded ? <Check className={addIconSizeClass} /> : <Plus className={addIconSizeClass} />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {showForm && editingFavoriteId === favorite.id && renderForm()}
              </div>
            );
          })}
        </div>
      )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
