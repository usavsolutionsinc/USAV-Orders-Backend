/**
 * Photo-label color registry — the single source of truth for a label's tone.
 *
 * A label's `color` column stores a SEMANTIC TOKEN NAME ('blue', 'rose', …),
 * never a hex (house rule: color only from semantic tokens). The chip classes
 * below are written as FULL LITERAL strings so Tailwind's content scanner
 * generates them — `src/lib/**` is in the `content` globs (see tailwind.config.ts),
 * so a class referenced only here is still emitted. Building the class names
 * dynamically (`bg-${token}-50`) would NOT be scanned and would render invisible
 * (the build-gotchas.md "un-scanned class" trap). Keep every variant spelled out.
 *
 * 3-layer chip per ui-design-system.md: `bg-x-50 text-x-700 ring-1 ring-inset ring-x-200`.
 */

export const LABEL_COLOR_TOKENS = [
  'slate',
  'blue',
  'violet',
  'indigo',
  'cyan',
  'teal',
  'emerald',
  'amber',
  'orange',
  'rose',
  'fuchsia',
] as const;

export type LabelColorToken = (typeof LABEL_COLOR_TOKENS)[number];

export const DEFAULT_LABEL_COLOR: LabelColorToken = 'slate';

const LABEL_COLOR_SET = new Set<string>(LABEL_COLOR_TOKENS);

/** True when `color` is one of the allowed semantic tokens. */
export function isLabelColorToken(color: unknown): color is LabelColorToken {
  return typeof color === 'string' && LABEL_COLOR_SET.has(color);
}

/** Coerce any stored value to a safe token (falls back to the default). */
export function normalizeLabelColor(color: string | null | undefined): LabelColorToken {
  return isLabelColorToken(color) ? color : DEFAULT_LABEL_COLOR;
}

/** Full literal chip classes per token (3-layer: bg / text / ring). */
export const LABEL_CHIP_CLASSES: Record<LabelColorToken, string> = {
  slate: 'bg-slate-50 text-slate-700 ring-1 ring-inset ring-slate-200',
  blue: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  violet: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200',
  cyan: 'bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-200',
  teal: 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  orange: 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200',
  rose: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
  fuchsia: 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200',
};

/** Solid dot classes per token (used in the color picker swatch). */
export const LABEL_DOT_CLASSES: Record<LabelColorToken, string> = {
  slate: 'bg-slate-500',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  indigo: 'bg-indigo-500',
  cyan: 'bg-cyan-500',
  teal: 'bg-teal-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  rose: 'bg-rose-500',
  fuchsia: 'bg-fuchsia-500',
};

/** Chip classes for a (possibly invalid/legacy) stored color value. */
export function labelChipClasses(color: string | null | undefined): string {
  return LABEL_CHIP_CLASSES[normalizeLabelColor(color)];
}

/** Dot classes for a (possibly invalid/legacy) stored color value. */
export function labelDotClasses(color: string | null | undefined): string {
  return LABEL_DOT_CLASSES[normalizeLabelColor(color)];
}
