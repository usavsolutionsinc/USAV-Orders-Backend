/**
 * Palette for the hand-built SVG analytics charts.
 *
 * The repo has no charting library — charts are SVG + Framer Motion. SVG
 * `stroke`/`fill` ignore Tailwind utility classes, so:
 *
 *  - **Series hues** (lines, arcs, dots) are fixed brand tones passed inline.
 *    They are chosen to read on BOTH the light canvas and the dark
 *    (`html[data-theme='dark']`) canvas, so they never need a remap.
 *  - **Axes / grid / labels** instead use `currentColor` inside a Tailwind
 *    `text-gray-*` wrapper, so they inherit the global dark-mode remap for free
 *    (no `dark:` prefixes, no JS theme probing). See `.claude/rules/build-gotchas`.
 *
 * Series tones mirror `semanticColors.dashboard` primaries so a station/source
 * keeps the same colour across the gauge, the line chart and the tables.
 */

export const STATION_TONES: Record<string, string> = {
  TECH: '#10b981', // emerald
  PACK: '#3b82f6', // blue
  FBA: '#a855f7', // violet
  UNBOX: '#f97316', // orange
  SALES: '#eab308', // amber
  RECEIVING: '#06b6d4', // cyan
  SHIP: '#6366f1', // indigo
  SYSTEM: '#94a3b8', // slate
  UNKNOWN: '#94a3b8',
};

/** Neutral marker hue for an unlabelled / unknown series (dots, bar fills). */
export const NEUTRAL_TONE = '#94a3b8';
/** Default primary series hue (also the first palette entry). */
export const DEFAULT_SERIES_TONE = '#3b82f6';

const FALLBACK_TONE = '#64748b';

export function stationTone(label: string | null | undefined): string {
  const key = (label ?? '').trim().toUpperCase();
  return STATION_TONES[key] ?? FALLBACK_TONE;
}

/** Sequential palette for arbitrary series (line chart, sources, tiers). */
export const CHART_PALETTE = [
  '#3b82f6', // blue
  '#a855f7', // violet
  '#10b981', // emerald
  '#f97316', // orange
  '#eab308', // amber
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#6366f1', // indigo
];

export function paletteTone(index: number): string {
  return CHART_PALETTE[((index % CHART_PALETTE.length) + CHART_PALETTE.length) % CHART_PALETTE.length];
}

/** A/B/C/D velocity tiers — green (fast) → slate (dormant). */
export const VELOCITY_TIER_TONES: Record<string, string> = {
  A: '#10b981',
  B: '#3b82f6',
  C: '#f59e0b',
  D: '#94a3b8',
};
