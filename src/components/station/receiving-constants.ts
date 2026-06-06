// Shared constants for all receiving-related components.
// Import from here instead of defining inline in each component.

import { WORKFLOW_STAGES } from '@/lib/receiving/workflow-stages';

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

export const CONDITION_OPTS = ['BRAND_NEW', 'LIKE_NEW', 'REFURBISHED', 'USED_A', 'USED_B', 'USED_C', 'PARTS'].map((v) => ({
  value: v,
  label: v.replace(/_/g, ' '),
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

export const COND_LABEL: Record<string, string> = {
  BRAND_NEW:   'New',
  LIKE_NEW:    'Like New',
  REFURBISHED: 'Refurb',
  USED_A:      'A',
  USED_B:      'B',
  USED_C:      'C',
  PARTS:       'Parts',
};

/** Compact label for list rows — matches sidebar / label copy (USED-A, NEW, …). */
export function conditionGradeTableLabel(code: string | null | undefined): string {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return 'N/A';
  if (c === 'BRAND_NEW') return 'NEW';
  if (c === 'LIKE_NEW') return 'L-NEW';
  if (c === 'REFURBISHED') return 'REF';
  if (c === 'PARTS') return 'PARTS';
  if (c === 'USED_A') return 'A';
  if (c === 'USED_B') return 'B';
  if (c === 'USED_C') return 'C';
  return c.replace(/_/g, ' ');
}

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
