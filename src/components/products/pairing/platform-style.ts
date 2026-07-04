// Per-platform display styles for the Product Hub. Single source of truth so
// the channel grid, queue list, and any future surfaces use identical colors.

export interface PlatformStyle {
  label: string;
  chip: string;       // border + bg + text classes
  ring: string;       // accent ring for the channel row left edge
  underline: string;  // CopyChip underline
}

const STYLE: Record<string, PlatformStyle> = {
  zoho:    { label: 'Zoho',    chip: 'border-red-200    bg-red-50    text-red-700',    ring: 'border-l-red-400',    underline: 'border-red-500' },
  amazon:  { label: 'Amazon',  chip: 'border-orange-200 bg-orange-50 text-orange-700', ring: 'border-l-orange-400', underline: 'border-orange-500' },
  fba:     { label: 'FBA',     chip: 'border-orange-200 bg-orange-50 text-orange-700', ring: 'border-l-orange-400', underline: 'border-orange-500' },
  ecwid:   { label: 'Ecwid',   chip: 'border-blue-200   bg-blue-50   text-blue-700',   ring: 'border-l-blue-400',   underline: 'border-blue-500' },
  ebay:    { label: 'eBay',    chip: 'border-yellow-200 bg-yellow-50 text-yellow-800', ring: 'border-l-yellow-400', underline: 'border-yellow-500' },
  walmart: { label: 'Walmart', chip: 'border-amber-200  bg-amber-50  text-amber-800',  ring: 'border-l-amber-400',  underline: 'border-amber-500' },
  mercari: { label: 'Mercari', chip: 'border-purple-200 bg-purple-50 text-purple-700', ring: 'border-l-purple-400', underline: 'border-purple-500' },
  shopify: { label: 'Shopify', chip: 'border-border-default  bg-surface-canvas  text-text-default',  ring: 'border-l-border-emphasis',  underline: 'border-slate-500' },
};

const DEFAULT: PlatformStyle = {
  label: 'Other',
  chip: 'border-border-soft bg-surface-canvas text-text-muted',
  ring: 'border-l-border-emphasis',
  underline: 'border-slate-500',
};

export function platformStyle(platform: string): PlatformStyle {
  const key = platform.toLowerCase();
  if (STYLE[key]) return STYLE[key];
  return {
    ...DEFAULT,
    label: platform.charAt(0).toUpperCase() + platform.slice(1),
  };
}

export const PRODUCT_HUB_PLATFORMS = [
  'amazon',
  'fba',
  'ebay',
  'ecwid',
  'walmart',
  'mercari',
  'shopify',
] as const;
