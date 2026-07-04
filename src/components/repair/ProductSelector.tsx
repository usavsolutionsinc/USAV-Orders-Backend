'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from '../Icons';
import { Button, IconButton } from '@/design-system/primitives';
import {
    SIDEBAR_INTAKE_LABEL_CLASS,
    getSidebarIntakeInputClass,
} from '@/design-system/components';

interface ProductSelection {
  type: string;
  model: string;
  sourceSku?: string | null;
}

interface ProductSelectorProps {
  onSelect: (product: ProductSelection) => void;
  selectedProduct: ProductSelection | null;
  onPriceChange?: (price: string) => void;
  /** When true, the component fills its parent height using flex layout */
  fillHeight?: boolean;
  /** Controlled selected items — state lives in parent */
  selectedItems?: SelectedItem[];
  onSelectedItemsChange?: (items: SelectedItem[]) => void;
}

interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  hasChildren: boolean;
  isLeaf: boolean;
  depth: number;
  fullPath: string;
}

interface EcwidProduct {
  id: string;
  name: string;
  sku: string;
  price: number | null;
  thumbnailUrl: string | null;
  enabled: boolean;
  inStock: boolean;
}

export interface SelectedItem {
  id: string;
  name: string;
  price: number | null;
  sku: string;
}

interface CategoriesResponse {
  success: boolean;
  error?: string;
  roots?: Array<{ id: string | null; name: string }>;
  currentParentId?: string | null;
  breadcrumbs?: Array<{ id: string; name: string }>;
  categories?: CategoryNode[];
}

interface ProductsResponse {
  success: boolean;
  error?: string;
  products?: EcwidProduct[];
  total?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
}

const BREADCRUMB_START_LABEL = 'Start';
const PRODUCT_PAGE_SIZE = 10;

