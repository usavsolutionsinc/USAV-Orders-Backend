'use client';

import { useEffect, useRef, useState } from 'react';
import { loadBarcodeLibrary, renderBarcode } from '@/utils/barcode';

interface Props {
  sku: string;
  title: string;
  serialNumber: string;
  embedded?: boolean;
}

/**
 * On-screen product label — SKU as CODE128 barcode + title + serial. Lazy-
 * loads the JsBarcode library so the receiving page doesn't pay the cost
 * until a label is rendered.
 */
export function ReceivingProductLabelPreview({ sku, title, serialNumber, embedded }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [libReady, setLibReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadBarcodeLibrary()
      .then(() => {
        if (!cancelled) setLibReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!libReady || !sku.trim()) return;
    renderBarcode(canvasRef.current, sku.trim(), {
      format: 'CODE128',
      lineColor: '#000',
      width: 2,
      height: 50,
      displayValue: false,
    });
  }, [libReady, sku]);

  if (!sku.trim()) return null;

  const innerShell = embedded
    ? 'flex w-full flex-nowrap items-start justify-between gap-3 bg-white'
    : 'flex flex-nowrap items-start justify-between gap-3 rounded-lg border border-gray-200/80 bg-white px-3 py-3 shadow-sm';
  const inner = (
    <div className={innerShell}>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-base font-black tracking-tight text-gray-900">{sku.trim()}</p>
        {title.trim() ? (
          <p className="mt-1 line-clamp-3 text-[11px] text-gray-500 leading-snug">{title}</p>
        ) : null}
        {serialNumber.trim() ? (
          <p className="mt-1 text-[10px] font-mono text-gray-500">SN: {serialNumber.trim()}</p>
        ) : null}
      </div>
      <div className="shrink-0 self-center">
        <canvas ref={canvasRef} className="max-w-[min(100%,9rem)]" />
      </div>
    </div>
  );
  if (embedded) {
    return inner;
  }
  return (
    <div className="border-t border-gray-200 bg-gray-50">
      <div className="flex items-center gap-3 px-3 pt-3 pb-2">
        <span className="text-[9px] font-black tabular-nums text-gray-500 tracking-widest">03</span>
        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-600">
          Review & print
        </span>
      </div>
      <div className="px-3 pb-3">{inner}</div>
    </div>
  );
}
