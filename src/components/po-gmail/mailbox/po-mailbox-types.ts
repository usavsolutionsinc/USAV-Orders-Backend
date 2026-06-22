/** Types + tab constants for the PO mailbox reconciler. */

export type Mode = 'missing' | 'scanned' | 'raw';

export interface MatchRow {
  zoho_purchaseorder_number: string | null;
  zoho_purchaseorder_id: string | null;
  workflow_status: string;
  sku: string | null;
  item_name: string | null;
  quantity_expected: number | null;
  quantity_received: number | null;
  receiving_id: number | null;
}

export interface ReconcileItem {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  internalDate: string;
  snippet: string;
  hasAttachments: boolean;
  bodyPreview: string;
  bodyTruncated: boolean;
  bodyLength: number;
  extracted: { all: string[]; labeled: string[]; unlabeled: string[] };
  matches: MatchRow[];
  matchedPoNumbers: string[];
  status: 'missing' | 'in_zoho' | 'received' | 'no_match';
}

export interface ReconcileResponse {
  query: string;
  limit: number;
  counts: { missing: number; in_zoho: number; received: number; no_match: number };
  persisted: { upserted: number; resolved: number } | null;
  elapsedMs: number;
  items: ReconcileItem[];
}

export interface MissingRow {
  id: string;
  gmail_msg_id: string;
  gmail_thread_id: string | null;
  po_numbers: string[];
  email_subject: string | null;
  email_from: string | null;
  email_received: string | null;
  scanned_at: string;
  status: 'pending' | 'ignored' | 'resolved';
  notes: string | null;
  resolved_at: string | null;
}

export interface MissingResponse {
  items: MissingRow[];
  counts: { pending: number; ignored: number; resolved: number };
}

// Legacy "raw preview" response (the original dry-run endpoint).
export interface PreviewItem {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  internalDate: string;
  snippet: string;
  hasAttachments: boolean;
  bodyPreview: string;
  bodyTruncated: boolean;
  bodyLength: number;
  extracted: { all: string[]; labeled: string[]; unlabeled: string[] };
}
export interface PreviewResponse { query: string; limit: number; count: number; elapsedMs: number; items: PreviewItem[]; }

export type MissingStatus = 'pending' | 'ignored' | 'resolved';

export const MODE_TABS: { id: Mode; label: string }[] = [
  { id: 'missing', label: 'Missing from Zoho' },
  { id: 'scanned', label: 'All scanned' },
  { id: 'raw',     label: 'Raw preview' },
];

export const MISSING_STATUS_TABS: { id: MissingStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'ignored', label: 'Ignored' },
  { id: 'resolved', label: 'Resolved' },
];
