/**
 * Outbound documents domain layer (docs/outbound-documents-plan.md §4.5, §8.1).
 *
 * Single write/read API for packing slips + shipping labels stored on the
 * existing `documents` table and linked via `document_entity_links`
 * (2026-07-01c migration). Routes stay thin: validate → call these → map
 * status → audit. See src/app/api/orders/[id]/documents/route.ts.
 *
 * Link-role convention (docs/outbound-documents-plan.md §4.1 notes):
 *   - shipping_label: STN is `primary` when resolvable, ORDER `secondary`;
 *     ORDER is the sole `primary` link when no STN resolves yet (D3).
 *   - packing_slip: ORDER is always `primary` (marketplace slips vary in
 *     whether they're order- or box-anchored, D2); STN is `secondary` when
 *     this is a per-box slip.
 * The read resolution order (§2) does not depend on link_role — it only
 * checks entity_type existence — so role is metadata for display, not a
 * correctness dependency.
 */

import type { PoolClient } from 'pg';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { linkShipment } from '@/lib/shipping/shipment-links';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getAllNasBaseUrls } from '@/lib/tenancy/settings';
import { createDocumentEntityLink } from './links';
import { resolveStnForOrder } from './resolve-stn-for-order';
import { documentContentUrl } from './display-url';
import { buildSourceHash } from './fetch-idempotency';
import { uploadOutboundDocumentToGcs, isOutboundDocumentGcsConfigured } from './storage/upload';
import type {
  DocumentEntityType,
  OutboundDocument,
  OutboundDocumentData,
  OutboundDocumentType,
} from './types';

export class OutboundDocumentNotFoundError extends Error {}
export class OutboundDocumentConflictError extends Error {}
export class OutboundDocumentValidationError extends Error {}

type Client = Pick<PoolClient, 'query'>;

/** `/path` is same-origin; `//host/path` is protocol-relative and resolves to
 * a DIFFERENT origin in a browser — never treat it as same-origin. */
function isSameOriginPath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

async function defaultResolveAllowedUrlBases(orgId: OrgId): Promise<string[]> {
  const org = await getOrganization(orgId);
  const bases = org ? getAllNasBaseUrls(org.settings) : [];
  const envBase = (process.env.NEXT_PUBLIC_NAS_PHOTOS_BASE_URL || '').replace(/\/+$/, '');
  if (envBase && !envBase.startsWith('/')) bases.push(envBase);
  return bases;
}

export interface OutboundDocumentDeps {
  withTenantTransaction: typeof withTenantTransaction;
  resolveShipmentId: typeof resolveShipmentId;
  resolveStnForOrder: typeof resolveStnForOrder;
  linkShipment: typeof linkShipment;
  createDocumentEntityLink: typeof createDocumentEntityLink;
  /** Org's configured NAS base URLs (+ env fallback). Empty array = unconfigured
   * (permissive — see validateAttachUrl). Centralized here so the allowlist
   * check runs once regardless of caller (route vs legacy order-labels wrapper). */
  resolveAllowedUrlBases: (orgId: OrgId) => Promise<string[]>;
}

const defaultDeps: OutboundDocumentDeps = {
  withTenantTransaction,
  resolveShipmentId,
  resolveStnForOrder,
  linkShipment,
  createDocumentEntityLink,
  resolveAllowedUrlBases: defaultResolveAllowedUrlBases,
};

/**
 * Manual-upload URLs must be same-origin (`/…`, never protocol-relative
 * `//…`) or point at the org's configured NAS base. An absolute URL is
 * rejected when NO base is configured, not waved through — this value is
 * later fed straight into a 302 redirect (/api/documents/[id]/content), so
 * "permissive when unconfigured" would be an open redirect for any org that
 * hasn't set up NAS settings yet. Legitimate writers only ever produce a
 * same-origin proxy path or the org's own NAS URL, so this never blocks a
 * real upload — only an unrecognized/attacker-controlled absolute URL.
 */
async function validateAttachUrl(orgId: OrgId, url: string, deps: OutboundDocumentDeps): Promise<void> {
  if (isSameOriginPath(url)) return;
  const allowedBases = await deps.resolveAllowedUrlBases(orgId);
  const isAllowed = allowedBases.some((base) => url === base || url.startsWith(`${base}/`));
  if (!isAllowed) {
    throw new OutboundDocumentValidationError('url must point at the configured NAS address');
  }
}

