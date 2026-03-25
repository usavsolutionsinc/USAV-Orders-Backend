/**
 * Human-facing FBA **plan** code stored in `fba_shipments.shipment_ref`.
 * This is not the internal DB row id (`fba_shipments.id`) and not the Amazon FBA shipment id.
 *
 * Format: `FBA-MM-DD-YY` from a calendar date only (no time-of-day).
 *
 * @param isoYmd - `YYYY-MM-DD` (e.g. Postgres `CURRENT_DATE::text` or `due_date`)
 */
export function buildFbaPlanRefFromIsoDate(isoYmd: string): string {
  const raw = String(isoYmd || '').trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return 'FBA-00-00-00';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || !month || !day) return 'FBA-00-00-00';
  const yy = String(year % 100).padStart(2, '0');
  return `FBA-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${yy}`;
}
