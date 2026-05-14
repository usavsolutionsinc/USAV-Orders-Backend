// Shared constants for all receiving-related components.
// Import from here instead of defining inline in each component.

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

export const CONDITION_OPTS = ['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS'].map((v) => ({
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

export const WORKFLOW_BADGE: Record<string, string> = {
  EXPECTED:      'bg-gray-100 text-gray-500',
  ARRIVED:       'bg-blue-100 text-blue-600',
  MATCHED:       'bg-indigo-100 text-indigo-700',
  UNBOXED:       'bg-yellow-100 text-yellow-700',
  AWAITING_TEST: 'bg-orange-100 text-orange-700',
  IN_TEST:       'bg-teal-100 text-teal-700',
  PASSED:        'bg-emerald-100 text-emerald-700',
  FAILED:        'bg-red-100 text-red-600',
  DONE:          'bg-emerald-100 text-emerald-700',
};

/** List-row / badge copy for inbound workflow; DB enums unchanged (`MATCHED`, `DONE`, …). */
export function workflowStatusTableLabel(status: string | null | undefined): string {
  const raw = String(status ?? '').trim().toUpperCase();
  if (!raw) return 'UNKNOWN';
  if (raw === 'MATCHED') return 'SCANNED';
  if (raw === 'DONE') return 'RECEIVED';
  return raw.replace(/_/g, ' ');
}

export const COND_LABEL: Record<string, string> = {
  BRAND_NEW: 'New',
  USED_A:    'A',
  USED_B:    'B',
  USED_C:    'C',
  PARTS:     'Parts',
};

/** Compact label for list rows — matches sidebar / label copy (USED-A, NEW, …). */
export function conditionGradeTableLabel(code: string | null | undefined): string {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return 'N/A';
  if (c === 'BRAND_NEW') return 'NEW';
  if (c === 'PARTS') return 'PARTS';
  if (c === 'USED_A') return 'USED-A';
  if (c === 'USED_B') return 'USED-B';
  if (c === 'USED_C') return 'USED-C';
  return c.replace(/_/g, ' ');
}
