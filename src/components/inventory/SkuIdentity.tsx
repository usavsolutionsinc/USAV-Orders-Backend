/**
 * SkuIdentity — shared dual-SKU display block.
 * ────────────────────────────────────────────────────────────────────
 * Renders the internal Zoho/catalog SKU as the primary identifier with
 * each connected marketplace SKU (Ecwid, Amazon, eBay, etc.) shown as
 * a labeled secondary chip below.
 *
 * Why: warehouse units carry the internal canonical SKU on the shelf,
 * but customers reference the marketplace SKU on their orders. Showing
 * both makes the link explicit so pickers and CS share one mental model.
 *
 * Usage:
 *   <SkuIdentity
 *     canonicalSku="00001-BK"
 *     productTitle="Bose VCS-10 Center Channel Speaker Black"
 *     platforms={[
 *       { platform: 'ecwid',  platformSku: '01279-B' },
 *       { platform: 'amazon', platformSku: 'ZB-AFHB-Y58D' },
 *     ]}
 *   />
 *
 * Variants:
 *   default — full block with product title, large canonical SKU, chip row.
 *   compact — single line, smaller canonical SKU, tight chip row.
 *             For dense lists (pick queue rows, table cells, etc.).
 */

import { HoverTooltip } from '@/components/ui/HoverTooltip';

export interface SkuPlatformMapping {
  platform: string;             // 'amazon' | 'ecwid' | 'ebay' | 'fba' | …
  platformSku: string | null;   // marketplace SKU/MSKU (or null when only an item id exists)
  platformItemId?: string | null; // e.g. Amazon ASIN, ebay item id — shown as fallback when SKU is null
  accountName?: string | null;  // e.g. "ebay-us-main" vs "ebay-us-warehouse2" — disambiguates duplicates
}

interface SkuIdentityProps {
  canonicalSku: string;
  productTitle?: string | null;
  platforms?: SkuPlatformMapping[];
  variant?: 'default' | 'compact';
  className?: string;
}

// Aligned with PLATFORM_COLORS in src/utils/order-platform.ts so the
// palette stays consistent across the app.
const PLATFORM_CHIP_CLASSES: Record<string, string> = {
  amazon:  'border-orange-200 bg-orange-50 text-orange-700',
  fba:     'border-orange-200 bg-orange-50 text-orange-700',
  ecwid:   'border-blue-200   bg-blue-50   text-blue-700',
  ebay:    'border-yellow-200 bg-yellow-50 text-yellow-800',
  walmart: 'border-amber-200  bg-amber-50  text-amber-800',
  mercari: 'border-purple-200 bg-purple-50 text-purple-700',
  shopify: 'border-border-default  bg-surface-canvas  text-text-default',
  zoho:    'border-red-200    bg-red-50    text-red-700',
};
const DEFAULT_PLATFORM_CHIP = 'border-border-soft bg-surface-canvas text-text-muted';

function platformChipClass(platform: string): string {
  return PLATFORM_CHIP_CLASSES[platform.toLowerCase()] || DEFAULT_PLATFORM_CHIP;
}

function platformLabel(platform: string): string {
  const p = platform.toLowerCase();
  if (p === 'amazon') return 'Amazon';
  if (p === 'fba')    return 'FBA';
  if (p === 'ebay')   return 'eBay';
  if (p === 'ecwid')  return 'Ecwid';
  if (p === 'walmart') return 'Walmart';
  if (p === 'mercari') return 'Mercari';
  if (p === 'shopify') return 'Shopify';
  // Fallback: title-case the raw string.
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

export function SkuIdentity({
  canonicalSku,
  productTitle,
  platforms,
  variant = 'default',
  className = '',
}: SkuIdentityProps) {
  const visiblePlatforms = (platforms ?? []).filter(
    (p) => (p.platformSku && p.platformSku.trim()) || (p.platformItemId && p.platformItemId.trim()),
  );

  if (variant === 'compact') {
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        <span className="font-mono text-sm font-bold tabular-nums text-text-default">{canonicalSku}</span>
        <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider ${platformChipClass('zoho')}`}>
          Zoho
        </span>
        {visiblePlatforms.map((p, i) => (
          <PlatformSkuChip key={`${p.platform}-${i}`} mapping={p} dense />
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      {productTitle && (
        <p className="text-sm font-semibold leading-snug text-text-default">{productTitle}</p>
      )}
      <div className={`flex items-baseline gap-2 ${productTitle ? 'mt-1.5' : ''}`}>
        <span className="font-mono text-2xl font-extrabold tabular-nums tracking-tight text-text-default">
          {canonicalSku}
        </span>
        <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider ${platformChipClass('zoho')}`}>
          Zoho
        </span>
      </div>
      {visiblePlatforms.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {visiblePlatforms.map((p, i) => (
            <PlatformSkuChip key={`${p.platform}-${i}`} mapping={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlatformSkuChip({ mapping, dense = false }: { mapping: SkuPlatformMapping; dense?: boolean }) {
  const value = (mapping.platformSku && mapping.platformSku.trim()) || mapping.platformItemId || '';
  const sizing = dense ? 'px-1.5 py-0.5 text-micro' : 'px-2 py-0.5 text-xs';
  return (
    <HoverTooltip
      label={`${platformLabel(mapping.platform)} · ${value}${mapping.platformItemId ? ` · ${mapping.platformItemId}` : ''}`}
      asChild
    >
      <span
        className={`inline-flex items-center gap-1 rounded-md border font-medium ${sizing} ${platformChipClass(mapping.platform)}`}
      >
        <span className="font-semibold uppercase tracking-wider">{platformLabel(mapping.platform)}</span>
        <span className="font-mono tabular-nums">{value}</span>
      </span>
    </HoverTooltip>
  );
}
