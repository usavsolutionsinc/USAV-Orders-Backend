import { escapeLabelHtml } from '@/lib/print/printLabel';

/**
 * One model for the printed 2×1" label *face*, shared by every label in the
 * app — receiving/PO cartons, testing/unit stickers, local-pickup, etc.
 *
 * The face is a fixed 5-slot grid plus a DataMatrix:
 *
 *   topLeft ───────────── topRight   ┌──────────┐
 *        (center, 3-line)            │  Data    │
 *   bottomLeft ───────── bottomRight  │  Matrix  │
 *                                     └──────────┘
 *
 * Both the on-screen preview ({@link LabelFacePreview}) and the printed HTML
 * ({@link buildFaceInfoHtml} → the shared {@link buildLabelHtml}/`printLabel`
 * shell) consume this model, so what techs see is exactly what prints — there's
 * no second hand-built layout to drift. Domain adapters
 * (`receivingPayloadToFace`, `unitLabelToFace`) map their payloads into it.
 */
export interface LabelFaceModel {
  /**
   * Layout family. `receiving` (default) = the 4-corner carton face
   * (platform·date / notes / condition·corner). `product` = the unit/testing
   * face where the product title fills a full top row, with condition·color on
   * the bottom row and no center band. This is where receiving and product
   * labels intentionally diverge.
   */
  kind?: 'receiving' | 'product';
  /** Top-left (receiving: platform/type). For `product`, holds the full-top-row title. */
  topLeft: string;
  /** Top-right — date (receiving). Unused by `product`. */
  topRight: string;
  /** Center — the 3-line hero text (receiving notes). Unused by `product`. */
  center: string;
  /** Bottom-left — condition grade (`label` variant). */
  bottomLeft: string;
  /** Bottom-right — corner value: PO/ticket/tracking (receiving) or color (product). */
  bottomRight: string;
  matrix: { value: string; symbology: 'gs1datamatrix' | 'datamatrix'; scale?: number };
  /** Optional human-readable handle printed under the matrix (e.g. `R-1234`). */
  hri?: string;
}

/**
 * CSS for the face's info column. Class names are slot-neutral (tl/tr/center/
 * bl/br) so the same stylesheet serves carton and unit labels. Mirrors the
 * weights/sizes the receiving label has used since it was the only label face.
 */
// All slots share one font size (9px) and pure black so the face reads uniformly
// on the tiny 2×1" label without clipping; center notes stay 9px too. These are
// the PRINTED sizes — deliberately a touch smaller than the on-screen
// LabelFacePreview, which renders in a larger box where a bigger size reads fine.
export const LABEL_FACE_CSS =
  '.row{display:flex;justify-content:space-between;align-items:baseline;gap:4px;line-height:1}' +
  '.tl{font-size:9px;font-weight:700;color:#000;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.tr{font-size:9px;font-weight:700;color:#000;white-space:nowrap;font-variant-numeric:tabular-nums}' +
  '.center{flex:1 1 auto;min-height:0;font-size:9px;font-weight:600;color:#000;text-align:center;line-height:1.12;overflow:hidden;padding:0 1px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow-wrap:anywhere;word-break:break-word;align-self:stretch}' +
  // Product label title — fills a full top row, wraps up to 2 lines.
  '.ptitle{font-size:9px;font-weight:700;line-height:1.15;color:#000;text-align:left;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere;word-break:break-word}' +
  '.bl{font-size:9px;font-weight:900;color:#000;white-space:nowrap}' +
  '.br{font-size:9px;font-weight:900;letter-spacing:0.3px;line-height:1.05;color:#000;white-space:nowrap;font-variant-numeric:tabular-nums}';

/**
 * Build the info-column HTML + CSS for a label face. Feed the result straight
 * into the shared `printLabel`/`buildLabelHtml` shell along with `model.matrix`
 * and `model.hri`. Branches on `model.kind`: `product` puts the title in a full
 * top row with condition·color beneath; `receiving` keeps the 4-corner grid.
 */
export function buildFaceInfoHtml(model: LabelFaceModel): {
  infoHtml: string;
  infoCss: string;
  infoAlign: 'space-between';
} {
  if (model.kind === 'product') {
    const infoHtml =
      `<div class="ptitle">${escapeLabelHtml(model.topLeft)}</div>` +
      `<div class="row"><span class="bl">${escapeLabelHtml(model.bottomLeft)}</span>` +
      `<span class="br">${escapeLabelHtml(model.bottomRight)}</span></div>`;
    return { infoHtml, infoCss: LABEL_FACE_CSS, infoAlign: 'space-between' };
  }
  const infoHtml =
    `<div class="row"><span class="tl">${escapeLabelHtml(model.topLeft)}</span>` +
    `<span class="tr">${escapeLabelHtml(model.topRight)}</span></div>` +
    `<div class="center">${escapeLabelHtml(model.center)}</div>` +
    `<div class="row"><span class="bl">${escapeLabelHtml(model.bottomLeft)}</span>` +
    `<span class="br">${escapeLabelHtml(model.bottomRight)}</span></div>`;
  return { infoHtml, infoCss: LABEL_FACE_CSS, infoAlign: 'space-between' };
}
