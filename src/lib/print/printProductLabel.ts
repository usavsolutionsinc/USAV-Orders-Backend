import { printLabel, buildLabelHtml } from '@/lib/print/printLabel';
import { getProfileForRole, printRawToProfile, resolvePaperSize } from '@/lib/print/browserPrint';
import {
  buildProductLabelBitmapCommands,
  buildProductLabelCommands,
} from '@/lib/print/productLabelCommands';
import { printHtmlInIframe } from '@/lib/print/iframePrint';
import { isSilentPrintEnabled } from '@/lib/print/printMode';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import {
  buildUnitPayload,
  productLabelFace,
  unitLabelToFace,
  type PrintProductLabelInput,
} from '@/lib/print/unitLabelCore';

export {
  buildUnitPayload,
  unitLabelToFace,
  type PrintProductLabelInput,
} from '@/lib/print/unitLabelCore';

const PRODUCT_LABEL_SIZE = resolvePaperSize('2x1');

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

export function resolveTestingLineTitle(
  row: Pick<ReceivingLineRow, 'zoho_item_title' | 'catalog_product_title' | 'item_name'>,
): string {
  return (
    (row.zoho_item_title ?? '').trim() ||
    (row.catalog_product_title ?? '').trim() ||
    (row.item_name ?? '').trim()
  );
}

/**
 * Print a product/testing unit label. Renders the same face as the on-screen
 * preview and drives the browser-only print pipeline: WebUSB/Web Serial raw
 * TSPL/ZPL to the paired thermal printer when silent mode is on, then Electron
 * silent-print / hidden-iframe dialog fallback.
 */
export function printProductLabel(input: PrintProductLabelInput): void {
  if (typeof window === 'undefined') return;

  const built = productLabelFace(input);
  if (!built) return;

  const { sku, matrix } = built;
  const html = buildLabelHtml({
    name: `Label ${sku}`,
    ...built,
    dataMatrix: matrix,
  });

  const silent = isSilentPrintEnabled();

  void (async () => {
    if (silent) {
      const labelProfile = getProfileForRole('label');
      if (labelProfile && labelProfile.kind !== 'os') {
        const commands =
          labelProfile.language === 'tspl'
            ? buildProductLabelBitmapCommands(input, PRODUCT_LABEL_SIZE, labelProfile.copies)
            : buildProductLabelCommands(
                input,
                labelProfile.language,
                PRODUCT_LABEL_SIZE,
                labelProfile.copies,
              );
        const res = await printRawToProfile(commands, labelProfile);
        if (res.success) return;
        console.warn('printProductLabel: browser raw print failed, falling back:', res.reason);
      }
    }

    if (silent) {
      printLabel({
        name: `Label ${sku}`,
        ...built,
        dataMatrix: matrix,
      });
      return;
    }

    printHtmlInIframe(html, { name: `Label ${sku}` });
  })();
}

export type PrintProductLabelsInput = {
  sku: string;
  title?: string;
  serialNumbers: string[];
  gtin?: string;
  qrPayloads?: Array<string | null | undefined>;
  condition?: string | null;
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
