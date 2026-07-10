/**
 * Station-table rollout flags (station-table-unification-plan §10). Client-read
 * `NEXT_PUBLIC_*` gates, default OFF, so the new unified `StationListTable` path
 * and the Pipeline boards ship dark and light up per staged bake-in — the legacy
 * `StationWeekTable` stays the default until `NEXT_PUBLIC_STATION_VIRTUAL_LIST=1`.
 */
export const STATION_VIRTUAL_LIST = process.env.NEXT_PUBLIC_STATION_VIRTUAL_LIST === '1';
export const STATION_PIPELINE_BOARDS = process.env.NEXT_PUBLIC_STATION_PIPELINE_BOARDS === '1';

/**
 * Packer testing-label photo scan → phone capture → unit photo timeline
 * (docs/todo/packer-testing-photo-scan-timeline-plan.md). Client-read gate,
 * default OFF, so the feature ships dark: when OFF the station scan never fires
 * a `unit_photo_request` and the phone never mounts the `UnitPhotoRequestCamera`
 * listener. Flip `NEXT_PUBLIC_UNIT_SCAN_PHOTOS=1` to light it up.
 */
export const UNIT_SCAN_PHOTOS = process.env.NEXT_PUBLIC_UNIT_SCAN_PHOTOS === '1';
