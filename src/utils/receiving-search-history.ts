/**
 * localStorage-backed history of recent tracking searches in the Receiving
 * page's History tab. Surfaced in `RecentSearchesRail` so the operator can
 * re-open a previously looked-up PO with one click instead of re-typing.
 *
 * Per-browser, dedupe by tracking, capped — same shape as
 * `work-order-recent-assignments.ts`.
 */

const STORAGE_KEY = 'usav.receiving.recent-searches';
const MAX_ENTRIES = 20;
const UPDATE_EVENT = 'usav-receiving-search-history-updated';

export type ReceivingSearchEntry = {
  tracking: string;
  receivingId: number;
  lineCount: number;
  at: number;
};

function safeParse(raw: string | null): ReceivingSearchEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is ReceivingSearchEntry =>
          e != null &&
          typeof e === 'object' &&
          typeof (e as ReceivingSearchEntry).tracking === 'string' &&
          (e as ReceivingSearchEntry).tracking.length > 0 &&
          typeof (e as ReceivingSearchEntry).receivingId === 'number' &&
          Number.isFinite((e as ReceivingSearchEntry).receivingId),
      )
      .map((e) => ({
        tracking: String(e.tracking).slice(0, 64),
        receivingId: Number(e.receivingId),
        lineCount: Number.isFinite(Number(e.lineCount)) ? Number(e.lineCount) : 0,
        at: typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : Date.now(),
      }));
  } catch {
    return [];
  }
}

export function readReceivingSearchHistory(): ReceivingSearchEntry[] {
  if (typeof window === 'undefined') return [];
  return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

export function pushReceivingSearchHistory(
  entry: Omit<ReceivingSearchEntry, 'at'> & { at?: number },
): void {
  if (typeof window === 'undefined') return;
  const tracking = entry.tracking.trim();
  if (!tracking || !Number.isFinite(entry.receivingId) || entry.receivingId <= 0) return;
  const at = entry.at ?? Date.now();
  const prev = readReceivingSearchHistory();
  const next: ReceivingSearchEntry[] = [
    {
      tracking,
      receivingId: entry.receivingId,
      lineCount: Number.isFinite(entry.lineCount) ? entry.lineCount : 0,
      at,
    },
    // Dedupe by tracking (case-insensitive) — re-searching moves the entry to
    // the top instead of cluttering the rail with duplicates.
    ...prev.filter((e) => e.tracking.toLowerCase() !== tracking.toLowerCase()),
  ].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  } catch {
    // quota / private mode — fail silent
  }
}

export function clearReceivingSearchHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  } catch {
    // ignore
  }
}

export const RECEIVING_SEARCH_HISTORY_EVENT = UPDATE_EVENT;
