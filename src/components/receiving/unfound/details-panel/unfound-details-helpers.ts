import { Mail, Package } from '@/components/Icons';
import type { UnfoundQueueDetailsRow } from '../unfound-triage-types';

// ─── Types ───────────────────────────────────────────────────────────────────

export type QueueKind = 'email_po' | 'unmatched_receiving' | 'station_exception';

export type DetailsTab = 'overview' | 'extract' | 'email';

export interface UnfoundQueueDetailsPanelProps {
  row: UnfoundQueueDetailsRow;
  onClose: () => void;
  onDeleted: (row: UnfoundQueueDetailsRow) => void;
  onPushedToZendesk?: (row: UnfoundQueueDetailsRow, ticketNumber: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const KIND_META: Record<QueueKind, { label: string; Icon: typeof Mail; bg: string }> = {
  email_po: { label: 'PO Mailbox', Icon: Mail, bg: 'bg-blue-600' },
  unmatched_receiving: {
    label: 'Unmatched Receiving',
    Icon: Package,
    bg: 'bg-emerald-600',
  },
  station_exception: {
    label: 'Station Exception',
    Icon: Package,
    bg: 'bg-amber-600',
  },
};

const PO_SUFFIX_RE = / · PO:\s*(.+?)\s*$/;
export function splitPoContext(context: string | null): {
  prefix: string;
  poNumbers: string[];
} {
  if (!context) return { prefix: '', poNumbers: [] };
  const match = context.match(PO_SUFFIX_RE);
  if (!match) return { prefix: context, poNumbers: [] };
  const prefix = context.slice(0, match.index).trim();
  const poNumbers = match[1]!
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { prefix, poNumbers };
}

export const CONFIDENCE_DOT: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-500',
  low: 'bg-gray-300',
};
