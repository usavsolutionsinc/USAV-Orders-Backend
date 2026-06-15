'use client';

import { buildLabelHtml } from '@/lib/print/printLabel';
import { buildFaceInfoHtml } from '@/lib/print/labelFace';
import {
  receivingPayloadToFace,
  resolveReceivingQrValue,
  type ReceivingLabelPayload,
} from '@/lib/print/printReceivingLabel';
import { getProfileForRole, printRawToProfile, resolvePaperSize } from '@/lib/print/browserPrint';
import {
  buildReceivingLabelBitmapCommands,
  buildReceivingLabelCommands,
} from '@/lib/print/labelCommands';
import { printHtmlInIframe } from '@/lib/print/iframePrint';
import { isSilentPrintEnabled } from '@/lib/print/printMode';

const RECEIVING_LABEL_SIZE = resolvePaperSize('2x1');

// Re-exported so the unbox workspace (LineEditPanel / LabelEditPopover /
// useUnboxLineController) and the raw-command builder keep their existing import
// path. The canonical definition lives in `@/lib/print/printReceivingLabel`.
export type { ReceivingLabelPayload };
export { resolveReceivingQrValue as resolveReceivingLabelQrValue };

/**
 * Print the unbox/receiving carton label. Renders the SAME face as the
 * on-screen preview (via {@link receivingPayloadToFace} → {@link buildLabelHtml})
 * and drives the browser-only print pipeline: WebUSB/Web Serial raw
 * TSPL/ZPL to the paired thermal printer, then browser iframe dialog fallback.
 */
export function printReceivingLabel(payload: ReceivingLabelPayload) {
  if (typeof window === 'undefined') return;
  const face = receivingPayloadToFace(payload);
  if (!face.matrix.value) return;

  // quietZone defaults to a scanner-safe margin in the print shell (this is the
  // real printed symbol, not the edge-to-edge preview).
  const html = buildLabelHtml({
    name: 'Label',
    ...buildFaceInfoHtml(face),
    dataMatrix: face.matrix,
    hri: face.hri,
  });

  // Silent printing OFF (Settings → Hardware) skips every dialog-free path and
  // hands the label to the browser's print dialog so an operator can pick a
  // printer / preview.
  const silent = isSilentPrintEnabled();

  void (async () => {
    if (silent) {
      // Browser-native raw (WebUSB / Web Serial) to the paired label printer.
      //    Sends raw TSPL/ZPL/ESC-POS so the firmware renders the label — no OS
      //    print dialog. Skipped for `os` profiles (those use the dialog path).
      const labelProfile = getProfileForRole('label');
      if (labelProfile && labelProfile.kind !== 'os') {
        const commands =
          labelProfile.language === 'tspl'
            ? buildReceivingLabelBitmapCommands(
                payload,
                RECEIVING_LABEL_SIZE,
                labelProfile.copies,
              )
            : buildReceivingLabelCommands(
                payload,
                labelProfile.language,
                RECEIVING_LABEL_SIZE,
                labelProfile.copies,
              );
        const res = await printRawToProfile(commands, labelProfile);
        if (res.success) return; // silent print to the paired thermal printer
        // Raw send failed — fall through to the iframe/window.print() path below.
        // We do NOT toast "failed": window.print() is fire-and-forget, so the
        // label may well print on the fallback and a failure toast would be a
        // false alarm. Diagnostics live in Settings → Hardware "Test".
        console.warn('printReceivingLabel: browser raw print failed, falling back:', res.reason);
      }
    }
    // Dialog path — hidden iframe + the page's own window.print(). Silent
    //    only under `--kiosk-printing` (default printer); otherwise the normal
    //    print dialog. An iframe (vs a popup) never flashes and dodges the
    //    popup blocker.
    printHtmlInIframe(html, { name: 'Receiving label' });
  })();
}
