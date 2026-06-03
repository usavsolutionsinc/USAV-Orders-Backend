'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  applyModeTarget,
  getSidebarPageNav,
  getSidebarRouteKey,
} from '@/lib/sidebar-navigation';

/**
 * The write half of the master nav (plan §3.3 + D2). `navigate(pageId, modeId?)`:
 *   • No `modeId` → land on the page's bare href (resolves to its default mode).
 *   • With `modeId` → apply that mode's `to()` on top of the current params.
 *   • Page change → `router.push` (new history entry); same-page mode flip →
 *     `router.replace` (matches what every panel does today, so back-button
 *     semantics are unchanged).
 * Unrelated query params are preserved on same-page flips via `applyModeTarget`.
 */
export function useSidebarModeNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (pageId: string, modeId?: string) => {
      const page = getSidebarPageNav(pageId);
      const samePage = getSidebarRouteKey(pathname) === pageId;

      // Single-surface page, unknown page, or "just go there": bare href.
      if (!page || !modeId) {
        const href = page?.href ?? pathname ?? '/';
        if (samePage && !modeId) return; // already here, nothing to do
        router.push(href);
        return;
      }

      const mode = page.modes?.find((m) => m.id === modeId);
      if (!mode) {
        router.push(page.href);
        return;
      }

      const base = samePage
        ? { pathname: pathname ?? page.href, params: searchParams }
        : { pathname: page.href, params: new URLSearchParams() };
      const { pathname: nextPath, search } = applyModeTarget(base, mode.to());
      const url = search ? `${nextPath}?${search}` : nextPath;

      if (samePage) router.replace(url);
      else router.push(url);
    },
    [router, pathname, searchParams],
  );
}
