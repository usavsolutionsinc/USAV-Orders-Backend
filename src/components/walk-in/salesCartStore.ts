'use client';

/**
 * Shared walk-in sales intake store.
 *
 * Mirrors {@link ../work-orders/localPickupStore} so the Sales surface runs the
 * same two-pane intake as Local Pickup: a slim selectable sidebar list
 * (`SalesCartSidebar`) and a main-pane editor + add popover (`SalesEditPanel`)
 * live in separate `RouteShell` slots and share this one module-scoped
 * singleton via `useSalesCart()` (useSyncExternalStore) — no CustomEvent bus.
 *
 * Source of truth: `cart` (staged items) + `selectedKey` (which line the main
 * editor is focused on). Products come from the Square catalog so the terminal
 * can charge by `catalog_object_id`; the "Product not added yet?" manual path
 * stages an ad-hoc line (no Square id) charged via name + base_price_money.
 */

import { useSyncExternalStore } from 'react';

export interface SalesCartLine {
  key: string;
  /** Square catalog_object_id (variation). null for a manual ad-hoc line. */
  variationId: string | null;
  sku: string;
  product_title: string;
  image_url: string | null;
  quantity: number;
  /** Unit price in minor units (cents). */
  unitAmount: number;
  /** Manual title-only line (not in the Square catalog). */
  isManual: boolean;
}

/** Minimal product shape needed to seed a cart line. */
export interface SalesProductInput {
  variationId: string | null;
  sku: string;
  product_title: string;
  image_url?: string | null;
  /** Unit price in minor units (cents). */
  unitAmount: number;
  isManual?: boolean;
}

interface SalesState {
  cart: SalesCartLine[];
  /** key of the line the main editor is focused on; null = none selected. */
  selectedKey: string | null;
  isSubmitting: boolean;
  submitError: string | null;
  successMessage: string | null;
}

let state: SalesState = {
  cart: [],
  selectedKey: null,
  isSubmitting: false,
  submitError: null,
  successMessage: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<SalesState>): void {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SalesState {
  return state;
}

function makeLine(item: SalesProductInput): SalesCartLine {
  return {
    key: `${item.sku || 'manual'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    variationId: item.variationId,
    sku: item.sku,
    product_title: item.product_title,
    image_url: item.image_url ?? null,
    quantity: 1,
    unitAmount: Math.max(0, Math.round(item.unitAmount || 0)),
    isManual: item.isManual ?? item.variationId === null,
  };
}

// ── Actions ──────────────────────────────────────────────────────────────────

/**
 * Add a product to the cart. Catalog items dedup by variation (bump quantity +
 * re-select); manual title-only lines are always distinct (no id to collapse
 * on). Returns the key of the affected line so callers can focus it.
 */
export function addLine(item: SalesProductInput): string {
  const existing = item.variationId
    ? state.cart.find((l) => l.variationId === item.variationId)
    : undefined;
  if (existing) {
    setState({
      cart: state.cart.map((l) =>
        l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l,
      ),
      selectedKey: existing.key,
      successMessage: null,
    });
    return existing.key;
  }
  const line = makeLine(item);
  setState({
    cart: [...state.cart, line],
    selectedKey: line.key,
    successMessage: null,
  });
  return line.key;
}

export function removeLine(key: string): void {
  const remaining = state.cart.filter((l) => l.key !== key);
  let nextSelected = state.selectedKey;
  if (state.selectedKey === key) {
    const idx = state.cart.findIndex((l) => l.key === key);
    nextSelected = remaining[idx]?.key ?? remaining[idx - 1]?.key ?? remaining[0]?.key ?? null;
  }
  setState({ cart: remaining, selectedKey: nextSelected });
}

export function patchLine(key: string, patch: Partial<SalesCartLine>): void {
  setState({
    cart: state.cart.map((l) => (l.key === key ? { ...l, ...patch } : l)),
  });
}

export function selectLine(key: string | null): void {
  setState({ selectedKey: key });
}

/**
 * Charge the staged cart on the Square terminal. Catalog lines are sent by
 * `catalog_object_id` (Square's price is authoritative); manual lines are sent
 * as ad-hoc `name` + `base_price_money`. Clears the cart once the order is
 * dispatched to the terminal.
 */
export async function checkout(): Promise<void> {
  if (state.isSubmitting || state.cart.length === 0) return;
  const cart = state.cart;
  setState({ isSubmitting: true, submitError: null, successMessage: null });
  try {
    const line_items = cart.map((l) =>
      l.variationId
        ? { catalog_object_id: l.variationId, quantity: String(l.quantity) }
        : {
            name: l.product_title,
            quantity: String(l.quantity),
            base_price_money: { amount: l.unitAmount },
          },
    );

    const orderRes = await fetch('/api/walk-in/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_items }),
    });
    const orderData = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok) throw new Error(orderData.error || 'Failed to create order');

    const orderId = orderData.order?.id;
    if (!orderId) throw new Error('No order ID returned');

    const checkoutRes = await fetch('/api/walk-in/terminal/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    });
    const checkoutData = await checkoutRes.json().catch(() => ({}));
    if (!checkoutRes.ok) throw new Error(checkoutData.error || 'Failed to send to terminal');

    setState({
      cart: [],
      selectedKey: null,
      isSubmitting: false,
      successMessage: 'Sent to terminal — waiting for payment',
    });
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
  } catch (err) {
    setState({
      isSubmitting: false,
      submitError: err instanceof Error ? err.message : 'Checkout failed',
    });
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/** Subscribe a component to the sales cart. Re-renders on any cart change. */
export function useSalesCart(): SalesState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Derived: the currently-selected cart line (or null). */
export function getSelectedSalesLine(s: SalesState): SalesCartLine | null {
  if (!s.selectedKey) return null;
  return s.cart.find((l) => l.key === s.selectedKey) ?? null;
}
