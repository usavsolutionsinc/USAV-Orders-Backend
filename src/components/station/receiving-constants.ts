// Shared constants for all receiving-related components.
// Import from here instead of defining inline in each component.

import type { ComponentType } from 'react';
import { WORKFLOW_STAGES } from '@/lib/receiving/workflow-stages';
import { PackageCheck, Clock, Truck, Package } from '@/components/Icons';
import {
  CONDITION_GRADES,
  CONDITION_LABELS,
  conditionLabel,
  conditionGradeTableLabel,
} from '@/lib/conditions';

// Condition-grade labels live in one place now — see src/lib/conditions.ts.
// Re-exported here so existing `from '@/components/station/receiving-constants'`
// import sites keep working.
export { conditionLabel, conditionGradeTableLabel };

// ─── Dropdown option arrays ───────────────────────────────────────────────────

export const QA_OPTS = [
  { value: 'PENDING',           label: 'Pending' },
  { value: 'PASSED',            label: 'Passed' },
  { value: 'FAILED_DAMAGED',    label: 'Failed Damaged' },
  { value: 'FAILED_INCOMPLETE', label: 'Failed Incomplete' },
  { value: 'FAILED_FUNCTIONAL', label: 'Failed Functional' },
  { value: 'HOLD',              label: 'Hold' },
];

export const DISPOSITION_OPTS = [
  { value: 'ACCEPT', label: 'Accept' },
  { value: 'HOLD',   label: 'Hold' },
  { value: 'RTV',    label: 'Return to Seller' },
  { value: 'SCRAP',  label: 'Claim' },
  { value: 'REWORK', label: 'Repair' },
];

export const CARRIER_OPTS = [
  'Unknown', 'UPS', 'FedEx', 'USPS', 'AMAZON', 'DHL', 'AliExpress', 'GoFo', 'UniUni', 'LOCAL',
].map((v) => ({ value: v, label: v }));

// For the bulk-scan carrier pill selector (empty value = auto-detect)
export const RECEIVING_CARRIERS = [
  { value: '',           label: 'Auto' },
  { value: 'UPS',        label: 'UPS' },
  { value: 'FEDEX',      label: 'FedEx' },
  { value: 'USPS',       label: 'USPS' },
  { value: 'AMAZON',     label: 'AMZ' },
  { value: 'DHL',        label: 'DHL' },
  { value: 'UNIUNI',     label: 'UniUni' },
  { value: 'GOFO',       label: 'GoFo' },
  { value: 'ALIEXPRESS', label: 'AliEx' },
];

export const CONDITION_OPTS = CONDITION_GRADES.map((v) => ({
  value: v,
  label: conditionLabel(v, 'option'),
}));

// ─── Pill-button option arrays (active/inactive Tailwind classes) ─────────────

export const QA_BTN_OPTS = [
  { value: 'PENDING',           label: 'Pending',    active: 'bg-gray-600 text-white',      inactive: 'bg-gray-100 text-gray-500' },
  { value: 'PASSED',            label: 'Passed',     active: 'bg-emerald-500 text-white',   inactive: 'bg-gray-100 text-gray-500' },
  { value: 'FAILED_DAMAGED',    label: 'Damaged',    active: 'bg-red-500 text-white',       inactive: 'bg-gray-100 text-gray-500' },
  { value: 'FAILED_INCOMPLETE', label: 'Incomplete', active: 'bg-orange-400 text-white',    inactive: 'bg-gray-100 text-gray-500' },
  { value: 'FAILED_FUNCTIONAL', label: 'Functional', active: 'bg-rose-500 text-white',      inactive: 'bg-gray-100 text-gray-500' },
  { value: 'HOLD',              label: 'Hold',       active: 'bg-yellow-400 text-gray-900', inactive: 'bg-gray-100 text-gray-500' },
];

