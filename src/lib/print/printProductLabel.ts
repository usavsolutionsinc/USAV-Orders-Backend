import { gs1UnitAi, serialUnitHandle } from '@/lib/barcode-routing';
import { printLabel } from '@/lib/print/printLabel';
import { buildFaceInfoHtml, type LabelFaceModel } from '@/lib/print/labelFace';
import { CONDITION_GRADES, conditionLabel } from '@/lib/conditions';

// Best-effort product colors recognised in a SKU title, longest-first so
// "space gray" wins over "gray". Used to pre-fill the testing label's
// bottom-right color slot; the operator can override it.
const COLOR_WORDS = [
  'space gray',
  'space grey',
  'rose gold',
  'starlight',
  'midnight',
  'graphite',
  'champagne',
  'platinum',
  'silver',
  'black',
  'white',
  'titanium',
  'purple',
  'yellow',
  'orange',
  'green',
  'beige',
  'brown',
  'coral',
  'gold',
  'gray',
  'grey',
  'blue',
  'pink',
  'red',
  'tan',
];

/**
 * Pull a product color out of a SKU/product title for the testing label's
 * bottom-right slot. First/longest keyword match wins; returns '' when none is
 * found so the slot is simply left blank. Manual override happens upstream.
 */
export function deriveColorFromTitle(title: string | null | undefined): string {
  const t = String(title ?? '').toLowerCase();
  if (!t) return '';
  for (const word of COLOR_WORDS) {
    if (t.includes(word)) {
      return word.replace(/\b\w/g, (ch) => ch.toUpperCase());
    }
  }
  return '';
}

/**
 * Condition label for the tiny 2×1" sticker, from the shared `label` variant
 * (New · Like New · Refurbished · Used-A · … · Parts) — same wording the
 * receiving label prints. The `.cond` CSS up-cases it on the sticker. Returns
 * '' for an empty/unknown grade so the meta chip is simply omitted.
 */
function conditionChipLabel(grade: string | null | undefined): string {
  const c = String(grade ?? '').trim().toUpperCase();
  if (!(CONDITION_GRADES as readonly string[]).includes(c)) return '';
  return conditionLabel(c, 'label');
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
 *      (NOTE: a SKU-only scan has no product-detail destination wired yet —
 *      see docs/reversibility-fixes-plan.md §1.3; deferred until one exists.)
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
  /** Condition grade (BRAND_NEW / USED_A… / PARTS). Rendered bottom-left. */
  condition?: string | null;
  /** Product color (e.g. "Black"). Rendered bottom-right. Manual / title-derived. */
  color?: string | null;
};

/**
 * Map a unit/testing/product label onto the shared {@link LabelFaceModel}.
 * Product labels use the `product` face: the title fills a full top row,
 * condition sits bottom-left and color bottom-right (the unit id lives in the
 * DataMatrix). The caller supplies the already-built `matrix` (preview and print
 * pass the identical value) so this adapter stays pure.
 */
export function unitLabelToFace(input: {
  sku: string;
  title?: string | null;
  serialNumber?: string | null;
  condition?: string | null;
  color?: string | null;
  matrix: LabelFaceModel['matrix'];
}): LabelFaceModel {
  const title = (input.title ?? '').trim();
  return {
    kind: 'product',
    topLeft: title || input.sku,
    topRight: '',
    center: '',
    bottomLeft: conditionChipLabel(input.condition),
    bottomRight: (input.color ?? '').trim(),
    matrix: input.matrix,
  };
}

/**
 * Print a product/testing unit label via the shared {@link printLabel} shell —
 * the same 2×1" face the receiving carton label uses (product title center,
 * condition bottom-left, color bottom-right, DataMatrix right). The encoded
 * value is built by {@link buildUnitPayload}; no consumer-readable URL.
 */
export function printProductLabel(input: PrintProductLabelInput): void {
  if (typeof window === 'undefined') return;

  const sku = input.sku?.trim();
  if (!sku) return;

  const matrix = {
    ...buildUnitPayload({
      sku,
      serialNumber: input.serialNumber?.trim() || null,
      qrPayload: input.qrPayload?.trim() || null,
      gtin: input.gtin?.trim() || null,
    }),
    scale: 4,
  };

  const face = unitLabelToFace({
    sku,
    title: input.title,
    serialNumber: input.serialNumber,
    condition: input.condition,
    color: input.color,
    matrix,
  });

  printLabel({
    name: `Label ${sku}`,
    ...buildFaceInfoHtml(face),
    dataMatrix: face.matrix,
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
  /** Condition grade shared by every label in the batch. Rendered bottom-left. */
  condition?: string | null;
  /** Product color shared by every label in the batch. Rendered bottom-right. */
  color?: string | null;
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
        condition: input.condition,
        color: input.color,
      });
    }, i * stagger);
  });
}
