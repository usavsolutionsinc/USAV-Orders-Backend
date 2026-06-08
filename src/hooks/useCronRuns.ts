import { useQuery } from '@tanstack/react-query';
import { cronRunsSummaryQuery, cronRunsListQuery } from '@/lib/queries/cron-runs-queries';

/** Latest run per job + aggregate health. Polls every 30s. */
export function useCronRunsSummary() {
  return useQuery(cronRunsSummaryQuery());
}

/** Paginated run history for the admin tab. */
export function useCronRunsList(opts: { job?: string | null; status?: string | null; offset?: number } = {}) {
  return useQuery(cronRunsListQuery(opts));
}
