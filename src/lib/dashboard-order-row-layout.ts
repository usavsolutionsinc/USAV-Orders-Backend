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
  return isMobile
    ? `${base} w-full justify-end`
    : `${base} justify-end pr-2`;
}
