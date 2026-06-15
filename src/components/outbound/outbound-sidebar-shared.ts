import { Printer, Barcode } from '@/components/Icons';
import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

export type OutboundMode = 'labels' | 'scan-out';

export const OUTBOUND_PATH = '/outbound';

/** Params cleared when switching modes. */
export const OUTBOUND_MODE_SCOPED_PARAMS = ['q', 'open', 'sort', 'ostatus'] as const;

export const OUTBOUND_MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'labels', label: 'Labels', icon: Printer },
  { id: 'scan-out', label: 'Scan out', icon: Barcode },
];

export type OutboundSort = 'priority' | 'newest';

export const OUTBOUND_SORT_OPTIONS: { id: OutboundSort; label: string }[] = [
  { id: 'priority', label: 'Priority (due soon)' },
  { id: 'newest', label: 'Newest first' },
];

export function parseOutboundMode(raw: string | null): OutboundMode {
  return raw === 'scan-out' ? 'scan-out' : 'labels';
}

export function parseOutboundSort(raw: string | null): OutboundSort {
  return raw === 'newest' ? 'newest' : 'priority';
}
