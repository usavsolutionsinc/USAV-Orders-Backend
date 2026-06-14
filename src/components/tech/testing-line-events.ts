import {
  dispatchLineUpdated,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';

/**
 * Like {@link dispatchLineUpdated}, but strips `last_activity_at` before it
 * reaches the rail. The Testing rail orders + renders by the tester's verdict
 * time (the API folds `tested_at` into `last_activity_at` for view=testing).
 * The by-id / PATCH refreshes the testing workspace fires on every line-select
 * can't reproduce that tester-scoped verdict time — they recompute
 * `last_activity_at` from the carton's scan/receive/import time. Dispatching
 * those rows verbatim clobbered the rail's "12h" with the scan time the instant
 * a row was clicked, so the relative timestamp jumped. Omitting the field lets
 * the merge keep the verdict time the rail already holds.
 */
export function dispatchTestingLineUpdated(
  row: Partial<ReceivingLineRow> & { id: number },
) {
  const patch = { ...row };
  delete patch.last_activity_at;
  dispatchLineUpdated(patch);
}
