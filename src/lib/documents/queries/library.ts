import 'server-only';

import pool from '@/lib/db';
import { documentContentUrl } from '@/lib/documents/display-url';
import type { OutboundDocumentType } from '@/lib/documents/types';
import type { PhotoFinderKind } from '@/lib/photos/library-filter-state';

export interface OutboundLibraryFilters {
  organizationId: string;
  cursor?: number | null;
  limit?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  sort?: 'recent' | 'oldest' | null;
  /** Filter to one outbound doc kind; omit for both label + slip. */
  documentType?: OutboundDocumentType | null;
  /** Match orders.order_id (ILIKE substring). */
  orderRef?: string | null;
  /** Match document_data.tracking or the linked STN's tracking number (ILIKE substring) —
   * the shipment_id linkage (document_entity_links.entity_type='SHIPMENT') is what makes
   * this resolve to a real carrier tracking number, not just the denormalized text field. */
  tracking?: string | null;
  /** The sidebar's unified search box (poFinder/poFinderKind) — same field the photo-scope
   * resolver reads. 'order'/'po' match orderRef; 'tracking' matches tracking; anything else
   * ('any', or a kind with no outbound-document analog like 'serial'/'ticket') matches either. */
  finderTerm?: string | null;
  finderKind?: PhotoFinderKind | null;
  staffId?: number | null;
}

export interface OutboundLibraryItem {
  id: number;
  kind: 'document';
  documentType: OutboundDocumentType;
  poRef: string | null;
  orderRef: string | null;
  tracking: string | null;
  platform: string | null;
  filename: string | null;
  mimeType: string | null;
  createdAt: string;
  displayUrl: string;
  thumbUrl: string;
  sourceScope: 'outbound';
}

/** `orders.order_id` ILIKE substring, joined via the document's ORDER link. */
function orderRefClause(term: string, params: unknown[]): string {
  params.push(`%${term}%`);
  return `EXISTS (
    SELECT 1 FROM document_entity_links l
      JOIN orders o ON o.id = l.entity_id AND o.organization_id = d.organization_id
     WHERE l.document_id = d.id
       AND l.organization_id = d.organization_id
       AND l.entity_type = 'ORDER'
       AND o.order_id ILIKE $${params.length}
  )`;
}

/** Denormalized document_data.tracking OR the linked STN's tracking number
 * (document_entity_links.entity_type='SHIPMENT' → shipping_tracking_numbers). */
function trackingClause(term: string, params: unknown[]): string {
  params.push(`%${term}%`);
  const t = `$${params.length}`;
  return `(
    d.document_data->>'tracking' ILIKE ${t}
    OR EXISTS (
      SELECT 1 FROM document_entity_links l
        JOIN shipping_tracking_numbers stn ON stn.id = l.entity_id
       WHERE l.document_id = d.id
         AND l.organization_id = d.organization_id
         AND l.entity_type = 'SHIPMENT'
         AND stn.tracking_number_normalized ILIKE ${t}
    )
  )`;
}

function buildOutboundLibraryWhere(filters: OutboundLibraryFilters): {
  clauses: string[];
  params: unknown[];
} {
  const params: unknown[] = [filters.organizationId];
  const clauses: string[] = [
    'd.organization_id = $1::uuid',
    `d.document_type IN ('shipping_label', 'packing_slip')`,
  ];

  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    clauses.push(`(d.created_at AT TIME ZONE 'America/Los_Angeles')::date >= $${params.length}::date`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    clauses.push(`(d.created_at AT TIME ZONE 'America/Los_Angeles')::date <= $${params.length}::date`);
  }
  if (filters.documentType) {
    params.push(filters.documentType);
    clauses.push(`d.document_type = $${params.length}`);
  }
  if (filters.orderRef) {
    clauses.push(orderRefClause(filters.orderRef, params));
  }
  if (filters.tracking) {
    clauses.push(trackingClause(filters.tracking, params));
  }
  if (filters.finderTerm) {
    const term = filters.finderTerm;
    if (filters.finderKind === 'tracking') {
      clauses.push(trackingClause(term, params));
    } else if (filters.finderKind === 'order' || filters.finderKind === 'po') {
      clauses.push(orderRefClause(term, params));
    } else {
      // 'any' (and 'serial'/'ticket', which have no outbound-document analog) — match either.
      clauses.push(`(${orderRefClause(term, params)} OR ${trackingClause(term, params)})`);
    }
  }

  return { clauses, params };
}

