import { gs1UnitAi, serialUnitHandle } from '@/lib/barcode-routing';
import { escapeLabelHtml, printLabel } from '@/lib/print/printLabel';

// Product/testing labels print the product title (the unit id lives in the
// DataMatrix). The title is small and top-aligned next to the code so longer
// names get room to wrap. `.sku` is the monospace fallback when no title.
const PRODUCT_INFO_CSS =
  '.title{font-weight:700;font-size:11px;line-height:1.15;color:#111;text-align:left;overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical}' +
  '.sku{font-family:monospace;font-weight:700;font-size:12px;line-height:1.15;color:#111;word-break:break-all;text-align:left}';

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

export type PrintProductLabelInput = {
  sku: string;
  /** Product title — printed as the label's readable line. Falls back to the unit id when absent. */
  title?: string;
  /** Per-unit identifier. Under the new format this is the {SKU}-{YEAR}-{SEQ6} value. */
  serialNumber?: string;
  /** Pre-built QR payload (e.g. the qrUrl returned by /api/units/next-id). Wins over auto-built URLs. */
  qrPayload?: string;
  /** SKU's internal GTIN. When present alongside serialNumber, the QR encodes a GS1 Digital Link URL. */
  gtin?: string;
};

/**
 * Print a product/testing unit label via the shared {@link printLabel} shell —
 * the same 2×1" sticker the receiving label uses, just with a single readable
 * line instead of carton metadata. DataMatrix-only layout: product title on the
 * left (unit id when no title is available), DataMatrix on the right (matches
 * the on-screen live preview). The encoded value is built by
 * {@link buildUnitPayload}; no consumer-readable URL.
 */
export function printProductLabel(input: PrintProductLabelInput): void {
  if (typeof window === 'undefined') return;

  const sku = input.sku?.trim();
  if (!sku) return;

  const { value, symbology } = buildUnitPayload({
    sku,
    serialNumber: input.serialNumber?.trim() || null,
    qrPayload: input.qrPayload?.trim() || null,
    gtin: input.gtin?.trim() || null,
  });

  // Readable line = product title; the unit id is encoded in the DataMatrix.
  // Fall back to the unit id when no title is available so the label is never
  // blank.
  const title = input.title?.trim();
  const infoHtml = title
    ? `<div class="title">${escapeLabelHtml(title)}</div>`
    : `<div class="sku">${escapeLabelHtml(sku)}</div>`;

  printLabel({
    name: `Label ${sku}`,
    infoHtml,
    infoCss: PRODUCT_INFO_CSS,
    infoAlign: 'flex-start',
    dataMatrix: { value, symbology, scale: 4 },
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
