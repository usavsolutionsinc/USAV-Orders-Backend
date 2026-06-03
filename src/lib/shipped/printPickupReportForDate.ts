/**
 * Fetch one day's shipped records and print the carrier pickup report.
 *
 * Shared by the per-day header button and the calendar picker. It always
 * fetches with `shippedFilter: 'all'` so the report is accurate regardless of
 * which tab/carrier filter the table is currently showing — a print is a rare
 * manual action, so the extra scoped query is cheap relative to correctness.
 */

import { fetchDashboardPackedRecords } from '@/lib/dashboard-table-data';
import { aggregatePickupReport } from '@/lib/shipped/pickup-report';
import { printPickupReport } from '@/lib/print/printPickupReport';
import { formatDateWithOrdinal, toPSTDateKey } from '@/utils/date';

/**
 * @param dateKey PST date key (yyyy-mm-dd) to print.
 * @returns the aggregated totals (useful for empty-day messaging).
 */
export async function printPickupReportForDate(
  dateKey: string,
): Promise<{ trackingNumbers: number; customerOrders: number; fbaOrders: number }> {
  const records = await fetchDashboardPackedRecords({
    weekStart: dateKey,
    weekEnd: dateKey,
    shippedFilter: 'all',
  });

  // The API window can include adjacent rows; keep only this PST day.
  const sameDay = records.filter((r) => {
    const src = r.created_at;
    if (!src || src === '1') return false;
    try {
      return toPSTDateKey(String(src)) === dateKey;
    } catch {
      return false;
    }
  });

  const data = aggregatePickupReport(sameDay, dateKey);
  printPickupReport(data, { dateLabel: formatDateWithOrdinal(dateKey) });
  return data.totals;
}
