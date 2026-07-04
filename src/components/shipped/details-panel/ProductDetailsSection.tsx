'use client';

import { useEffect, useMemo, useState } from 'react';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { useOrderAssignment } from '@/hooks';
import { useSkuIdentity } from '@/hooks/useSkuIdentity';
import { CopyableValueFieldBlock } from '@/components/shipped/details-panel/blocks/CopyableValueFieldBlock';
import { ContextualManualLinkRow } from '@/components/shipped/details-panel/blocks/ContextualManualLinkRow';
import { ConditionPills } from '@/components/receiving/workspace/ConditionPills';
import { FnskuCatalogInfoPanel } from '@/components/fba/FnskuCatalogInfoPanel';
import { getFnskuCatalogValue, isFnskuCatalogContext } from '@/utils/fnsku-catalog';
import { CopyChip } from '@/components/ui/CopyChip';
import { ShippingEditableRow, type EditableShippingFields } from '@/components/shipped/details-panel/ShippingInformationSection';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';

type ConditionGrade = 'BRAND_NEW' | 'LIKE_NEW' | 'REFURBISHED' | 'USED_A' | 'USED_B' | 'USED_C' | 'PARTS';

// Shipped orders historically stored the coarse 3-grade scale (NEW / USED /
// PARTS); receiving switched to the 5-grade BRAND_NEW / USED_A/B/C / PARTS
// scale. This maps legacy values forward so the picker can show the right
// pill for existing rows. Unmapped values default to USED_B (the most
// neutral "in service" grade).
function normalizeCondition(value: string | null | undefined): ConditionGrade {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (normalized === 'BRAND_NEW' || normalized === 'NEW') return 'BRAND_NEW';
  if (normalized === 'LIKE_NEW') return 'LIKE_NEW';
  if (normalized === 'REFURBISHED' || normalized === 'REFURB') return 'REFURBISHED';
  if (normalized === 'USED_A') return 'USED_A';
  if (normalized === 'USED_B' || normalized === 'USED') return 'USED_B';
  if (normalized === 'USED_C') return 'USED_C';
  if (normalized === 'PARTS' || normalized === 'PARTS_USED') return 'PARTS';
  return 'USED_B';
}

// Per-platform CopyChip styling. Underline color matches the chip palette used
// by SkuIdentity / order-platform.ts so the panel stays consistent with the
// rest of the app.
const PLATFORM_STYLE: Record<
  string,
  { label: string; underline: string; chip: string }
> = {
  zoho:    { label: 'Zoho',    underline: 'border-red-500',     chip: 'border-red-200    bg-red-50    text-red-700' },
  amazon:  { label: 'Amazon',  underline: 'border-orange-500',  chip: 'border-orange-200 bg-orange-50 text-orange-700' },
  fba:     { label: 'FBA',     underline: 'border-orange-500',  chip: 'border-orange-200 bg-orange-50 text-orange-700' },
  ecwid:   { label: 'Ecwid',   underline: 'border-blue-500',    chip: 'border-blue-200   bg-blue-50   text-blue-700' },
  ebay:    { label: 'eBay',    underline: 'border-yellow-500',  chip: 'border-yellow-200 bg-yellow-50 text-yellow-800' },
  walmart: { label: 'Walmart', underline: 'border-amber-500',   chip: 'border-amber-200  bg-amber-50  text-amber-800' },
  mercari: { label: 'Mercari', underline: 'border-purple-500',  chip: 'border-purple-200 bg-purple-50 text-purple-700' },
  shopify: { label: 'Shopify', underline: 'border-slate-500',   chip: 'border-border-default  bg-surface-canvas  text-text-default' },
};
const DEFAULT_STYLE = {
  label: 'Other',
  underline: 'border-slate-500',
  chip: 'border-border-soft bg-surface-canvas text-text-muted',
};

function styleFor(platform: string) {
  return PLATFORM_STYLE[platform.toLowerCase()] || {
    ...DEFAULT_STYLE,
    label: platform.charAt(0).toUpperCase() + platform.slice(1),
  };
}

interface PlatformSkuEntry {
  platform: string;
  value: string;
  itemId?: string | null;
  accountName?: string | null;
}

