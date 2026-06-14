'use client';

import { receivingHandle } from '@/lib/barcode-routing';
import { renderDataMatrixSvg } from '@/lib/barcode/dataMatrixSvg';
import {
  receivingLabelPlatformDisplay,
  receivingLabelPoCornerDisplay,
} from '@/lib/print/printReceivingLabel';
import { printHtmlSilent } from '@/lib/print/silentPrint';
import { getProfileForRole, printRawToProfile, resolvePaperSize } from '@/lib/print/browserPrint';
import { buildReceivingLabelCommands } from '@/lib/print/labelCommands';
import { printHtmlInIframe } from '@/lib/print/iframePrint';
import { isSilentPrintEnabled } from '@/lib/print/printMode';
import { CONDITION_GRADES, conditionLabel } from '@/lib/conditions';

/** Microns per inch — the unit Electron's silent-print pageSize expects. */
const MICRONS_PER_INCH = 25400;

export type ReceivingLabelPayload = {
  /** Numeric receiving id — used to build the phone-scannable QR URL. */
  receivingId?: number | null;
  /** Human-readable PO/RCV identifier shown as the "last 4" on the label face. */
  scanValue: string;
  platform: string;
  zendeskTicket?: string;
  /**
   * Carton tracking number — corner display falls back to its last-4 when
   * no PO is set (scanValue would otherwise be the internal `RCV-{id}` handle).
   */
  trackingNumber?: string | null;
  /** Support / carton notes printed in the label center — any free text. */
  notes: string;
  conditionCode: string;
  /** Receiving type (PO / RETURN / TRADE_IN / PICKUP) — shown after the platform as "Platform - Type". */
  receivingType?: string | null;
  /** Org-catalog label for `receivingType` (custom / renamed types); overrides the built-in map. */
  receivingTypeLabel?: string | null;
  date: string;
};

/**
 * The string actually encoded into the printed DataMatrix. When we know
 * the receiving id we encode the bare handle `R-{id}` (no URL, no host)
 * via {@link receivingHandle}; the internal scanner recognises the prefix
 * and routes to /m/r/{id}. Falls back to the human-readable scanValue
 * for legacy callers without a receivingId.
 */
