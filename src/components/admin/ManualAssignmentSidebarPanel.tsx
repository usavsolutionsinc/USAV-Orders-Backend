'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SearchBar } from '@/components/ui/SearchBar';
import { TabSwitch } from '@/components/ui/TabSwitch';
import { Loader2 } from '@/components/Icons';

export type ManualMode = 'category' | 'orders';

interface Category {
  id: string;
  title: string;
  productCount?: number;
}

interface RecentOrder {
  id: number;
  order_id: string;
  product_title: string;
  item_number: string | null;
  sku: string;
  quantity: string | number | null;
  shipping_tracking_number: string | null;
  is_shipped: boolean;
  has_manual: boolean;
}

interface DateGroup {
  date: string;
  label: string;
  orders: RecentOrder[];
}

const MODE_TABS = [
  { id: 'category' as ManualMode, label: 'By Category', color: 'blue' as const },
  { id: 'orders' as ManualMode, label: 'Recent Orders', color: 'blue' as const },
];

function cleanCategoryTitle(rawTitle: string): string {
  const title = String(rawTitle || '').trim();
  if (!title) return '';
  const slashParts = title.split('/').map((p) => p.trim()).filter(Boolean);
  const rightSide = slashParts.length > 0 ? slashParts[slashParts.length - 1] : title;
  const arrowParts = rightSide.split('>').map((p) => p.trim()).filter(Boolean);
  return arrowParts.length > 0 ? arrowParts[arrowParts.length - 1] : rightSide;
}

