/**
 * search-result-chips — shared presentation config for the one search-result
 * renderer (SearchResultRow). Extracted out of AiQuickJumpResults so the row,
 * the header preview, /search, and operations all import one map (SoT rule:
 * "never build a per-surface search" → also never fork its chrome).
 *
 * Three exports:
 *   1. CHIP_TONE_CLASSES — the house 3-layer chip families (bg / text / ring).
 *   2. ENTITY_ICONS      — entity → leading glyph for the generic row.
 *   3. orderStatusTone   — the ORDER-status → dot/chip tone SoT.
 *
 * Why a dedicated order-status tone map (not workflowStageDot, not
 * deriveOutboundState): the search doc carries only the raw `orders.status`
 * string. `workflowStageDot` only knows the receiving/testing lifecycle
 * (EXPECTED…DONE) — every order status would fall through to the neutral
 * "unknown" dot. `deriveOutboundState` needs pack/ship/carrier signals that
 * are not on the search doc. So the dot AND the status chip both flow from
 * this one map, so they can never disagree (plan L8).
 */

import {
  LayoutDashboard,
  Tool,
  Package,
  ClipboardList,
  Box,
  PackageCheck,
} from '@/components/Icons';

type IconComponent = (props: { className?: string }) => JSX.Element;

/** UI entity type → leading glyph (generic row). */
export const ENTITY_ICONS: Record<string, IconComponent> = {
  order: LayoutDashboard,
  repair: Tool,
  fba: Package,
  receiving: ClipboardList,
  sku: Box,
  unit: PackageCheck,
};

/** Semantic chip tone vocabulary — matches SearchHitChip.tone. */
export type ChipTone = 'gray' | 'blue' | 'emerald' | 'amber' | 'rose';

/** House 3-layer chip tones (bg-x-50 / text-x-700 / ring-x-200). */
export const CHIP_TONE_CLASSES: Record<string, string> = {
  gray: 'bg-surface-canvas text-text-muted ring-border-soft',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
};

/** Status-dot bg class per tone (glanceable colour, paired with a tooltip). */
const DOT_BY_TONE: Record<ChipTone, string> = {
  gray: 'bg-border-emphasis',
  blue: 'bg-blue-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
};

/**
 * Raw `orders.status` → tone. Values are lowercased before lookup, so the
 * mixed-case DB vocabulary (SHIPPED / delivered / RETURNED / …) all resolve.
 * Unknown statuses fall back to neutral gray (never a crash, never the
 * receiving "unknown" dot).
 */
const ORDER_STATUS_TONE: Record<string, ChipTone> = {
  delivered: 'emerald',
  completed: 'emerald',
  closed: 'emerald',
  shipped: 'blue',
  packed: 'blue',
  processing: 'blue',
  open: 'amber',
  pending: 'amber',
  awaiting: 'amber',
  unpaid: 'amber',
  listed: 'gray',
  paid: 'gray',
  returned: 'rose',
  cancelled: 'rose',
  canceled: 'rose',
  refunded: 'rose',
};

export interface OrderStatusTone {
  tone: ChipTone;
  /** Tailwind bg-* class for the status dot. */
  dot: string;
  /** Title-cased label for the dot's HoverTooltip / status chip. */
  label: string;
}

/** ORDER-status → dot/chip tone SoT (see file header). */
export function orderStatusTone(status: string | null | undefined): OrderStatusTone {
  const raw = String(status ?? '').trim();
  const key = raw.toLowerCase();
  const tone = ORDER_STATUS_TONE[key] ?? 'gray';
  const label = raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : 'No status';
  return { tone, dot: DOT_BY_TONE[tone], label };
}
