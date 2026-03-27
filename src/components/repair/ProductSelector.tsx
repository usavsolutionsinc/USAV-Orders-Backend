'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from '../Icons';

interface ProductSelection {
  type: string;
  model: string;
  sourceSku?: string | null;
}

interface ProductSelectorProps {
  onSelect: (product: ProductSelection) => void;
  selectedProduct: ProductSelection | null;
  onPriceChange?: (price: string) => void;
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

interface SelectedItem {
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
}

export function ProductSelector({ onSelect, selectedProduct, onPriceChange }: ProductSelectorProps) {
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [products, setProducts] = useState<EcwidProduct[]>([]);
  const [rootName, setRootName] = useState('Bose Repair Service');
  const [currentCategoryId, setCurrentCategoryId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [otherModelText, setOtherModelText] = useState('');
  const [showOther, setShowOther] = useState(false);

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

      if (parentId) void fetchProducts(parentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories');
      setCategories([]);
    } finally {
      setLoadingCategories(false);
    }
  };

  const fetchProducts = async (categoryId: string) => {
    setLoadingProducts(true);
    try {
      const response = await fetch(
        `/api/repair/ecwid-products?categoryId=${encodeURIComponent(categoryId)}`,
        
      );
      const payload = (await response.json()) as ProductsResponse;
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Failed to load products');
      setProducts(Array.isArray(payload.products) ? payload.products : []);
    } catch {
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  };

  useEffect(() => { void fetchCategoryLevel(null); }, []);

  // Sync totalPrice to parent whenever selectedItems changes
  useEffect(() => {
    if (selectedItems.length === 0) return;
    onPriceChange?.(totalPriceOf(selectedItems).toFixed(2));
  }, [selectedItems]);

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

  const toggleProduct = (product: EcwidProduct) => {
    setShowOther(false);
    setSelectedItems((prev) => {
      const exists = prev.find((i) => i.id === product.id);
      const next = exists
        ? prev.filter((i) => i.id !== product.id)
        : [...prev, { id: product.id, name: product.name, price: product.price, sku: product.sku }];
      const model = next.map((i) => i.name).join(', ');
      onSelect({ type: next.length > 0 ? rootName : '', model, sourceSku: deriveSourceSku(next) });
      onPriceChange?.(totalPriceOf(next).toFixed(2));
      return next;
    });
  };

  const removeItem = (id: string) => {
    setSelectedItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      const model = next.map((i) => i.name).join(', ');
      onSelect({ type: next.length > 0 ? rootName : '', model, sourceSku: deriveSourceSku(next) });
      onPriceChange?.(totalPriceOf(next).toFixed(2));
      return next;
    });
  };

  const handleOtherSubmit = () => {
    const value = otherModelText.trim();
    if (!value) return;
    setSelectedItems([]);
    onSelect({ type: 'Other', model: value, sourceSku: null });
    setOtherModelText('');
    setShowOther(false);
  };

  const isSelected = (id: string) => selectedItems.some((i) => i.id === id);
  const isAtRoot = !currentCategoryId;
  const loading = loadingCategories;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div>
        <p className="text-[8px] font-black uppercase tracking-[0.2em] text-blue-600 mb-0.5">Step 1</p>
        <h3 className="text-xs font-black text-gray-900 uppercase tracking-tight">Select Products</h3>
        <p className="text-[10px] text-gray-500 font-semibold mt-0.5">Browse {rootName}</p>
      </div>

