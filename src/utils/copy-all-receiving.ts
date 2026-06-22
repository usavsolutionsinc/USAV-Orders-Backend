import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { formatDateTimePST } from '@/utils/date';

export type ReceivingCopyScratch = {
  zendesk: string;
  listing: string;
  extraTrackings: string[];
};

type ReceivingCartonApi = {
  id?: number;
  tracking?: string | null;
  carrier?: string | null;
  source_platform?: string | null;
  received_at?: string | null;
  unboxed_at?: string | null;
  support_notes?: string | null;
  is_return?: boolean;
  return_platform?: string | null;
};

type ReceivingLineApi = {
  id?: number;
  sku?: string | null;
  item_name?: string | null;
  quantity_expected?: number | null;
  quantity_received?: number | null;
  workflow_status?: string | null;
  qa_status?: string | null;
  condition_grade?: string | null;
  zoho_purchaseorder_number?: string | null;
  zoho_purchaseorder_id?: string | null;
  notes?: string | null;
  serials?: Array<{ serial_number?: string | null }>;
};

function itemEntry(line: ReceivingLineApi): string {
  const serials = (line.serials ?? [])
    .map((s) => String(s.serial_number || '').trim())
    .filter(Boolean);
  const sku = (line.sku || '').trim() || 'No SKU';
  const name = (line.item_name || '').trim() || 'Unnamed item';
  const poRef = (line.zoho_purchaseorder_number || line.zoho_purchaseorder_id || '').trim();

  const meta = [
    poRef ? `PO ${poRef}` : null,
    `Qty ${line.quantity_received ?? 0}/${line.quantity_expected ?? '?'}`,
    line.workflow_status ? `Status ${line.workflow_status}` : null,
    line.qa_status ? `QA ${line.qa_status}` : null,
    line.condition_grade ? `Condition ${line.condition_grade}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return [
    `• ${sku} — ${name}`,
    meta ? `  ${meta}` : null,
    serials.length
      ? `  Serial${serials.length > 1 ? 's' : ''}: ${serials.join(', ')}`
      : null,
    line.notes?.trim() ? `  Notes: ${line.notes.trim()}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Plain-text summary of a receiving carton + PO lines for clipboard / Slack.
 */
export function buildReceivingCopyInfo(opts: {
  carton: ReceivingCartonApi | null;
  lines: ReceivingLineApi[];
  scratch: ReceivingCopyScratch;
  currentLine: ReceivingLineRow;
  shareUrl?: string;
}): string {
  const { carton, lines, scratch, currentLine, shareUrl } = opts;
  const trackings = [
    (currentLine.tracking_number || '').trim(),
    ...scratch.extraTrackings.map((t) => t.trim()).filter(Boolean),
  ].filter((t, i, arr) => t && arr.indexOf(t) === i);

  const supportNotes =
    (carton?.support_notes || '').trim() ||
    (currentLine.receiving_support_notes || '').trim() ||
    '';

  const itemLines = lines.length > 0 ? lines : [currentLine as ReceivingLineApi];
  const itemCount = itemLines.length;

  const header = [
    '=== Receiving package ===',
    shareUrl ? `Link: ${shareUrl}` : null,
    carton?.id != null
      ? `Receiving ID: ${carton.id}`
      : currentLine.receiving_id != null
        ? `Receiving ID: ${currentLine.receiving_id}`
        : null,
    `PO#: ${currentLine.zoho_purchaseorder_number || currentLine.zoho_purchaseorder_id || 'N/A'}`,
    trackings.length ? `Tracking: ${trackings.join(', ')}` : null,
    carton?.carrier
      ? `Carrier: ${carton.carrier}`
      : currentLine.carrier
        ? `Carrier: ${currentLine.carrier}`
        : null,
    carton?.source_platform || currentLine.source_platform
      ? `Platform: ${carton?.source_platform || currentLine.source_platform}`
      : null,
    scratch.zendesk.trim() ? `Zendesk: ${scratch.zendesk.trim()}` : null,
    scratch.listing.trim() ? `Listing: ${scratch.listing.trim()}` : null,
    supportNotes ? `Support notes: ${supportNotes}` : null,
    carton?.received_at ? `Received: ${formatDateTimePST(carton.received_at)}` : null,
    carton?.unboxed_at ? `Unboxed: ${formatDateTimePST(carton.unboxed_at)}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const itemsSection = [
    `=== Items (${itemCount}) ===`,
    itemLines.map((line) => itemEntry(line)).join('\n\n'),
  ].join('\n');

  return `${header}\n\n${itemsSection}`.trim();
}
