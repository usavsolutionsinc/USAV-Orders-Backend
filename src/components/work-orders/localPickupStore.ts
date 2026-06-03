'use client';

/**
 * Shared local-pickup intake store.
 *
 * The pickup sidebar (slim selectable list) and the pickup main pane (the big
 * editor + add popover) live in two separate React trees — different
 * `RouteShell` slots wired up by `ReceivingSidebarPanel` and
 * `ReceivingDashboard`. Rather than juggle CustomEvents between them (the old
 * `LOCAL_PICKUP_ADD/REMOVE/CART_STATE` bus), both panes read and write this one
 * module-scoped singleton via `useLocalPickupCart()` (useSyncExternalStore).
 *
 * Source of truth: `cart` (the staged items) + `selectedKey` (which item the
 * main editor is focused on). Persistence is unchanged from the old inline
 * form — `submit()` creates one receiving-entry + one local-pickups detail per
 * line, then clears the cart.
 *
 * Mirrors the `serialEditHandoff.ts` singleton pattern already used by the
 * receiving workspace.
 */

import { useSyncExternalStore } from 'react';
import { invalidateReceivingCache } from '@/lib/receivingCache';
import { buildLocalPickupPoNumber } from '@/lib/local-pickup/po-number';

export const CONDITION_OPTIONS = [
  { value: 'BRAND_NEW', label: 'Brand New' },
  { value: 'USED_A', label: 'Used — A' },
  { value: 'USED_B', label: 'Used — B' },
  { value: 'USED_C', label: 'Used — C' },
  { value: 'PARTS', label: 'Parts Only' },
] as const;

export type ConditionGrade = (typeof CONDITION_OPTIONS)[number]['value'];
export type PartsStatus = 'COMPLETE' | 'MISSING_PARTS';

export interface CartLine {
  key: string;
  sku: string;
  product_title: string;
  category: string | null;
  image_url: string | null;
  quantity: number;
  conditionGrade: ConditionGrade;
  partsStatus: PartsStatus;
  missingPartsNote: string;
  conditionNote: string;
  total: string;
}

/** Minimal product shape needed to seed a cart line (subset of SkuCatalogItem). */
export interface PickupProductInput {
  sku: string;
  product_title: string;
  category?: string | null;
  image_url?: string | null;
}

interface PickupState {
  cart: CartLine[];
  /** key of the line the main editor is focused on; null = none selected. */
  selectedKey: string | null;
  /** Review & print overlay open (the finalize step before logging the PO). */
  reviewOpen: boolean;
  isSubmitting: boolean;
  submitError: string | null;
  successMessage: string | null;
}

let state: PickupState = {
  cart: [],
  selectedKey: null,
  reviewOpen: false,
  isSubmitting: false,
  submitError: null,
  successMessage: null,
};

/**
 * Set after the order + receiving row are created but before the Zoho PO
 * succeeds, so a retry of {@link finalize} reuses them instead of creating a
 * duplicate order / receiving entry. Cleared once the PO is committed.
 */
let pendingFinalize: { orderId: number; receivingId: number; poNumber: string } | null = null;

