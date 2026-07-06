'use client';

/**
 * useOrgNavItems — the sidebar nav list with the per-org override applied
 * (operator-surfaces refactor Phase 4). Fetches the org's active `nav_definitions`
 * override via `/api/nav` and merges it onto the static `getSidebarNavItems`
 * result. Falls back to the static defaults on load/error/no-override, so a page
 * that adopts this hook behaves exactly as before until an org publishes an
 * override — the safe default.
 */

import { useQuery } from '@tanstack/react-query';
import {
  getSidebarNavItems,
  type GetSidebarNavItemsOpts,
  type SidebarNavItem,
} from '@/lib/sidebar-navigation';
import { mergeOrgNav, parseNavDefinition, type NavDefinition } from '@/lib/nav/org-nav';

async function fetchOrgNav(): Promise<NavDefinition | null> {
  try {
    const res = await fetch('/api/nav', { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { definition?: unknown };
    return json?.definition ? parseNavDefinition(json.definition) : null;
  } catch {
    return null;
  }
}

export function orgNavQuery() {
  return {
    queryKey: ['org-nav'] as const,
    queryFn: fetchOrgNav,
    // Nav changes on publish; long staleTime, no refetch loop.
    staleTime: 5 * 60_000,
  };
}

export function useOrgNavItems(opts: GetSidebarNavItemsOpts = {}): SidebarNavItem[] {
  const { data } = useQuery(orgNavQuery());
  // getSidebarNavItems is cheap + already permission/mobile-filtered; the merge
  // only hides/renames/reorders the visible items.
  return mergeOrgNav(getSidebarNavItems(opts), data ?? null);
}
