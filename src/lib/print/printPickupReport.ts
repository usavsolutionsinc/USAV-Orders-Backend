/**
 * Daily carrier pickup report — letter-size printout for the warehouse hand-off
 * log. Follows the same silent-print / popup-fallback pipeline as
 * {@link ./printLabel}, but renders a full-page table instead of a thermal
 * label. The computed columns (tracking counts, customer/FBA split) are
 * pre-filled; "Checked By" and "Notes" are left blank to sign by hand.
 */

import { escapeLabelHtml } from '@/lib/print/printLabel';
import { printHtmlSilent } from '@/lib/print/silentPrint';
import type { PickupReportData } from '@/lib/shipped/pickup-report';

export interface PickupReportPrintOptions {
  /** Human-readable date for the report header (e.g. "June 3rd, 2026"). */
  dateLabel: string;
  /** Optional org/title line above the report. */
  title?: string;
}

function row(
  carrier: string,
  trackingNumbers: number | '',
  customerOrders: number | '',
  fbaOrders: number | '',
  opts: { strong?: boolean } = {},
): string {
  const cls = opts.strong ? ' class="total"' : '';
  return `<tr${cls}>
    <td class="carrier">${escapeLabelHtml(carrier)}</td>
    <td class="num">${trackingNumbers === '' ? '' : escapeLabelHtml(String(trackingNumbers))}</td>
    <td class="num">${customerOrders === '' ? '' : escapeLabelHtml(String(customerOrders))}</td>
    <td class="num">${fbaOrders === '' ? '' : escapeLabelHtml(String(fbaOrders))}</td>
    <td class="hand"></td>
    <td class="hand"></td>
  </tr>`;
}

/** Build the full letter-size report HTML document. Exposed for tests/preview. */
export function buildPickupReportHtml(
  data: PickupReportData,
  opts: PickupReportPrintOptions,
): string {
  const title = escapeLabelHtml(opts.title ?? 'Shipped Report');
  const dateLabel = escapeLabelHtml(opts.dateLabel);

  const bodyRows = data.rows
    .map((r) => row(r.carrier, r.trackingNumbers, r.customerOrders, r.fbaOrders))
    .join('\n');

  const totalRow = row(
    'Total',
    data.totals.trackingNumbers,
    data.totals.customerOrders,
    data.totals.fbaOrders,
    { strong: true },
  );

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${title} — ${dateLabel}</title>
<style>
  @page{size:Letter;margin:0.6in}
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:18px}
  .head h1{font-size:18px;margin:0;letter-spacing:.3px}
  .head .date{font-size:14px;font-weight:700}
  .head .date small{display:block;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#666;text-align:right}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #999;padding:8px 10px;text-align:left;vertical-align:middle}
  th{background:#f1f1f1;font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:#333}
  td.carrier{font-weight:700;font-size:13px;width:14%}
  td.num{text-align:center;font-size:14px;font-weight:600;width:13%;font-variant-numeric:tabular-nums}
  td.hand{width:auto;height:34px}
  tr.total td{background:#f7f7f7;font-weight:800;border-top:2px solid #111}
  .note{margin-top:10px;font-size:10px;color:#777;font-style:italic}
  .sign{display:flex;gap:40px;margin-top:34px;font-size:11px}
  .sign .field{flex:1}
  .sign .line{border-bottom:1px solid #111;height:26px}
  .sign .lbl{margin-top:4px;font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:#555}
</style></head><body>
  <div class="head">
    <h1>${title}</h1>
    <div class="date"><small>Shipped Date</small>${dateLabel}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Carrier</th>
        <th style="text-align:center">Total Tracking #s</th>
        <th style="text-align:center">Customer Orders</th>
        <th style="text-align:center">FBA Orders</th>
        <th>Checked By</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      ${totalRow}
    </tbody>
  </table>
  <div class="sign">
    <div class="field" style="flex:0 0 60%"><div class="line"></div><div class="lbl">Checked By (Signature)</div></div>
  </div>
<script>
window.onload=function(){setTimeout(function(){window.focus();window.print();},150);};
window.onafterprint=function(){setTimeout(function(){window.close();},80);};
</script>
</body></html>`;
}

/**
 * Render and print the daily pickup report. Tries Electron silent-print first;
 * falls back to a browser popup + window.print() outside the desktop shell.
 */
export function printPickupReport(
  data: PickupReportData,
  opts: PickupReportPrintOptions,
): void {
  if (typeof window === 'undefined') return;
  const html = buildPickupReportHtml(data, opts);

  void printHtmlSilent(html, {
    pageSize: 'Letter',
    margins: { marginType: 'default' },
    waitMs: 300,
  }).then((handled) => {
    if (handled) return;
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) {
      console.warn('printPickupReport: popup blocked');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  });
}
