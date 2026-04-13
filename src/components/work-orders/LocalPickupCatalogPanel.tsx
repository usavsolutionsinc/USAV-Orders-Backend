'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Package, Search, X } from '@/components/Icons';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { useSkuCatalogSearch, type SearchField, type SkuCatalogItem } from '@/hooks/useSkuCatalogSearch';
import {
  LOCAL_PICKUP_ADD_LINE_EVENT,
  LOCAL_PICKUP_REMOVE_LINE_EVENT,
  LOCAL_PICKUP_CART_STATE_EVENT,
  type LocalPickupAddLineDetail,
  type LocalPickupCartStateDetail,
} from './LocalPickupIntakeForm';

const SEARCH_MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'title',     label: 'Title',     tone: 'purple' },
  { id: 'ecwid_sku', label: 'Ecwid SKU', tone: 'emerald' },
  { id: 'zoho_sku',  label: 'Zoho SKU',  tone: 'orange' },
];

function detectField(q: string): SearchField {
  const trimmed = q.trim();
  if (!trimmed) return 'ecwid_sku';
  if (/[a-zA-Z]/.test(trimmed)) return 'title';
  return 'ecwid_sku';
}

export function LocalPickupCatalogPanel() {
  const [query, setQuery] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('ecwid_sku');
  const [userOverride, setUserOverride] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cartQtyBySku, setCartQtyBySku] = useState<Record<string, number>>({});

  const { data: items = [], isFetching } = useSkuCatalogSearch(query, {
    limit: 60,
    allowEmpty: true,
    ecwidOnly: true,
    excludeSkuSuffix: '-RS',
    searchField,
  });

  // Build distinct category list from what the server returned
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.category) set.add(item.category);
    }
    return Array.from(set).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!activeCategory) return items;
    return items.filter((item) => item.category === activeCategory);
  }, [items, activeCategory]);

  // Listen for cart state dispatched by the sidebar intake form
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LocalPickupCartStateDetail>).detail;
      if (!detail?.items) return;
      const next: Record<string, number> = {};
      for (const entry of detail.items) {
        next[entry.sku] = entry.quantity;
      }
      setCartQtyBySku(next);
    };
    window.addEventListener(LOCAL_PICKUP_CART_STATE_EVENT, handler);
    return () => window.removeEventListener(LOCAL_PICKUP_CART_STATE_EVENT, handler);
  }, []);

  const toggleCart = (item: SkuCatalogItem) => {
    const inCart = (cartQtyBySku[item.sku] || 0) > 0;
    if (inCart) {
      window.dispatchEvent(
        new CustomEvent<string>(LOCAL_PICKUP_REMOVE_LINE_EVENT, { detail: item.sku }),
      );
    } else {
      const detail: LocalPickupAddLineDetail = {
        sku: item.sku,
        product_title: item.product_title,
        category: item.category,
        image_url: item.image_url,
      };
      window.dispatchEvent(
        new CustomEvent<LocalPickupAddLineDetail>(LOCAL_PICKUP_ADD_LINE_EVENT, { detail }),
      );
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
      {/* Header — search + category pills */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-5 py-4 space-y-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500">
            Local Pickup · Catalog
          </p>
          <h2 className="mt-0.5 text-[18px] font-black uppercase tracking-tight text-gray-900">
            Pick products to add to the intake
          </h2>
        </div>

        <HorizontalButtonSlider
          items={SEARCH_MODE_ITEMS}
          value={searchField}
          onChange={(id) => {
            setSearchField(id as SearchField);
            setUserOverride(true);
          }}
          variant="fba"
          size="md"
        />

        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              const v = e.target.value;
              setQuery(v);
              if (!userOverride) setSearchField(detectField(v));
            }}
            placeholder={
              searchField === 'zoho_sku'
                ? 'Search by Zoho SKU…'
                : searchField === 'title'
                  ? 'Search by product title…'
                  : 'Search by Ecwid SKU…'
            }
            className="h-12 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-12 pr-12 text-[14px] font-semibold text-gray-900 outline-none transition-all focus:border-transparent focus:bg-white focus:ring-2 focus:ring-emerald-500"
          />
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          {isFetching ? (
            <Loader2 className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-emerald-500" />
          ) : query ? (
            <button
              type="button"
              onClick={() => { setQuery(''); setUserOverride(false); setSearchField('ecwid_sku'); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors ${
                activeCategory === null
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-emerald-50 hover:text-emerald-700'
              }`}
            >
              All
            </button>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() =>
                  setActiveCategory(activeCategory === category ? null : category)
                }
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors ${
                  activeCategory === category
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-emerald-50 hover:text-emerald-700'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid — mirrors SalesIntakeForm right column */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {isFetching && filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Loading Catalog…
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
              <Package className="h-8 w-8 text-emerald-300" />
            </div>
            <p className="text-sm font-bold text-gray-500">
              {query ? 'No products match your search' : 'No products to show'}
            </p>
            <p className="mt-1 text-[10px] text-gray-400">
              Try another search term or clear the category filter
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredItems.map((item) => {
              const inCart = (cartQtyBySku[item.sku] || 0) > 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleCart(item)}
                  className={`group relative flex flex-col border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${
                    inCart
                      ? 'border-emerald-300 bg-emerald-50/60 ring-1 ring-emerald-200'
                      : 'border-gray-200 bg-white hover:border-emerald-200'
                  }`}
                >
                  <div className="mb-3 flex aspect-square w-full items-center justify-center overflow-hidden bg-white" style={{ maxHeight: 360 }}>
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image_url}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <Package className="h-14 w-14 text-gray-200" />
                    )}
                  </div>
                  <p className="text-[15px] font-bold leading-snug text-gray-900">
                    {item.product_title}
                  </p>
                  <div className="mt-1 space-y-0.5">
                    <p className="text-[10px] font-mono font-black uppercase text-emerald-600">
                      Ecwid: {item.sku}
                    </p>
                    {item.zoho_sku && item.zoho_sku !== item.sku && (
                      <p className="text-[10px] font-mono font-black uppercase text-orange-500">
                        Zoho: {item.zoho_sku}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