function mapRow(row: {
  id: number | string;
  document_type: string;
  document_data: {
    tracking?: string | null;
    platform?: string | null;
    filename?: string | null;
    mimeType?: string | null;
  };
  created_at: string;
  order_ref: string | null;
}): OutboundLibraryItem {
  const id = Number(row.id);
  return {
    id: -id,
    kind: 'document',
    documentType: row.document_type as OutboundDocumentType,
    poRef: row.order_ref,
    orderRef: row.order_ref,
    tracking: row.document_data?.tracking ?? null,
    platform: row.document_data?.platform ?? null,
    filename: row.document_data?.filename ?? null,
    mimeType: row.document_data?.mimeType ?? null,
    createdAt: row.created_at,
    displayUrl: documentContentUrl(id),
    thumbUrl: documentContentUrl(id),
    sourceScope: 'outbound',
  };
}

export async function listOutboundDocumentLibrary(filters: OutboundLibraryFilters) {
  const limit = Math.min(Math.max(filters.limit ?? 48, 1), 100);
  const { clauses, params } = buildOutboundLibraryWhere(filters);

  if (filters.cursor && filters.cursor < 0) {
    params.push(Math.abs(filters.cursor));
    clauses.push(`d.id < $${params.length}`);
  }

  const sortDir = filters.sort === 'oldest' ? 'ASC' : 'DESC';
  params.push(limit + 1);
  const limitParam = `$${params.length}`;

  const res = await pool.query(
    `SELECT d.id, d.document_type, d.document_data, d.created_at,
            (SELECT o.order_id FROM document_entity_links l
               JOIN orders o ON o.id = l.entity_id AND o.organization_id = d.organization_id
              WHERE l.document_id = d.id AND l.entity_type = 'ORDER'
              LIMIT 1) AS order_ref
       FROM documents d
      WHERE ${clauses.join(' AND ')}
      ORDER BY d.created_at ${sortDir}, d.id ${sortDir}
      LIMIT ${limitParam}`,
    params,
  );

  const hasMore = res.rows.length > limit;
  const rows = hasMore ? res.rows.slice(0, limit) : res.rows;
  const items = rows.map((row) => mapRow(row));
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return { items, nextCursor, hasMore };
}

export function outboundLibraryFiltersFromSearchParams(
  params: URLSearchParams,
): Omit<OutboundLibraryFilters, 'organizationId' | 'cursor' | 'limit'> {
  const docType = params.get('documentType');
  const finderTerm = params.get('poFinder');
  return {
    dateFrom: params.get('dateFrom'),
    dateTo: params.get('dateTo'),
    sort: params.get('sort') === 'oldest' ? 'oldest' : 'recent',
    documentType:
      docType === 'shipping_label' || docType === 'packing_slip' ? docType : null,
    orderRef: params.get('poRef') || params.get('order') || null,
    tracking: params.get('tracking'),
    // The sidebar's unified search box — same param the photo-scope resolver
    // reads (poFinderExists in src/lib/photos/queries/library.ts). Without
    // this, typing in the search box while "Outbound" is the active sidebar
    // row silently did nothing server-side.
    finderTerm,
    finderKind: finderTerm ? ((params.get('poFinderKind') as PhotoFinderKind | null) ?? 'any') : null,
    staffId: params.get('staffId') ? Number(params.get('staffId')) : null,
  };
}