interface RawDocumentRow {
  id: number | string;
  entity_type: string;
  entity_id: number | string;
  document_type: string;
  document_data: OutboundDocumentData;
  created_at: string;
  updated_at: string;
}

interface RawLinkRow {
  document_id: number | string;
  entity_type: DocumentEntityType;
  entity_id: number | string;
  link_role: 'primary' | 'secondary';
}

async function attachLinksToDocuments(
  c: Client,
  orgId: OrgId,
  rows: RawDocumentRow[],
): Promise<OutboundDocument[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => Number(r.id));
  const linkRes = await c.query<RawLinkRow>(
    `SELECT document_id, entity_type, entity_id, link_role
       FROM document_entity_links
      WHERE organization_id = $1 AND document_id = ANY($2::int[])`,
    [orgId, ids],
  );
  const byDoc = new Map<number, RawLinkRow[]>();
  for (const link of linkRes.rows) {
    const docId = Number(link.document_id);
    const list = byDoc.get(docId) ?? [];
    list.push(link);
    byDoc.set(docId, list);
  }
  return rows.map((r) => ({
    id: Number(r.id),
    documentType: r.document_type as OutboundDocumentType,
    data: r.document_data ?? ({} as OutboundDocumentData),
    links: (byDoc.get(Number(r.id)) ?? []).map((l) => ({
      entityType: l.entity_type,
      entityId: Number(l.entity_id),
      linkRole: l.link_role,
    })),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** All labels + slips linked to an order — merges new link-hub rows with
 * un-migrated legacy `entity_type='SHIPPING_LABEL'` rows (dual-read window,
 * D6). Newest first. */
export async function listDocumentsForOrder(
  orgId: OrgId,
  orderId: number,
  deps: OutboundDocumentDeps = defaultDeps,
): Promise<OutboundDocument[]> {
  return deps.withTenantTransaction(orgId, async (client) => {
    const res = await client.query<RawDocumentRow>(
      `SELECT DISTINCT d.id, d.entity_type, d.entity_id, d.document_type, d.document_data, d.created_at, d.updated_at
         FROM documents d
         LEFT JOIN document_entity_links l
           ON l.document_id = d.id AND l.organization_id = $1 AND l.entity_type = 'ORDER' AND l.entity_id = $2
        WHERE d.organization_id = $1
          AND (
            l.document_id IS NOT NULL
            OR (d.entity_type = 'SHIPPING_LABEL' AND d.entity_id = $2)
          )
        ORDER BY d.created_at DESC`,
      [orgId, orderId],
    );
    return attachLinksToDocuments(client, orgId, res.rows);
  });
}

/** All labels + slips linked to one STN (per-box view, §9.x / Phase 2). */
export async function listDocumentsForShipment(
  orgId: OrgId,
  shipmentId: number,
  deps: OutboundDocumentDeps = defaultDeps,
): Promise<OutboundDocument[]> {
  return deps.withTenantTransaction(orgId, async (client) => {
    const res = await client.query<RawDocumentRow>(
      `SELECT DISTINCT d.id, d.entity_type, d.entity_id, d.document_type, d.document_data, d.created_at, d.updated_at
         FROM documents d
         JOIN document_entity_links l
           ON l.document_id = d.id AND l.organization_id = $1 AND l.entity_type = 'SHIPMENT' AND l.entity_id = $2
        WHERE d.organization_id = $1
        ORDER BY d.created_at DESC`,
      [orgId, shipmentId],
    );
    return attachLinksToDocuments(client, orgId, res.rows);
  });
}

export interface AttachOutboundDocumentInput {
  orderId: number;
  documentType: OutboundDocumentType;
  url: string;
  platform?: string | null;
  /** manual_upload | marketplace_api | generated | zoho_export. Defaults to manual_upload. */
  source?: string;
  carrier?: string | null;
  /** Raw tracking number. When present, resolves/registers its STN (may hit a carrier API). */
  tracking?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  uploadedBy?: number | null;
}

export interface AttachOutboundDocumentResult {
  document: OutboundDocument;
  /** True when this is the order's first shipping_label — callers should also
   * record AUDIT_ACTION.LABEL_PRINTED (order timeline precedent). */
  isFirstLabel: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '23505');
}

/**
 * Attach (manually upload or re-link) a shipping label / packing slip to an
 * order. Idempotent on (org, document_type, entity, url) — a duplicate drop
 * is a 409, not a second row. The URL allowlist check, owner check, dupe
 * check, and every write all happen inside ONE transaction; a genuine
 * concurrent-duplicate race is still caught by `ux_documents_outbound_url`
 * (2026-07-01c) and mapped to the same conflict error.
 */
export async function attachOutboundDocument(
  orgId: OrgId,
  input: AttachOutboundDocumentInput,
  deps: OutboundDocumentDeps = defaultDeps,
): Promise<AttachOutboundDocumentResult> {
  await validateAttachUrl(orgId, input.url, deps);

  // Resolve a tracking-supplied STN outside any transaction — resolveShipmentId
  // may hit a carrier API (registerAndSyncShipment) and must not hold a DB
  // connection open across that network call. The no-tracking fallback
  // (resolveStnForOrder) is a pure read and runs inside the transaction below
  // via the shared client, so it doesn't cost a second round trip.
  let shipmentId: number | null = null;
  if (input.tracking && input.tracking.trim()) {
    const resolved = await deps.resolveShipmentId(input.tracking.trim(), orgId);
    shipmentId = resolved.shipmentId;
  }

  return deps.withTenantTransaction(orgId, async (client) => {
    const owner = await client.query(
      `SELECT 1 FROM orders WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [input.orderId, orgId],
    );
    if (owner.rowCount === 0) {
      throw new OutboundDocumentNotFoundError(`order not found: ${input.orderId}`);
    }

    if (shipmentId == null && !(input.tracking && input.tracking.trim())) {
      shipmentId = await deps.resolveStnForOrder(orgId, input.orderId, client);
    }

    const dupe = await client.query(
      `SELECT 1 FROM documents
        WHERE organization_id = $1 AND document_type = $2
          AND entity_type IN ('ORDER', 'SHIPPING_LABEL') AND entity_id = $3
          AND document_data->>'url' = $4
        LIMIT 1`,
      [orgId, input.documentType, input.orderId, input.url],
    );
    if ((dupe.rowCount ?? 0) > 0) {
      throw new OutboundDocumentConflictError('Document already attached');
    }

    let isFirstLabel = false;
    if (input.documentType === 'shipping_label') {
      const prior = await client.query(
        `SELECT 1 FROM documents
          WHERE organization_id = $1 AND document_type = 'shipping_label'
            AND entity_type IN ('ORDER', 'SHIPPING_LABEL') AND entity_id = $2
          LIMIT 1`,
        [orgId, input.orderId],
      );
      isFirstLabel = (prior.rowCount ?? 0) === 0;
    }

    if (shipmentId != null) {
      await deps.linkShipment(
        orgId,
        {
          ownerType: 'ORDER',
          ownerId: input.orderId,
          shipmentId,
          direction: 'OUTBOUND',
          source: 'outbound-documents',
        },
        client,
      );
    }

    const data: OutboundDocumentData = {
      url: input.url,
      platform: input.platform ?? null,
      source: input.source ?? 'manual_upload',
      mimeType: input.mimeType ?? null,
      carrier: input.carrier ?? null,
      tracking: input.tracking ?? null,
      uploadedBy: input.uploadedBy ?? null,
      filename: input.filename ?? null,
    };

    let inserted;
    try {
      inserted = await client.query<RawDocumentRow>(
        `INSERT INTO documents (entity_type, entity_id, document_type, document_data, organization_id)
         VALUES ('ORDER', $1, $2, $3::jsonb, $4::uuid)
         RETURNING id, entity_type, entity_id, document_type, document_data, created_at, updated_at`,
        [input.orderId, input.documentType, JSON.stringify(data), orgId],
      );
    } catch (error) {
      // Genuine concurrent-duplicate race: two identical attaches passed the
      // SELECT-based dupe check above before either committed. The DB-level
      // partial unique index (ux_documents_outbound_url) is the real guard;
      // the SELECT above is just the fast, friendly path.
      if (isUniqueViolation(error)) {
        throw new OutboundDocumentConflictError('Document already attached');
      }
      throw error;
    }
    const documentId = Number(inserted.rows[0].id);

    if (input.documentType === 'shipping_label') {
      if (shipmentId != null) {
        await deps.createDocumentEntityLink(orgId, { documentId, entityType: 'SHIPMENT', entityId: shipmentId, linkRole: 'primary' }, client);
        await deps.createDocumentEntityLink(orgId, { documentId, entityType: 'ORDER', entityId: input.orderId, linkRole: 'secondary' }, client);
      } else {
        await deps.createDocumentEntityLink(orgId, { documentId, entityType: 'ORDER', entityId: input.orderId, linkRole: 'primary' }, client);
      }
    } else {
      await deps.createDocumentEntityLink(orgId, { documentId, entityType: 'ORDER', entityId: input.orderId, linkRole: 'primary' }, client);
      if (shipmentId != null) {
        await deps.createDocumentEntityLink(orgId, { documentId, entityType: 'SHIPMENT', entityId: shipmentId, linkRole: 'secondary' }, client);
      }
    }

    if (isFirstLabel) {
      await client.query(
        `UPDATE orders SET label_printed_at = NOW(), label_printed_by = $1
           WHERE id = $2 AND label_printed_at IS NULL AND organization_id = $3`,
        [input.uploadedBy ?? null, input.orderId, orgId],
      );
    }

    const [document] = await attachLinksToDocuments(client, orgId, inserted.rows);
    return { document, isFirstLabel };
  });
}

export interface DeletedOutboundDocument {
  id: number;
  documentType: OutboundDocumentType;
  orderId: number | null;
}

export interface DeleteOutboundDocumentOptions {
  /** When set, a document of a different type 404s instead of deleting — lets
   * a type-scoped caller (e.g. the deprecated /api/order-labels wrapper, which
   * must only ever unlink labels) enforce that in the same transaction as the
   * existence check, with no separate pre-check round trip. */
  expectedDocumentType?: OutboundDocumentType;
}

/** Unlink + delete a document. Cascades to document_entity_links via FK. */
export async function deleteOutboundDocument(
  orgId: OrgId,
  documentId: number,
  opts: DeleteOutboundDocumentOptions = {},
  deps: OutboundDocumentDeps = defaultDeps,
): Promise<DeletedOutboundDocument> {
  return deps.withTenantTransaction(orgId, async (client) => {
    const existing = await client.query<{ document_type: string; entity_type: string; entity_id: number }>(
      `SELECT document_type, entity_type, entity_id FROM documents
        WHERE id = $1 AND organization_id = $2`,
      [documentId, orgId],
    );
    if (existing.rowCount === 0) {
      throw new OutboundDocumentNotFoundError(`document not found: ${documentId}`);
    }
    const row = existing.rows[0];
    if (opts.expectedDocumentType && row.document_type !== opts.expectedDocumentType) {
      throw new OutboundDocumentNotFoundError(`document not found: ${documentId}`);
    }
    await client.query(`DELETE FROM documents WHERE id = $1 AND organization_id = $2`, [documentId, orgId]);
    return {
      id: documentId,
      documentType: row.document_type as OutboundDocumentType,
      orderId: row.entity_type === 'ORDER' || row.entity_type === 'SHIPPING_LABEL' ? Number(row.entity_id) : null,
    };
  });
}

export interface FetchOutboundDocumentsResult {
  fetched: OutboundDocument[];
  failed: Array<{ type: OutboundDocumentType; error: string }>;
}

export interface StoreOutboundDocumentBytesInput {
  orderId: number;
  orderRef: string;
  documentType: OutboundDocumentType;
  platform: string;
  source: string;
  buffer: Buffer;
  contentType: string;
  extension?: string;
  tracking?: string | null;
  carrier?: string | null;
  filename?: string | null;
  uploadedBy?: number | null;
  sourceHash?: string;
}

export interface StoreOutboundDocumentBytesResult extends AttachOutboundDocumentResult {
  created: boolean;
}

async function findOutboundDocumentBySourceHash(
  orgId: OrgId,
  documentType: OutboundDocumentType,
  sourceHash: string,
  deps: OutboundDocumentDeps = defaultDeps,
): Promise<OutboundDocument | null> {
  return deps.withTenantTransaction(orgId, async (client) => {
    const res = await client.query<RawDocumentRow>(
      `SELECT id, entity_type, entity_id, document_type, document_data, created_at, updated_at
         FROM documents
        WHERE organization_id = $1
          AND document_type = $2
          AND document_data->>'sourceHash' = $3
        LIMIT 1`,
      [orgId, documentType, sourceHash],
    );
    if (res.rowCount === 0) return null;
    const [doc] = await attachLinksToDocuments(client, orgId, res.rows);
    return doc ?? null;
  });
}

async function wireOutboundDocumentLinks(
  orgId: OrgId,
  client: Client,
  deps: OutboundDocumentDeps,
  input: {
    documentId: number;
    orderId: number;
    documentType: OutboundDocumentType;
    shipmentId: number | null;
  },
): Promise<void> {
  if (input.documentType === 'shipping_label') {
    if (input.shipmentId != null) {
      await deps.createDocumentEntityLink(
        orgId,
        { documentId: input.documentId, entityType: 'SHIPMENT', entityId: input.shipmentId, linkRole: 'primary' },
        client,
      );
      await deps.createDocumentEntityLink(
        orgId,
        { documentId: input.documentId, entityType: 'ORDER', entityId: input.orderId, linkRole: 'secondary' },
        client,
      );
    } else {
      await deps.createDocumentEntityLink(
        orgId,
        { documentId: input.documentId, entityType: 'ORDER', entityId: input.orderId, linkRole: 'primary' },
        client,
      );
    }
    return;
  }

  await deps.createDocumentEntityLink(
    orgId,
    { documentId: input.documentId, entityType: 'ORDER', entityId: input.orderId, linkRole: 'primary' },
    client,
  );
  if (input.shipmentId != null) {
    await deps.createDocumentEntityLink(
      orgId,
      { documentId: input.documentId, entityType: 'SHIPMENT', entityId: input.shipmentId, linkRole: 'secondary' },
      client,
    );
  }
}

/**
 * Server-side ingest: write bytes to GCS, persist proxy URL + metadata, wire links.
 * Idempotent on sourceHash when provided (marketplace re-fetch).
 */
export async function storeOutboundDocumentFromBytes(
  orgId: OrgId,
  input: StoreOutboundDocumentBytesInput,
  deps: OutboundDocumentDeps = defaultDeps,
): Promise<StoreOutboundDocumentBytesResult> {
  if (!isOutboundDocumentGcsConfigured()) {
    throw new OutboundDocumentValidationError('GCS storage is required for server-side document ingest');
  }

  const sourceHash =
    input.sourceHash ??
    buildSourceHash({
      platform: input.platform,
      orderRef: input.orderRef,
      documentType: input.documentType,
    });

  const existing = await findOutboundDocumentBySourceHash(orgId, input.documentType, sourceHash, deps);
  if (existing) {
    return { document: existing, isFirstLabel: false, created: false };
  }

  let shipmentId: number | null = null;
  if (input.tracking?.trim()) {
    const resolved = await deps.resolveShipmentId(input.tracking.trim(), orgId);
    shipmentId = resolved.shipmentId;
  }

  const insertResult = await deps.withTenantTransaction(orgId, async (client) => {
    const owner = await client.query(
      `SELECT 1 FROM orders WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [input.orderId, orgId],
    );
    if (owner.rowCount === 0) {
      throw new OutboundDocumentNotFoundError(`order not found: ${input.orderId}`);
    }

    if (shipmentId == null && !(input.tracking && input.tracking.trim())) {
      shipmentId = await deps.resolveStnForOrder(orgId, input.orderId, client);
    }

    let firstLabel = false;
    if (input.documentType === 'shipping_label') {
      const prior = await client.query(
        `SELECT 1 FROM documents
          WHERE organization_id = $1 AND document_type = 'shipping_label'
            AND entity_type IN ('ORDER', 'SHIPPING_LABEL') AND entity_id = $2
          LIMIT 1`,
        [orgId, input.orderId],
      );
      firstLabel = (prior.rowCount ?? 0) === 0;
    }

    if (shipmentId != null) {
      await deps.linkShipment(
        orgId,
        {
          ownerType: 'ORDER',
          ownerId: input.orderId,
          shipmentId,
          direction: 'OUTBOUND',
          source: 'outbound-documents',
        },
        client,
      );
    }

    let inserted;
    try {
      inserted = await client.query<RawDocumentRow>(
        `INSERT INTO documents (entity_type, entity_id, document_type, document_data, organization_id)
         VALUES ('ORDER', $1, $2, $3::jsonb, $4::uuid)
         RETURNING id, entity_type, entity_id, document_type, document_data, created_at, updated_at`,
        [
          input.orderId,
          input.documentType,
          JSON.stringify({
            url: '',
            platform: input.platform,
            source: input.source,
            sourceHash,
            mimeType: input.contentType,
            carrier: input.carrier ?? null,
            tracking: input.tracking ?? null,
            uploadedBy: input.uploadedBy ?? null,
            filename: input.filename ?? null,
          } satisfies OutboundDocumentData),
          orgId,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new OutboundDocumentConflictError('Document already attached');
      }
      throw error;
    }

    const newId = Number(inserted.rows[0].id);
    await wireOutboundDocumentLinks(orgId, client, deps, {
      documentId: newId,
      orderId: input.orderId,
      documentType: input.documentType,
      shipmentId,
    });

    if (firstLabel) {
      await client.query(
        `UPDATE orders SET label_printed_at = NOW(), label_printed_by = $1
           WHERE id = $2 AND label_printed_at IS NULL AND organization_id = $3`,
        [input.uploadedBy ?? null, input.orderId, orgId],
      );
    }

    return { documentId: newId, isFirstLabel: firstLabel };
  }).catch(async (error) => {
    if (error instanceof OutboundDocumentConflictError) {
      const raced = await findOutboundDocumentBySourceHash(orgId, input.documentType, sourceHash, deps);
      if (raced) return { raced } as const;
    }
    throw error;
  });

  if ('raced' in insertResult) {
    return { document: insertResult.raced, isFirstLabel: false, created: false };
  }

  const { documentId, isFirstLabel } = insertResult;

  const ext =
    input.extension ??
    (input.contentType === 'image/png' ? 'png' : input.contentType === 'application/pdf' ? 'pdf' : 'bin');

  try {
    const uploaded = await uploadOutboundDocumentToGcs({
      organizationId: orgId,
      documentId,
      documentType: input.documentType,
      platform: input.platform,
      orderRef: input.orderRef,
      trackingTail: input.tracking?.trim().slice(-6) || null,
      buffer: input.buffer,
      contentType: input.contentType,
      extension: ext,
    });

    const proxyUrl = documentContentUrl(documentId);
    const data: OutboundDocumentData = {
      url: proxyUrl,
      platform: input.platform,
      source: input.source,
      sourceHash,
      mimeType: input.contentType,
      carrier: input.carrier ?? null,
      tracking: input.tracking ?? null,
      uploadedBy: input.uploadedBy ?? null,
      filename: input.filename ?? null,
      storageProvider: 'gcs',
      bucket: uploaded.bucket,
      objectKey: uploaded.objectKey,
      sha256Hex: uploaded.sha256Hex,
      fileSizeBytes: uploaded.fileSizeBytes,
      fetchedAt: new Date().toISOString(),
    };

    await deps.withTenantTransaction(orgId, async (client) => {
      await client.query(
        `UPDATE documents SET document_data = $1::jsonb, updated_at = NOW()
          WHERE id = $2 AND organization_id = $3::uuid`,
        [JSON.stringify(data), documentId, orgId],
      );
    });

    const docs = await listDocumentsForOrder(orgId, input.orderId, deps);
    const document = docs.find((d) => d.id === documentId);
    if (!document) {
      throw new OutboundDocumentNotFoundError(`document not found after store: ${documentId}`);
    }

    return { document, isFirstLabel, created: true };
  } catch (error) {
    await deps.withTenantTransaction(orgId, async (client) => {
      await client.query(`DELETE FROM documents WHERE id = $1 AND organization_id = $2::uuid`, [
        documentId,
        orgId,
      ]);
    });
    throw error;
  }
}

/**
 * Marketplace fetch entry — delegates to orchestrator when enabled; otherwise
 * returns a clear manual-upload message (legacy stub behavior).
 */
export async function fetchOutboundDocuments(
  orgId: OrgId,
  orderId: number,
  types: OutboundDocumentType[],
): Promise<FetchOutboundDocumentsResult> {
  const { isOutboundMarketplaceFetchEnabled } = await import('./marketplace/feature-flag');
  if (!isOutboundMarketplaceFetchEnabled()) {
    return {
      fetched: [],
      failed: types.map((type) => ({
        type,
        error: 'Marketplace document fetch is disabled — upload manually.',
      })),
    };
  }

  const { runMarketplaceDocumentFetch } = await import('./marketplace/fetch-outbound-documents');
  return runMarketplaceDocumentFetch(orgId, orderId, types);
}
