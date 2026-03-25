/**
 * Recently confirmed assignments for quick jump in WorkOrderAssignmentCard.
 * localStorage fits this use case: per-browser, no latency, survives refresh,
 * and does not require syncing across devices for a short “go back” list.
 */

const STORAGE_KEY = 'work-orders:recent-assignment-jumps';
const MAX_ENTRIES = 12;

export type RecentAssignmentJump = {
  rowId: string;
  entityType: string;
  entityId: number;
  title: string;
  queueLabel: string;
  techId: number | null;
  packerId: number | null;
  at: number;
};

function safeParse(raw: string | null): RecentAssignmentJump[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentAssignmentJump =>
          e != null &&
          typeof e === 'object' &&
          typeof (e as RecentAssignmentJump).rowId === 'string' &&
          typeof (e as RecentAssignmentJump).entityId === 'number' &&
          Number.isFinite((e as RecentAssignmentJump).entityId)
      )
      .map((e) => ({
        rowId: e.rowId,
        entityType: String(e.entityType ?? ''),
        entityId: Number(e.entityId),
        title: String(e.title ?? '').slice(0, 200),
        queueLabel: String(e.queueLabel ?? '').slice(0, 80),
        techId: e.techId != null && Number.isFinite(Number(e.techId)) ? Number(e.techId) : null,
        packerId: e.packerId != null && Number.isFinite(Number(e.packerId)) ? Number(e.packerId) : null,
        at: typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : Date.now(),
      }));
  } catch {
    return [];
  }
}

export function readRecentAssignmentJumps(): RecentAssignmentJump[] {
  if (typeof window === 'undefined') return [];
  return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

export function pushRecentAssignmentJump(
  entry: Omit<RecentAssignmentJump, 'at'> & { at?: number }
): void {
  if (typeof window === 'undefined') return;
  const at = entry.at ?? Date.now();
  const prev = readRecentAssignmentJumps();
  const next: RecentAssignmentJump[] = [
    {
      rowId: entry.rowId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      title: entry.title.slice(0, 200),
      queueLabel: entry.queueLabel.slice(0, 80),
      techId: entry.techId,
      packerId: entry.packerId,
      at,
    },
    ...prev.filter((e) => e.rowId !== entry.rowId),
  ].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // quota / private mode
  }
}
