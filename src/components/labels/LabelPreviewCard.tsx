'use client';

import React from 'react';
import { Gs1DataMatrix } from '@/components/barcode/Gs1DataMatrix';

interface LabelPreviewCardProps {
  sku: string;
  itemName?: string | null;
  eyebrowLabel?: string;
  dataMatrixValue: string;
  dataMatrixSymbology: 'gs1datamatrix' | 'datamatrix';
  showReady?: boolean;
  readyBadgeClassName?: string;
  heading?: string;
}

export function LabelPreviewCard({
  sku,
  itemName,
  eyebrowLabel = 'New unit ID allocates on print',
  dataMatrixValue,
  dataMatrixSymbology,
  showReady = false,
  readyBadgeClassName = 'bg-emerald-50 text-emerald-700',
  heading = 'Live preview',
}: LabelPreviewCardProps) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
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
        <div className="flex flex-nowrap items-start gap-3 min-h-[5rem]">
          <div className="min-w-0 flex-1 py-0.5">
            {eyebrowLabel ? (
              <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
                {eyebrowLabel}
              </p>
            ) : null}
            <p className="mt-1 font-mono text-sm font-bold tracking-tight text-gray-900 break-all">
              {sku}
            </p>
            {itemName ? (
              <p className="mt-1 truncate text-caption text-gray-600">{itemName}</p>
            ) : null}
          </div>
          <div className="shrink-0 flex items-center">
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
