/**
 * Staff-to-staff message queries — backs GET/POST/PATCH /api/staff-messages,
 * the persistent side of the header clipboard "send to staff" flow.
 *
 * Every read is scoped to the verified session's staff_id (you only ever see
 * your OWN inbox). Sends are scoped to the sender's organization: the recipient
 * must be a live staffer in the same org, checked server-side — the request
 * body is never trusted for org/identity.
 */

import pool from '@/lib/db';
import type { StaffMessageKind } from '@/lib/schemas/staff-messages';

export interface StaffMessageRow {
  id: number;
  senderId: number;
  senderName: string;
  senderColorHex: string;
  recipientId: number;
  body: string;
  kind: string;
  context: Record<string, unknown> | null;
  readAtMs: number | null;
  createdAtMs: number;
}

function mapRow(row: Record<string, unknown>): StaffMessageRow {
  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  return {
    id: Number(row.id),
    senderId: Number(row.sender_id),
    senderName: String(row.sender_name ?? `Staff #${row.sender_id}`),
    senderColorHex: String(row.sender_color_hex ?? '#10b981'),
    recipientId: Number(row.recipient_id),
    body: String(row.body ?? ''),
    kind: String(row.kind ?? 'copied_text'),
    context: (row.context as Record<string, unknown> | null) ?? null,
    readAtMs: num(row.read_at_ms),
    createdAtMs: Number(row.created_at_ms) || 0,
  };
}

const SELECT_ROW = `
  SELECT m.id::int,
         m.sender_id::int,
         s.name        AS sender_name,
         s.color_hex   AS sender_color_hex,
         m.recipient_id::int,
         m.body,
         m.kind,
         m.context,
         (EXTRACT(EPOCH FROM m.read_at) * 1000)::bigint    AS read_at_ms,
         (EXTRACT(EPOCH FROM m.created_at) * 1000)::bigint AS created_at_ms
    FROM staff_messages m
    JOIN staff s ON s.id = m.sender_id`;

/** A live staffer in `organizationId`, or null. Guards who a message can be sent to. */
export async function resolveRecipient(
  organizationId: string,
  recipientId: number,
): Promise<{ id: number; name: string } | null> {
  const r = await pool.query(
    `SELECT id::int, name
       FROM staff
      WHERE id = $1
        AND organization_id = $2
        AND COALESCE(status, 'active') IN ('active', 'invited')
        AND COALESCE(active, true) = true`,
    [recipientId, organizationId],
  );
  return r.rows[0] ? { id: Number(r.rows[0].id), name: String(r.rows[0].name) } : null;
}

export async function createStaffMessage(args: {
  organizationId: string;
  senderId: number;
  recipientId: number;
  body: string;
  kind: StaffMessageKind;
  context?: Record<string, unknown> | null;
}): Promise<StaffMessageRow> {
  const r = await pool.query(
    `INSERT INTO staff_messages (organization_id, sender_id, recipient_id, body, kind, context)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id`,
    [
      args.organizationId,
      args.senderId,
      args.recipientId,
      args.body,
      args.kind,
      args.context ? JSON.stringify(args.context) : null,
    ],
  );
  const row = await getStaffMessage(args.recipientId, Number(r.rows[0].id));
  if (!row) throw new Error('staff_messages insert did not return a readable row');
  return row;
}

/** One message, scoped to its recipient (the only person allowed to read it). */
export async function getStaffMessage(
  recipientId: number,
  id: number,
): Promise<StaffMessageRow | null> {
  const r = await pool.query(
    `${SELECT_ROW} WHERE m.id = $2 AND m.recipient_id = $1 AND m.archived_at IS NULL`,
    [recipientId, id],
  );
  return r.rows[0] ? mapRow(r.rows[0]) : null;
}

/** The recipient's inbox, newest first. `unreadOnly` powers the bell badge. */
export async function listInboxMessages(
  recipientId: number,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<StaffMessageRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const r = await pool.query(
    `${SELECT_ROW}
      WHERE m.recipient_id = $1
        AND m.archived_at IS NULL
        ${opts.unreadOnly ? 'AND m.read_at IS NULL' : ''}
      ORDER BY m.created_at DESC
      LIMIT ${limit}`,
    [recipientId],
  );
  return r.rows.map(mapRow);
}

/** Mark one received message read (idempotent). False when nothing matched. */
export async function markStaffMessageRead(recipientId: number, id: number): Promise<boolean> {
  const r = await pool.query(
    `UPDATE staff_messages SET read_at = now()
      WHERE id = $2 AND recipient_id = $1 AND archived_at IS NULL AND read_at IS NULL`,
    [recipientId, id],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Mark the recipient's whole inbox read. Returns how many flipped. */
export async function markAllStaffMessagesRead(recipientId: number): Promise<number> {
  const r = await pool.query(
    `UPDATE staff_messages SET read_at = now()
      WHERE recipient_id = $1 AND archived_at IS NULL AND read_at IS NULL`,
    [recipientId],
  );
  return r.rowCount ?? 0;
}
