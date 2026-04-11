'use client';

import React, { useEffect, useRef, useState } from 'react';
import { loadBarcodeLibrary, renderBarcode } from '@/utils/barcode';

type Props = {
  sku: string;
  title?: string;
  serialNumber?: string;
  className?: string;
};

export function ProductLabelPreview({ sku, title, serialNumber, className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    loadBarcodeLibrary()
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || !canvasRef.current) return;
    const value = sku?.trim();
    if (!value) return;
    renderBarcode(canvasRef.current, value);
  }, [ready, sku]);

  return (
    <div
      className={`flex flex-col items-center rounded-xl border border-gray-200 bg-white px-4 py-3 ${className}`}
    >
      <canvas ref={canvasRef} className="max-w-full" />
      <div className="mt-1 font-mono text-base font-black tracking-tight text-gray-900">{sku}</div>
      {title && (
        <div className="mt-0.5 max-w-full truncate px-1 text-[11px] text-gray-500">{title}</div>
      )}
      {serialNumber && (
        <div className="mt-0.5 font-mono text-[10px] text-gray-500">SN: {serialNumber}</div>
      )}
    </div>
  );
}
