import { repairHandle } from '@/lib/barcode-routing';
import { escapeLabelHtml, printLabel } from '@/lib/print/printLabel';

// Repair metadata laid out top/middle/bottom in the shared label's info column.
const REPAIR_INFO_CSS = `
  .row{display:flex;justify-content:space-between;align-items:baseline;gap:4px;line-height:1}
  .platform{font-size:11px;font-weight:700;color:#374151;text-transform:capitalize;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .notes{flex:1 1 auto;min-height:0;font-size:10px;font-weight:600;color:#111;text-transform:none;letter-spacing:0;text-align:center;line-height:1.12;overflow:hidden;padding:0 1px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow-wrap:anywhere;word-break:break-word;align-self:stretch;-webkit-hyphens:auto;hyphens:auto}
  .cond{font-size:11px;font-weight:700;color:#111;white-space:nowrap}
  .po{font-size:11px;font-weight:700;letter-spacing:0.3px;line-height:1.05;color:#111;white-space:nowrap;font-variant-numeric:tabular-nums}
  .date{font-size:11px;font-weight:700;color:#4b5563;white-space:nowrap;font-variant-numeric:tabular-nums}`;

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

/**
 * The string actually encoded in the printed DataMatrix. Bare handle
 * `REP-{id}` — `routeScan()` parses the prefix and navigates to
 * /m/rs/{id} (the mobile repair-service detail page). No URL on the wire.
 */
export function resolveRepairQrValue(payload: RepairLabelPayload): string {
  if (payload.qrValue && payload.qrValue.trim()) return payload.qrValue.trim();
  return repairHandle(payload.repairId);
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
  const qrValue = resolveRepairQrValue(payload);
  if (!qrValue) return;

  const infoHtml = `
    <div class="row">
      <span class="platform">${escapeLabelHtml((payload.firstName || 'Repair').trim())}</span>
      <span class="date">${escapeLabelHtml(payload.date)}</span>
    </div>
    <div class="notes"></div>
    <div class="row">
      <span class="cond">${escapeLabelHtml(payload.dueDate)}</span>
      <span class="po">${escapeLabelHtml(repairLabelCornerDisplay(payload))}</span>
    </div>`;

  // DataMatrix (`REP-{id}` handle) — routeScan() routes to /m/rs/{id}.
  printLabel({
    name: 'Label',
    infoHtml,
    infoCss: REPAIR_INFO_CSS,
    dataMatrix: { value: qrValue, symbology: 'datamatrix', scale: 4 },
  });
}
