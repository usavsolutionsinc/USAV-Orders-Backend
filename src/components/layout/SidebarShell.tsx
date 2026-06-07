'use client';

import type { ReactNode } from 'react';
import { cn } from '@/utils/_cn';
import { SIDEBAR_GUTTER, sidebarHeaderPillRowClass } from '@/components/layout/header-shell';
import { SidebarSearchBar, type SidebarSearchBarProps } from '@/components/ui/SidebarSearchBar';
import { FilterRefinementBar, type FilterRefinementBarProps } from '@/design-system/components/FilterRefinementBar';

/** The search props the shell forwards to its internal `<SidebarSearchBar>`. */
export type SidebarShellSearch = SidebarSearchBarProps;

/**
 * The ONE layout shell for every sidebar that has a header search.
 *
 * The sidebar-search drift bug was never the search *component* — every panel
 * already used {@link SidebarSearchBar}. It was that each panel hand-positioned
 * it: flush in one, nested inside an `overflow-y-auto` scroll body in another,
 * wrapped in `py-2`/`py-3`/`mt-4` in a third. So the band double-inset, the
 * gaps differed per page, and a `-mx-1.5` patch failed (negative margins clamp
 * inside the scroll body's implied `overflow-x`).
 *
 * `SidebarShell` fixes this by owning the structure and **rendering the search
 * itself** from props — panels can no longer wrap or misposition it. The shape
 * is the proven-good one from Pending (`DashboardManagementPanel`):
 *
 *   h-full flex flex-col overflow-hidden     ← outer column (never scrolls)
 *     headerAbove                            ← pinned: filterControl / eyebrow / mode rail
 *     <SidebarSearchBar/>  (flush)           ← the 40px band, a direct child
 *     headerRows[]  (each a 40px pill band)  ← pinned: tabs / field scopes / chips
 *     headerBelow                            ← pinned, non-banded, OUTSIDE the scroll
 *     children  (flex-1 overflow-y-auto)     ← the only scrolling region
 *
 * Enforced by `sidebar-search-bar.guard.test.ts`: `SidebarSearchBar` may be
 * imported ONLY by this shell, so search can never be rendered directly again.
 */
export interface SidebarShellProps {
  /**
   * Search props — the shell renders `<SidebarSearchBar {...search}/>` flush.
   * Omit for a shell with no header search (scan-only / nav-only panels).
   * Typed as {@link SidebarSearchBarProps} (already `Omit<…, 'size'>`), so a
   * height can never be passed and the 28/32px drift is impossible.
   */
  search?: SidebarSearchBarProps;

  /**
   * Optional configuration for a unified filter bar. When provided, the shell
   * renders a `<FilterRefinementBar variant="sidebar">` directly below the
   * search bar.
   */
  filter?: Omit<FilterRefinementBarProps, 'variant'>;

  /**
   * Focus-grouping wrapper around the rendered search. Receives the shell's own
   * `<SidebarSearchBar>` node so a panel can keep `onFocus`/`onBlur` on a single
   * element that also contains anything the search reveals (e.g. Shipped's
   * "search by" field pills). When omitted, the search renders flush directly.
   */
  searchGroup?: (searchBar: ReactNode) => ReactNode;

  /** Pinned rows ABOVE the search (filterControl, section eyebrow, mode rail).
   *  Rendered raw, in order — the panel decides whether to band/gutter each. */
  headerAbove?: ReactNode;

  /** Pinned 40px rows BELOW the search (tab pills, field-scope pills, chips).
   *  The shell wraps each in `sidebarHeaderPillRowClass`, so panels never
   *  hand-wrap the band. Falsy entries are skipped (conditional rows). */
  headerRows?: Array<ReactNode | false | null | undefined>;

  /** Pinned, non-banded block below the rows and OUTSIDE the scroll body — for
   *  filter popovers / refresh buttons whose absolute menus would otherwise be
   *  clipped by the body's `overflow-y-auto` (e.g. Receiving). */
  headerBelow?: ReactNode;

  /** The scroll body. Shell owns `flex-1 overflow-y-auto ${SIDEBAR_GUTTER} pt-4`. */
  children?: ReactNode;

  /** Extra classes for the scroll body (e.g. `space-y-4`, `scrollbar-hide`, `pb-6`). */
  bodyClassName?: string;

  /** Outer container element. Pass a framer `motion.div` for stagger panels;
   *  `containerProps` (initial/animate/variants) spread onto it. */
  as?: React.ElementType;
  containerProps?: Record<string, unknown>;
  className?: string;
}

export function SidebarShell({
  search,
  filter,
  searchGroup,
  headerAbove,
  headerRows,
  headerBelow,
  children,
  bodyClassName,
  as: Container = 'div',
  containerProps,
  className,
}: SidebarShellProps) {
  const searchBar = search ? <SidebarSearchBar {...search} /> : null;

  return (
    <Container
      {...containerProps}
      className={cn('flex h-full flex-col overflow-hidden', className)}
    >
      {headerAbove}

      {searchBar ? (searchGroup ? searchGroup(searchBar) : searchBar) : null}

      {filter && (
        // Default (glassmorphic pill) variant, floated with the house gutter —
        // matches the /design-demo showroom exactly, not the old flat 40px band.
        <div className={cn('relative z-30 shrink-0 bg-white py-2', SIDEBAR_GUTTER)}>
          <FilterRefinementBar {...filter} />
        </div>
      )}

      {headerRows?.map((row, i) =>
        row ? (
          <div key={i} className={sidebarHeaderPillRowClass}>
            {row}
          </div>
        ) : null,
      )}

      {headerBelow ? <div className="shrink-0">{headerBelow}</div> : null}

      {children != null ? (
        <div className={cn('min-h-0 flex-1 overflow-y-auto', SIDEBAR_GUTTER, 'pt-4', bodyClassName)}>
          {children}
        </div>
      ) : null}
    </Container>
  );
}
