import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QRCode from 'react-qr-code';
import { QR_BASE_URL, mobileQrUrl } from '@/lib/barcode-routing';
import { buildGs1UnitUrl } from '@/lib/scan-resolver';
import { printHtmlSilent } from '@/lib/print/silentPrint';

// Same 2in × 1in stock as the receiving label.
const PRODUCT_PAGE_SIZE = { width: 50800, height: 25400 } as const;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the URL embedded in a printed unit-label QR.
 *
 * Resolution order:
 *   1. Caller-provided `qrPayload` (highest priority — e.g. the value
 *      already returned by /api/units/next-id).
 *   2. GS1 Digital Link form when both `gtin` and `serialNumber` are
 *      present. Format: {origin}/01/{gtin}/21/{serialNumber}.
 *   3. Legacy /m/u/{serial} for serialized labels without a GTIN.
 *   4. /sku-stock/{sku} for labels without a serial.
 *
 * Anchored to QR_BASE_URL (production domain) so localhost prints still
 * scan correctly out in the warehouse.
 */
function buildUnitQrValue(args: {
  sku: string;
  serialNumber: string | null;
  qrPayload?: string | null;
  gtin?: string | null;
}): string {
  if (args.qrPayload && args.qrPayload.trim()) return args.qrPayload.trim();
  if (args.gtin && args.serialNumber) {
    return buildGs1UnitUrl(QR_BASE_URL, args.gtin, args.serialNumber);
  }
  if (args.serialNumber) return mobileQrUrl('u', args.serialNumber);
  const path = `/sku-stock/${encodeURIComponent(args.sku)}`;
  try {
    return new URL(path, QR_BASE_URL).toString();
  } catch {
    return `${QR_BASE_URL.replace(/\/$/, '')}${path}`;
  }
}

/**
 * Render the label HTML. QR-only layout: product title + identifier
 * column on the left, QR on the right. The 1D barcode that used to sit
 * under the SKU is intentionally gone — see [[project-qr-label-format]].
 */
function buildLabelHtml(args: {
  sku: string;
  title: string;
  serialNumber: string;
  qrPayload?: string | null;
  gtin?: string | null;
}): string {
  const safeSku = escapeHtml(args.sku);
  const safeTitle = escapeHtml(args.title);
  const safeSerial = escapeHtml(args.serialNumber);
  const qrPayload = buildUnitQrValue({
    sku: args.sku,
    serialNumber: args.serialNumber || null,
    qrPayload: args.qrPayload,
    gtin: args.gtin,
  });

  // Pre-render the QR as inline SVG so the popup window doesn't need to
  // wait on a remote script before printing.
  const qrSvg = renderToStaticMarkup(
    React.createElement(QRCode, {
      value: qrPayload,
      size: 160,
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
    <style>
      *,*::before,*::after{box-sizing:border-box}
      body { font-family: Arial, sans-serif; padding: 0; margin: 0; }
      .wrap { display:flex; align-items:stretch; gap:8px; padding:6px 8px; height:1in; }
      .info { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; justify-content:center; gap:3px; }
      .title { font-size: 12px; font-weight: 700; line-height:1.15; margin:0; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
      .sku { font-size: 11px; color: #444; margin:0; font-family: monospace; }
      .sn { font-size: 14px; color: #111; margin:0; font-family: monospace; font-weight: 700; word-break: break-all; }
      .qr { flex:0 0 auto; width:0.88in; height:0.88in; display:flex; align-items:center; justify-content:center; align-self:center; }
      .qr svg { width:100%; height:100%; display:block; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="info">
        ${safeTitle ? `<div class="title">${safeTitle}</div>` : ''}
        ${safeSerial ? `<div class="sn">${safeSerial}</div>` : ''}
        <div class="sku">${safeSku}</div>
      </div>
      <div class="qr">${qrSvg}</div>
    </div>
    <script>
      window.onload = function() {
        setTimeout(function() { window.print(); window.close(); }, 200);
      };
    </script>
  </body>
</html>`;
}

export type PrintProductLabelInput = {
  sku: string;
  title?: string;
  /** Per-unit identifier. Under the new format this is the {SKU}-{YEAR}-{SEQ6} value. */
  serialNumber?: string;
  /** Pre-built QR payload (e.g. the qrUrl returned by /api/units/next-id). Wins over auto-built URLs. */
  qrPayload?: string;
  /** SKU's internal GTIN. When present alongside serialNumber, the QR encodes a GS1 Digital Link URL. */
  gtin?: string;
};

export function printProductLabel(input: PrintProductLabelInput): void {
  if (typeof window === 'undefined') return;

  const sku = input.sku?.trim();
  if (!sku) return;

  const serialNumber = input.serialNumber?.trim() ?? '';
  const title = input.title?.trim() ?? '';
  const qrPayload = input.qrPayload?.trim() || null;
  const gtin = input.gtin?.trim() || null;
  const html = buildLabelHtml({ sku, title, serialNumber, qrPayload, gtin });

  void printHtmlSilent(html, {
    pageSize: PRODUCT_PAGE_SIZE,
    margins: { marginType: 'none' },
    // QR is pre-rendered as inline SVG, so the popup needs much less warm-up.
    waitMs: 200,
  }).then((handled) => {
    if (handled) return;
    const printWindow = window.open('', '', 'width=420,height=320');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
  });
}

export type PrintProductLabelsInput = {
  sku: string;
  title?: string;
  /** Each entry becomes one printed label. Under the new format each value is a unique {SKU}-{YEAR}-{SEQ6} unit ID. */
  serialNumbers: string[];
  /** Shared per SKU; per-label QR is built per-serial as GS1 Digital Link when present. */
  gtin?: string;
  /** Optional per-serial QR payload override (rare; allows mixed sources). Index-aligned with serialNumbers. */
  qrPayloads?: Array<string | null | undefined>;
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
  const payloads = input.qrPayloads ?? [];

  serials.forEach((serialNumber, i) => {
    window.setTimeout(() => {
      printProductLabel({
        sku,
        title: input.title,
        serialNumber,
        gtin: input.gtin,
        qrPayload: payloads[i] ?? undefined,
      });
    }, i * stagger);
  });
}
