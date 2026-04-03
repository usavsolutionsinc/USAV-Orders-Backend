'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from '@/components/Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { useOrderAssignment } from '@/hooks';
import { CopyableValueFieldBlock } from '@/components/shipped/details-panel/blocks/CopyableValueFieldBlock';
import { ContextualManualLinkRow } from '@/components/shipped/details-panel/blocks/ContextualManualLinkRow';
import { DetailsPanelRow } from '@/design-system/components/DetailsPanelRow';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { FnskuCatalogInfoPanel } from '@/components/fba/FnskuCatalogInfoPanel';
import { getFnskuCatalogValue, isFnskuCatalogContext } from '@/utils/fnsku-catalog';

type ConditionValue = 'NEW' | 'USED' | 'PARTS';

const CONDITION_OPTIONS: Array<{ value: ConditionValue; label: string }> = [
  { value: 'NEW', label: 'NEW' },
  { value: 'USED', label: 'USED' },
  { value: 'PARTS', label: 'PARTS' },
];

function normalizeCondition(value: string | null | undefined): ConditionValue {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'NEW') return 'NEW';
  if (normalized === 'PARTS' || normalized === 'PARTS USED') return 'PARTS';
  if (normalized === 'USED') return 'USED';
  return 'USED';
}

export function ProductDetailsSection({
  shipped,
}: {
  shipped: ShippedOrder;
}) {
  const hasOutOfStock = !!String((shipped as any).out_of_stock || '').trim();
  const [conditionValue, setConditionValue] = useState<ConditionValue>(normalizeCondition(shipped.condition));
  const [isSavingCondition, setIsSavingCondition] = useState(false);
  const orderAssignmentMutation = useOrderAssignment();

  useEffect(() => {
    setConditionValue(normalizeCondition(shipped.condition));
  }, [shipped.id, shipped.condition]);

  const handleConditionChange = async (nextCondition: ConditionValue) => {
    if (isSavingCondition) return;
    setConditionValue(nextCondition);
    setIsSavingCondition(true);
    try {
      await orderAssignmentMutation.mutateAsync({
        orderId: shipped.id,
        condition: nextCondition,
      });
    } catch (error) {
      console.error('Failed to update condition:', error);
    } finally {
      setIsSavingCondition(false);
    }
  };

  const fnskuCatalogValue = getFnskuCatalogValue(shipped);
  const showFnskuCatalog = isFnskuCatalogContext(shipped) && Boolean(fnskuCatalogValue);

  const refreshAfterCatalogSave = () => {
    window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    window.dispatchEvent(new Event('usav-refresh-data'));
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {hasOutOfStock && <AlertTriangle className="w-3.5 h-3.5 text-red-600" />}
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">Product Details</h3>
      </div>

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
            twoLineValue
            variant="flat"
            valueClassName="font-dm-sans"
          />

          <DetailsPanelRow
            label="Condition"
            actions={isSavingCondition ? (
              <span className="text-[10px] font-black uppercase tracking-wide text-blue-600">Saving</span>
            ) : null}
            className="last:border-b-0"
          >
            <ViewDropdown
              options={CONDITION_OPTIONS}
              value={conditionValue}
              onChange={handleConditionChange}
              className="w-full"
              buttonClassName="h-8 w-full border-0 bg-transparent px-0 pr-8 text-left text-sm font-bold uppercase tracking-wide text-gray-900 outline-none transition-colors hover:text-gray-700"
              optionClassName="text-xs font-bold tracking-wide text-gray-800"
            />
          </DetailsPanelRow>

          <ContextualManualLinkRow
            sku={shipped.sku}
            itemNumber={shipped.item_number}
            allowEmbeddedItemNumberInput={false}
          />

          <CopyableValueFieldBlock
            label="SKU"
            value={shipped.sku || 'N/A'}
            variant="flat"
            keepBottomDivider
          />
        </div>
      )}
    </section>
  );
}