      {/* Search + Back */}
      <div className="flex gap-0">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={isAtRoot ? 'Search categories...' : 'Search products...'}
          className="flex-1 px-4 py-3 border-2 border-gray-300 text-xs font-bold focus:outline-none focus:border-blue-600 transition-colors bg-white"
        />
        <button
          onClick={() => void fetchCategoryLevel(
            breadcrumbs.length <= 1 ? null : breadcrumbs[breadcrumbs.length - 2].id
          )}
          disabled={loading || isAtRoot}
          className="flex items-center justify-center w-12 border-2 border-l-0 border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 active:bg-gray-100 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap text-[9px] font-black text-gray-500 uppercase tracking-wide">
          <button
            onClick={() => void fetchCategoryLevel(null)}
            className="hover:text-blue-600 transition-colors"
          >
            {rootName}
          </button>
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={b.id}>
              <ChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0" />
              <button
                onClick={() => void fetchCategoryLevel(b.id)}
                className={`hover:text-blue-600 transition-colors ${i === breadcrumbs.length - 1 ? 'text-gray-900' : ''}`}
              >
                {b.name}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="w-full p-4 border-2 border-gray-200 bg-gray-50 text-xs font-black text-gray-400 uppercase tracking-wide">
          Loading...
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="w-full p-4 border-2 border-red-300 bg-red-50 text-xs font-black text-red-700">
          {error}
        </div>
      )}

      {/* Content */}
      {!loading && !error && (
        <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">

          {/* Sub-categories */}
          {filteredCategories.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.15em]">
                {isAtRoot ? 'Categories' : 'Sub-categories'}
              </p>
              <div className="space-y-1">
                {filteredCategories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => void fetchCategoryLevel(cat.id)}
                    className="w-full p-3.5 border-2 border-gray-300 bg-white hover:border-blue-600 hover:bg-blue-50 active:bg-blue-100 transition-colors text-left flex items-center justify-between gap-3"
                  >
                    <span className="text-xs font-black uppercase tracking-wide text-gray-900 truncate">
                      {cat.name}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Products grid */}
          {(loadingProducts || filteredProducts.length > 0) && (
            <div className="space-y-2">
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.15em]">
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
                      <button
                        key={product.id}
                        onClick={() => toggleProduct(product)}
                        className={`relative border-2 overflow-hidden text-left transition-colors flex flex-col ${
                          selected
                            ? 'border-blue-600'
                            : 'border-gray-300 hover:border-blue-400 active:border-blue-600'
                        }`}
                      >
                        {/* Square image */}
                        <div className="w-full aspect-square bg-gray-100 overflow-hidden relative flex-shrink-0">
                          {product.thumbnailUrl ? (
                            <img
                              src={product.thumbnailUrl}
                              alt={product.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[9px] font-black text-gray-300 uppercase tracking-widest">
                              No Image
                            </div>
                          )}

                          {/* Selected checkmark */}
                          {selected && (
                            <div className="absolute top-0 right-0 w-7 h-7 bg-blue-600 flex items-center justify-center">
                              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className={`p-2.5 flex-1 flex flex-col justify-between gap-1.5 ${selected ? 'bg-blue-600' : 'bg-white'}`}>
                          <p className={`text-xs font-black leading-tight ${selected ? 'text-white' : 'text-gray-900'}`}>
                            {product.name}
                          </p>
                          <div className="flex items-end justify-between gap-1">
                            <span className={`text-sm font-black ${
                              selected ? 'text-blue-100' : product.price !== null ? 'text-emerald-600' : 'text-gray-300'
                            }`}>
                              {product.price !== null ? `$${product.price.toFixed(2)}` : '—'}
                            </span>
                            {product.sku && (
                              <span className={`text-[9px] font-bold truncate max-w-[55%] text-right ${selected ? 'text-blue-200' : 'text-gray-400'}`}>
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
            </div>
          )}

          {/* Empty state */}
          {!loadingProducts && filteredCategories.length === 0 && filteredProducts.length === 0 && (
            <div className="w-full p-4 border-2 border-amber-300 bg-amber-50 text-xs font-black text-amber-700 uppercase tracking-wide">
              {search.trim() ? 'No results match your search.' : 'No items found at this level.'}
            </div>
          )}
        </div>
      )}

      {/* Selected items tray */}
      {selectedItems.length > 0 && (
        <div className="border-2 border-blue-600 bg-blue-600 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black text-blue-100 uppercase tracking-[0.15em]">
              Selected ({selectedItems.length})
            </p>
            <p className="text-xs font-black text-white">
              ${totalPriceOf(selectedItems).toFixed(2)}
            </p>
          </div>
          <div className="space-y-1">
            {selectedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 bg-white px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black text-gray-900 truncate">{item.name}</p>
                  {item.sku && <p className="text-[9px] font-semibold text-gray-400">{item.sku}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {item.price !== null && (
                    <span className="text-[10px] font-black text-emerald-600">${item.price.toFixed(2)}</span>
                  )}
                  <button
                    onClick={() => removeItem(item.id)}
                    className="w-5 h-5 bg-gray-100 hover:bg-red-100 flex items-center justify-center transition-colors"
                  >
                    <svg className="w-3 h-3 text-gray-500 hover:text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Other / Manual Entry */}
      <div className="space-y-2">
        <button
          onClick={() => setShowOther((prev) => !prev)}
          className={`w-full p-3.5 border-2 transition-colors text-left ${
            selectedProduct?.type === 'Other'
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'bg-white border-gray-300 text-gray-900 hover:border-blue-600 active:bg-blue-50'
          }`}
        >
          <div className="text-xs font-black uppercase tracking-wide">Other — Manual Entry</div>
          {selectedProduct?.type === 'Other' && (
            <div className="text-[10px] font-semibold mt-1 opacity-90 truncate">{selectedProduct.model}</div>
          )}
        </button>

        {showOther && (
          <div className="flex gap-0">
            <input
              type="text"
              value={otherModelText}
              onChange={(e) => setOtherModelText(e.target.value)}
              placeholder="Enter product name..."
              className="flex-1 px-4 py-3 bg-white border-2 border-gray-300 text-xs font-bold text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-600 transition-colors"
              onKeyDown={(e) => { if (e.key === 'Enter') handleOtherSubmit(); }}
            />
            <button
              onClick={handleOtherSubmit}
              disabled={!otherModelText.trim()}
              className="px-5 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-black uppercase tracking-wide transition-colors disabled:cursor-not-allowed border-2 border-l-0 border-blue-600 disabled:border-gray-200"
            >
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
