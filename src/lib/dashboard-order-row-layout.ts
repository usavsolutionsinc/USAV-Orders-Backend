/**
 * Dashboard / queue table row layout: stack title+meta over chips on mobile UI mode,
 * two-column grid on desktop. Driven by UIMode `isMobile` directly — desktop mode
 * always renders one row, regardless of viewport width (so a narrow desktop window
 * or an open details panel does not collapse the chips onto a second line).
 */

export function dashboardOrderRowShellClass(isMobile: boolean): string {
  return isMobile
    ? 'flex flex-col gap-1.5'
    : 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2';
}

export function dashboardOrderRowChipsClass(isMobile: boolean): string {
  const base = 'flex shrink-0 flex-wrap items-center gap-0.5';
  // Desktop: the trailing chip carries a 6px right gutter (CopyChip's `px-1.5`).
  // `-mr-1.5` pulls the cluster's right edge back by that gutter so whatever the
  // last chip is — serial, tracking, FNSKU — its value lands flush with the
  // day-group count above it (which sits at the same `pr-1` inset). Stays within
  // the row's `px-3` padding, so no horizontal overflow.
  return isMobile
    ? `${base} w-full justify-end`
    : `${base} justify-end pr-1 -mr-1.5`;
}