export function ManualAssignmentSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const mode = (searchParams.get('manualMode') as ManualMode) || 'category';
  const activeCategoryId = searchParams.get('categoryId') || '';
  const activeOrderId = searchParams.get('orderId') || '';
  const searchValue = searchParams.get('search') || '';

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [dateGroups, setDateGroups] = useState<DateGroup[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localSearch, setLocalSearch] = useState(searchValue);

  const updateParam = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      router.replace(`/admin?${next.toString()}`);
    },
    [router, searchParams]
  );

  useEffect(() => {
    setLocalSearch(searchValue);
  }, [searchValue]);

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      updateParam((params) => {
        if (value.trim()) {
          params.set('search', value.trim());
        } else {
          params.delete('search');
        }
      });
    }, 300);
  };

  const handleModeChange = (nextMode: string) => {
    updateParam((params) => {
      params.set('manualMode', nextMode);
      params.delete('search');
      params.delete('orderId');
      params.delete('categoryId');
    });
    setLocalSearch('');
  };

  // Load categories
  useEffect(() => {
    if (mode !== 'category') return;
    setCategoriesLoading(true);
    fetch('/api/product-manuals/categories')
      .then((r) => r.json())
      .then((data) => {
        const cats: Category[] = (Array.isArray(data?.categories) ? data.categories : [])
          .map((c: any) => ({
            id: String(c?.id || ''),
            title: cleanCategoryTitle(String(c?.title || '')),
            productCount: Number(c?.productCount ?? c?.product_count ?? 0) || 0,
          }))
          .filter((c: Category) => c.id && c.title);
        setCategories(cats);
      })
      .catch(() => setCategories([]))
      .finally(() => setCategoriesLoading(false));
  }, [mode]);

  // Load recent orders
  useEffect(() => {
    if (mode !== 'orders') return;
    setOrdersLoading(true);
    const params = new URLSearchParams({ days: '14' });
    if (searchValue.trim()) params.set('q', searchValue.trim());
    fetch(`/api/orders/recent?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setDateGroups(Array.isArray(data?.groups) ? data.groups : []);
      })
      .catch(() => setDateGroups([]))
      .finally(() => setOrdersLoading(false));
  }, [mode, searchValue]);

  const filteredCategories = useMemo(() => {
    if (!localSearch.trim()) return categories;
    const q = localSearch.trim().toLowerCase();
    return categories.filter((c) => c.title.toLowerCase().includes(q));
  }, [categories, localSearch]);

  const filteredGroups = useMemo(() => {
    if (!localSearch.trim()) return dateGroups;
    const q = localSearch.trim().toLowerCase();
    return dateGroups.map((g) => ({
      ...g,
      orders: g.orders.filter(
        (o) =>
          (o.product_title || '').toLowerCase().includes(q) ||
          (o.item_number || '').toLowerCase().includes(q) ||
          o.order_id.toLowerCase().includes(q)
      ),
    })).filter((g) => g.orders.length > 0);
  }, [dateGroups, localSearch]);

  const handleCategorySelect = (id: string) => {
    updateParam((params) => {
      params.set('categoryId', id);
      params.delete('orderId');
    });
  };

  const handleOrderSelect = (orderId: string) => {
    updateParam((params) => {
      params.set('orderId', orderId);
      params.delete('categoryId');
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Search bar — always on top */}
      <div className="flex-shrink-0 px-4 pt-4 pb-2">
        <SearchBar
          value={localSearch}
          onChange={handleSearchChange}
          onSearch={handleSearchChange}
          onClear={() => handleSearchChange('')}
          placeholder={mode === 'category' ? 'Search categories...' : 'Search orders...'}
          isSearching={categoriesLoading || ordersLoading}
          variant="blue"
          className="w-full"
        />
      </div>

      {/* Mode toggle — below search */}
      <div className="flex-shrink-0 px-4 pb-3">
        <TabSwitch
          tabs={MODE_TABS}
          activeTab={mode}
          onTabChange={handleModeChange}
          className="w-full"
        />
      </div>

      {/* List content */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-4 space-y-1">
        {mode === 'category' ? (
          categoriesLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            </div>
          ) : filteredCategories.length === 0 ? (
            <p className="py-6 text-center text-[10px] font-black uppercase tracking-widest text-gray-400">
              No categories found
            </p>
          ) : (
            filteredCategories.map((cat) => {
              const isActive = cat.id === activeCategoryId;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategorySelect(cat.id)}
                  className={`w-full text-left rounded-2xl px-4 py-3 transition-all border ${
                    isActive
                      ? 'bg-blue-600 border-blue-600 shadow-sm shadow-blue-200'
                      : 'bg-white border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {/* Title: full wrap, bold, no truncate */}
                  <p className={`text-[13px] font-bold leading-snug break-words ${isActive ? 'text-white' : 'text-gray-900'}`}>
                    {cat.title}
                  </p>
                  {cat.productCount !== undefined && cat.productCount > 0 && (
                    <p className={`mt-1 text-[10px] font-semibold ${isActive ? 'text-blue-100' : 'text-gray-400'}`}>
                      {cat.productCount} products
                    </p>
                  )}
                </button>
              );
            })
          )
        ) : ordersLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          </div>
        ) : filteredGroups.length === 0 ? (
          <p className="py-6 text-center text-[10px] font-black uppercase tracking-widest text-gray-400">
            No orders found
          </p>
        ) : (
          filteredGroups.map((group) => (
            <div key={group.date}>
              <p className="px-2 pb-1.5 pt-4 text-[9px] font-black uppercase tracking-widest text-gray-400">
                {group.label}
              </p>
              {group.orders.map((order) => {
                const isActive = String(order.id) === activeOrderId;
                const displayTitle =
                  order.product_title || order.item_number || order.sku || order.order_id;
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => handleOrderSelect(String(order.id))}
                    className={`w-full text-left rounded-2xl px-4 py-3 mb-1.5 transition-all border ${
                      isActive
                        ? 'bg-blue-600 border-blue-600 shadow-sm shadow-blue-200'
                        : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      {/* Title: full wrap, bold, no truncate */}
                      <p className={`flex-1 text-[13px] font-bold leading-snug break-words ${isActive ? 'text-white' : 'text-gray-900'}`}>
                        {displayTitle}
                      </p>
                      <span
                        className={`flex-shrink-0 mt-1 rounded-full w-2 h-2 ${
                          order.has_manual
                            ? 'bg-emerald-400'
                            : isActive
                              ? 'bg-blue-300'
                              : 'bg-gray-300'
                        }`}
                        title={order.has_manual ? 'Manual linked' : 'No manual'}
                      />
                    </div>
                    {order.is_shipped && (
                      <span
                        className={`mt-1.5 inline-block text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          isActive ? 'bg-blue-500 text-blue-100' : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        Shipped
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
