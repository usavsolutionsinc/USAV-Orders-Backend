'use client';

import { useEffect, useState } from 'react';
import type { FavoriteSkuRecord, FavoriteWorkspaceKey } from '@/lib/favorites/sku-favorites';
import {
  EMPTY_DRAFT,
  buildSearchQueries,
  matchesSkuSuffix,
  rankProductsByFuzzyQuery,
  type EcwidSearchProduct,
  type FavoriteDraft,
} from './favorites-search';
import { deleteFavorite, fetchFavorites, saveFavorite, searchEcwidProducts } from './favorites-api';

export interface FavoritesWorkspaceSectionProps {
  workspaceKey: FavoriteWorkspaceKey;
  accent: 'orange' | 'blue';
  title: string;
  description: string;
  emptyLabel: string;
  useLabel: string;
  onUseFavorite: (favorite: FavoriteSkuRecord) => void;
  /** Intake tile grid — tap card to use, no inline CRUD. Sidebar keeps `default`. */
  variant?: 'default' | 'quick-pick';
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

/**
 * Controller for the favorites workspace: loads the workspace's favorites, runs
 * the debounced multi-query Ecwid product search (deduped + optionally
 * fuzzy-ranked), and handles create/edit/delete. Returns one bag consumed by the
 * quick-pick / default views + the shared form.
 */
export function useFavoritesWorkspace(props: FavoritesWorkspaceSectionProps) {
  const { workspaceKey, variant = 'default', searchSkuSuffixFilter, fuzzyTitleSearch = false } = props;
  const isQuickPick = variant === 'quick-pick';

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
  const [isListOpen, setIsListOpen] = useState(variant === 'quick-pick');

  const loadFavorites = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setFavorites(await fetchFavorites(workspaceKey));
    } catch (err: any) {
      setError(err?.message || 'Failed to load favorites');
      setFavorites([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadFavorites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setDraft({ label: favorite.label, issueTemplate: favorite.issueTemplate || '', notes: favorite.notes || '' });
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
        const limit = fuzzyTitleSearch ? 100 : 12;
        const settledSearches = await Promise.allSettled(
          queries.map((query) => searchEcwidProducts(query, limit, controller.signal)),
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
      await saveFavorite(isEditing ? payload : { ...payload, sortOrder: favorites.length * 10 + 10 }, editingFavoriteId);
      resetDraft();
      await loadFavorites();
    } catch (err: any) {
      setError(err?.message || 'Failed to save favorite');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (favoriteId: number) => {
    if (!window.confirm('Remove this favorite from this workspace?')) return;
    setError(null);
    try {
      await deleteFavorite(favoriteId, workspaceKey);
      resetDraft();
      await loadFavorites();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete favorite');
    }
  };

  return {
    props,
    isQuickPick,
    favorites,
    draft,
    setDraft,
    isLoading,
    isSaving,
    searchValue,
    setSearchValue,
    searchResults,
    searchingProducts,
    selectedProduct,
    setSelectedProduct,
    error,
    showForm,
    setShowForm,
    editingFavoriteId,
    setEditingFavoriteId,
    isManageMode,
    setIsManageMode,
    isListOpen,
    setIsListOpen,
    resetDraft,
    openEditForm,
    handleSave,
    handleDelete,
  };
}

export type FavoritesWorkspaceController = ReturnType<typeof useFavoritesWorkspace>;
