/**
 * Pure logic for the station week tables (Tech / Packer), extracted from the
 * hook + shell so it can be unit-tested without a DOM. No React imports.
 */

/** True when clicking a row that's already open (→ should close it). */
export function isDetailsReopen(selectedDetailId: number | null, clickedDetailId: number): boolean {
  return selectedDetailId !== null && clickedDetailId === selectedDetailId;
}

/**
 * Resolve the next record for up/down keyboard navigation. Returns null when
 * there is no open selection, the list is empty, the selection isn't found, or
 * stepping would run off either end.
 */
export function resolveDetailsNavigation<T>(
  orderedRecords: T[],
  selectedDetailId: number | null,
  direction: 'up' | 'down' | undefined,
  getDetailId: (record: T) => number,
): T | null {
  if (selectedDetailId === null || orderedRecords.length === 0) return null;
  const currentIndex = orderedRecords.findIndex((record) => getDetailId(record) === selectedDetailId);
  if (currentIndex < 0) return null;
  const step = direction === 'up' ? -1 : 1;
  return orderedRecords[currentIndex + step] ?? null;
}

/** Total record count across all day sections (drives the WeekHeader count). */
export function sumDaySectionCounts<T>(daySections: [string, T[]][]): number {
  return daySections.reduce((sum, [, records]) => sum + records.length, 0);
}
