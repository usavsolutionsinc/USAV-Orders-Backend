'use client';

import React, { useState } from 'react';
import { ChevronLeft, Loader2, Minus, Plus, Search, ShoppingCart, X } from '../Icons';
import {
  SidebarIntakeFormField,
  getSidebarIntakeInputClass,
  getSidebarIntakeSubmitButtonClass,
} from '@/design-system/components';
import { useSquareCatalog, type SquareCatalogItem } from '@/hooks/useSquareCatalog';
import { useSquareCustomerSearch, type SquareCustomer } from '@/hooks/useSquareCustomers';
import { useSquareCategories } from '@/hooks/useSquareCategories';
import { formatCentsToDollars } from '@/lib/square/client';

interface SalesIntakeFormProps {
  onClose: () => void;
  onComplete: () => void;
}

interface CartItem {
  variationId: string;
  name: string;
  sku: string;
  priceAmount: number;
  quantity: number;
}

export function SalesIntakeForm({ onClose, onComplete }: SalesIntakeFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [waitingForTerminal, setWaitingForTerminal] = useState(false);

  // Customer
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<SquareCustomer | null>(null);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [customerMode, setCustomerMode] = useState<'existing' | 'anonymous'>('existing');

  // Products
  const [productSearch, setProductSearch] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);

  // Hooks
  const { data: customers = [], isLoading: loadingCustomers } = useSquareCustomerSearch(customerQuery);
  const { data: categories = [] } = useSquareCategories();
  const { data: catalogItems = [], isLoading: loadingCatalog } = useSquareCatalog(
    productSearch || undefined,
    activeCategoryId,
  );

  const greenInputClass = getSidebarIntakeInputClass('green');
  const greenSubmitButtonClass = getSidebarIntakeSubmitButtonClass('green');

  const cartSubtotal = cart.reduce((sum, c) => sum + c.priceAmount * c.quantity, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);
  const canSubmit = cart.length > 0;

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
  };

  const updateQuantity = (variationId: string, delta: number) => {
    setCart((prev) => prev.map((c) => c.variationId === variationId ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c).filter((c) => c.quantity > 0));
  };

  const handleSubmit = async () => {
    if (isSubmitting || !canSubmit) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const orderRes = await fetch('/api/walk-in/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line_items: cart.map((c) => ({ catalog_object_id: c.variationId, quantity: String(c.quantity) })),
          customer_id: selectedCustomer?.id || undefined,
        }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) throw new Error(orderData.error || 'Failed to create order');

      const orderId = orderData.order?.id;
      if (!orderId) throw new Error('No order ID returned');

      setWaitingForTerminal(true);
      const checkoutRes = await fetch('/api/walk-in/terminal/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId }),
      });
      const checkoutData = await checkoutRes.json();
      if (!checkoutRes.ok) throw new Error(checkoutData.error || 'Failed to send to terminal');

      onComplete();
    } catch (error: unknown) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to process sale');
      setWaitingForTerminal(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const customerName = selectedCustomer
    ? [selectedCustomer.given_name, selectedCustomer.family_name].filter(Boolean).join(' ')
    : '';

  return (
    <div className="flex h-full w-full bg-gray-100">

      {/* ════════════════════════════════════════════════
          LEFT SIDEBAR (360px) — Customer + Cart
         ════════════════════════════════════════════════ */}
      <aside className="flex w-[360px] shrink-0 flex-col border-r border-gray-200 bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-[13px] font-black uppercase tracking-tight text-gray-900">
              New Sale
            </h2>
            <p className="mt-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-500">
              Walk-In Order
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sidebar content — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-hide space-y-5">

          {/* ── Customer Section ── */}
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-2">Customer</p>

            <div className="grid grid-cols-2 gap-1.5 mb-3">
              <button
                type="button"
                onClick={() => { setCustomerMode('existing'); setIsAnonymous(false); }}
                className={`rounded-lg px-2 py-2 text-[9px] font-black uppercase tracking-wide transition-colors ${
                  customerMode === 'existing'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Existing
              </button>
              <button
                type="button"
                onClick={() => { setCustomerMode('anonymous'); setIsAnonymous(true); setSelectedCustomer(null); }}
                className={`rounded-lg px-2 py-2 text-[9px] font-black uppercase tracking-wide transition-colors ${
                  customerMode === 'anonymous'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Anonymous
              </button>
            </div>

            {customerMode === 'existing' && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="Search by name, phone, or email..."
                  className={greenInputClass}
                />

                {/* Customer results */}
                <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white">
                  <div className="grid grid-cols-[1fr_1fr_0.6fr] gap-2 border-b border-emerald-100 bg-emerald-50 px-3 py-2 text-[8px] font-black uppercase tracking-wider text-emerald-700">
                    <span>Name</span>
                    <span>Contact</span>
                    <span className="text-right">Action</span>
                  </div>
                  <div className="max-h-36 overflow-y-auto">
                    {loadingCustomers && customerQuery.length > 1 && (
                      <div className="px-3 py-3 text-[10px] font-bold text-gray-500">Searching...</div>
                    )}
                    {!loadingCustomers && customers.length === 0 && customerQuery.length > 1 && (
                      <div className="px-3 py-3 text-[10px] font-bold text-gray-500">No customers found</div>
                    )}
                    {!loadingCustomers && customers.map((c) => (
                      <div
                        key={c.id}
                        className={`grid grid-cols-[1fr_1fr_0.6fr] gap-2 border-b border-gray-100 px-3 py-2 text-[10px] ${
                          selectedCustomer?.id === c.id ? 'bg-emerald-50' : 'bg-white'
                        }`}
                      >
                        <span className="truncate font-bold text-gray-900">
                          {[c.given_name, c.family_name].filter(Boolean).join(' ') || 'Unknown'}
                        </span>
                        <span className="truncate text-gray-500">
                          {c.phone_number || c.email_address || '—'}
                        </span>
                        <div className="text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedCustomer(c)}
                            className="rounded-md bg-emerald-600 px-2 py-1 text-[8px] font-black uppercase tracking-wide text-white hover:bg-emerald-700 transition-colors"
                          >
                            Select
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedCustomer && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-bold text-emerald-800">{customerName}</p>
                        <p className="text-[10px] text-emerald-600">
                          {selectedCustomer.phone_number || selectedCustomer.email_address || 'Selected'}
                        </p>
                      </div>
                      <button type="button" onClick={() => setSelectedCustomer(null)} className="p-1 text-emerald-600 hover:text-emerald-800">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {customerMode === 'anonymous' && (
              <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 text-center">
                <p className="text-[10px] font-bold text-gray-500">Anonymous walk-in sale</p>
              </div>
            )}
          </div>

          {/* ── Cart Section ── */}
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-2">
              Cart {cartCount > 0 && <span className="text-emerald-600">({cartCount})</span>}
            </p>

            {cart.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center">
                <ShoppingCart className="h-5 w-5 text-gray-300 mx-auto mb-1" />
                <p className="text-[10px] text-gray-400">Select products from the catalog</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {cart.map((item) => (
                  <div
                    key={item.variationId}
                    className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-gray-900 truncate">{item.name}</p>
                      {item.sku && <p className="text-[8px] font-mono text-gray-400">{item.sku}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.variationId, -1)}
                        className="p-0.5 rounded border border-gray-200 bg-white hover:bg-gray-50"
                      >
                        <Minus className="h-3 w-3 text-gray-600" />
                      </button>
                      <span className="text-[11px] font-black text-gray-900 w-4 text-center">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.variationId, 1)}
                        className="p-0.5 rounded border border-gray-200 bg-white hover:bg-gray-50"
                      >
                        <Plus className="h-3 w-3 text-gray-600" />
                      </button>
                      <span className="text-[10px] font-black text-emerald-600 w-14 text-right">
                        {formatCentsToDollars(item.priceAmount * item.quantity)}
                      </span>
                      <button onClick={() => updateQuantity(item.variationId, -item.quantity)} className="text-gray-400 hover:text-red-500">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Subtotal */}
                <div className="flex items-center justify-between border-t border-gray-200 pt-2 mt-2">
                  <span className="text-[10px] font-black uppercase text-gray-900">Subtotal</span>
                  <span className="text-[13px] font-black text-emerald-600">{formatCentsToDollars(cartSubtotal)}</span>
                </div>
                <p className="text-[8px] text-gray-400">Tax calculated by Square at checkout</p>
              </div>
            )}
          </div>

          {/* Terminal waiting state */}
          {waitingForTerminal && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600 mx-auto mb-2" />
              <p className="text-[11px] font-bold text-blue-800">Waiting for payment on terminal...</p>
              <p className="text-[9px] text-blue-600 mt-1">Customer should tap or insert card</p>
            </div>
          )}
        </div>

        {/* Footer — submit */}
        <div className="border-t border-gray-100 px-5 py-3 space-y-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            className={`flex-1 w-full flex items-center justify-center gap-2 ${greenSubmitButtonClass}`}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </span>
            ) : (
              <>
                <ShoppingCart className="h-4 w-4" />
                {canSubmit ? `Charge ${formatCentsToDollars(cartSubtotal)}` : 'Add Products to Cart'}
              </>
            )}
          </button>
          {submitError && (
            <p className="text-center text-[9px] font-bold text-red-600">{submitError}</p>
          )}
        </div>
      </aside>

      {/* ════════════════════════════════════════════════
          RIGHT MAIN — Product Catalog Grid
         ════════════════════════════════════════════════ */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Search + Category tabs */}
        <div className="shrink-0 border-b border-gray-200 bg-white px-5 py-3 space-y-3">
          <div className="relative">
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Search products by name or SKU..."
              className="w-full px-4 py-2.5 pl-10 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            {productSearch && (
              <button
                onClick={() => setProductSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveCategoryId(null)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors ${
                activeCategoryId === null
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-emerald-50 hover:text-emerald-700'
              }`}
            >
              All Products
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategoryId(cat.id === activeCategoryId ? null : cat.id)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors ${
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

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {loadingCatalog ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Loading Catalog...</p>
            </div>
          ) : catalogItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-sm font-bold text-gray-400">
                {productSearch ? 'No products found' : 'No items in this category'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {catalogItems.map((item) => {
                const v = item.item_data?.variations?.[0];
                if (!v) return null;
                const vd = v.item_variation_data;
                const price = vd?.price_money?.amount || 0;
                const inCart = cart.find((c) => c.variationId === v.id);

                return (
                  <div
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className={`relative rounded-xl border p-3 transition-all cursor-pointer hover:shadow-md ${
                      inCart
                        ? 'border-emerald-300 bg-emerald-50/60 shadow-sm ring-1 ring-emerald-200'
                        : 'border-gray-200 bg-white hover:border-emerald-200'
                    }`}
                  >
                    {inCart && (
                      <div className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-black text-white shadow">
                        {inCart.quantity}
                      </div>
                    )}
                    <p className="text-[12px] font-bold text-gray-900 leading-tight line-clamp-2 mb-1">
                      {item.item_data?.name || 'Item'}
                    </p>
                    {vd?.sku && (
                      <p className="text-[9px] font-mono text-gray-400 mb-2">{vd.sku}</p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-black text-emerald-600">
                        {formatCentsToDollars(price)}
                      </span>
                      {inCart ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => updateQuantity(v.id, -1)}
                            className="p-0.5 rounded border border-emerald-200 bg-white hover:bg-emerald-50"
                          >
                            <Minus className="h-3 w-3 text-emerald-600" />
                          </button>
                          <button
                            onClick={() => updateQuantity(v.id, 1)}
                            className="p-0.5 rounded border border-emerald-200 bg-white hover:bg-emerald-50"
                          >
                            <Plus className="h-3 w-3 text-emerald-600" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">
                          + Add
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
