/**
 * Shared bwip-js wrapper that returns a DataMatrix as an SVG string —
 * usable from both React components (via `dangerouslySetInnerHTML`) and
 * server-rendered HTML templates (via plain string interpolation).
 *
 * For React component usage prefer the `Gs1DataMatrix` component in
 * `src/components/barcode/Gs1DataMatrix.tsx`, which wraps this helper
 * with the right ARIA + sizing affordances. This module is the bare
 * primitive for label-print HTML generation that's outside the React
 * render tree (e.g. `printProductLabel.ts`).
 */

import bwipjs from 'bwip-js/browser';

export type DataMatrixSymbology = 'gs1datamatrix' | 'datamatrix';

export interface RenderDataMatrixOptions {
  /** Payload string. AI parens form for `gs1datamatrix`, plain for `datamatrix`. */
  value: string;
  /** Symbology — defaults to `gs1datamatrix`. */
  symbology?: DataMatrixSymbology;
  /** Pixels per module (dot resolution). Higher = larger but crisper print. */
  scale?: number;
  /** Foreground colour hex (no `#`). */
  barcolor?: string;
  /** Background colour hex (no `#`). */
  backgroundcolor?: string;
  /**
   * Quiet-zone border in *modules* on every side. Defaults to 2 (scanner-safe
   * for printed/scanned symbols). Set to 0 for on-screen previews where the
   * symbol's ink edges must sit flush with its layout box so adjacent text can
   * be aligned to the visible matrix edges.
   */
  quietZone?: number;
}

export function renderDataMatrixSvg(opts: RenderDataMatrixOptions): string {
  const pad = opts.quietZone ?? 2;
  return bwipjs.toSVG({
    bcid: opts.symbology ?? 'gs1datamatrix',
    text: opts.value,
    scale: opts.scale ?? 4,
    includetext: false,
    paddingwidth: pad,
    paddingheight: pad,
    rotate: 'N',
    backgroundcolor: opts.backgroundcolor ?? 'FFFFFF',
    barcolor: opts.barcolor ?? '000000',
  });
}
