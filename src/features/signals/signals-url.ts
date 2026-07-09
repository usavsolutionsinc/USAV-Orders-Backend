/**
 * URL helpers for Signals as an Operations mode (`/operations?mode=signals`).
 *
 * Timeline is the default sub-view (omit `signalsView`). Browse sets
 * `signalsView=browse`. Legacy `/signals?mode=browse` redirects through the
 * retired route page.
 */

import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

export type SignalsView = 'timeline' | 'browse';

export const SIGNALS_VIEW_ITEMS: HorizontalSliderItem[] = [
  { id: 'timeline', label: 'Timeline', tone: 'blue' },
  { id: 'browse', label: 'Browse', tone: 'blue' },
];

export function parseSignalsView(raw: string | null | undefined): SignalsView {
  return raw === 'browse' ? 'browse' : 'timeline';
}

/** Build `/operations?mode=signals…` from current params + patch. */
export function buildOperationsSignalsHref(
  searchParams: URLSearchParams,
  patch?: (sp: URLSearchParams) => void,
): string {
  const sp = new URLSearchParams(searchParams.toString());
  sp.set('mode', 'signals');
  patch?.(sp);
  if (sp.get('signalsView') === 'timeline') sp.delete('signalsView');
  const qs = sp.toString();
  return qs ? `/operations?${qs}` : '/operations?mode=signals';
}

export function replaceOperationsSignalsUrl(
  router: AppRouterInstance,
  searchParams: URLSearchParams,
  patch?: (sp: URLSearchParams) => void,
): void {
  router.replace(buildOperationsSignalsHref(searchParams, patch), { scroll: false });
}
