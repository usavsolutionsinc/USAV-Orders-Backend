import { renderDataMatrixSvg } from '@/lib/barcode/dataMatrixSvg';
import { printHtmlSilent } from '@/lib/print/silentPrint';
import { printHtmlInIframe } from '@/lib/print/iframePrint';
import { isSilentPrintEnabled } from '@/lib/print/printMode';

/**
 * Shared 2×1" DataMatrix label shell. Receiving, repair, and product/testing
 * labels all render the same physical sticker — an info column on the left and
 * a DataMatrix on the right — so the page setup, flex layout, print script, and
 * silent-print plumbing live here once. Each caller supplies only its own
 * content (`infoHtml` + `infoCss`) and scaling knobs (`scale`, `qrSize`, label
 * dimensions). Keeping the shell in one place is what stops the labels from
 * drifting apart (e.g. the testing label printing at the wrong scale/position).
 */

const MICRONS_PER_INCH = 25400;

/** HTML-escape a value for safe interpolation into label markup. */
export function escapeLabelHtml(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface LabelDataMatrix {
  value: string;
  symbology: 'gs1datamatrix' | 'datamatrix';
  /** bwip-js module scale. Default 4 — the receiving label's proven density. */
  scale?: number;
}

export interface PrintLabelOptions {
  /**
   * Inner HTML of the left `.info` column. The caller owns escaping (use
   * {@link escapeLabelHtml}) and the content classes referenced here.
   */
  infoHtml: string;
  /** The DataMatrix rendered on the right. */
  dataMatrix: LabelDataMatrix;
  /** Caller-specific CSS for the content classes used inside `infoHtml`. */
  infoCss?: string;
  /** Vertical distribution of the `.info` column. Default `space-between`. */
  infoAlign?: 'space-between' | 'center' | 'flex-start' | 'flex-end';
  /** DataMatrix block side length (any CSS length). Default `0.86in`. */
  qrSize?: string;
  /** Label width in inches. Default 2. */
  widthIn?: number;
  /** Label height in inches. Default 1. */
  heightIn?: number;
  /** `<title>` text and popup-blocked log prefix. */
  name?: string;
  /** Silent-print settle delay in ms. Default 250. */
  waitMs?: number;
}

/**
 * Build the full label HTML document. Exposed for tests/preview; most callers
 * want {@link printLabel}, which also drives the silent-print / popup pipeline.
 */
export function buildLabelHtml(opts: PrintLabelOptions): string {
  const widthIn = opts.widthIn ?? 2;
  const heightIn = opts.heightIn ?? 1;
  const qrSize = opts.qrSize ?? '0.86in';
  const infoAlign = opts.infoAlign ?? 'space-between';
  const title = escapeLabelHtml(opts.name ?? 'Label');

  const qrSvg = renderDataMatrixSvg({
    value: opts.dataMatrix.value,
    symbology: opts.dataMatrix.symbology,
    scale: opts.dataMatrix.scale ?? 4,
  });

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title>
<style>
  @page{size:${widthIn}in ${heightIn}in;margin:0}
  *,*::before,*::after{box-sizing:border-box}
  html,body{width:${widthIn}in;height:${heightIn}in;padding:0;margin:0;font-family:Arial,sans-serif;color:#111}
  .wrap{width:${widthIn}in;height:${heightIn}in;display:flex;align-items:stretch;gap:4px;padding:4px 5px}
  .info{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:${infoAlign};height:100%}
  .qr{flex:0 0 auto;width:${qrSize};height:${qrSize};display:flex;align-items:center;justify-content:center}
  .qr svg{width:100%;height:100%;display:block}
  ${opts.infoCss ?? ''}
</style></head><body>
<div class="wrap">
  <div class="info">${opts.infoHtml}</div>
  <div class="qr">${qrSvg}</div>
</div>
<script>
window.onload=function(){
  setTimeout(function(){window.focus();window.print();},120);
};
window.onafterprint=function(){setTimeout(function(){window.close();},80);};
</script>
</body></html>`;
}

/**
 * Render and print a 2×1" DataMatrix label. Tries Electron silent-print first;
 * falls back to a browser popup + `window.print()` when not in the desktop
 * shell. The label dimensions are mirrored into the microns `pageSize` so the
 * thermal printer picks the right stock.
 */
export function printLabel(opts: PrintLabelOptions): void {
  if (typeof window === 'undefined') return;

  const widthIn = opts.widthIn ?? 2;
  const heightIn = opts.heightIn ?? 1;
  const html = buildLabelHtml(opts);

  void (async () => {
    // Silent printing OFF → skip the Electron silent path and go straight to
    // the dialog (hidden iframe + window.print()).
    if (isSilentPrintEnabled()) {
      const handled = await printHtmlSilent(html, {
        pageSize: {
          width: Math.round(widthIn * MICRONS_PER_INCH),
          height: Math.round(heightIn * MICRONS_PER_INCH),
        },
        margins: { marginType: 'none' },
        waitMs: opts.waitMs ?? 250,
      });
      if (handled) return;
    }
    // Browser fallback: print via a hidden iframe + the page's own
    // window.print(). Silent under `--kiosk-printing` (default printer);
    // otherwise the normal dialog. No popup flash, no popup-blocker risk.
    printHtmlInIframe(html, { name: opts.name ?? 'printLabel' });
  })();
}
