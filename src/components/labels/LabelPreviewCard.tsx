'use client';

import React from 'react';
import { Gs1DataMatrix } from '@/components/barcode/Gs1DataMatrix';

interface LabelPreviewCardProps {
  sku: string;
  /** @deprecated No longer rendered — label preview shows unit id only. */
  itemName?: string | null;
  /** @deprecated No longer rendered — label preview shows unit id only. */
  eyebrowLabel?: string;
  dataMatrixValue: string;
  dataMatrixSymbology: 'gs1datamatrix' | 'datamatrix';
  showReady?: boolean;
  readyBadgeClassName?: string;
  heading?: string;
}

export function LabelPreviewCard({
  sku,
  dataMatrixValue,
  dataMatrixSymbology,
  showReady = false,
  readyBadgeClassName = 'bg-emerald-50 text-emerald-700',
  heading = 'Live preview',
}: LabelPreviewCardProps) {
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
            <p className="font-mono text-sm font-bold tracking-tight text-gray-900 break-all text-left">
              {sku}
            </p>
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
