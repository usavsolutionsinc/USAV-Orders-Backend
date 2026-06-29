/**
 * Zendesk ticket ↔ internal entity linking + Blob-photo resolution.
 *
 * Photos for a ticket live in OUR Vercel Blob (the `photos` table), not as
 * Zendesk attachments. To show them we resolve the ticket's internal entity,
 * then fetch that entity's photos. See migration 2026-06-01_ticket_links.sql.
 */
import { tenantQuery } from '@/lib/tenancy/db';
import { getTicket, updateTicket } from './zendesk';
import { photoContentUrl } from '@/lib/photos/display-url';
import { listPhotosForEntity } from '@/lib/photos/service';
import type { PhotoEntityType } from '@/lib/photos/types';

export interface TicketEntityRef {
  type: string;
  id: number;
}

export interface ResolvedTicketEntity extends TicketEntityRef {
  source: 'ticket_links' | 'external_id' | 'unfound_overlay';
}

/** Build a Zendesk `external_id`, e.g. ('RECEIVING_LINE', 1234) → "receiving_line:1234". */
export function buildExternalId(type: string, id: number | string): string {
  return `${String(type).toLowerCase()}:${id}`;
}

/** Parse a Zendesk `external_id` back into an entity ref, or null if it isn't ours. */
export function parseExternalId(value: string | null | undefined): TicketEntityRef | null {
  if (!value) return null;
  const m = /^([a-z_]+):(\d+)$/i.exec(value.trim());
  if (!m) return null;
  return { type: m[1].toUpperCase(), id: Number(m[2]) };
}

/** Upsert a ticket → entity link. Best-effort callers should wrap in try/catch. */
export async function linkTicket(args: {
  orgId: string;
  zendeskTicketId: number;
  entityType: string;
  entityId: number;
  staffId?: number | null;
}): Promise<void> {
  await tenantQuery(
    args.orgId,
    `INSERT INTO ticket_links
       (organization_id, zendesk_ticket_id, entity_type, entity_id, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (organization_id, zendesk_ticket_id) DO UPDATE
       SET entity_type = EXCLUDED.entity_type,
           entity_id   = EXCLUDED.entity_id,
           updated_at  = NOW()`,
    [args.orgId, args.zendeskTicketId, args.entityType, args.entityId, args.staffId ?? null],
  );
}

/**
 * Remove a ticket → entity link. Only deletes the row when it still points at
 * the given entity, so a stale unlink can't detach a ticket that was since
 * re-linked elsewhere. Returns true when a row was removed.
 */