export const DISP_BTN_OPTS = [
  { value: 'ACCEPT', label: 'Accept', active: 'bg-emerald-500 text-white',      inactive: 'bg-gray-100 text-gray-500' },
  { value: 'HOLD',   label: 'Hold',   active: 'bg-yellow-400 text-gray-900',    inactive: 'bg-gray-100 text-gray-500' },
  { value: 'RTV',    label: 'RTV',    active: 'bg-purple-500 text-white',       inactive: 'bg-gray-100 text-gray-500' },
  { value: 'SCRAP',  label: 'Scrap',  active: 'bg-gray-700 text-white',         inactive: 'bg-gray-100 text-gray-500' },
  { value: 'REWORK', label: 'Rework', active: 'bg-blue-500 text-white',         inactive: 'bg-gray-100 text-gray-500' },
];

// ─── Badge class maps ─────────────────────────────────────────────────────────

export const QA_BADGE: Record<string, string> = {
  PENDING:           'bg-gray-100 text-gray-500',
  PASSED:            'bg-emerald-100 text-emerald-700',
  FAILED_DAMAGED:    'bg-red-100 text-red-600',
  FAILED_INCOMPLETE: 'bg-orange-100 text-orange-600',
  FAILED_FUNCTIONAL: 'bg-rose-100 text-rose-700',
  HOLD:              'bg-yellow-100 text-yellow-700',
};

export const DISP_BADGE: Record<string, string> = {
  ACCEPT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  HOLD:   'bg-yellow-50 text-yellow-700 border-yellow-200',
  RTV:    'bg-purple-50 text-purple-700 border-purple-200',
  SCRAP:  'bg-gray-100 text-gray-500 border-gray-200',
  REWORK: 'bg-blue-50 text-blue-700 border-blue-200',
};

// Badge tone per workflow status, derived from the single lifecycle registry
// (src/lib/receiving/workflow-stages.ts) so every surface — rails, tables,
// side panels — renders the same color for the same status. Kept as a
// Record<string,string> for the existing `WORKFLOW_BADGE[status]` callers.
export const WORKFLOW_BADGE: Record<string, string> = Object.fromEntries(
  Object.values(WORKFLOW_STAGES).map((s) => [s.status, s.badge]),
);

/** List-row / badge copy for inbound workflow; DB enums unchanged (`MATCHED`, `DONE`, …). */
export function workflowStatusTableLabel(status: string | null | undefined): string {
  const raw = String(status ?? '').trim().toUpperCase();
  if (!raw) return 'UNKNOWN';
  // Both early receiving stages read as "SCANNED" on list rows: ARRIVED is a
  // carton scanned at the dock but not matched to a PO (an Unfound PO), MATCHED
  // is a carton scanned and matched to a PO line. The matched/unmatched split is
  // carried by the row title + PO column, not this chip. ARRIVED's lifecycle
  // label is "Scanned" (see workflow-stages.ts), so this keeps the two in sync.
  if (raw === 'ARRIVED' || raw === 'MATCHED') return 'SCANNED';
  if (raw === 'DONE') return 'RECEIVED';
  return raw.replace(/_/g, ' ');
}

/** Compact grade→label map (New · Like New · Refurb · A · B · C · Parts). */
export const COND_LABEL: Record<string, string> = CONDITION_LABELS.compact;

/** Soft pill tone per condition grade. Shared by table rows and the scanned
 *  line/receipt detail headers so condition reads the same color everywhere. */
export const CONDITION_BADGE: Record<string, string> = {
  BRAND_NEW:   'bg-yellow-100 text-yellow-700',
  LIKE_NEW:    'bg-emerald-100 text-emerald-700',
  REFURBISHED: 'bg-teal-100 text-teal-700',
  USED_A:      'bg-blue-100 text-blue-700',
  USED_B:      'bg-indigo-100 text-indigo-700',
  USED_C:      'bg-slate-100 text-slate-600',
  PARTS:       'bg-amber-100 text-amber-800',
};

export function conditionBadgeTone(code: string | null | undefined): string {
  const c = String(code || '').trim().toUpperCase();
  return CONDITION_BADGE[c] || 'bg-slate-100 text-slate-600';
}

/** Soft pill tone per serial-unit lifecycle status (RECEIVED → … → SHIPPED).
 *  This is the unit domain, distinct from receiving workflow_status. Shared by
 *  the desktop /serial/[id] page and the mobile /m/u/[id] page. */
