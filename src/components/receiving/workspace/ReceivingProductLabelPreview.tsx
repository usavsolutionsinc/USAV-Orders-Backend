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
    ? 'flex w-full flex-nowrap items-start justify-between gap-3 bg-surface-card'
    : 'flex flex-nowrap items-start justify-between gap-3 rounded-lg border border-border-soft/80 bg-surface-card px-3 py-3 shadow-sm';
  const inner = (
    <div className={innerShell}>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-base font-black tracking-tight text-text-default">{sku.trim()}</p>
        {title.trim() ? (
          <p className="mt-1 line-clamp-3 text-caption text-text-soft leading-snug">{title}</p>
        ) : null}
        {serialNumber.trim() ? (
          <p className="mt-1 text-micro font-mono text-text-soft">SN: {serialNumber.trim()}</p>
        ) : null}
      </div>
      <div className="shrink-0 self-center">
        {/* label-preview-matrix → inverted to light bars in a dark scheme (globals.css). */}
        <canvas ref={canvasRef} className="label-preview-matrix max-w-[min(100%,9rem)]" />
      </div>
    </div>
  );
  if (embedded) {
    return inner;
  }
  return (
    <div className="border-t border-border-soft bg-surface-canvas">
      <div className="flex items-center gap-3 px-3 pt-3 pb-2">
        <span className="text-eyebrow font-black tabular-nums text-text-soft tracking-widest">03</span>
        <span className="text-eyebrow font-black uppercase tracking-[0.18em] text-text-muted">
          Review & print
        </span>
      </div>
      <div className="px-3 pb-3">{inner}</div>
    </div>
  );
}
