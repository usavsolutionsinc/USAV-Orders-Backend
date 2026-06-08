'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  APP_SIDEBAR_NAV,
  getSidebarNavItems,
  getSidebarPageNav,
  type SidebarNavItem,
  type SidebarPageNav,
} from '@/lib/sidebar-navigation';
import { useActiveSidebarMode } from './useActiveSidebarMode';
import { useSidebarModeNav } from './useSidebarModeNav';
import { useRecentPages } from './useRecentPages';
import { MasterNavView } from './MasterNavView';
import type { ReactNode } from 'react';

/** Merge a flat nav item with its mode metadata (if the page has modes). */
function toPageNav(item: SidebarNavItem): SidebarPageNav {
  const page = getSidebarPageNav(item.id);
  return page ? { ...page, icon: item.icon } : item;
}

/**
 * Drop modes the user can't access (per-mode `requires`, e.g. admin sub-sections)
 * so the dropdown matches the page body's own permission filtering. Modes without
 * `requires` are always visible; gated modes need the permission present.
 */
function filterPageModes(page: SidebarPageNav, permissions?: ReadonlySet<string>): SidebarPageNav {
  if (!page.modes) return page;
  const modes = page.modes.filter((mode) => !mode.requires || (permissions?.has(mode.requires) ?? false));
  return modes.length === page.modes.length ? page : { ...page, modes };
}

/**
 * Router-wired master nav container (plan §3). Reads the active page+mode from
 * the URL, writes navigation through `useSidebarModeNav`, and pins recents. This
 * is what P2 mounts into `DashboardSidebar`; P1 exercises it behind a flag.
 *
 * NB: clicking a row genuinely navigates — do not mount this in a pure showroom
 * Bay (use {@link MasterNavView} with local state there instead).
 */
export function MasterNav({
  permissions,
  mobileRestricted = false,
  showModeRail = true,
  railPageIds,
  renderContext,
  onNavigate,
  className,
}: {
  permissions?: ReadonlySet<string>;
  mobileRestricted?: boolean;
  showModeRail?: boolean;
  /** Fired after a page/mode pick (e.g. to close the mobile drawer). */
  onNavigate?: () => void;
  /**
   * Restrict the L2 rail to these page ids (the pages whose panels have already
   * dropped their own pill-row). When omitted, the rail shows for every modeful
   * page. Used during the phased cutover so un-migrated pages keep their own
   * switcher instead of getting a doubled one.
   */
  railPageIds?: ReadonlySet<string>;
  /** `panel` mode only: the workspace body shown below the rail when closed. */
  renderContext?: () => ReactNode;
  className?: string;
}) {
  const { pageId, modeId } = useActiveSidebarMode();
  const navigate = useSidebarModeNav();
  const { recents, pushRecent } = useRecentPages();

  const [open, setOpen] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setExpandedKey(null);
  }, []);

  // Pin the page you land on so it's a recent next time you're elsewhere.
  useEffect(() => {
    pushRecent(pageId);
  }, [pageId, pushRecent]);

  // Close the menu whenever the route resolves to a new page/mode.
  useEffect(() => {
    setOpen(false);
    setExpandedKey(null);
  }, [pageId, modeId]);

  const pages = useMemo(
    () => getSidebarNavItems({ permissions, mobileRestricted }).map(toPageNav).map((page) => filterPageModes(page, permissions)),
    [permissions, mobileRestricted],
  );

  const activePage = useMemo<SidebarPageNav>(() => {
    const found = pages.find((p) => p.id === pageId);
    if (found) return found;
    const fallbackItem = APP_SIDEBAR_NAV.find((item) => item.id === pageId);
    return fallbackItem ? toPageNav(fallbackItem) : pages[0];
  }, [pages, pageId]);

  // Recents = fast switch-back only (never the page you're on). Grouped sections
  // mirror APP_SIDEBAR_NAV order so the active page sits in its real slot (e.g.
  // Orders / Shipping between Operations and Walk-In) with the blue row highlight.
  const recentPages = useMemo(
    () =>
      recents
        .filter((id) => id !== pageId)
        .map((id) => pages.find((p) => p.id === id))
        .filter((p): p is SidebarPageNav => Boolean(p)),
    [recents, pages, pageId],
  );
  const otherPages = useMemo(() => pages, [pages]);

  if (!activePage) return null;

  // Rail shows only for pages cleared for it (or all, when no allowlist).
  const railOn = showModeRail && (!railPageIds || railPageIds.has(activePage.id));

  return (
    <MasterNavView
      activePage={activePage}
      activeModeId={modeId}
      open={open}
      onOpen={() => setOpen(true)}
      recentPages={recentPages}
      otherPages={otherPages}
      expandedKey={expandedKey}
      onToggleRow={setExpandedKey}
      onNavigate={(nextPageId, nextModeId) => {
        navigate(nextPageId, nextModeId);
        setOpen(false);
        setExpandedKey(null);
        onNavigate?.();
      }}
      onRequestClose={closeMenu}
      showModeRail={railOn}
      renderContext={renderContext}
      className={className}
    />
  );
}