export function resolveReceivingLabelQrValue(payload: ReceivingLabelPayload): string {
  if (payload.receivingId != null && Number.isFinite(payload.receivingId)) {
    return receivingHandle(payload.receivingId);
  }
  return payload.scanValue.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function printReceivingLabel(payload: ReceivingLabelPayload) {
  if (typeof window === 'undefined') return;
  const scanValue = payload.scanValue.trim();
  const qrPayload = resolveReceivingLabelQrValue(payload);
  if (!qrPayload) return;

  // Bare handle (R-{id}) — `routeScan()` routes to /m/r/{id}. No URL.
  const qrSvg = renderDataMatrixSvg({ value: qrPayload, symbology: 'datamatrix', scale: 4 });
  // Human-readable interpretation (HRI) of the carton handle, printed under
  // the DataMatrix the way a barcode shows its digits. Gives the operator a
  // value to TYPE into the scan bar when the symbol won't scan — the same
  // `R-{id}` handle resolves identically by hand (see looksLikeReceivingCode).
  const handleHri = /^(?:R|RCV)-\d+$/i.test(qrPayload) ? qrPayload.toUpperCase() : '';

  const condShort = conditionLabel(payload.conditionCode, 'label');
  const condHtml = escapeHtml(condShort);

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Label</title>
<style>
  @page{size:2in 1in;margin:0}
  *,*::before,*::after{box-sizing:border-box}
  html,body{width:2in;height:1in;padding:0;margin:0;font-family:Arial,sans-serif;color:#111}
  .wrap{width:2in;height:1in;display:flex;align-items:stretch;gap:4px;padding:4px 5px}
  .info{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:space-between;height:100%}
  .row{display:flex;justify-content:space-between;align-items:baseline;gap:4px;line-height:1}
  .platform{font-size:11px;font-weight:700;color:#374151;text-transform:capitalize;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .notes{flex:1 1 auto;min-height:0;font-size:10px;font-weight:600;color:#111;text-transform:none;letter-spacing:0;text-align:center;line-height:1.12;overflow:hidden;padding:0 1px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow-wrap:anywhere;word-break:break-word;align-self:stretch;-webkit-hyphens:auto;hyphens:auto}
  .cond{font-size:13px;font-weight:900;color:#111;white-space:nowrap}
  .po{font-size:12px;font-weight:900;letter-spacing:0.3px;line-height:1.05;color:#111;white-space:nowrap;font-variant-numeric:tabular-nums}
  .date{font-size:11px;font-weight:700;color:#4b5563;white-space:nowrap;font-variant-numeric:tabular-nums}
  .qrcol{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}
  .qr{width:0.74in;height:0.74in;display:flex;align-items:center;justify-content:center}
  .qr svg{width:100%;height:100%;display:block}
  .hri{font-size:7px;font-weight:800;letter-spacing:0.3px;line-height:1;color:#111;font-family:ui-monospace,Menlo,Consolas,monospace;white-space:nowrap}
</style></head><body>
<div class="wrap">
  <div class="info">
    <div class="row">
      <span class="platform">${escapeHtml(receivingLabelPlatformDisplay(payload))}</span>
      <span class="date">${escapeHtml(payload.date)}</span>
    </div>
    <div class="notes">${escapeHtml((payload.notes || '').trim())}</div>
    <div class="row">
      <span class="cond">${condHtml}</span>
      <span class="po">${escapeHtml(receivingLabelPoCornerDisplay(payload))}</span>
    </div>
  </div>
  <div class="qrcol">
    <div class="qr">${qrSvg}</div>
    ${handleHri ? `<div class="hri">${escapeHtml(handleHri)}</div>` : ''}
  </div>
</div>
<script>
window.onload=function(){
  setTimeout(function(){window.focus();window.print();},120);
};
window.onafterprint=function(){setTimeout(function(){window.close();},80);};
</script>
</body></html>`;

  // Match the settings "Print test label" path: try the Electron silent-print
  // bridge first (printHtmlSilent → api.printHtml), which sends straight to the
  // configured/default printer. Only fall back to the browser popup + window.print()
  // when we're not in the desktop shell — that raw popup print is what throws
  // "no Windows app for printing" when no default print handler is registered.
  // The 2×1" label face is mirrored into the microns pageSize so the thermal
  // printer picks the right stock.
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
        // Raw send failed — fall through to the iframe/window.print() path
        // below, which still prints (silently under --kiosk-printing, else the
        // dialog). We do NOT toast "failed" here: window.print() is
        // fire-and-forget, so the label may well print on the fallback and a
        // failure toast would be a false alarm. Diagnostics live in the
        // Settings → Hardware "Test" button (which reports the reason).
        console.warn('printReceivingLabel: browser raw print failed, falling back:', res.reason);
      }
    }
    // 3) Dialog path — hidden iframe + the page's own window.print(). Silent
    //    only under `--kiosk-printing` (default printer); otherwise the normal
    //    print dialog. Reached when silent printing is OFF, or no silent path
    //    was available. An iframe (vs a popup) never flashes and dodges the
    //    popup blocker.
    printHtmlInIframe(html, { name: 'Receiving label' });
  })();
}

/**
 * Renders a condition code with the right typography weight. Used inside the
 * PO label preview where the label face should match the printed output's
 * letter spacing exactly.
 */
export function ConditionHeaderDisplay({ code }: { code: string }) {
  const c = String(code || 'BRAND_NEW').trim().toUpperCase();
  // Label face text comes from the shared `label` variant so the preview and
  // the printed label (printReceivingLabel above) read identically.
  const isKnown = (CONDITION_GRADES as readonly string[]).includes(c);
  const className = !isKnown
    ? 'font-semibold text-gray-800'
    : c.startsWith('USED_')
      ? 'font-black tracking-tight text-gray-900'
      : 'font-black text-gray-900';
  return <span className={className}>{conditionLabel(c, 'label')}</span>;
}
