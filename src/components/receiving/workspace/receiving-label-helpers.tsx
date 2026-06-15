'use client';

import { buildLabelHtml } from '@/lib/print/printLabel';
import { buildFaceInfoHtml } from '@/lib/print/labelFace';
import {
  receivingPayloadToFace,
  resolveReceivingQrValue,
  type ReceivingLabelPayload,
} from '@/lib/print/printReceivingLabel';
import { printHtmlSilent } from '@/lib/print/silentPrint';
import { getProfileForRole, printRawToProfile, resolvePaperSize } from '@/lib/print/browserPrint';
import { buildReceivingLabelCommands } from '@/lib/print/labelCommands';
import { printHtmlInIframe } from '@/lib/print/iframePrint';
import { isSilentPrintEnabled } from '@/lib/print/printMode';

/** Microns per inch — the unit Electron's silent-print pageSize expects. */
const MICRONS_PER_INCH = 25400;

// Re-exported so the unbox workspace (LineEditPanel / LabelEditPopover /
// useUnboxLineController) and the raw-command builder keep their existing import
// path. The canonical definition lives in `@/lib/print/printReceivingLabel`.
export type { ReceivingLabelPayload };
export { resolveReceivingQrValue as resolveReceivingLabelQrValue };

/**
 * Print the unbox/receiving carton label. Renders the SAME face as the
 * on-screen preview (via {@link receivingPayloadToFace} → {@link buildLabelHtml})
 * and the non-unbox `printReceivingLabel`, then drives the unbox print pipeline:
 * Electron silent-print → WebUSB/Web Serial raw TSPL/ZPL to the paired thermal
 * printer → browser iframe dialog. Only this path carries the raw-command leg
 * (the shared `printLabel` shell stops at the dialog).
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

  // Match the settings "Print test label" path: try the Electron silent-print
  // bridge first (printHtmlSilent → api.printHtml), which sends straight to the
  // configured/default printer. Only fall back to the browser popup + window.print()
  // when we're not in the desktop shell.
  // Silent printing OFF (Settings → Hardware) skips every dialog-free path and
  // hands the label to the browser's print dialog so an operator can pick a
  // printer / preview.
  const silent = isSilentPrintEnabled();

  void (async () => {
    if (silent) {
      // 1) Electron desktop shell — webContents.print({ silent:true }).
      const handled = await printHtmlSilent(html, {
        pageSize: { width: 2 * MICRONS_PER_INCH, height: 1 * MICRONS_PER_INCH },
        margins: { marginType: 'none' },
        waitMs: 250,
      });
      if (handled) return;
      // 2) Browser-native raw (WebUSB / Web Serial) to the paired label printer.
      //    Sends raw TSPL/ZPL/ESC-POS so the firmware renders the label — no OS
      //    print dialog. Skipped for `os` profiles (those use the dialog path).
      const labelProfile = getProfileForRole('label');
      if (labelProfile && labelProfile.kind !== 'os') {
        const commands = buildReceivingLabelCommands(
          payload,
          labelProfile.language,
          resolvePaperSize(labelProfile.paperSizeId),
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
    // 3) Dialog path — hidden iframe + the page's own window.print(). Silent
    //    only under `--kiosk-printing` (default printer); otherwise the normal
    //    print dialog. An iframe (vs a popup) never flashes and dodges the
    //    popup blocker.
    printHtmlInIframe(html, { name: 'Receiving label' });
  })();
}
