import { escapeLabelHtml, printLabel } from '@/lib/print/printLabel';

/**
 * 2×1" master label for a preboxed KIT manifest (serial↔label pairing plan §5.2,
 * template `prebox_master`). The big face is the human-readable `manifest_uid`
 * (KIT-{SKU}-{YYWW}-{SEQ6}); the DataMatrix carries the SAME uid, which
 * `routeScan()` parses as a `manifest` scan → opens the manifest detail listing
 * every child unit. Violet kicker so it reads as the LOGICAL kit identity,
 * distinct from the teal LPN box label.
 */
const MANIFEST_INFO_CSS = `
  .mf-code{font-size:26px;font-weight:900;letter-spacing:0.5px;line-height:1;color:#111;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mf-meta{display:flex;justify-content:space-between;align-items:baseline;gap:6px;line-height:1}
  .mf-count{font-size:13px;font-weight:800;color:#111;white-space:nowrap}
  .mf-sku{font-size:11px;font-weight:700;color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mf-kicker{font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#7c3aed}`;

export interface ManifestLabelPayload {
  /** manifest_uid — the KIT-{SKU}-{YYWW}-{SEQ6} identity, shown + encoded. */
  manifestUid: string;
  /** Child unit count, e.g. 3 → "3 units". */
  unitCount?: number | null;
  /** SKU / kit description shown under the code. */
  sku?: string | null;
}

export function printManifestLabel(payload: ManifestLabelPayload): void {
  if (typeof window === 'undefined') return;
  const uid = (payload.manifestUid || '').trim();
  if (!uid) return;
  const count =
    payload.unitCount != null && Number.isFinite(payload.unitCount)
      ? `${Math.max(0, Math.floor(payload.unitCount))} ${payload.unitCount === 1 ? 'unit' : 'units'}`
      : '';
  const sku = (payload.sku || '').trim();

  const infoHtml = `
    <div class="mf-kicker">Prebox / Kit</div>
    <div class="mf-code">${escapeLabelHtml(uid)}</div>
    <div class="mf-meta">
      <span class="mf-count">${escapeLabelHtml(count)}</span>
      <span class="mf-sku">${escapeLabelHtml(sku)}</span>
    </div>`;

  printLabel({
    name: 'Prebox Master Label',
    infoHtml,
    infoCss: MANIFEST_INFO_CSS,
    // Plain DataMatrix carrying the manifest uid — no URL on the wire.
    dataMatrix: { value: uid, symbology: 'datamatrix', scale: 4 },
  });
}
