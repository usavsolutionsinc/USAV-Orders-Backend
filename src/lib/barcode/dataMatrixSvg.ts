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
}

export function renderDataMatrixSvg(opts: RenderDataMatrixOptions): string {
  return bwipjs.toSVG({
    bcid: opts.symbology ?? 'gs1datamatrix',
    text: opts.value,
    scale: opts.scale ?? 4,
    includetext: false,
    paddingwidth: 2,
    paddingheight: 2,
    rotate: 'N',
    backgroundcolor: opts.backgroundcolor ?? 'FFFFFF',
    barcolor: opts.barcolor ?? '000000',
  });
}
