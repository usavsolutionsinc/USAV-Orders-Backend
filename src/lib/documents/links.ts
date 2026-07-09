/**
 * document_entity_links — read/write API for the polymorphic document↔entity
 * link hub (docs/outbound-documents-plan.md §4.1). Mirrors the shape of
 * src/lib/shipping/shipment-links.ts: org-scoped, Deps-free at the query
 * layer, accepts an optional transaction client so callers can enlist in a
 * larger write (e.g. attachOutboundDocument's insert-then-link).
 */

import type { PoolClient } from 'pg';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { DocumentEntityLinkRow, DocumentEntityType, DocumentLinkRole } from './types';

type Client = Pick<PoolClient, 'query'>;

interface RawLinkRow {
  id: number | string;
  document_id: number | string;
  entity_type: DocumentEntityType;
  entity_id: number | string;
  link_role: DocumentLinkRole;
  created_at: string;
}

function mapLinkRow(row: RawLinkRow): DocumentEntityLinkRow {
  return {
    id: Number(row.id),
    documentId: Number(row.document_id),
    entityType: row.entity_type,
    entityId: Number(row.entity_id),
    linkRole: row.link_role,
    createdAt: row.created_at,
  };
}

export interface CreateDocumentEntityLinkInput {
  documentId: number;
  entityType: DocumentEntityType;
  entityId: number;
  linkRole?: DocumentLinkRole;
}

/** Upsert one document↔entity link. Idempotent on (document_id, entity_type, entity_id, link_role). */
export async function createDocumentEntityLink(
  orgId: OrgId,
  input: CreateDocumentEntityLinkInput,
  client?: Client,
): Promise<DocumentEntityLinkRow> {
  const run = async (c: Client): Promise<DocumentEntityLinkRow> => {
    const r = await c.query<RawLinkRow>(
      `INSERT INTO document_entity_links (document_id, organization_id, entity_type, entity_id, link_role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ON CONSTRAINT ux_document_entity_links_unique DO UPDATE SET
         organization_id = EXCLUDED.organization_id
       RETURNING id, document_id, entity_type, entity_id, link_role, created_at`,
      [input.documentId, orgId, input.entityType, input.entityId, input.linkRole ?? 'primary'],
    );
    return mapLinkRow(r.rows[0]);
  };
  if (client) return run(client);
  return withTenantTransaction<DocumentEntityLinkRow>(orgId, run);
}

/** All links for one document (both ORDER and SHIPMENT rows, if present). */
export async function listLinksForDocument(
  orgId: OrgId,
  documentId: number,
  client?: Client,
): Promise<DocumentEntityLinkRow[]> {
  const run = async (c: Client) => {
    const r = await c.query<RawLinkRow>(
      `SELECT id, document_id, entity_type, entity_id, link_role, created_at
         FROM document_entity_links
        WHERE organization_id = $1 AND document_id = $2
        ORDER BY link_role ASC, id ASC`,
      [orgId, documentId],
    );
    return r.rows.map(mapLinkRow);
  };
  if (client) return run(client);
  return withTenantTransaction<DocumentEntityLinkRow[]>(orgId, run);
}

/** Document ids linked to one entity (ORDER or SHIPMENT), newest first. */
export async function listDocumentIdsForEntity(
  orgId: OrgId,
  entityType: DocumentEntityType,
  entityId: number,
  client?: Client,
): Promise<number[]> {
  const run = async (c: Client) => {
    const r = await c.query<{ document_id: number }>(
      `SELECT DISTINCT document_id
         FROM document_entity_links
        WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3`,
      [orgId, entityType, entityId],
    );
    return r.rows.map((row) => Number(row.document_id));
  };
  if (client) return run(client);
  return withTenantTransaction<number[]>(orgId, run);
}
