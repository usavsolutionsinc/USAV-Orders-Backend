'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Minus, Plus, ShoppingCart, X } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { SalesIntakeForm } from '@/components/walk-in/SalesIntakeForm';
import { useSquareCatalog, type SquareCatalogItem } from '@/hooks/useSquareCatalog';
import { useSquareCategories } from '@/hooks/useSquareCategories';
import { useWalkInSales } from '@/hooks/useWalkInSales';
import { formatCentsToDollars } from '@/lib/square/client';
import { getSalesWeekRange } from '@/lib/sales-week-range';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

interface SalesSidebarPanelProps {
  embedded?: boolean;
  hideSectionHeader?: boolean;
}

interface CartItem {
  variationId: string;
  name: string;
  sku: string;
  priceAmount: number;
  quantity: number;
}

export function SalesSidebarPanel({ embedded = false }: SalesSidebarPanelProps) {
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [showIntakeForm, setShowIntakeForm] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const isSearchMode = searchValue.trim().length > 0;

  // Sync with the SalesTable week offset from URL
  const weekOffset = useMemo(() => {
    const raw = searchParams.get('salesWeekOffset');
    return raw != null ? Math.max(0, parseInt(raw || '0', 10) || 0) : 0;
  }, [searchParams]);
  const activeWeek = useMemo(() => getSalesWeekRange(weekOffset), [weekOffset]);

  const weekLabel = weekOffset === 0 ? 'This Week' : weekOffset === 1 ? 'Last Week' : `${weekOffset} Weeks Ago`;

  const { data: categories = [] } = useSquareCategories();
  const { data: catalogItems = [], isLoading: loadingCatalog } = useSquareCatalog(
    isSearchMode ? searchValue : undefined,
    isSearchMode ? undefined : activeCategoryId,
  );
  const { data: recentSales = [] } = useWalkInSales(null, {
    weekStart: activeWeek.startStr,
    weekEnd: activeWeek.endStr,
  });

  const totalRevenue = recentSales.reduce((sum, s) => sum + (s.total || 0), 0);
  const cartTotal = cart.reduce((sum, c) => sum + c.priceAmount * c.quantity, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    if (!isMounted || !showIntakeForm) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isMounted, showIntakeForm]);

  const addToCart = (item: SquareCatalogItem) => {
    const v = item.item_data?.variations?.[0];
    if (!v) return;
    const existing = cart.find((c) => c.variationId === v.id);
    if (existing) {
      setCart((prev) => prev.map((c) => c.variationId === v.id ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart((prev) => [...prev, {
        variationId: v.id,
        name: item.item_data?.name || 'Item',
        sku: v.item_variation_data?.sku || '',
        priceAmount: v.item_variation_data?.price_money?.amount || 0,
        quantity: 1,
      }]);
    }
    setSubmitSuccess(false);
    setSubmitError(null);
  };

  const updateCartQty = (variationId: string, delta: number) => {
    setCart((prev) => prev.map((c) => c.variationId === variationId ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c).filter((c) => c.quantity > 0));
  };

  const handleCheckout = async () => {
    if (cart.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    try {
      const orderRes = await fetch('/api/walk-in/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line_items: cart.map((c) => ({ catalog_object_id: c.variationId, quantity: String(c.quantity) })),
        }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) throw new Error(orderData.error || 'Failed to create order');

      const orderId = orderData.order?.id;
      if (!orderId) throw new Error('No order ID returned');

      const checkoutRes = await fetch('/api/walk-in/terminal/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId }),
      });
      const checkoutData = await checkoutRes.json();
      if (!checkoutRes.ok) throw new Error(checkoutData.error || 'Failed to send to terminal');

      setCart([]);
      setSubmitSuccess(true);
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (error: any) {
      setSubmitError(error?.message || 'Checkout failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleIntakeComplete = () => {
    setShowIntakeForm(false);
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
  };

  const content = (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Search bar + New Sale button */}
      <div className="shrink-0 border-b border-gray-100 px-4 py-3">
        <SearchBar
          value={searchValue}
          onChange={setSearchValue}
          onSearch={() => {}}
          onClear={() => setSearchValue('')}
          placeholder="Search products, SKU…"
          variant="emerald"
          size="compact"
          rightElement={
            <button
              type="button"
              onClick={() => setShowIntakeForm(true)}
              className="rounded-xl bg-emerald-500 p-2.5 text-white transition-colors hover:bg-emerald-600"
              title="New sale"
              aria-label="Open new sale form"
            >
              <Plus className="h-5 w-5" />
            </button>
          }
        />
      </div>

      {/* ── SEARCH MODE: category tabs + product results ── */}
      {isSearchMode ? (
        <>
          {/* Category tabs */}
          <div className="shrink-0 border-b border-gray-100 px-3 py-2">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setActiveCategoryId(null)}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors ${
                  activeCategoryId === null
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-emerald-50 hover:text-emerald-700'
                }`}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategoryId(cat.id === activeCategoryId ? null : cat.id)}
                  className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors ${
                    activeCategoryId === cat.id
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-emerald-50 hover:text-emerald-700'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Product results */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {loadingCatalog ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
              </div>
            ) : catalogItems.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No products found</p>
            ) : (
              <div className="space-y-1.5">
                {catalogItems.map((item) => {
                  const v = item.item_data?.variations?.[0];
                  if (!v) return null;
                  const vd = v.item_variation_data;
                  const price = vd?.price_money?.amount || 0;
                  const inCart = cart.find((c) => c.variationId === v.id);

                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border px-3 py-2 transition-all cursor-pointer ${
                        inCart
                          ? 'border-emerald-300 bg-emerald-50/60'
                          : 'border-gray-100 bg-white hover:border-emerald-200 hover:bg-emerald-50/30'
                      }`}
                      onClick={() => addToCart(item)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-bold text-gray-900 leading-tight line-clamp-2">
                            {item.item_data?.name || 'Item'}
                          </p>
                          {vd?.sku && (
                            <p className="text-[8px] font-mono text-gray-400 mt-0.5">{vd.sku}</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[11px] font-black text-emerald-600">{formatCentsToDollars(price)}</p>
                          {inCart && (
                            <div className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => updateCartQty(v.id, -1)}
                                className="p-0.5 rounded border border-emerald-200 bg-white hover:bg-emerald-50"
                              >
                                <Minus className="h-2.5 w-2.5 text-emerald-600" />
                              </button>
                              <span className="text-[10px] font-black text-emerald-700 w-4 text-center">{inCart.quantity}</span>
                              <button
                                onClick={() => updateCartQty(v.id, 1)}
                                className="p-0.5 rounded border border-emerald-200 bg-white hover:bg-emerald-50"
                              >
                                <Plus className="h-2.5 w-2.5 text-emerald-600" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        /* ── DEFAULT MODE: revenue summary + recent sales ── */
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Revenue card */}
          <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-4 mb-4">
            <p className={`${sectionLabel} text-emerald-600 mb-1`}>{weekLabel}</p>
            <p className="text-2xl font-black text-emerald-700 tracking-tight">
              {formatCentsToDollars(totalRevenue)}
            </p>
            <p className="text-[10px] font-bold text-emerald-500 mt-0.5">
              {recentSales.length} sale{recentSales.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Recent sales */}
          <p className={`${sectionLabel} mb-3 text-gray-500`}>Recent Sales</p>
          {recentSales.length === 0 ? (
            <p className="text-xs text-gray-400">No sales yet</p>
          ) : (
            <div className="space-y-1.5">
              {recentSales.slice(0, 8).map((sale) => {
                const items = Array.isArray(sale.line_items) ? sale.line_items : [];
                const firstName = items[0]?.name || 'Item';
                return (
                  <div
                    key={sale.id}
                    className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-gray-900">
                        {items.length === 1 ? firstName : `${firstName} +${items.length - 1}`}
                      </span>
                      <span className="text-[11px] font-black text-emerald-600 shrink-0 ml-2">
                        {formatCentsToDollars(sale.total)}
                      </span>
                    </div>
                    <p className="text-[9px] text-gray-400 mt-0.5">
                      {sale.created_at ? new Date(sale.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Cart footer — visible in both modes when items are in cart */}
      {cart.length > 0 && (
        <div className="shrink-0 border-t border-gray-200 bg-white px-3 py-3 space-y-2">
          <div className="space-y-1">
            {cart.map((c) => (
              <div key={c.variationId} className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-gray-800 truncate max-w-[140px]">{c.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">×{c.quantity}</span>
                  <span className="font-black text-emerald-600 w-14 text-right">{formatCentsToDollars(c.priceAmount * c.quantity)}</span>
                  <button onClick={() => updateCartQty(c.variationId, -c.quantity)} className="text-gray-400 hover:text-red-500">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 pt-2">
            <span className="text-[10px] font-black uppercase text-gray-900">
              {cartCount} item{cartCount !== 1 ? 's' : ''} · {formatCentsToDollars(cartTotal)}
            </span>
          </div>

          <button
            onClick={handleCheckout}
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 px-4 py-2.5 text-white shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-700 hover:to-green-700 disabled:from-gray-400 disabled:to-gray-400 disabled:shadow-none"
          >
            <ShoppingCart className="h-4 w-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">
              {isSubmitting ? 'Sending...' : `Charge ${formatCentsToDollars(cartTotal)}`}
            </span>
          </button>

          {submitError && (
            <p className="text-[9px] font-bold text-red-600 text-center">{submitError}</p>
          )}
        </div>
      )}

      {submitSuccess && cart.length === 0 && (
        <div className="shrink-0 border-t border-emerald-200 bg-emerald-50 px-3 py-3 text-center">
          <p className="text-[10px] font-bold text-emerald-700">Sent to terminal — waiting for payment</p>
        </div>
      )}
    </div>
  );

  // Intake form overlay (like ShippedIntakeForm pattern)
  const intakeOverlay =
    isMounted && showIntakeForm
      ? createPortal(
          <div className="fixed inset-0 z-[130] bg-white">
            <SalesIntakeForm
              onClose={() => setShowIntakeForm(false)}
              onComplete={handleIntakeComplete}
            />
          </div>,
          document.body,
        )
      : null;

  if (embedded) {
    return (
      <>
        <div className="h-full overflow-hidden bg-white">{content}</div>
        {intakeOverlay}
      </>
    );
  }

  return (
    <>
      <aside className="h-full overflow-hidden border-r border-gray-200 bg-white">{content}</aside>
      {intakeOverlay}
    </>
  );
}
