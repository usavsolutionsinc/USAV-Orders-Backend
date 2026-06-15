import {
  dispatchLineUpdated,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';

/**
 * Like {@link dispatchLineUpdated}, but safe for the Unboxed recent rail.
 *
 * The by-id / PATCH refreshes the workspace fires on every line-select can't
 * always reproduce the feed's sort axis (`unboxed_at` from the carton join).
 * When those responses omit or null the stamp, merging them verbatim clobbered
 * the rail copy and re-sorted the row to the bottom on click. Strip fields
 * that must not override the rail's ordering / time label.
 */
export function dispatchUnboxRailLineUpdated(
  row: Partial<ReceivingLineRow> & { id: number },
) {
  const patch = { ...row };
  delete patch.last_activity_at;
  if (patch.unboxed_at == null) delete patch.unboxed_at;
  dispatchLineUpdated(patch);
}
