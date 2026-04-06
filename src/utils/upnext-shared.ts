import { SLIDER_PRESETS, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

// ─── Types ──────────────────────────────────────────────────────────────────

export type UpNextTabId = 'all' | 'orders' | 'repair' | 'fba' | 'stock' | 'receiving';

// ─── Helpers ────────────────────────────────────────────────────────────────

export function isOutOfStock(order: { out_of_stock: string | null }): boolean {
  return !!String(order.out_of_stock || '').trim();
}

export function getRepairSortValue(deadlineAt: string | null | undefined, fallbackDateTime?: string | null | undefined): number {
  const source = deadlineAt || fallbackDateTime;
  if (!source) return Number.POSITIVE_INFINITY;
  try {
    const parsed = typeof source === 'string' && source.startsWith('"') ? JSON.parse(source) : source;
    const value = typeof parsed === 'object' && parsed?.start ? parsed.start : parsed;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function matchesSearch(needle: string, fields: (string | null | undefined)[]): boolean {
  const trimmed = needle.trim();
  if (!trimmed) return true;
  const tokens = trimmed.toLowerCase().split(/\s+/);
  const haystack = fields.map((f) => (f || '').toLowerCase()).join(' ');
  return tokens.every((t) => haystack.includes(t));
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const TAB_ORDER: UpNextTabId[] = ['all', 'orders', 'fba', 'repair', 'stock', 'receiving'];

export const SORT_FILTER_IDS = new Set(['must_go', 'newest', 'oldest']);

export const QUICK_FILTER_ITEMS: Record<UpNextTabId, HorizontalSliderItem[]> = {
  all:       [SLIDER_PRESETS.mustGo, SLIDER_PRESETS.newest, SLIDER_PRESETS.oldest],
  orders:    [SLIDER_PRESETS.all, SLIDER_PRESETS.amazon, SLIDER_PRESETS.ebay, SLIDER_PRESETS.ecwid],
  fba:       [SLIDER_PRESETS.pending],
  repair:    [SLIDER_PRESETS.repair],
  stock:     [SLIDER_PRESETS.stock],
  receiving: [SLIDER_PRESETS.receiving],
};