export async function unlinkTicket(args: {
  orgId: string;
  zendeskTicketId: number;
  entityType: string;
  entityId: number;
}): Promise<boolean> {
  const res = await tenantQuery(
    args.orgId,
    `DELETE FROM ticket_links
      WHERE organization_id = $1
        AND zendesk_ticket_id = $2
        AND entity_type = $3
        AND entity_id = $4`,
    [args.orgId, args.zendeskTicketId, args.entityType, args.entityId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Clear a Zendesk ticket's `external_id` — but ONLY when it still resolves to
 * the given entity. Called on unlink (receiving + warranty) so a detached
 * ticket can't be silently re-attached to the same entity via the external_id
 * fallback in {@link getTicketEntity}. Best-effort: never throws — the
 * `ticket_links` delete is the authoritative detach, this is the clean-up.
 * Returns true when an external_id was cleared.
 */
export async function clearTicketExternalIdIfMatches(args: {
  zendeskTicketId: number;
  entityType: string;
  entityId: number;
}): Promise<boolean> {
  try {
    const ticket = await getTicket(args.zendeskTicketId);
    const parsed = parseExternalId(ticket?.external_id as string | undefined);
    if (parsed && parsed.type === args.entityType && parsed.id === args.entityId) {
      await updateTicket(args.zendeskTicketId, { external_id: null });
      return true;
    }
  } catch (err) {
    console.warn('[zendesk-links] external_id clear failed', err);
  }
  return false;
}

/**
 * Resolve which internal entity a Zendesk ticket belongs to, trying in order:
 *   1. ticket_links table  2. the ticket's external_id  3. unfound_overlay.
 * Returns null when no link is known (e.g. inbound/Zendesk-native tickets).
 */
export async function getTicketEntity(
  orgId: string,
  zendeskTicketId: number,
): Promise<ResolvedTicketEntity | null> {
  // 1. ticket_links (cheapest, authoritative)
  const links = await tenantQuery<{ entity_type: string; entity_id: string }>(
    orgId,
    `SELECT entity_type, entity_id FROM ticket_links
      WHERE organization_id = $1 AND zendesk_ticket_id = $2 LIMIT 1`,
    [orgId, zendeskTicketId],
  );
  if (links.rows[0]) {
    return {
      type: links.rows[0].entity_type,
      id: Number(links.rows[0].entity_id),
      source: 'ticket_links',
    };
  }

  // 2. external_id off the live ticket (covers tickets created with it but not yet linked)
  const ticket = await getTicket(zendeskTicketId);
  const parsed = parseExternalId(ticket?.external_id as string | undefined);
  if (parsed) return { ...parsed, source: 'external_id' };

  // 3. unfound_overlay — stores zendesk_ticket_id as text ("1234" or "#1234")
  const ov = await tenantQuery<{ source_kind: string; source_id: string }>(
    orgId,
    `SELECT source_kind, source_id FROM unfound_overlay
      WHERE organization_id = $1
        AND zendesk_ticket_id IN ($2, $3) LIMIT 1`,
    [orgId, String(zendeskTicketId), `#${zendeskTicketId}`],
  );
  const row = ov.rows[0];
  if (row && row.source_kind === 'unmatched_receiving' && /^\d+$/.test(row.source_id)) {
    // unmatched_receiving.source_id is a receiving.id → photo-bearing RECEIVING entity
    return { type: 'RECEIVING', id: Number(row.source_id), source: 'unfound_overlay' };
  }

  return null;
}

export interface EntityPhoto {
  id: number;
  url: string;
  caption: string | null;
  takenByStaffId: number | null;
  createdAt: string;
}

/**
 * Fetch photos for an entity via photo_entity_links dual-read.
 * For RECEIVING_LINE, includes parent PO-level photos (not other lines).
 */
export async function getEntityPhotos(
  organizationId: string,
  entity: TicketEntityRef,
): Promise<EntityPhoto[]> {
  const byId = new Map<number, EntityPhoto>();

  const addRows = (
    rows: Awaited<ReturnType<typeof listPhotosForEntity>>,
  ) => {
    for (const row of rows) {
      if (byId.has(row.id)) continue;
      byId.set(row.id, {
        id: row.id,
        url: row.url?.startsWith('/api/photos/') ? row.url : photoContentUrl(row.id),
        caption: row.photoType,
        takenByStaffId: row.takenByStaffId,
        createdAt: row.createdAt,
      });
    }
  };

  if (entity.type === 'RECEIVING_LINE') {
    addRows(
      await listPhotosForEntity({
        organizationId,
        entityType: 'RECEIVING_LINE',
        entityId: entity.id,
      }),
    );
    const parent = await tenantQuery<{ receiving_id: number | null }>(
      organizationId,
      `SELECT receiving_id FROM receiving_lines WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [entity.id, organizationId],
    );
    const receivingId = parent.rows[0]?.receiving_id;
    if (receivingId != null) {
      addRows(
        await listPhotosForEntity({
          organizationId,
          entityType: 'RECEIVING',
          entityId: Number(receivingId),
        }),
      );
    }
  } else if (entity.type === 'RECEIVING') {
    addRows(
      await listPhotosForEntity({
        organizationId,
        entityType: 'RECEIVING',
        entityId: entity.id,
        receivingId: entity.id,
      }),
    );
  } else {
    const entityType = entity.type as PhotoEntityType;
    addRows(
      await listPhotosForEntity({
        organizationId,
        entityType,
        entityId: entity.id,
      }),
    );
  }

  return [...byId.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}
