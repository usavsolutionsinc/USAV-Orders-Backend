/**
 * Station TABLE query factories (station-table-unification-plan §7.1) — the SoT
 * for the station COUNTS queries (the sidebar legend + lane bubble headers call
 * these, not ad-hoc `fetch` keys). Query keys align with the `invalidate*Counts`
 * helpers in `station-cache-patch.ts` (`['tech-logs-counts']` /
 * `['packer-logs-counts']`) so a live scan refreshes the tally without a full
 * list refetch. The list queries themselves stay in `useTechLogs`/`usePackerLogs`.
 *
 * (Named `station-table-*` because `station-queries.ts` is already the
 * station-BUILDER definition factory — a different concern.)
 */

/** Uniform counts response (§7.2). `byLane` is re-derived client-side (Decision 12). */
export interface StationCounts {
  total: number;
  byDay: Record<string, number>;
  truncated: boolean;
}

const EMPTY_COUNTS: StationCounts = { total: 0, byDay: {}, truncated: false };

export interface TechCountsArgs {
  weekStart?: string;
  weekEnd?: string;
  /** admin.view_logs override — another tech's counts. */
  techId?: number | null;
}

export function techCountsQuery({ weekStart = '', weekEnd = '', techId = null }: TechCountsArgs) {
  const params = new URLSearchParams();
  if (weekStart) params.set('weekStart', weekStart);
  if (weekEnd) params.set('weekEnd', weekEnd);
  if (techId != null && techId > 0) params.set('techId', String(techId));
  return {
    queryKey: ['tech-logs-counts', { weekStart, weekEnd, techId }] as const,
    queryFn: async (): Promise<StationCounts> => {
      const res = await fetch(`/api/tech/logs/counts?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) return EMPTY_COUNTS;
      return (await res.json()) as StationCounts;
    },
    staleTime: 30_000,
  };
}

export interface PackerCountsArgs {
  weekStart?: string;
  weekEnd?: string;
  packedBy?: number | null;
  staff?: number | null;
}

export function packerCountsQuery({ weekStart = '', weekEnd = '', packedBy = null, staff = null }: PackerCountsArgs) {
  const params = new URLSearchParams();
  if (weekStart) params.set('weekStart', weekStart);
  if (weekEnd) params.set('weekEnd', weekEnd);
  if (packedBy != null && packedBy > 0) params.set('packedBy', String(packedBy));
  if (staff != null && staff > 0) params.set('staff', String(staff));
  return {
    queryKey: ['packer-logs-counts', { weekStart, weekEnd, packedBy, staff }] as const,
    queryFn: async (): Promise<StationCounts> => {
      const res = await fetch(`/api/packerlogs/counts?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) return EMPTY_COUNTS;
      return (await res.json()) as StationCounts;
    },
    staleTime: 30_000,
  };
}

export interface ReceivingCountsArgs {
  weekStart?: string;
  weekEnd?: string;
  staff?: number | null;
  workflowStatus?: string;
}

export function receivingCountsQuery({ weekStart = '', weekEnd = '', staff = null, workflowStatus = '' }: ReceivingCountsArgs) {
  const params = new URLSearchParams();
  if (weekStart) params.set('weekStart', weekStart);
  if (weekEnd) params.set('weekEnd', weekEnd);
  if (staff != null && staff > 0) params.set('staff', String(staff));
  if (workflowStatus) params.set('workflowStatus', workflowStatus);
  return {
    queryKey: ['receiving-lines-counts', { weekStart, weekEnd, staff, workflowStatus }] as const,
    queryFn: async (): Promise<StationCounts> => {
      const res = await fetch(`/api/receiving-lines/counts?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) return EMPTY_COUNTS;
      return (await res.json()) as StationCounts;
    },
    staleTime: 30_000,
  };
}
