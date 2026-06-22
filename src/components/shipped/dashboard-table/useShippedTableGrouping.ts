'use client';

import { useMemo } from 'react';
import { toPSTDateKey } from '@/utils/date';
import type { DerivedPackerRecord } from '@/lib/shipped-records';

export interface ShippedTableGrouping {
  /** `[date, records]` bands, newest day first, each day's rows newest-first. */
  daySections: [string, DerivedPackerRecord[]][];
  /** Flat on-screen order — used for keyboard nav + multi-select rows. */
  orderedRecords: DerivedPackerRecord[];
  /** Total dated records across all bands. */
  totalCount: number;
}

/** Newest-first by packed time (created_at), falling back to scan-out time. */
function byNewest(a: DerivedPackerRecord, b: DerivedPackerRecord): number {
  const timeA = new Date(a.created_at || a.effShipTime || 0).getTime();
  const timeB = new Date(b.created_at || b.effShipTime || 0).getTime();
  return timeB - timeA;
}

/**
 * Bands the derived records into day sections (newest day first), sorts each
 * day newest-first, and flattens to a single on-screen order so keyboard nav
 * and shift-range select line up with what's rendered.
 *
 * Records are filed under the day they were PACKED (created_at = pack-scan
 * time), matching the packing photo / camera timeline; effShipTime (scan-out)
 * is only a last-resort fallback for rows with no pack time.
 */
export function useShippedTableGrouping(derivedRecords: DerivedPackerRecord[]): ShippedTableGrouping {
  return useMemo(() => {
    const groups: Record<string, DerivedPackerRecord[]> = {};
    derivedRecords.forEach((record) => {
      const dateSource = record.created_at || record.effShipTime;
      if (!dateSource || dateSource === '1') return;
      let date = '';
      try {
        date = toPSTDateKey(String(dateSource)) || 'Unknown';
      } catch { date = 'Unknown'; }
      if (!groups[date]) groups[date] = [];
      groups[date].push(record);
    });

    const daySections: [string, DerivedPackerRecord[]][] = Object.entries(groups)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, dayRecords]) => [date, [...dayRecords].sort(byNewest)] as [string, DerivedPackerRecord[]]);

    const orderedRecords = daySections.flatMap(([, dayRecords]) => dayRecords);
    const totalCount = orderedRecords.length;

    return { daySections, orderedRecords, totalCount };
  }, [derivedRecords]);
}
