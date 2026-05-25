export const TRIAGE_PILES = ['inbox', 'upload', 'ignore', 'done'] as const;
export type TriagePile = (typeof TRIAGE_PILES)[number];

export interface TriageRow {
  id: string;
  gmail_msg_id: string;
  gmail_thread_id: string | null;
  po_numbers: string[];
  po_numbers_norm: string[];
  email_subject: string | null;
  email_from: string | null;
  email_received: string | null;
  scanned_at: string;
  pile: TriagePile;
  status: string;
  notes: string | null;
  assigned_to: string | null;
  zoho_uploaded_po_number: string | null;
  zoho_uploaded_at: string | null;
  triage_state: Record<string, unknown>;
  resolved_at: string | null;
}

export interface TriagePileBucket {
  items: TriageRow[];
  count: number;
  truncated: boolean;
}

export type TriagePiles = Record<TriagePile, TriagePileBucket>;

export interface TriageResponse {
  piles: TriagePiles;
  maxPerPile: number;
}

export interface TriagePileMeta {
  id: TriagePile;
  label: string;
  short: string;
  helper: string;
}

export const TRIAGE_PILE_META: Record<TriagePile, TriagePileMeta> = {
  inbox:  { id: 'inbox',  label: 'Inbox',          short: 'Inbox',  helper: 'New scans waiting for triage' },
  upload: { id: 'upload', label: 'Upload to Zoho', short: 'Upload', helper: 'Confirmed POs to enter in Zoho' },
  ignore: { id: 'ignore', label: 'Ignore',         short: 'Ignore', helper: 'Not a real PO (marketing, dupes)' },
  done:   { id: 'done',   label: 'Done',           short: 'Done',   helper: 'Auto-closed when Zoho mirror catches up' },
};

export interface TriageDetailBody {
  text: string;
  /** DOMPurify-sanitized HTML. null when the source had no text/html part. */
  html: string | null;
  length: number;
  subject: string;
  from: string;
  to: string;
  date: string;
  hasAttachments: boolean;
  error: string | null;
}

export interface TriageZohoMatch {
  zoho_purchaseorder_id: string;
  zoho_purchaseorder_number: string;
  zoho_purchaseorder_number_norm: string;
  vendor_id: string | null;
  vendor_name: string | null;
  status: string | null;
  po_date: string | null;
  total: string | null;
}

export interface TriageZohoCompare {
  existingPos: TriageZohoMatch[];
  matchedVendor: { vendor_id: string | null; vendor_name: string | null } | null;
  openPoCountForVendor: number | null;
}

export interface TriageDetail {
  row: TriageRow;
  body: TriageDetailBody;
  zohoCompare: TriageZohoCompare;
}

/** Per-field confirmation written into triage_state.fields. */
export interface TriageFieldState {
  value?: string | number;
  source?: 'regex_labeled' | 'regex_unlabeled' | 'mirror' | 'llm' | 'user';
  confidence?: 'high' | 'medium' | 'low';
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  extracted_at?: string;
}

/** LLM-extracted field keys (subset shown in the checklist as AI rows). */
export const LLM_FIELD_KEYS = [
  'vendor',
  'po_date',
  'total',
  'currency',
  'line_items_count',
  'ship_to',
] as const;
export type LlmFieldKey = (typeof LLM_FIELD_KEYS)[number];

export const LLM_FIELD_LABEL: Record<LlmFieldKey, string> = {
  vendor:           'Vendor',
  po_date:          'PO date',
  total:            'Total',
  currency:         'Currency',
  line_items_count: 'Line items',
  ship_to:          'Ship to',
};

export function getFieldState(
  state: Record<string, unknown>,
  field: string,
): TriageFieldState | undefined {
  const fields = state?.fields;
  if (!fields || typeof fields !== 'object') return undefined;
  const f = (fields as Record<string, unknown>)[field];
  if (!f || typeof f !== 'object') return undefined;
  return f as TriageFieldState;
}

export function isFieldConfirmed(
  state: Record<string, unknown>,
  field: string,
): boolean {
  return Boolean(getFieldState(state, field)?.confirmed_at);
}

export function emptyPiles(): TriagePiles {
  return {
    inbox:  { items: [], count: 0, truncated: false },
    upload: { items: [], count: 0, truncated: false },
    ignore: { items: [], count: 0, truncated: false },
    done:   { items: [], count: 0, truncated: false },
  };
}
