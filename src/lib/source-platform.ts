/**
 * Single source of truth for a receiving `source_platform` value → its display
 * name + chip tone. Before this module the same platform read three different
 * ways: the pill said "AliExp" while the printed label said "AliExpress", the
 * order-derived helper returned a lowercase "ebay", and "ECWID" vs "ECWID-RS"
 * drifted between surfaces. Everything that turns a platform value into a name
 * or a color now derives from {@link SOURCE_PLATFORMS} so a platform can never
 * present two ways again. Mirrors the condition-label SoT pattern.
 */

export interface SourcePlatformMeta {
  /** Stored `source_platform` value (lowercase, what the DB holds). */
  value: string;
  /** Canonical display name — the ONE label shown anywhere a platform appears. */
  label: string;
  /** Tailwind text tone for the chip's external-link icon. */
  text: string;
  /** Tailwind border tone for the chip's underline accent. */
  border: string;
}

/**
 * Canonical platform registry, display order left → right. The pill options,
 * the printed label, the condensed-row listing chip, and any tone lookup read
 * from here. Add a platform once, in this list.
 */
export const SOURCE_PLATFORMS: SourcePlatformMeta[] = [
  { value: 'ebay',       label: 'eBay',       text: 'text-yellow-500', border: 'border-yellow-400' },
  { value: 'amazon',     label: 'Amazon',     text: 'text-orange-600', border: 'border-orange-600' },
  { value: 'fba',        label: 'FBA',        text: 'text-orange-600', border: 'border-orange-600' },
  { value: 'aliexpress', label: 'AliExpress', text: 'text-red-500',    border: 'border-red-500' },
  { value: 'walmart',    label: 'Walmart',    text: 'text-amber-700',  border: 'border-amber-700' },
  { value: 'goodwill',   label: 'Goodwill',   text: 'text-sky-600',    border: 'border-sky-600' },
  // ECWID-RS (not plain ECWID): today this pill only appears when the carton
  // was paired with an Ecwid repair-service (-RS) order.
  { value: 'ecwid',      label: 'ECWID-RS',   text: 'text-blue-600',   border: 'border-blue-600' },
  { value: 'other',      label: 'Other',      text: 'text-slate-500',  border: 'border-slate-400' },
];

/** Fallback tone/label for an empty/unknown platform value. */
export const UNKNOWN_PLATFORM: SourcePlatformMeta = {
  value: '',
  label: 'Unknown',
  text: 'text-slate-400',
  border: 'border-slate-300',
};

const BY_VALUE = new Map(SOURCE_PLATFORMS.map((p) => [p.value, p]));

/** Resolve a `source_platform` value to its canonical meta (tone + label). */
export function sourcePlatformMeta(value: string | null | undefined): SourcePlatformMeta {
  const key = String(value ?? '').trim().toLowerCase();
  return BY_VALUE.get(key) ?? UNKNOWN_PLATFORM;
}

/** Canonical display name for a `source_platform` value. */
export function sourcePlatformLabel(value: string | null | undefined): string {
  return sourcePlatformMeta(value).label;
}
