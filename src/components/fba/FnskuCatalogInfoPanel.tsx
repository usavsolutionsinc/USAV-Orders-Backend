'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Pencil } from '@/components/Icons';
import { DetailsPanelRow } from '@/design-system/components/DetailsPanelRow';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { emitOpenQuickAddFnsku, FBA_FNSKU_SAVED_EVENT } from './FbaQuickAddFnskuModal';

export interface FnskuCatalogMeta {
  productTitle: string;
  condition: string;
  sku: string;
  asin: string;
}

export interface FnskuCatalogInfoPanelProps {
  fnsku: string;
  productTitle?: string | null;
  condition?: string | null;
  sku?: string | null;
  asin?: string | null;
  /** When this changes, local catalog fields re-seed from props */
  sourceKey?: string | number;
  allowEdit?: boolean;
  onCatalogSaved?: () => void;
  /** Fired when internal catalog fields change (including after Quick Add save) — use for parent headers */
  onCatalogMetaChange?: (meta: FnskuCatalogMeta) => void;
  className?: string;
}

export function FnskuCatalogInfoPanel({
  fnsku,
  productTitle: initialProductTitle,
  condition: initialCondition,
  sku: initialSku,
  asin: initialAsin,
  sourceKey,
  allowEdit = true,
  onCatalogSaved,
  onCatalogMetaChange,
  className,
}: FnskuCatalogInfoPanelProps) {
  const [productTitle, setProductTitle] = useState(initialProductTitle || '');
  const [condition, setCondition] = useState(initialCondition || '');
  const [sku, setSku] = useState(initialSku || '');
  const [asin, setAsin] = useState(initialAsin || '');

  useEffect(() => {
    setProductTitle(initialProductTitle || '');
    setCondition(initialCondition || '');
    setSku(initialSku || '');
    setAsin(initialAsin || '');
  }, [sourceKey, fnsku, initialProductTitle, initialCondition, initialSku, initialAsin]);

  const onCatalogMetaChangeRef = useRef(onCatalogMetaChange);
  onCatalogMetaChangeRef.current = onCatalogMetaChange;

  useEffect(() => {
    onCatalogMetaChangeRef.current?.({ productTitle, condition, sku, asin });
  }, [productTitle, condition, sku, asin]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{
        fnsku: string;
        product_title: string | null;
        asin: string | null;
        sku: string | null;
        condition: string | null;
      }>).detail;
      if (!detail?.fnsku || detail.fnsku.toUpperCase() !== fnsku.trim().toUpperCase()) return;
      if (detail.product_title != null) setProductTitle(detail.product_title);
      if (detail.asin != null) setAsin(detail.asin);
      if (detail.sku != null) setSku(detail.sku);
      if (detail.condition != null) setCondition(detail.condition);
      onCatalogSaved?.();
    };
    window.addEventListener(FBA_FNSKU_SAVED_EVENT, handler as EventListener);
    return () => window.removeEventListener(FBA_FNSKU_SAVED_EVENT, handler as EventListener);
  }, [fnsku, onCatalogSaved]);

  const openCatalogEdit = useCallback(() => {
    emitOpenQuickAddFnsku({
      fnsku: fnsku.trim(),
      product_title: productTitle || null,
      asin: asin || null,
      sku: sku || null,
      condition: condition || null,
    });
  }, [fnsku, productTitle, asin, sku, condition]);

  const fnskuTrimmed = fnsku.trim();

  return (
    <section className={className}>
      <div className="mb-1 flex items-center justify-between">
        <p className={sectionLabel}>Catalog Info</p>
        {allowEdit ? (
          <button
            type="button"
            onClick={openCatalogEdit}
            className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Edit catalog details"
            title="Edit catalog details"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div>
        <DetailsPanelRow
          label="Product Title"
          actions={
            productTitle ? (
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(productTitle)}
                className="text-gray-400 transition-colors hover:text-gray-700"
                aria-label="Copy product title"
                title="Copy product title"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            ) : null
          }
        >
          <p className="whitespace-pre-wrap break-words text-sm font-bold text-gray-900">
            {productTitle || <span className="text-gray-400">No title</span>}
          </p>
        </DetailsPanelRow>
        <DetailsPanelRow
          label="Condition"
          actions={
            condition ? (
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(condition)}
                className="text-gray-400 transition-colors hover:text-gray-700"
                aria-label="Copy condition"
                title="Copy condition"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            ) : null
          }
        >
          <p className="text-sm font-bold text-gray-900">
            {condition || <span className="text-gray-400">—</span>}
          </p>
        </DetailsPanelRow>
        <DetailsPanelRow
          label="FNSKU"
          actions={
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(fnskuTrimmed)}
              className="text-gray-400 transition-colors hover:text-gray-700"
              aria-label="Copy FNSKU"
              title="Copy FNSKU"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          }
        >
          <p className="font-mono text-sm font-bold text-gray-900">{fnskuTrimmed}</p>
        </DetailsPanelRow>
        <DetailsPanelRow
          label="ASIN"
          actions={
            asin ? (
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(asin)}
                className="text-gray-400 transition-colors hover:text-gray-700"
                aria-label="Copy ASIN"
                title="Copy ASIN"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            ) : null
          }
        >
          <p className="font-mono text-sm font-bold text-gray-900">
            {asin || <span className="text-gray-400">—</span>}
          </p>
        </DetailsPanelRow>
        <DetailsPanelRow
          label="SKU"
          className="last:border-b-0"
          actions={
            sku ? (
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(sku)}
                className="text-gray-400 transition-colors hover:text-gray-700"
                aria-label="Copy SKU"
                title="Copy SKU"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            ) : null
          }
        >
          <p className="font-mono text-sm font-bold text-gray-900">
            {sku || <span className="text-gray-400">—</span>}
          </p>
        </DetailsPanelRow>
      </div>
    </section>
  );
}