/** Result of a successful finalize, returned to the review panel for printing. */
export interface FinalizeResult {
  ok: boolean;
  orderId?: number;
  receivingId?: number;
  poNumber?: string;
  error?: string;
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<PickupState>): void {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PickupState {
  return state;
}

// ── Money helpers (shared with the editor) ───────────────────────────────────

export function parseMoney(raw: string): number {
  const value = Number((raw || '').trim());
  return Number.isFinite(value) ? value : 0;
}

export function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function conditionLabel(grade: ConditionGrade | string): string {
  return CONDITION_OPTIONS.find((o) => o.value === grade)?.label ?? String(grade);
}

function makeLine(item: PickupProductInput): CartLine {
  return {
    key: `${item.sku}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sku: item.sku,
    product_title: item.product_title,
    category: item.category ?? null,
    image_url: item.image_url ?? null,
    quantity: 1,
    conditionGrade: 'USED_A',
    partsStatus: 'COMPLETE',
    missingPartsNote: '',
    conditionNote: '',
    total: '',
  };
}

// ── Actions ──────────────────────────────────────────────────────────────────

/**
 * Add a product to the cart. If the SKU is already staged, bumps its quantity
 * and re-selects it; otherwise pushes a fresh line and selects it. Returns the
 * key of the affected line so callers can scroll/focus it.
 */
export function addLine(item: PickupProductInput): string {
  // Manual-title picks (the unfound lookup's "Product not added yet?" path)
  // arrive with an empty SKU — never dedup those into each other; each is a
  // distinct item. Only collapse repeat picks of a real, identified SKU.
  const existing = item.sku
    ? state.cart.find((l) => l.sku === item.sku)
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
    // Selection follows the list: pick the neighbour that slides into place,
    // else the new last item, else nothing.
    const idx = state.cart.findIndex((l) => l.key === key);
    nextSelected = remaining[idx]?.key ?? remaining[idx - 1]?.key ?? remaining[0]?.key ?? null;
  }
  setState({ cart: remaining, selectedKey: nextSelected });
}

export function patchLine(key: string, patch: Partial<CartLine>): void {
  setState({
    cart: state.cart.map((l) => (l.key === key ? { ...l, ...patch } : l)),
  });
}

export function selectLine(key: string | null): void {
  setState({ selectedKey: key });
}

export function clearMessages(): void {
  if (state.submitError || state.successMessage) {
    setState({ submitError: null, successMessage: null });
  }
}

export function openReview(): void {
  if (state.cart.length === 0) return;
  // Fresh review session — drop any half-finished finalize from a prior attempt
  // so we never reuse a stale order/receiving against an edited cart.
  pendingFinalize = null;
  setState({ reviewOpen: true, submitError: null, successMessage: null });
}

export function closeReview(): void {
  pendingFinalize = null;
  setState({ reviewOpen: false });
}

/**
 * Finalize the staged pickup as a single Purchase Order:
 *   1. create one DRAFT `local_pickup_order` (+ items) for the whole batch
 *   2. create one `receiving` row (source 'local_pickup') that owns the label
 *      QR + receiving-history row — tracking = the PO number
 *   3. POST `…/{id}/finalize` → resolves the Zoho vendor, creates the Zoho PO
 *      `LCPU-{NAME}-{MMDDYY}`, marks the order COMPLETED + links the receiving
 *
 * Steps 1–2 are remembered in {@link pendingFinalize} so a retry after a Zoho
 * failure reuses the same order + receiving row (no duplicates). On success the
 * cart is cleared and the order id / receiving id / PO number are returned so
 * the review panel can print the label.
 */
export async function finalize(name: string, notes: string): Promise<FinalizeResult> {
  if (state.isSubmitting) return { ok: false, error: 'Finalize already in progress' };
  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, error: 'Pickup name is required' };
  if (state.cart.length === 0) return { ok: false, error: 'No items to finalize' };

  setState({ isSubmitting: true, submitError: null, successMessage: null });
  try {
    if (!pendingFinalize) {
      const pickupDate = new Date().toISOString().slice(0, 10);
      const poNumber = buildLocalPickupPoNumber(trimmedName, pickupDate);

      // 1. One DRAFT order + items for the whole pickup.
      const orderRes = await fetch('/api/local-pickup-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickupDate,
          customerName: trimmedName,
          notes: notes.trim() || null,
          items: state.cart.map((l) => ({
            sku: l.sku,
            productTitle: l.product_title,
            imageUrl: l.image_url,
            quantity: l.quantity,
            conditionGrade: l.conditionGrade,
            partsStatus: l.partsStatus,
            missingPartsNote: l.partsStatus === 'MISSING_PARTS' ? l.missingPartsNote : '',
            conditionNote: l.conditionNote,
            totalPrice: parseMoney(l.total),
          })),
        }),
      });
      const orderData = await orderRes.json().catch(() => ({}));
      if (!orderRes.ok || !orderData?.success) {
        throw new Error(orderData?.error || `Failed to create order (HTTP ${orderRes.status})`);
      }
      const orderId = Number(orderData.order?.id);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        throw new Error('Missing order id from local-pickup-orders response');
      }

      // 2. One receiving row owns the scannable label + history row.
      const entryRes = await fetch('/api/receiving-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumber: poNumber,
          carrier: 'LOCAL',
          source: 'local_pickup',
          conditionGrade: 'USED_A',
          qaStatus: 'PASSED',
          dispositionCode: 'ACCEPT',
          isReturn: false,
          needsTest: false,
          targetChannel: 'ORDERS',
          skipZohoMatch: true,
        }),
      });
      const entryData = await entryRes.json().catch(() => ({}));
      if (!entryRes.ok) {
        throw new Error(entryData?.error || `Failed to create receiving entry (HTTP ${entryRes.status})`);
      }
      const receivingId = Number(entryData?.record?.id);
      if (!Number.isFinite(receivingId) || receivingId <= 0) {
        throw new Error('Missing receiving_id from receiving-entry response');
      }

      pendingFinalize = { orderId, receivingId, poNumber };
    }

    // 3. Push to Zoho + complete (retry-safe via pendingFinalize).
    const finRes = await fetch(`/api/local-pickup-orders/${pendingFinalize.orderId}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receivingId: pendingFinalize.receivingId }),
    });
    const finData = await finRes.json().catch(() => ({}));
    if (!finRes.ok || !finData?.success) {
      throw new Error(finData?.error || `Failed to finalize (HTTP ${finRes.status})`);
    }

    const result: FinalizeResult = {
      ok: true,
      orderId: pendingFinalize.orderId,
      receivingId: pendingFinalize.receivingId,
      poNumber: String(finData.poNumber || pendingFinalize.poNumber),
    };
    pendingFinalize = null;

    invalidateReceivingCache();
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    window.dispatchEvent(new CustomEvent('dashboard-refresh'));

    setState({
      cart: [],
      selectedKey: null,
      isSubmitting: false,
      successMessage: `Logged ${result.poNumber}`,
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Finalize failed';
    setState({ isSubmitting: false, submitError: msg });
    return { ok: false, error: msg };
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/** Subscribe a component to the pickup cart. Re-renders on any cart change. */
export function useLocalPickupCart(): PickupState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Derived: the currently-selected cart line (or null). */
export function getSelectedLine(s: PickupState): CartLine | null {
  if (!s.selectedKey) return null;
  return s.cart.find((l) => l.key === s.selectedKey) ?? null;
}
