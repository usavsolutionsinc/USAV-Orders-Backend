import { handlingUnitHandle } from '@/lib/barcode-routing';
import { escapeLabelHtml, printLabel } from '@/lib/print/printLabel';

/**
 * 2×1" license-plate (LPN) label for a handling unit (box/tray). The big face
 * is the human-readable `H-{id}` code; the DataMatrix carries the same bare
 * `H-{id}` handle, which `routeScan()` parses → `/m/h/{id}` (and the testing
 * resolver fans out to every unit in the box). Visually distinct from the
 * receiving carton label (which leads with platform/PO) — this one is all about
 * the box identity.
 */
const HANDLING_UNIT_INFO_CSS = `
  .hu-code{font-size:30px;font-weight:900;letter-spacing:0.5px;line-height:1;color:#111;font-variant-numeric:tabular-nums}
  .hu-meta{display:flex;justify-content:space-between;align-items:baseline;gap:6px;line-height:1}
  .hu-count{font-size:13px;font-weight:800;color:#111;white-space:nowrap}
  .hu-loc{font-size:11px;font-weight:700;color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hu-date{font-size:11px;font-weight:700;color:#4b5563;white-space:nowrap;font-variant-numeric:tabular-nums}
  .hu-kicker{font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#6b7280}`;

export interface HandlingUnitLabelPayload {
  /** Numeric handling_units.id — used to build the H- handle + DataMatrix. */
  handlingUnitId: number;
  /** Stored code; defaults to `H-{id}` when omitted. Shown on the big face. */
  code?: string | null;
  /** Member count, e.g. 4 → "4 units". */
  unitCount?: number | null;
  /** Optional bin/zone name where the box lives. */
  locationName?: string | null;
  /** Display date string (already formatted by the caller). */
  date?: string | null;
}

export function printHandlingUnitLabel(payload: HandlingUnitLabelPayload): void {
  if (typeof window === 'undefined') return;
  const handle = handlingUnitHandle(payload.handlingUnitId);
  const code = (payload.code && payload.code.trim()) || handle;
  const count = payload.unitCount != null && Number.isFinite(payload.unitCount)
    ? `${Math.max(0, Math.floor(payload.unitCount))} ${payload.unitCount === 1 ? 'unit' : 'units'}`
    : '';
  const loc = (payload.locationName || '').trim();
  const date = (payload.date || '').trim();

  const infoHtml = `
    <div class="hu-kicker">Box / LPN</div>
    <div class="hu-code">${escapeLabelHtml(code)}</div>
    <div class="hu-meta">
      <span class="hu-count">${escapeLabelHtml(count)}</span>
      <span class="hu-date">${escapeLabelHtml(date)}</span>
    </div>
    <div class="hu-loc">${escapeLabelHtml(loc)}</div>`;

  printLabel({
    name: 'Box Label',
    infoHtml,
    infoCss: HANDLING_UNIT_INFO_CSS,
    // Plain DataMatrix carrying the `H-{id}` handle — no URL on the wire.
    dataMatrix: { value: handle, symbology: 'datamatrix', scale: 4 },
  });
}
