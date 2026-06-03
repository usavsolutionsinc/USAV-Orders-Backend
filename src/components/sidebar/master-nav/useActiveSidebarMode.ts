'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { getSidebarRouteKey, resolveSidebarMode } from '@/lib/sidebar-navigation';

/**
 * Single resolver for "which page + which mode am I on" — reads the live URL via
 * the same `SIDEBAR_PAGE_NAV.resolveMode()` the panels will adopt, so the closed
 * header label and the L2 rail's active pill stay in lockstep with deep-links.
 * `modeId` is `null` for single-surface pages (no mode row).
 */
export function useActiveSidebarMode(): { pageId: string; modeId: string | null } {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageId = getSidebarRouteKey(pathname);
  const modeId = resolveSidebarMode(pageId, {
    pathname: pathname ?? '',
    params: searchParams,
  });
  return { pageId, modeId };
}
