/**
 * Dashboard / queue table row layout: stack title+meta over chips on mobile UI mode,
 * two-column grid on desktop. Uses UIMode `isMobile` (device + touch), not viewport
 * `md:` alone — tablets in mobile mode stay stacked even above 768px width.
 */

export function dashboardOrderRowShellClass(isMobile: boolean): string {
  const stack = 'flex flex-col gap-1.5';
  const grid = isMobile
    ? ''
    : 'md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-2';
  return [stack, grid].filter(Boolean).join(' ');
}

export function dashboardOrderRowChipsClass(isMobile: boolean): string {
  const base = 'flex shrink-0 flex-wrap items-center gap-0.5';
  return isMobile
    ? `${base} w-full justify-end`
    : `${base} pl-4 md:justify-end md:pl-0 md:pr-2`;
}
