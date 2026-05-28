/**
 * FBA sidebar mode switcher — mirrors the receiving pattern
 * (RECEIVING_MODE_ITEMS in receiving-sidebar-shared.ts). The three modes flip
 * the `?mode=` URL param on /fba; the sidebar + center content render per mode.
 *
 *   plan    — staff add FNSKUs to today's planned board (PLANNED items)
 *   combine — combiner pulls PACKED items and combines under one FBA shipment ID
 *   shipped — shipped / history
 *
 * Pure data — no JSX. The pill UI consumes FBA_MODE_ITEMS via
 * HorizontalButtonSlider; updateMode() lives in the sidebar panel.
 */

import { ClipboardList, Package, Truck } from '@/components/Icons';
import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

export type FbaMode = 'plan' | 'combine' | 'shipped';

export const FBA_MODES: FbaMode[] = ['plan', 'combine', 'shipped'];

export const FBA_MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'plan',    label: 'Plan',    icon: ClipboardList },
  { id: 'combine', label: 'Combine', icon: Package },
  { id: 'shipped', label: 'Shipped', icon: Truck },
];

/** Resolve the active mode from a raw `?mode=` value, defaulting to combine. */
export function resolveFbaMode(raw: string | null | undefined): FbaMode {
  const v = String(raw || '').trim().toLowerCase();
  return (FBA_MODES as string[]).includes(v) ? (v as FbaMode) : 'combine';
}