function PlatformSkuRow({ entry }: { entry: PlatformSkuEntry }) {
  const style = styleFor(entry.platform);
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex w-[88px] shrink-0 flex-col items-start gap-0.5">
        <span
          className={`inline-flex w-full items-center justify-center rounded-md border px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider ${style.chip}`}
        >
          {style.label}
        </span>
        {entry.accountName && (
          <span className="w-full truncate text-eyebrow font-medium uppercase tracking-wider text-text-faint">
            {entry.accountName}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <CopyChip
          value={entry.value}
          display={entry.value}
          underlineClass={style.underline}
          width="w-fit max-w-full"
          truncateDisplay={false}
        />
      </div>
      {entry.itemId && entry.itemId !== entry.value && (
        <span className="shrink-0 font-mono text-micro text-text-faint">
          {entry.itemId}
        </span>
      )}
    </div>
  );
}

function SkuPlatformList({
  canonicalSku,
  platforms,
  loading,
}: {
  canonicalSku: string;
  platforms: PlatformSkuEntry[];
  loading: boolean;
}) {
  const rows = useMemo<PlatformSkuEntry[]>(
    () => [
      ...(canonicalSku ? [{ platform: 'zoho', value: canonicalSku } satisfies PlatformSkuEntry] : []),
      ...platforms,
    ],
    [canonicalSku, platforms],
  );

  if (loading && rows.length === 0) {
    return (
      <div className="py-2">
        <div className="h-6 w-32 animate-pulse rounded bg-surface-sunken" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-2 text-xs text-text-faint">No SKU mappings</div>
    );
  }

  return (
    <div className="py-1.5">
      {rows.map((row, i) => (
        <PlatformSkuRow key={`${row.platform}-${i}-${row.value}`} entry={row} />
      ))}
    </div>
  );
}

export function ProductDetailsSection({
  shipped,
  editableShippingFields,
}: {
  shipped: ShippedOrder;
  editableShippingFields?: EditableShippingFields;
}) {
  const [conditionValue, setConditionValue] = useState<ConditionGrade>(normalizeCondition(shipped.condition));
  const [isSavingCondition, setIsSavingCondition] = useState(false);
  const orderAssignmentMutation = useOrderAssignment();
  const skuIdentity = useSkuIdentity(shipped.sku, shipped.account_source);

  useEffect(() => {
    setConditionValue(normalizeCondition(shipped.condition));
  }, [shipped.id, shipped.condition]);

  const handleConditionChange = async (nextCondition: string) => {
    if (isSavingCondition) return;
    const grade = normalizeCondition(nextCondition);
    setConditionValue(grade);
    setIsSavingCondition(true);
    try {
      await orderAssignmentMutation.mutateAsync({
        orderId: shipped.id,
        condition: grade,
      });
    } catch (error) {
      console.error('Failed to update condition:', error);
    } finally {
      setIsSavingCondition(false);
    }
  };

  const { getExternalUrlByItemNumber } = useExternalItemUrl();
  const fnskuCatalogValue = getFnskuCatalogValue(shipped);
  const showFnskuCatalog = isFnskuCatalogContext(shipped) && Boolean(fnskuCatalogValue);

  const refreshAfterCatalogSave = () => {
    window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    window.dispatchEvent(new Event('usav-refresh-data'));
  };

  const canonicalSku = (skuIdentity.canonicalSku || shipped.sku || '').trim();
  const platformEntries = useMemo<PlatformSkuEntry[]>(() => {
    const list: PlatformSkuEntry[] = [];
    for (const p of skuIdentity.platforms || []) {
      const value = (p.platformSku && p.platformSku.trim()) || (p.platformItemId || '').trim();
      if (!value) continue;
      list.push({
        platform: p.platform,
        value,
        itemId: p.platformItemId ?? null,
        accountName: p.accountName ?? null,
      });
    }
    return list;
  }, [skuIdentity.platforms]);

  const itemNumberRow = editableShippingFields ? (
    <ShippingEditableRow
      label="Item Number"
      value={editableShippingFields.itemNumber}
      placeholder="Item Number"
      onChange={editableShippingFields.onItemNumberChange}
      onBlur={editableShippingFields.onBlur}
      externalUrl={getExternalUrlByItemNumber(editableShippingFields.itemNumber)}
      allowEdit={false}
    />
  ) : null;

  return (
    <section className="space-y-3">
      {showFnskuCatalog ? (
        <div className="space-y-3">
          <FnskuCatalogInfoPanel
            fnsku={fnskuCatalogValue}
            productTitle={shipped.product_title}
            condition={shipped.condition}
            sku={shipped.sku}
            asin={(shipped as { asin?: string | null }).asin ?? null}
            sourceKey={shipped.id}
            onCatalogSaved={refreshAfterCatalogSave}
          />
          <ContextualManualLinkRow
            sku={shipped.sku}
            itemNumber={shipped.item_number}
            allowEmbeddedItemNumberInput={false}
          />
        </div>
      ) : (
        <div className="space-y-0">
          <CopyableValueFieldBlock
            label="Product Title"
            value={shipped.product_title || 'Not provided'}
            noTruncate
            variant="flat"
            valueClassName="font-dm-sans"
          />

          <div className="border-b border-border-hairline py-3">
            {isSavingCondition ? (
              <div className="mb-1 flex justify-end">
                <span className="text-micro font-black uppercase tracking-wide text-blue-600">Saving</span>
              </div>
            ) : null}
            <ConditionPills value={conditionValue} onChange={handleConditionChange} />
          </div>

          {itemNumberRow}

          <ContextualManualLinkRow
            sku={shipped.sku}
            itemNumber={shipped.item_number}
            allowEmbeddedItemNumberInput={false}
          />

          <SkuPlatformList
            canonicalSku={canonicalSku}
            platforms={platformEntries}
            loading={skuIdentity.loading}
          />
        </div>
      )}
    </section>
  );
}
