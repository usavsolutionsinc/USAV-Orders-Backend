import { cn } from '@/utils/_cn';

/** Inner bottom hairline shared by receiving sidebar + workspace chrome (not outer border-b). */
export const receivingHeaderHairlineClass = 'shadow-[inset_0_-1px_0_0_#d1d5db]';

/**
 * Canonical left gutter for sidebar sections. Every band, eyebrow, and rail row
 * in a sidebar panel should align to THIS value — pass it through `cn()` so it
 * wins over any baked-in `px-*` on the shared band constants below. Single knob:
 * change it here and every section that references it re-aligns together.
 *
 * 6px (px-1.5) is the house sidebar gutter. The recent-activity rail rows, the
 * mode/scan bands, and the section eyebrows all inset to this same line so the
 * panel reads as one column. Decorative leads (status dots, the scan icon)
 * inset *within* their container from this edge — they never add to it.
 */
export const SIDEBAR_GUTTER = 'px-1.5';

/** 40px identity / mode-pill row — aligns sidebar mode slider with workspace PaneHeader. */
export const receivingIdentityBandClass = `flex h-[40px] shrink-0 items-center bg-white px-3 ${receivingHeaderHairlineClass}`;

/** 40px scan band — same grid height as all other header bands. */
export const receivingScanBandClass = `flex h-[40px] shrink-0 items-center px-3 ${receivingHeaderHairlineClass}`;

export const sidebarHeaderBandClass = `shrink-0 bg-white ${receivingHeaderHairlineClass}`;
// 40px pill/tab row — matches the dashboard's HorizontalButtonSlider band height.
// Sidebar variant of receivingIdentityBandClass: same 40px grid + hairline, but
// re-gutters to SIDEBAR_GUTTER so every sidebar panel aligns on one left column.
// The workspace keeps receivingIdentityBandClass directly (12px), so this only
// moves sidebar chrome — the two panes stay decoupled.
export const sidebarHeaderPillRowClass = cn(receivingIdentityBandClass, SIDEBAR_GUTTER);
/**
 * Sticky `nav` pill band inside a scrolling sidebar body — transparent (no bg
 * fill) so the active pill's drop shadow renders over rail rows beneath.
 * Pair with `HorizontalButtonSlider variant="nav" dense overlay`.
 */
export const sidebarNavOverlayBandClass = cn(
  'sticky top-0 z-10 flex shrink-0 items-center overflow-visible pt-1 pb-2.5',
  SIDEBAR_GUTTER,
);
export const sidebarHeaderRowClass = `flex min-h-[44px] items-center ${SIDEBAR_GUTTER} py-1`;
// 40px search-bar band — locks the sidebar search row to the SAME 40px grid as
// sidebarHeaderPillRowClass so a search row stacked above a pill/tab row reads as
// one continuous column instead of two bands of slightly different height. Use this
// (not sidebarHeaderRowClass, which is min-h-[44px]) wherever a search bar is the
// pinned header chrome of a sidebar panel.
export const sidebarHeaderSearchRowClass = `flex h-[40px] shrink-0 items-center ${SIDEBAR_GUTTER}`;
export const sidebarHeaderControlClass = 'h-full min-h-[44px] w-full appearance-none bg-white px-3 py-1 pr-8 text-left text-micro font-black uppercase tracking-wider text-gray-700 outline-none transition-colors hover:bg-gray-50';

export const mainStickyHeaderClass = 'shrink-0 sticky top-0 z-10 border-b border-gray-100 bg-white/95 backdrop-blur-sm';
export const mainStickyHeaderRowClass = 'flex min-h-[44px] items-center justify-between gap-4 px-4 py-1';
export const mainStickyHeaderShellRowClass = 'flex h-[44px] items-center justify-between gap-4 px-4';
/** 40px queue banner — matches sidebar identity bands (receivingIdentityBandClass). */
export const mainStickyHeaderCompactRowClass = 'flex h-[40px] items-center justify-between gap-4 px-4';
