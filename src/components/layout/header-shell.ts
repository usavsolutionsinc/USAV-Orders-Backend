/** Inner bottom hairline shared by receiving sidebar + workspace chrome (not outer border-b). */
export const receivingHeaderHairlineClass = 'shadow-[inset_0_-1px_0_0_#d1d5db]';

/** 40px identity / mode-pill row — aligns sidebar mode slider with workspace PaneHeader. */
export const receivingIdentityBandClass = `flex h-[40px] shrink-0 items-center bg-white px-3 ${receivingHeaderHairlineClass}`;

/** 40px scan band — same grid height as all other header bands. */
export const receivingScanBandClass = `flex h-[40px] shrink-0 items-center px-3 ${receivingHeaderHairlineClass}`;

export const sidebarHeaderBandClass = `shrink-0 bg-white ${receivingHeaderHairlineClass}`;
// 40px pill/tab row — matches the dashboard's HorizontalButtonSlider band height
export const sidebarHeaderPillRowClass = receivingIdentityBandClass;
export const sidebarHeaderRowClass = 'flex min-h-[44px] items-center px-3 py-1';
export const sidebarHeaderControlClass = 'h-full min-h-[44px] w-full appearance-none bg-white px-3 py-1 pr-8 text-left text-micro font-black uppercase tracking-wider text-gray-700 outline-none transition-colors hover:bg-gray-50';

export const mainStickyHeaderClass = 'shrink-0 sticky top-0 z-10 border-b border-gray-100 bg-white/95 backdrop-blur-sm';
export const mainStickyHeaderRowClass = 'flex min-h-[44px] items-center justify-between gap-4 px-4 py-1';
export const mainStickyHeaderShellRowClass = 'flex h-[44px] items-center justify-between gap-4 px-4';
