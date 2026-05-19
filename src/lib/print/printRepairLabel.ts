import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QRCode from 'react-qr-code';
import { QR_BASE_URL } from '@/lib/barcode-routing';
import { buildRepairDetailsDeepLink } from '@/lib/repair/repair-deep-link';
import { printHtmlSilent } from '@/lib/print/silentPrint';

// 2in × 1in label in microns — mirrors RECEIVING_PAGE_SIZE so Electron's
// silent-print picks the same thermal label stock used for carton labels.
const REPAIR_PAGE_SIZE = { width: 50800, height: 25400 } as const;

export interface RepairLabelPayload {
  /** Numeric repair id — used to build the QR URL when qrValue is not provided. */
  repairId: number;
  /** Human-readable RS code, e.g. "RS-1234". Used as the bottom-right fallback when no ticket #. */
  rsCode: string;
  /** Customer first name only — shown top-left. */
  firstName: string;
  /** Optional Zendesk ticket — shown bottom-right when present, else RS code is repeated. */
  ticketNumber?: string;
  /** Pre-formatted intake/print date string shown top-right. */
  date: string;
  /** Pre-formatted due date shown bottom-left (when this repair should be completed by). */
  dueDate: string;
  /** Override the encoded URL. Defaults to the walk-in repair deep link. */
  qrValue?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The string actually encoded in the QR. Always anchors to the production
 * QR_BASE_URL so labels printed from any environment still resolve when
 * scanned — same approach the receiving label uses via mobileQrUrl().
 */
export function resolveRepairQrValue(payload: RepairLabelPayload): string {
  if (payload.qrValue && payload.qrValue.trim()) return payload.qrValue.trim();
  return buildRepairDetailsDeepLink(payload.repairId, QR_BASE_URL);
}

/** Bottom-right corner: prefer a Zendesk ticket, otherwise repeat the RS code. */
function repairLabelCornerDisplay(payload: RepairLabelPayload): string {
  const t = (payload.ticketNumber || '').trim();
  if (t && !/^RS-?\d+$/i.test(t)) return t.startsWith('#') ? t : `#${t}`;
  return payload.rsCode;
}

/**
 * Generate a 2×1" repair label with info on the left and a pre-rendered QR SVG
 * on the right. The QR encodes the walk-in repair deep link so a scanner / phone
 * opens RepairDetailsPanel for this repair without needing the app installed.
 */
export function printRepairLabel(payload: RepairLabelPayload): void {
  if (typeof window === 'undefined') return;
  const qrPayload = resolveRepairQrValue(payload);
  if (!qrPayload) return;

  const qrSvg = renderToStaticMarkup(
    React.createElement(QRCode, {
      value: qrPayload,
      size: 80,
      level: 'M',
      fgColor: '#000000',
      bgColor: '#ffffff',
    }),
  );

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
  .cond{font-size:11px;font-weight:700;color:#111;white-space:nowrap}
  .po{font-size:11px;font-weight:700;letter-spacing:0.3px;line-height:1.05;color:#111;white-space:nowrap;font-variant-numeric:tabular-nums}
  .date{font-size:11px;font-weight:700;color:#4b5563;white-space:nowrap;tabular-nums:true;font-variant-numeric:tabular-nums}
  .qr{flex:0 0 auto;width:0.86in;height:0.86in;display:flex;align-items:center;justify-content:center}
  .qr svg{width:100%;height:100%;display:block}
</style></head><body>
<div class="wrap">
  <div class="info">
    <div class="row">
      <span class="platform">${escapeHtml((payload.firstName || 'Repair').trim())}</span>
      <span class="date">${escapeHtml(payload.date)}</span>
    </div>
    <div class="notes"></div>
    <div class="row">
      <span class="cond">${escapeHtml(payload.dueDate)}</span>
      <span class="po">${escapeHtml(repairLabelCornerDisplay(payload))}</span>
    </div>
  </div>
  <div class="qr">${qrSvg}</div>
</div>
<script>
window.onload=function(){
  setTimeout(function(){window.focus();window.print();},120);
};
window.onafterprint=function(){setTimeout(function(){window.close();},80);};
</script>
</body></html>`;

  void printHtmlSilent(html, {
    pageSize: REPAIR_PAGE_SIZE,
    margins: { marginType: 'none' },
    waitMs: 250,
  }).then((handled) => {
    if (handled) return;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) {
      console.warn('printRepairLabel: popup blocked');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  });
}
