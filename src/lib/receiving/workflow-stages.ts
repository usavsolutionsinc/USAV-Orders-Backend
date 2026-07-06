// Single source of truth for the inbound receiving / testing lifecycle.
//
// Every status dot, badge, phase grouping, and progress ordering across the
// receiving + testing UIs derives from this one map. Before this existed the
// same `workflow_status` rendered three different colors in three different
// files (rails vs. WORKFLOW_BADGE vs. local copies in PendingUnboxingQueue /
// PoLinesSection). Add a stage here once and it shows up everywhere, the same.
//
// Pure module — no server/client-only imports — so it is safe to import from
// client components AND server code (e.g. receive-line.ts uses the labels for
// audit notes).
//
// The DB enum (`inbound_workflow_status_enum`) is the contract; keep the keys
// below in lockstep with it. UI copy (label) may diverge from the enum name.

export type WorkflowPhase = 'INBOUND' | 'RECEIVING' | 'TESTING' | 'TERMINAL';

export interface WorkflowStageMeta {
  /** Canonical enum key. */
  status: string;
  /**
   * Monotonic position in the lifecycle — used for progress ordering and
   * "is this further along?" comparisons. Terminal branches (FAILED/RTV/SCRAP)
   * share the order of the point they branch from.
   */
  order: number;
  /** Which workspace owns this stage. */
  phase: WorkflowPhase;
  /** Short human label for rails / badges (may differ from the DB enum). */
  label: string;
  /** Tailwind `bg-*` class for the status dot — phase-grouped palette. */
  dot: string;
  /** Tailwind badge classes (bg + text). */
  badge: string;
  /** One-line description for tooltips / audit detail. */
  description: string;
}

/**
 * Phase-grouped dot palette:
 *   • Receiving  → blue family   (sky → blue → indigo as it advances)
 *   • Testing    → amber/violet/teal (awaiting → in-test → passed)
 *   • Success    → emerald       (done, fully finalized)
 *   • Terminal   → rose/slate/purple for failed / scrap / RTV
 *
 * PASSED is teal (not emerald) so "tested/passed" reads visually distinct from
 * "received/done" (emerald-600) in the rail — both hues are "positive" but
 * teal ≠ emerald at a glance, which is the signal operators need.
 */
export const WORKFLOW_STAGES: Record<string, WorkflowStageMeta> = {
  EXPECTED: {
    status: 'EXPECTED', order: 0, phase: 'INBOUND', label: 'Incoming',
    dot: 'bg-surface-strong', badge: 'bg-surface-sunken text-text-soft',
    description: 'On a PO, vendor issued it — not yet scanned at the dock.',
  },
  ARRIVED: {
    status: 'ARRIVED', order: 1, phase: 'RECEIVING', label: 'Scanned',
    dot: 'bg-sky-500', badge: 'bg-sky-100 text-sky-700',
    description: 'Scanned in at the receiving station, not yet matched to a PO.',
  },
  MATCHED: {
    status: 'MATCHED', order: 2, phase: 'RECEIVING', label: 'Matched',
    dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700',
    description: 'Matched to a PO line, staged for unboxing.',
  },
  UNBOXED: {
    status: 'UNBOXED', order: 3, phase: 'RECEIVING', label: 'Unboxed',
    dot: 'bg-indigo-500', badge: 'bg-indigo-100 text-indigo-700',
    description: 'Units counted out of the carton and into the warehouse.',
  },
  AWAITING_TEST: {
    status: 'AWAITING_TEST', order: 4, phase: 'TESTING', label: 'Awaiting Test',
    dot: 'bg-amber-400', badge: 'bg-amber-100 text-amber-700',
    description: 'Queued for QA / functional testing.',
  },
  IN_TEST: {
    status: 'IN_TEST', order: 5, phase: 'TESTING', label: 'Testing',
    dot: 'bg-violet-500', badge: 'bg-violet-100 text-violet-700',
    description: 'A tech is actively testing this line.',
  },
  PASSED: {
    status: 'PASSED', order: 6, phase: 'TESTING', label: 'Passed',
    dot: 'bg-teal-500', badge: 'bg-teal-100 text-teal-700',
    description: 'Passed testing — ready to finalize.',
  },
  FAILED: {
    status: 'FAILED', order: 6, phase: 'TERMINAL', label: 'Failed',
    dot: 'bg-rose-500', badge: 'bg-rose-100 text-rose-700',
    description: 'Failed testing — awaiting disposition (RTV / scrap / rework).',
  },
  RTV: {
    status: 'RTV', order: 7, phase: 'TERMINAL', label: 'RTV',
    dot: 'bg-purple-500', badge: 'bg-purple-100 text-purple-700',
    description: 'Returning to vendor.',
  },
  SCRAP: {
    status: 'SCRAP', order: 7, phase: 'TERMINAL', label: 'Scrap',
    dot: 'bg-slate-600', badge: 'bg-surface-strong text-text-muted', // ds-allow-raw-neutral: identity/tone hue — SCRAP's slate dot among colored lifecycle dots
    description: 'Scrapped / claimed — removed from sellable stock.',
  },
  DONE: {
    status: 'DONE', order: 8, phase: 'TERMINAL', label: 'Done',
    dot: 'bg-emerald-600', badge: 'bg-emerald-600 text-white',
    description: 'Line finalized — all units accounted for.',
  },
};