export function ProductSelector({
  onSelect, selectedProduct, onPriceChange, fillHeight,
  selectedItems: controlledItems, onSelectedItemsChange,
}: ProductSelectorProps) {
  const blueInputClass = getSidebarIntakeInputClass('blue');
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [products, setProducts] = useState<EcwidProduct[]>([]);
  const [rootName, setRootName] = useState('Bose Repair Service');
  const [currentCategoryId, setCurrentCategoryId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [internalItems, setInternalItems] = useState<SelectedItem[]>([]);
  const selectedItems = controlledItems ?? internalItems;
  const setSelectedItems = (updater: SelectedItem[] | ((prev: SelectedItem[]) => SelectedItem[])) => {
    const next = typeof updater === 'function' ? updater(selectedItems) : updater;
    if (onSelectedItemsChange) onSelectedItemsChange(next);
    else setInternalItems(next);
  };
  const [otherModelText, setOtherModelText] = useState('');
  const [showOther, setShowOther] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [productsOffset, setProductsOffset] = useState(0);
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);

  const deriveSourceSku = (items: SelectedItem[]): string | null => {
    const candidate = items
      .map((item) => String(item.sku || '').trim())
      .find(Boolean);

    return candidate || null;
  };

  const totalPriceOf = (items: SelectedItem[]) =>
    items.reduce((sum, i) => sum + (i.price ?? 0), 0);

  const fetchCategoryLevel = async (parentId: string | null) => {
    setLoadingCategories(true);
    setError(null);
    setProducts([]);
    setShowAllProducts(false);
    setProductsOffset(0);
    setHasMoreProducts(false);
    setSearch('');

    try {
      const query = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
      const response = await fetch(`/api/repair/ecwid-categories${query}`);
      const payload = (await response.json()) as CategoriesResponse;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load categories');
      }

      const roots = Array.isArray(payload.roots) ? payload.roots : [];
      if (roots.length > 0 && roots[0]?.name) setRootName(roots[0].name);

      setCategories(Array.isArray(payload.categories) ? payload.categories : []);
      setCurrentCategoryId(payload.currentParentId ?? null);
      setBreadcrumbs(Array.isArray(payload.breadcrumbs) ? payload.breadcrumbs : []);

      if (parentId) void fetchProducts(parentId, 0, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories');
      setCategories([]);
    } finally {
      setLoadingCategories(false);
    }
  };

  const fetchProducts = async (categoryId: string, offset = 0, append = false) => {
    if (append) setLoadingMoreProducts(true);
    else setLoadingProducts(true);
    try {
      const response = await fetch(
        `/api/repair/ecwid-products?categoryId=${encodeURIComponent(categoryId)}&limit=${PRODUCT_PAGE_SIZE}&offset=${offset}`,
      );
      const payload = (await response.json()) as ProductsResponse;
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Failed to load products');
      const rows = Array.isArray(payload.products) ? payload.products : [];
      setProducts((prev) => (append ? [...prev, ...rows] : rows));
      setProductsOffset(offset + rows.length);
      setHasMoreProducts(Boolean(payload.hasMore));
    } catch {
      if (!append) setProducts([]);
      setHasMoreProducts(false);
    } finally {
      if (append) setLoadingMoreProducts(false);
      else setLoadingProducts(false);
    }
  };

  const fetchAllProducts = async (offset = 0, append = false) => {
    if (append) setLoadingMoreProducts(true);
    else setLoadingProducts(true);
    setError(null);
    if (!append) setSearch('');
    try {
      const response = await fetch(`/api/repair/ecwid-products?mode=all&limit=${PRODUCT_PAGE_SIZE}&offset=${offset}`);
      const payload = (await response.json()) as ProductsResponse;
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Failed to load products');
      const rows = Array.isArray(payload.products) ? payload.products : [];
      setProducts((prev) => (append ? [...prev, ...rows] : rows));
      setShowAllProducts(true);
      setProductsOffset(offset + rows.length);
      setHasMoreProducts(Boolean(payload.hasMore));
    } catch (err) {
      if (!append) setProducts([]);
      setError(err instanceof Error ? err.message : 'Failed to load products');
      if (!append) setShowAllProducts(false);
      setHasMoreProducts(false);
    } finally {
      if (append) setLoadingMoreProducts(false);
      else setLoadingProducts(false);
    }
  };

  const loadMoreProducts = () => {
    if (loadingProducts || loadingMoreProducts || !hasMoreProducts) return;
    if (showAllProducts) {
      void fetchAllProducts(productsOffset, true);
      return;
    }
    if (currentCategoryId) {
      void fetchProducts(currentCategoryId, productsOffset, true);
    }
  };

  useEffect(() => { void fetchCategoryLevel(null); }, []);

  // Sync selection + price to parent after state settles (avoids setState-during-render)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    // Manual "Other" entry is not driven by catalog chips — don't clear it.
    if (selectedItems.length === 0 && selectedProduct?.type === 'Other') {
      return;
    }
    notifyParent(selectedItems);
  }, [selectedItems, selectedProduct?.type]);

  const filteredCategories = categories.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.fullPath.toLowerCase().includes(q);
  });

  const filteredProducts = products.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
  });

  const notifyParent = (items: SelectedItem[]) => {
    const model = items.map((i) => i.name).join(', ');
    onSelect({ type: items.length > 0 ? rootName : '', model, sourceSku: deriveSourceSku(items) });
    onPriceChange?.(totalPriceOf(items).toFixed(2));
  };

  const toggleProduct = (product: EcwidProduct) => {
    setShowOther(false);
    setSelectedItems((prev) => {
      const exists = prev.find((i) => i.id === product.id);
      return exists
        ? prev.filter((i) => i.id !== product.id)
        : [...prev, { id: product.id, name: product.name, price: product.price, sku: product.sku }];
    });
  };

  const removeItem = (id: string) => {
    setSelectedItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleOtherSubmit = () => {
    const value = otherModelText.trim();
    if (!value) return;
    onSelect({ type: 'Other', model: value, sourceSku: null });
    setSelectedItems([]);
    setOtherModelText('');
    setShowOther(false);
  };

  const isSelected = (id: string) => selectedItems.some((i) => i.id === id);
  const isAtRoot = !currentCategoryId;
  const loading = loadingCategories;

  return (
    <div className={fillHeight ? 'flex h-full flex-col gap-4' : 'space-y-4'}>

      {/* Back + Search */}
      <div className="flex items-center gap-2">
        <IconButton
          type="button"
          onClick={() => {
            if (showAllProducts) {
              setShowAllProducts(false);
              setProducts([]);
              setProductsOffset(0);
              setHasMoreProducts(false);
              setSearch('');
              return;
            }
            void fetchCategoryLevel(
              breadcrumbs.length <= 1 ? null : breadcrumbs[breadcrumbs.length - 2].id
            );
          }}
          disabled={loading || (isAtRoot && !showAllProducts)}
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border border-border-soft bg-surface-canvas transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
          ariaLabel="Go back"
          icon={<ChevronLeft className="h-4 w-4" />}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={showAllProducts ? 'Search all repairs...' : isAtRoot ? 'Search categories...' : 'Search products...'}
          className={`flex-1 ${blueInputClass}`}
        />
      </div>

      {/* Manual Entry + SKU pairing */}
      <div className="space-y-2">
        {/* ds-raw-button: full-width selectable toggle card with title + conditional subtitle and active-state restyle — not a Button/IconButton shape */}
        <button
          type="button"
          onClick={() => setShowOther((prev) => !prev)}
          className={`w-full rounded-xl p-3.5 text-left transition-all ${
            selectedProduct?.type === 'Other'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'border border-border-soft bg-surface-canvas text-text-default hover:border-blue-300 hover:bg-blue-50'
          }`}
        >
          <div className="text-xs font-bold uppercase tracking-wide">Other -- Manual Entry</div>
          {selectedProduct?.type === 'Other' && (
            <div className="mt-1 truncate text-micro font-semibold opacity-90">{selectedProduct.model}</div>
          )}
        </button>

        {showOther && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={otherModelText}
              onChange={(e) => setOtherModelText(e.target.value)}
              placeholder="Enter product name..."
              className={`flex-1 ${blueInputClass}`}
              onKeyDown={(e) => { if (e.key === 'Enter') handleOtherSubmit(); }}
            />
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={handleOtherSubmit}
              disabled={!otherModelText.trim()}
            >
              Add
            </Button>
          </div>
        )}
      </div>

      {/* Breadcrumbs */}
      {(breadcrumbs.length > 0 || showAllProducts) && (
        <div className="flex flex-wrap items-center gap-1 text-eyebrow font-black uppercase tracking-wide text-text-soft">
          {/* ds-raw-button: inline breadcrumb text link (no chrome) — Button would add height/padding */}
          <button
            type="button"
            onClick={() => void fetchCategoryLevel(null)}
            className="transition-colors hover:text-blue-600"
          >
            {BREADCRUMB_START_LABEL}
          </button>
          {showAllProducts && (
            <>
              <ChevronRight className="h-3 w-3 flex-shrink-0 text-text-faint" />
              <span className="text-text-default">All Repairs</span>
            </>
          )}
          {!showAllProducts && breadcrumbs.map((b, i) => (
            <React.Fragment key={b.id}>
              <ChevronRight className="h-3 w-3 flex-shrink-0 text-text-faint" />
              {/* ds-raw-button: inline breadcrumb text link (no chrome) */}
              <button
                type="button"
                onClick={() => void fetchCategoryLevel(b.id)}
                className={`transition-colors hover:text-blue-600 ${i === breadcrumbs.length - 1 ? 'text-text-default' : ''}`}
              >
                {b.name}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="rounded-xl border border-border-soft bg-surface-canvas p-4 text-xs font-bold text-text-faint uppercase tracking-wide">
          Loading...
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-red-700">
          {error}
        </div>
      )}

      {/* Content */}
      {!loading && !error && (
        <div className={`${fillHeight ? 'flex-1' : 'max-h-[50vh]'} space-y-4 overflow-y-auto p-0.5`}>

          {/* Sub-categories */}
          {!showAllProducts && filteredCategories.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-eyebrow font-black uppercase tracking-[0.15em] text-text-faint">
                {isAtRoot ? 'Categories' : 'Sub-categories'}
              </p>
              <div className="space-y-1.5">
                {/* ds-raw-button: full-width category nav row card (title + chevron), not a Button shape */}
                {filteredCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => void fetchCategoryLevel(cat.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border-soft bg-surface-card p-3.5 text-left transition-all hover:border-blue-300 hover:bg-blue-50 active:bg-blue-100"
                  >
                    <span className="truncate text-xs font-bold text-text-default">
                      {cat.name}
                    </span>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-text-faint" />
                  </button>
                ))}
                {isAtRoot && (
                  /* ds-raw-button: full-width nav row card (title + chevron), not a Button shape */
                  <button
                    type="button"
                    onClick={() => void fetchAllProducts()}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border-soft bg-surface-card p-3.5 text-left transition-all hover:border-blue-300 hover:bg-blue-50 active:bg-blue-100"
                  >
                    <span className="truncate text-xs font-bold text-text-default">
                      Pick Your Repair - All Repairs
                    </span>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-text-faint" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Products grid */}
          {(loadingProducts || filteredProducts.length > 0) && (
            <div className="space-y-2">
              <p className="text-eyebrow font-black uppercase tracking-[0.15em] text-text-faint">
                {loadingProducts ? 'Loading products...' : 'Products'}
              </p>
              {!loadingProducts && (
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: `repeat(auto-fill, minmax(148px, 1fr))` }}
                >
                  {filteredProducts.map((product) => {
                    const selected = isSelected(product.id);
                    return (
                      // ds-raw-button: selectable product image+price card with checkmark overlay, not a Button shape
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => toggleProduct(product)}
                        className={`relative flex flex-col overflow-hidden rounded-xl border-2 text-left transition-all ${
                          selected
                            ? 'border-blue-500 shadow-md shadow-blue-500/20'
                            : 'border-border-soft hover:border-blue-300 hover:shadow-sm'
                        }`}
                      >
                        {/* Square image */}
                        <div className="relative aspect-square w-full flex-shrink-0 overflow-hidden bg-surface-sunken">
                          {product.thumbnailUrl ? (
                            <img
                              src={product.thumbnailUrl}
                              alt={product.name}
                              className="h-full w-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-eyebrow font-black uppercase tracking-widest text-text-faint">
                              No Image
                            </div>
                          )}

                          {/* Selected checkmark */}
                          {selected && (
                            <div className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600">
                              <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className={`flex flex-1 flex-col justify-between gap-1.5 p-2.5 ${selected ? 'bg-blue-600' : 'bg-surface-card'}`}>
                          <p className={`text-xs font-bold leading-tight ${selected ? 'text-white' : 'text-text-default'}`}>
                            {product.name}
                          </p>
                          <div className="flex items-end justify-between gap-1">
                            <span className={`text-sm font-black ${
                              selected ? 'text-blue-100' : product.price !== null ? 'text-emerald-600' : 'text-text-faint'
                            }`}>
                              {product.price !== null ? `$${product.price.toFixed(2)}` : '--'}
                            </span>
                            {product.sku && (
                              <span className={`max-w-[55%] truncate text-right text-eyebrow font-bold ${selected ? 'text-blue-200' : 'text-text-faint'}`}>
                                {product.sku}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {!loadingProducts && hasMoreProducts && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={loadMoreProducts}
                  disabled={loadingMoreProducts}
                  className="mt-2 w-full"
                >
                  {loadingMoreProducts ? 'Loading More...' : `Load ${PRODUCT_PAGE_SIZE} More`}
                </Button>
              )}
            </div>
          )}

          {/* Empty state */}
          {!loadingProducts && filteredCategories.length === 0 && filteredProducts.length === 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-700">
              {search.trim() ? 'No results match your search.' : 'No items found at this level.'}
            </div>
          )}
        </div>
      )}

      {/* Selected items tray */}
      {selectedItems.length > 0 && (
        <div className="overflow-hidden rounded-xl bg-blue-600 p-3 shadow-lg shadow-blue-500/20">
          <div className="space-y-1.5">
            {selectedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-card px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-micro font-bold text-text-default">{item.name}</p>
                  {item.sku && <p className="text-eyebrow font-semibold text-text-faint">{item.sku}</p>}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {item.price !== null && (
                    <span className="text-micro font-black text-emerald-600">${item.price.toFixed(2)}</span>
                  )}
                  <IconButton
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="flex h-5 w-5 items-center justify-center rounded-md bg-surface-sunken transition-colors hover:bg-red-100"
                    ariaLabel="Remove item"
                    icon={
                      <svg className="h-3 w-3 text-text-soft hover:text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
