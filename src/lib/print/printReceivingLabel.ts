import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QRCode from 'react-qr-code';
import { getLast4 } from '@/components/ui/CopyChip';
import { mobileQrUrl } from '@/lib/barcode-routing';

export interface ReceivingLabelPayload {
  /** Numeric receiving id — used to build the QR URL when qrValue is not provided. */
  receivingId?: number | null;
  /** Human-readable PO/RCV id; corner shows last‑4 unless `zendeskTicket` yields a ticket #. */
  scanValue: string;
  /** Override the encoded URL. Defaults to `${origin}/m/r/{receivingId}`. */
  qrValue?: string;
  platform: string;
  /** Sidebar Zendesk field — only an all‑digits ticket (# optional) replaces PO last‑4; URLs/other text uses PO shorthand. */
  zendeskTicket?: string;
  /** Support / line notes shown in the center of the label (any free text). */
  notes: string;
  conditionCode: string;
  date: string;
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
 * Parses the sidebar Zendesk field for label print: **only** a plain ticket #
 * — optional leading `#`, optional spaces, digits only everywhere else.
 * Any URL or free text yields null; corner then shows PO last‑4 shorthand.
 */
function zendeskTicketNumberForLabel(raw: string | null | undefined): string | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;

  if (/https?:\/\//i.test(t) || /\.zendesk\./i.test(t) || /\/(?:agent\/)?tickets\//i.test(t)) {
    return null;
  }

  const compact = t.replace(/\s+/g, '');
  const digitsOnly = /^#?(\d+)$/.exec(compact);
  return digitsOnly ? digitsOnly[1] : null;
}

/** Bottom‑right carton label: `#ticket` only for numeric Zendesk id; otherwise PO last‑4. */
export function receivingLabelPoCornerDisplay(payload: ReceivingLabelPayload): string {
  const fromZk = zendeskTicketNumberForLabel(payload.zendeskTicket);
  if (fromZk) return `#${fromZk}`;
  return getLast4(payload.scanValue);
}

function conditionShort(code: string | null | undefined): string {
  const c = String(code || 'BRAND_NEW').trim().toUpperCase();
  if (c === 'BRAND_NEW') return 'New';
  if (c === 'PARTS') return 'Parts';
  if (c.startsWith('USED_')) {
    const letter = c.replace('USED_', '');
    return `USED-${letter}`;
  }
  return c.replace(/_/g, ' ');
}

/**
 * The string actually encoded in the QR. Prefers an explicit qrValue,
 * then derives the absolute production URL via {@link mobileQrUrl}, then
 * falls back to the human-readable scanValue for back-compat. Always anchors
 * to the production domain so labels printed from any environment work.
 */
export function resolveReceivingQrValue(payload: ReceivingLabelPayload): string {
  if (payload.qrValue && payload.qrValue.trim()) return payload.qrValue.trim();
  if (payload.receivingId != null && Number.isFinite(payload.receivingId)) {
    return mobileQrUrl('r', payload.receivingId);
  }
  return payload.scanValue.trim();
}

/**
 * Generate a 2×1" label with info on the left and a pre-rendered QR SVG on
 * the right. The QR encodes a URL into the mobile carton page so phones
 * scanning it open the right screen without needing the app installed.
 */
export function printReceivingLabel(payload: ReceivingLabelPayload): void {
  if (typeof window === 'undefined') return;
  const qrPayload = resolveReceivingQrValue(payload);
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

  const condHtml = escapeHtml(conditionShort(payload.conditionCode));

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
  .date{font-size:11px;font-weight:700;color:#4b5563;white-space:nowrap;tabular-nums:true;font-variant-numeric:tabular-nums}
  .qr{flex:0 0 auto;width:0.86in;height:0.86in;display:flex;align-items:center;justify-content:center}
  .qr svg{width:100%;height:100%;display:block}
</style></head><body>
<div class="wrap">
  <div class="info">
    <div class="row">
      <span class="platform">${escapeHtml(payload.platform)}</span>
      <span class="date">${escapeHtml(payload.date)}</span>
    </div>
    <div class="notes">${escapeHtml((payload.notes || '').trim())}</div>
    <div class="row">
      <span class="cond">${condHtml}</span>
      <span class="po">${escapeHtml(receivingLabelPoCornerDisplay(payload))}</span>
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

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) {
    console.warn('printReceivingLabel: popup blocked');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