/** Fallback for unknown / legacy NULL statuses. */
export const UNKNOWN_STAGE: WorkflowStageMeta = {
  status: 'UNKNOWN', order: -1, phase: 'INBOUND', label: 'Unknown',
  dot: 'bg-border-emphasis', badge: 'bg-surface-sunken text-text-muted',
  description: 'No workflow status recorded.',
};

/** Normalize an arbitrary status value and resolve its stage metadata. */
export function workflowStage(status: string | null | undefined): WorkflowStageMeta {
  const key = String(status ?? '').trim().toUpperCase();
  return WORKFLOW_STAGES[key] ?? UNKNOWN_STAGE;
}

/** Tailwind `bg-*` class for the status dot. */
export function workflowStageDot(status: string | null | undefined): string {
  return workflowStage(status).dot;
}

/** Tailwind badge classes (bg + text). */
export function workflowStageBadge(status: string | null | undefined): string {
  return workflowStage(status).badge;
}

/** Short human label for the stage. */
export function workflowStageLabel(status: string | null | undefined): string {
  return workflowStage(status).label;
}

/** True when `a` is a strictly later lifecycle stage than `b`. */
export function isLaterStage(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return workflowStage(a).order > workflowStage(b).order;
}

// ── Coarse operator lifecycle (receiving redesign) ──────────────────────────
//
// The redesign's operator-facing receiving lifecycle is a COARSE 4-state view
// (receiving_lines.receiving_line_status), projected from the fine-grained
// inbound_workflow_status_enum above. The fine states stay authoritative for the
// testing pipeline; this projection is what the Receiving/Unbox/History modes
// show and filter on.
//
// PROBLEM is NOT a value here — it is an ORTHOGONAL exception dimension
// (receiving_lines.exception_code / receiving_exceptions) layered on ANY state,
// so a line can be SCANNED + PROBLEM. This is the SINGLE derive-SoT for
// receiving_line_status; never inline this mapping (source-of-truth.md).

export type ReceivingLineStatus = 'INCOMING' | 'SCANNED' | 'UNBOXED' | 'RECEIVED';

/** workflow_status → coarse receiving_line_status. */
const WORKFLOW_TO_LINE_STATUS: Record<string, ReceivingLineStatus> = {
  EXPECTED: 'INCOMING',
  ARRIVED: 'SCANNED',
  MATCHED: 'SCANNED',
  UNBOXED: 'UNBOXED',
  // Past unboxing the item is physically received into the building; the
  // testing/disposition states are the downstream tech pipeline → RECEIVED.
  AWAITING_TEST: 'RECEIVED',
  IN_TEST: 'RECEIVED',
  PASSED: 'RECEIVED',
  FAILED: 'RECEIVED',
  RTV: 'RECEIVED',
  SCRAP: 'RECEIVED',
  DONE: 'RECEIVED',
};

/**
 * Project the fine-grained workflow_status onto the coarse operator lifecycle.
 * Used to write receiving_lines.receiving_line_status (through the guarded
 * chokepoint) AND to derive-on-read for legacy rows whose column is still NULL.
 */
export function deriveReceivingLineStatus(
  workflowStatus: string | null | undefined,
): ReceivingLineStatus {
  const key = String(workflowStatus ?? '').trim().toUpperCase();
  return WORKFLOW_TO_LINE_STATUS[key] ?? 'INCOMING';
}

/**
 * The coarse status for a row: the stored value when present, else derived from
 * workflow_status. One reader so legacy NULLs and forward-written rows agree.
 */
export function resolveReceivingLineStatus(
  stored: string | null | undefined,
  workflowStatus: string | null | undefined,
): ReceivingLineStatus {
  const s = String(stored ?? '').trim().toUpperCase();
  if (s === 'INCOMING' || s === 'SCANNED' || s === 'UNBOXED' || s === 'RECEIVED') {
    return s as ReceivingLineStatus;
  }
  return deriveReceivingLineStatus(workflowStatus);
}
