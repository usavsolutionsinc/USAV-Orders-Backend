/**
 * Zendesk ticket ↔ internal entity linking + Blob-photo resolution.
 *
 * Photos for a ticket live in OUR Vercel Blob (the `photos` table), not as
 * Zendesk attachments. To show them we resolve the ticket's internal entity,
 * then fetch that entity's photos. See migration 2026-06-01_ticket_links.sql.
 */
import pool from '@/lib/db';
import { getTicket, updateTicket } from './zendesk';

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
  await pool.query(
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
  const res = await pool.query(
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
  const links = await pool.query<{ entity_type: string; entity_id: string }>(
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
  const ov = await pool.query<{ source_kind: string; source_id: string }>(
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
 * Fetch Blob photos for an entity. For a RECEIVING_LINE we also include the
 * parent receiving's PO-level photos (entity_type='RECEIVING'), mirroring how
 * the receiving workspace surfaces both line and package shots.
 */
export async function getEntityPhotos(entity: TicketEntityRef): Promise<EntityPhoto[]> {
  const pairs: Array<[string, number]> = [[entity.type, entity.id]];

  if (entity.type === 'RECEIVING_LINE') {
    const parent = await pool.query<{ receiving_id: number | null }>(
      `SELECT receiving_id FROM receiving_lines WHERE id = $1 LIMIT 1`,
      [entity.id],
    );
    const receivingId = parent.rows[0]?.receiving_id;
    if (receivingId != null) pairs.push(['RECEIVING', Number(receivingId)]);
  }

  const where = pairs
    .map((_, i) => `(entity_type = $${i * 2 + 1} AND entity_id = $${i * 2 + 2})`)
    .join(' OR ');
  const params = pairs.flat();

  const res = await pool.query<{
    id: string;
    url: string;
    photo_type: string | null;
    taken_by_staff_id: number | null;
    created_at: string;
  }>(
    `SELECT id, url, photo_type, taken_by_staff_id, created_at
       FROM photos
      WHERE ${where}
      ORDER BY created_at DESC`,
    params,
  );

  return res.rows.map((r) => ({
    id: Number(r.id),
    url: r.url,
    caption: r.photo_type,
    takenByStaffId: r.taken_by_staff_id,
    createdAt: r.created_at,
  }));
}