export const UNIT_STATUS_BADGE: Record<string, string> = {
  UNKNOWN:  'bg-slate-100 text-slate-600',
  LABELED:  'bg-amber-100 text-amber-700',
  RECEIVED: 'bg-amber-100 text-amber-800',
  IN_TEST:  'bg-blue-100 text-blue-700',
  TESTED:   'bg-blue-100 text-blue-700',
  STOCKED:  'bg-emerald-100 text-emerald-700',
  PICKED:   'bg-indigo-100 text-indigo-700',
  SHIPPED:  'bg-violet-100 text-violet-700',
  RETURNED: 'bg-rose-100 text-rose-700',
  RMA:      'bg-rose-100 text-rose-700',
  SCRAPPED: 'bg-red-100 text-red-700',
};

export function unitStatusBadgeTone(status: string | null | undefined): string {
  const s = String(status || '').trim().toUpperCase();
  return UNIT_STATUS_BADGE[s] || 'bg-slate-100 text-slate-600';
}

/**
 * Inline status-dot color for a receiving line. Quantity-complete wins over
 * status (a fully-received line is always emerald). Lifted out of
 * ReceivingLinesTable so the table rows and the scanned-line header render the
 * exact same dot. Unlike the registry `workflowStageDot`, this folds in qty.
 */
export function getStatusDotBg(
  status: string | null | undefined,
  qtyReceived?: number,
  qtyExpected?: number | null,
): string {
  if (
    qtyExpected != null &&
    qtyExpected > 0 &&
    qtyReceived != null &&
    qtyReceived >= qtyExpected
  ) {
    return 'bg-emerald-500';
  }
  const value = String(status || '').trim().toUpperCase();
  if (value === 'EXPECTED') return 'bg-amber-400';
  if (value === 'ARRIVED' || value === 'MATCHED') return 'bg-blue-500';
  if (value === 'UNBOXED') return 'bg-indigo-500';
  if (value === 'AWAITING_TEST' || value === 'IN_TEST') return 'bg-violet-500';
  if (value === 'PASSED' || value === 'DONE') return 'bg-emerald-500';
  if (value.startsWith('FAILED') || value === 'SCRAP' || value === 'RTV') return 'bg-rose-500';
  return 'bg-gray-400';
}

// ─── Shared row-display contract (desktop ⇄ mobile) ──────────────────────────
// One source of truth for the receiving ROW display decisions that both the
// desktop table (ReceivingLinesTable) and the mobile feed (MobileReceivingRow)
// make, so they can't drift. Pass the same `ReceivingRowDisplay` to both.

/** Per-surface display flags for a receiving row. */
export interface ReceivingRowDisplay {
  /** History/recent surface: "received" is implied, so the workflow status
   *  icon is suppressed (desktop history mode + the mobile recent/receiving feed). */
  isHistory?: boolean;
  /** Incoming/expected surface: workflow status doesn't apply yet → also hidden. */
  isIncoming?: boolean;
}

/**
 * Workflow status → its compact glyph + tone. Single source for the icon
 * mapping that desktop (ReceivingLinesTable) and mobile (MobileReceivingRow)
 * previously copy-pasted. `label` is the value from {@link workflowStatusTableLabel}.
 */
export function getWorkflowIconMeta(label: string): {
  Icon: ComponentType<{ className?: string }>;
  tone: string;
} {
  if (label === 'RECEIVED') return { Icon: PackageCheck, tone: 'text-emerald-600' };
  if (label === 'EXPECTED') return { Icon: Clock, tone: 'text-amber-500' };
  if (label === 'SCANNED') return { Icon: Truck, tone: 'text-blue-600' };
  return { Icon: Package, tone: 'text-gray-400' };
}

/**
 * Whether the workflow status icon should render for this row. History and
 * incoming surfaces suppress it (received is implied / status N/A). The mobile
 * receiving feed is a history surface, so it passes `{ isHistory: true }` and
 * gets the same suppression the desktop history table does — for free.
 */
export function shouldShowWorkflowStatusIcon(display: ReceivingRowDisplay = {}): boolean {
  return !(display.isHistory || display.isIncoming);
}
