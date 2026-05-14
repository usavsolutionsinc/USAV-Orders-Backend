import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QRCode from 'react-qr-code';
import { QR_BASE_URL, mobileQrUrl } from '@/lib/barcode-routing';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the absolute URL embedded in a printed product-label QR. When a
 * serial is present, the QR routes to the per-unit mobile page; otherwise
 * to the SKU detail page. Always anchors to the production domain via
 * {@link QR_BASE_URL} so localhost-printed labels still work.
 */
function productLabelQrValue(sku: string, serialNumber: string | null): string {
  if (serialNumber) return mobileQrUrl('u', serialNumber);
  const path = `/sku-stock/${encodeURIComponent(sku)}`;
  try {
    return new URL(path, QR_BASE_URL).toString();
  } catch {
    return `${QR_BASE_URL.replace(/\/$/, '')}${path}`;
  }
}

function buildLabelHtml(sku: string, title: string, serialNumber: string): string {
  const safeSku = escapeHtml(sku);
  const safeTitle = escapeHtml(title);
  const safeSerial = escapeHtml(serialNumber);
  const barcodeValue = JSON.stringify(sku);
  const qrPayload = productLabelQrValue(sku, serialNumber || null);

  // Pre-render the QR so the popup doesn't depend on a remote script for it.
  const qrSvg = renderToStaticMarkup(
    React.createElement(QRCode, {
      value: qrPayload,
      size: 80,
      level: 'M',
      fgColor: '#000000',
      bgColor: '#ffffff',
    }),
  );

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Label ${safeSku}</title>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
    <style>
      *,*::before,*::after{box-sizing:border-box}
      body { font-family: Arial, sans-serif; padding: 0; margin: 0; }
      .wrap { display:flex; align-items:stretch; gap:6px; padding:4px 5px; }
      .info { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; justify-content:center; gap:2px; }
      .sku { font-size: 18px; font-weight: 900; line-height:1; margin:0; }
      .title { font-size: 10px; color: #555; margin:0; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
      .sn { font-size: 10px; color: #777; margin:0; font-family: monospace; }
      .barcode-row { display:flex; align-items:center; justify-content:center; margin-top:2px; }
      canvas { max-width:100%; }
      .qr { flex:0 0 auto; width:0.86in; height:0.86in; display:flex; align-items:center; justify-content:center; }
      .qr svg { width:100%; height:100%; display:block; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="info">
        <div class="sku">${safeSku}</div>
        ${safeTitle ? `<div class="title">${safeTitle}</div>` : ''}
        ${safeSerial ? `<div class="sn">SN: ${safeSerial}</div>` : ''}
        <div class="barcode-row"><canvas id="barcode"></canvas></div>
      </div>
      <div class="qr">${qrSvg}</div>
    </div>
    <script>
      window.onload = function() {
        if (window.JsBarcode) {
          window.JsBarcode("#barcode", ${barcodeValue}, {
            format: "CODE128",
            lineColor: "#000",
            width: 1.6,
            height: 36,
            displayValue: false,
            margin: 0
          });
        }
        setTimeout(function() { window.print(); window.close(); }, 350);
      };
    </script>
  </body>
</html>`;
}

export type PrintProductLabelInput = {
  sku: string;
  title?: string;
  serialNumber?: string;
};

export function printProductLabel(input: PrintProductLabelInput): void {
  if (typeof window === 'undefined') return;

  const sku = input.sku?.trim();
  if (!sku) return;

  const serialNumber = input.serialNumber?.trim() ?? '';
  const title = input.title?.trim() ?? '';

  const printWindow = window.open('', '', 'width=420,height=320');
  if (!printWindow) return;

  printWindow.document.write(buildLabelHtml(sku, title, serialNumber));
  printWindow.document.close();
}

export type PrintProductLabelsInput = {
  sku: string;
  title?: string;
  serialNumbers: string[];
  staggerMs?: number;
};

export function printProductLabels(input: PrintProductLabelsInput): void {
  if (typeof window === 'undefined') return;

  const sku = input.sku?.trim();
  if (!sku) return;

  const serials = (input.serialNumbers ?? [])
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);
  if (serials.length === 0) return;

  const stagger = input.staggerMs ?? 200;

  serials.forEach((serialNumber, i) => {
    window.setTimeout(() => {
      printProductLabel({ sku, title: input.title, serialNumber });
    }, i * stagger);
  });
}
