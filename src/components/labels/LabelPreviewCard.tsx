'use client';

import React from 'react';
import { Gs1DataMatrix } from '@/components/barcode/Gs1DataMatrix';

interface LabelPreviewCardProps {
  sku: string;
  /** Product title — rendered as the label's readable line. Falls back to the unit id when absent. */
  title?: string | null;
  /** @deprecated Use {@link title}. Kept for caller compatibility. */
  itemName?: string | null;
  /** @deprecated No longer rendered. */
  eyebrowLabel?: string;
  dataMatrixValue: string;
  dataMatrixSymbology: 'gs1datamatrix' | 'datamatrix';
  showReady?: boolean;
  readyBadgeClassName?: string;
  heading?: string;
}

export function LabelPreviewCard({
  sku,
  title,
  itemName,
  dataMatrixValue,
  dataMatrixSymbology,
  showReady = false,
  readyBadgeClassName = 'bg-emerald-50 text-emerald-700',
  heading = 'Live preview',
}: LabelPreviewCardProps) {
  // The readable line on the label is the product title; the unit id lives in
  // the DataMatrix. Fall back to the unit id when no title is available so the
  // label is never blank.
  const productTitle = (title ?? itemName ?? '').trim();
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-left text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
          {heading}
        </h3>
        {showReady ? (
          <span
            className={`rounded-md px-2 py-0.5 text-micro font-bold uppercase tracking-wider ${readyBadgeClassName}`}
          >
            Ready
          </span>
        ) : null}
      </div>
      <div className="w-full rounded border border-gray-200 bg-white px-2 py-2 shadow-sm">
        <div className="flex min-h-[5rem] flex-nowrap items-start gap-3">
          <div className="min-w-0 flex-1 self-start pt-0.5">
            {productTitle ? (
              <p className="text-xs font-bold leading-snug tracking-tight text-gray-900 text-left line-clamp-4">
                {productTitle}
              </p>
            ) : (
              <p className="font-mono text-sm font-bold tracking-tight text-gray-900 break-all text-left">
                {sku}
              </p>
            )}
          </div>
          <div className="flex shrink-0 self-start">
            {dataMatrixValue ? (
              <Gs1DataMatrix
                value={dataMatrixValue}
                symbology={dataMatrixSymbology}
                size={80}
              />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
