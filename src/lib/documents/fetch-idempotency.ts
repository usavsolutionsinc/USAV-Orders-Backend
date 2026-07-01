/**
 * Dedupe key for marketplace-fetched outbound documents (docs/outbound-documents-plan.md §4.3).
 * Backed by ux_documents_outbound_source_hash (2026-07-01c migration) so a
 * re-fetch of the same (org, document_type, sourceHash) upserts instead of
 * duplicating. Pure — no DB access — so it unit-tests trivially.
 */

import { createHash } from 'node:crypto';

export interface SourceHashInput {
  platform: string;
  orderRef: string;
  documentType: string;
  /** Include when the document is per-box (multi-tracking order). */
  shipmentId?: number | null;
}

export function buildSourceHash(input: SourceHashInput): string {
  const parts = [
    input.platform.trim().toLowerCase(),
    input.orderRef.trim(),
    input.documentType.trim().toLowerCase(),
    input.shipmentId != null ? String(input.shipmentId) : '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
