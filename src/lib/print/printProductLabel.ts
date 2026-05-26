import { gs1UnitAi, serialUnitHandle } from '@/lib/barcode-routing';
import { renderDataMatrixSvg } from '@/lib/barcode/dataMatrixSvg';
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
 * Build the DataMatrix payload embedded in a printed unit label.
 *
 * Resolution order:
 *   1. Caller-provided `qrPayload` (highest priority — e.g. a payload
 *      already returned by /api/units/next-id).
 *   2. GS1 AI form `(01){gtin}(21){serial}` when both are present —
 *      encoded as `gs1datamatrix`.
 *   3. Bare handle `U-{serial}` for serialized labels without a GTIN —
 *      encoded as plain `datamatrix`. The internal scanner routes it.
 *   4. Bare SKU for labels without a serial — encoded as plain
 *      `datamatrix`. `routeScan()` falls through to the SKU branch.
 *
 * No URL, no host, no protocol on the wire. Consumer phone cameras see
 * opaque text; the internal app's scanner decodes via `routeScan()`.
 */
export function buildUnitPayload(args: {
  sku: string;
  serialNumber: string | null;
  qrPayload?: string | null;
  gtin?: string | null;
}): { value: string; symbology: 'gs1datamatrix' | 'datamatrix' } {
  if (args.qrPayload && args.qrPayload.trim()) {
    const v = args.qrPayload.trim();
    // If the caller supplied a GS1 AI parens-form payload, use the
    // gs1datamatrix symbology. Otherwise treat as opaque text.
    const looksLikeAi = /\((?:01|21|10|17|414|254)\)/.test(v);
    return { value: v, symbology: looksLikeAi ? 'gs1datamatrix' : 'datamatrix' };
  }
  if (args.gtin && args.serialNumber) {
    return {
      value: gs1UnitAi({ gtin: args.gtin, serial: args.serialNumber }),
      symbology: 'gs1datamatrix',
    };
  }
  if (args.serialNumber) {
    return { value: serialUnitHandle(args.serialNumber), symbology: 'datamatrix' };
  }
  return { value: args.sku, symbology: 'datamatrix' };
}

/**
 * Render the label HTML. DataMatrix-only layout: SKU/unit-id column on
 * the left, DataMatrix on the right. Product title is intentionally
 * absent — this label rides on the outer shipping carton, and any
 * descriptive text raises theft risk on electronics. Operator-facing
 * title still shows in the on-screen live preview.
 */
function buildLabelHtml(args: {
  sku: string;
  /** Accepted for API compatibility but no longer printed. */
  title?: string;
  serialNumber: string;
  qrPayload?: string | null;
  gtin?: string | null;
}): string {
  const safeSku = escapeHtml(args.sku);
  const { value, symbology } = buildUnitPayload({
    sku: args.sku,
    serialNumber: args.serialNumber || null,
    qrPayload: args.qrPayload,
    gtin: args.gtin,
  });

  // GS1 DataMatrix replaces the old QR Digital Link form — denser (~40%
  // smaller mark), better ECC, FNC1-native AI parsing on industrial
  // scanners, and no consumer-readable URL on the sticker. bwip-js
  // renders it as inline SVG so the popup window doesn't need any
  // remote script before printing.
  const qrSvg = renderDataMatrixSvg({ value, symbology, scale: 6 });

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
      .sku { font-size: 16px; color: #111; margin:0; font-family: monospace; font-weight: 700; word-break: break-all; line-height:1.2; }
      .qr { flex:0 0 auto; width:0.88in; height:0.88in; display:flex; align-items:center; justify-content:center; align-self:center; }
      .qr svg { width:100%; height:100%; display:block; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="info">
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
