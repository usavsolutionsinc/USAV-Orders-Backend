import { getLast4 } from '@/components/ui/CopyChip';
import { receivingHandle } from '@/lib/barcode-routing';
import { escapeLabelHtml, printLabel } from '@/lib/print/printLabel';

// Carton metadata laid out top/middle/bottom in the shared label's info column.
const RECEIVING_INFO_CSS = `
  .row{display:flex;justify-content:space-between;align-items:baseline;gap:4px;line-height:1}
  .platform{font-size:11px;font-weight:700;color:#374151;text-transform:capitalize;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .notes{flex:1 1 auto;min-height:0;font-size:10px;font-weight:600;color:#111;text-transform:none;letter-spacing:0;text-align:center;line-height:1.12;overflow:hidden;padding:0 1px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow-wrap:anywhere;word-break:break-word;align-self:stretch;-webkit-hyphens:auto;hyphens:auto}
  .cond{font-size:13px;font-weight:900;color:#111;white-space:nowrap}
  .po{font-size:12px;font-weight:900;letter-spacing:0.3px;line-height:1.05;color:#111;white-space:nowrap;font-variant-numeric:tabular-nums}
  .date{font-size:11px;font-weight:700;color:#4b5563;white-space:nowrap;font-variant-numeric:tabular-nums}`;

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
  /**
   * Carton's carrier tracking number. Used as the corner-display fallback
   * when there's no PO (scanValue is an internal `RCV-{id}` handle).
   */
  trackingNumber?: string | null;
  /** Support / line notes shown in the center of the label (any free text). */
  notes: string;
  conditionCode: string;
  date: string;
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

/**
 * Bottom‑right carton label preference order:
 *   1. `#ticket` for a numeric Zendesk id
 *   2. Last‑4 of the PO# / scanValue (matched cartons)
 *   3. Last‑4 of the carton tracking number (unmatched cartons — scanValue
 *      is `RCV-{id}` which is meaningless to the operator)
 */
export function receivingLabelPoCornerDisplay(payload: ReceivingLabelPayload): string {
  const fromZk = zendeskTicketNumberForLabel(payload.zendeskTicket);
  if (fromZk) return `#${fromZk}`;
  const sv = String(payload.scanValue || '').trim();
  const isInternalRcv = /^RCV-\d+$/i.test(sv);
  if (isInternalRcv) {
    const tracking = String(payload.trackingNumber || '').trim();
    if (tracking) return getLast4(tracking);
  }
  return getLast4(sv);
}

function conditionShort(code: string | null | undefined): string {
  const c = String(code || 'BRAND_NEW').trim().toUpperCase();
  if (c === 'BRAND_NEW') return 'New';
  if (c === 'LIKE_NEW') return 'Like New';
  if (c === 'REFURBISHED') return 'Refurb';
  if (c === 'PARTS') return 'Parts';
  if (c.startsWith('USED_')) {
    const letter = c.replace('USED_', '');
    return `USED-${letter}`;
  }
  return c.replace(/_/g, ' ');
}

/**
 * The string actually encoded in the carton DataMatrix. Prefers an
 * explicit qrValue override (legacy callsites still pass a full URL),
 * then derives the bare handle `R-{id}` via {@link receivingHandle},
 * then falls back to the human-readable scanValue for back-compat.
 *
 * Industry-standard for internal warehouse handles: no URL, no host. The
 * internal scanner recognises the `R-{id}` prefix in `routeScan()` and
 * navigates to `/m/r/{id}`. Consumer phone cameras see opaque text.
 */
export function resolveReceivingQrValue(payload: ReceivingLabelPayload): string {
  if (payload.qrValue && payload.qrValue.trim()) return payload.qrValue.trim();
  if (payload.receivingId != null && Number.isFinite(payload.receivingId)) {
    return receivingHandle(payload.receivingId);
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
  const qrValue = resolveReceivingQrValue(payload);
  if (!qrValue) return;

  const infoHtml = `
    <div class="row">
      <span class="platform">${escapeLabelHtml(payload.platform)}</span>
      <span class="date">${escapeLabelHtml(payload.date)}</span>
    </div>
    <div class="notes">${escapeLabelHtml((payload.notes || '').trim())}</div>
    <div class="row">
      <span class="cond">${escapeLabelHtml(conditionShort(payload.conditionCode))}</span>
      <span class="po">${escapeLabelHtml(receivingLabelPoCornerDisplay(payload))}</span>
    </div>`;

  // Plain DataMatrix carrying the `R-{id}` handle — `routeScan()` parses
  // the prefix and navigates to /m/r/{id}. No URL on the wire.
  printLabel({
    name: 'Label',
    infoHtml,
    infoCss: RECEIVING_INFO_CSS,
    dataMatrix: { value: qrValue, symbology: 'datamatrix', scale: 4 },
  });
}
