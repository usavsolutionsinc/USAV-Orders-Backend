/**
 * Path convention for server-fetched outbound documents (docs/outbound-documents-plan.md §5.2).
 * Pure string builder — no I/O. Phase 4 marketplace adapters write bytes at
 * this path (NAS agent proxy or org GCS prefix, per storage-strategy §5.1);
 * Phase 1 only needs the naming rule to exist so the domain layer + tests can
 * be authored against it ahead of the adapters.
 */

export interface OutboundDocumentPathInput {
  orgSlug: string;
  documentType: string;
  platform: string;
  orderRef: string;
  /** Last segment of the tracking number, for a human-scannable filename. */
  trackingTail?: string | null;
  documentId: number;
  extension?: string;
}

function slugSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'na';
}

/** `{orgSlug}/outbound/{document_type}/{yyyy}/{mm}/{platform}/{orderRef}-{trackingTail}-{docId}.pdf` */
export function buildOutboundDocumentPath(input: OutboundDocumentPathInput, now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = input.extension ?? 'pdf';
  const filename = [
    slugSegment(input.orderRef),
    input.trackingTail ? slugSegment(input.trackingTail) : null,
    String(input.documentId),
  ]
    .filter(Boolean)
    .join('-');

  return [
    slugSegment(input.orgSlug),
    'outbound',
    slugSegment(input.documentType),
    String(yyyy),
    mm,
    slugSegment(input.platform),
    `${filename}.${ext}`,
  ].join('/');
}
