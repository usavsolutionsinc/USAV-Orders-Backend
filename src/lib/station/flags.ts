/**
 * Station-table rollout flags (station-table-unification-plan §10). Client-read
 * `NEXT_PUBLIC_*` gates, default OFF, so the new unified `StationListTable` path
 * and the Pipeline boards ship dark and light up per staged bake-in — the legacy
 * `StationWeekTable` stays the default until `NEXT_PUBLIC_STATION_VIRTUAL_LIST=1`.
 */
export const STATION_VIRTUAL_LIST = process.env.NEXT_PUBLIC_STATION_VIRTUAL_LIST === '1';
export const STATION_PIPELINE_BOARDS = process.env.NEXT_PUBLIC_STATION_PIPELINE_BOARDS === '1';
