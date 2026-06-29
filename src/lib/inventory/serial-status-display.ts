/**
 * Serial-unit lifecycle status → display (label + dot class).
 *
 * The single source of truth for how a `serial_units.current_status` renders in
 * UI: a short human label and a Tailwind `bg-*` dot class. Mirrors the house
 * pattern set by `workflowStageDot` (`src/lib/receiving/workflow-stages.ts`) —
 * a status→class function, so no component inlines per-status colors. Distinct
 * from `workflow-stages.ts`, which models the *receiving inbound* workflow
 * (EXPECTED…DONE); this models the *unit lifecycle* the state machine emits
 * (RECEIVED…SHIPPED…RETURNED).
 *
 * Tones reuse the already-generated semantic shades (no new hues): gray = inert,
 * blue = in-process, amber = attention/hold, emerald = stocked/done,
 * rose = terminal-bad, violet = post-sale (returned/RMA/repair).
 */

interface SerialStatusMeta {
  /** Short, glanceable label. */
  label: string;
  /** Tailwind `bg-*` class for the status dot. */
  dot: string;
}

const SERIAL_STATUS_META: Record<string, SerialStatusMeta> = {
  RECEIVED: { label: 'Received', dot: 'bg-gray-400' },
  TRIAGED: { label: 'Triaged', dot: 'bg-gray-400' },
  IN_TEST: { label: 'In test', dot: 'bg-blue-500' },
  TESTED: { label: 'Tested', dot: 'bg-blue-500' },
  GRADED: { label: 'Graded', dot: 'bg-blue-500' },
  STOCKED: { label: 'In stock', dot: 'bg-emerald-500' },
  ALLOCATED: { label: 'Allocated', dot: 'bg-blue-500' },
  PICKING: { label: 'Picking', dot: 'bg-blue-500' },
  PICKED: { label: 'Picked', dot: 'bg-blue-500' },
  PACKING: { label: 'Packing', dot: 'bg-blue-500' },
  PACKED: { label: 'Packed', dot: 'bg-blue-500' },
  LABELED: { label: 'Labeled', dot: 'bg-blue-500' },
  STAGED: { label: 'Staged', dot: 'bg-blue-500' },
  LOADING: { label: 'Loading', dot: 'bg-blue-500' },
  SHIPPED: { label: 'Shipped', dot: 'bg-emerald-600' },
  RETURNED: { label: 'Returned', dot: 'bg-violet-500' },
  RMA: { label: 'RMA', dot: 'bg-violet-500' },
  IN_REPAIR: { label: 'In repair', dot: 'bg-violet-500' },
  REPAIR_DONE: { label: 'Repaired', dot: 'bg-violet-500' },
  ON_HOLD: { label: 'On hold', dot: 'bg-amber-500' },
  SCRAPPED: { label: 'Scrapped', dot: 'bg-rose-500' },
  UNKNOWN: { label: 'Unknown', dot: 'bg-gray-300' },
};

const UNKNOWN_STATUS: SerialStatusMeta = SERIAL_STATUS_META.UNKNOWN;

function meta(status: string | null | undefined): SerialStatusMeta {
  const key = String(status ?? '').trim().toUpperCase();
  return SERIAL_STATUS_META[key] ?? UNKNOWN_STATUS;
}

/** Short human label for a serial-unit lifecycle status. */
export function serialStatusLabel(status: string | null | undefined): string {
  return meta(status).label;
}

/** Tailwind `bg-*` class for the serial-unit status dot. */
export function serialStatusDot(status: string | null | undefined): string {
  return meta(status).dot;
}
