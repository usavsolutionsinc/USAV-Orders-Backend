'use client';

import { sidebarHeaderSearchRowClass } from '@/components/layout/header-shell';
import { SearchBar, type SearchBarProps } from '@/components/ui/SearchBar';

/**
 * The ONE search bar for sidebar header rows.
 *
 * Every sidebar — every page, every mode — should use this for its top search
 * row. It bundles the two things that used to drift independently:
 *   1. the canonical 40px band (`sidebarHeaderSearchRowClass`) that lines the
 *      search row up with the pill / mode-rail rows above and below it, and
 *   2. a single locked input height.
 *
 * `size` is deliberately OMITTED from the public props (see {@link SidebarSearchBarProps}),
 * so no sidebar can quietly render a 28px vs 32px field — they are identical by
 * construction. If you need a denser INLINE search (tables, popovers, workspace
 * panels, mobile overlays), use `<SearchBar size="compact" />` directly; that is a
 * different context and is intentionally not part of this contract.
 *
 * Invariant (enforced by sidebar-search-bar.guard.test.ts): the 40px search band
 * `sidebarHeaderSearchRowClass` is referenced ONLY here — never hand-wrapped at a
 * call site — so the band + size can never be applied inconsistently.
 */
export type SidebarSearchBarProps = Omit<SearchBarProps, 'size'>;

export function SidebarSearchBar(props: SidebarSearchBarProps) {
  return (
    <div className={sidebarHeaderSearchRowClass}>
      {/* size intentionally not forwarded — SearchBar's default ('default' / 32px)
          is the canonical sidebar-header height. */}
      <SearchBar {...props} />
    </div>
  );
}
