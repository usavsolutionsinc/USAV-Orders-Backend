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
  isSubmitting: boolean;
  submitError: string | null;
  successMessage: string | null;
}

let state: PickupState = {
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

/**
 * Persist every staged line. Identical to the old inline form: one
 * receiving-entry (synthetic LOCAL tracking) + one local-pickups detail per
 * line. On full success the cart is cleared; partial failures keep the cart and
 * surface the per-SKU errors. Returns the created receiving ids.
 */
export async function submit(): Promise<number[]> {
  if (state.isSubmitting || state.cart.length === 0) return [];
  const cart = state.cart;
  setState({ isSubmitting: true, submitError: null, successMessage: null });

  const createdReceivingIds: number[] = [];
  const errors: string[] = [];

  for (const line of cart) {
    try {
      const syntheticTracking = `LOCAL-${line.sku || 'ITEM'}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)
        .toUpperCase()}`;

      const entryRes = await fetch('/api/receiving-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumber: syntheticTracking,
          carrier: 'LOCAL',
          source: 'local_pickup',
          conditionGrade: line.conditionGrade,
          qaStatus: 'PASSED',
          dispositionCode: 'ACCEPT',
          isReturn: false,
          needsTest: false,
          targetChannel: 'ORDERS',
          skipZohoMatch: true,
        }),
      });
      if (!entryRes.ok) {
        const err = await entryRes.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${entryRes.status}`);
      }
      const entryData = await entryRes.json();
      const receivingId = Number(entryData?.record?.id);
      if (!Number.isFinite(receivingId) || receivingId <= 0) {
        throw new Error('Missing receiving_id from receiving-entry response');
      }
      createdReceivingIds.push(receivingId);

      const totalNumber = parseMoney(line.total);

      const detailRes = await fetch('/api/local-pickups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivingId,
          productTitle: line.product_title,
          sku: line.sku,
          quantity: line.quantity,
          partsStatus: line.partsStatus,
          missingPartsNote:
            line.partsStatus === 'MISSING_PARTS' ? line.missingPartsNote : '',
          receivingGrade: line.conditionGrade,
          conditionNote: line.conditionNote,
          total: totalNumber ? totalNumber.toFixed(2) : null,
        }),
      });
      if (!detailRes.ok) {
        const err = await detailRes.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${detailRes.status}`);
      }
    } catch (err) {
      errors.push(`${line.sku}: ${err instanceof Error ? err.message : 'Failed'}`);
    }
  }

  invalidateReceivingCache();
  window.dispatchEvent(new CustomEvent('usav-refresh-data'));
  window.dispatchEvent(new CustomEvent('dashboard-refresh'));

  if (errors.length === 0) {
    setState({
      cart: [],
      selectedKey: null,
      isSubmitting: false,
      successMessage: `Logged ${createdReceivingIds.length} item${
        createdReceivingIds.length === 1 ? '' : 's'
      }`,
    });
  } else {
    setState({ isSubmitting: false, submitError: errors.join(' · ') });
  }

  return createdReceivingIds;
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
