/**
 * Shared building blocks for unfound-queue → Zendesk tickets.
 *
 * Extracted so the push route and the AI-draft route compose the SAME
 * human-friendly ticket from the SAME queue-row query. Pure + DB helpers only;
 * the Zendesk REST call stays in the route.
 */

import pool from '@/lib/db';

export const ALLOWED_UNFOUND_KINDS = new Set([
  'email_po',
  'unmatched_receiving',
  'station_exception',
]);

export interface UnfoundQueueRow {
  kind: string;
  source_id: string;
  product_title: string | null;
  serial_numbers: string | null;
  context: string | null;
  usa_team_note: string | null;
  vietnam_team_note: string | null;
  zendesk_ticket_id: string | null;
}

export function unfoundKindLabel(kind: string): string {
  return kind === 'email_po'
    ? 'PO Mailbox'
    : kind === 'unmatched_receiving'
      ? 'Unmatched Tracking'
      : kind === 'station_exception'
        ? 'Station Exception'
        : kind;
}

/** Parse {kind, sourceId} out of an `/unfound-queue/<kind>/<id>/...` path. */
export function unfoundParamsFromUrl(
  url: URL,
): { kind: string; sourceId: string } | null {
  const segs = url.pathname.split('/');
  const idx = segs.indexOf('unfound-queue');
  if (idx < 0 || idx + 2 >= segs.length) return null;
  return {
    kind: decodeURIComponent(segs[idx + 1]!),
    sourceId: decodeURIComponent(segs[idx + 2]!),
  };
}

/**
 * Build a clean, human-readable ticket from the queue row. Leads with a plain
 * sentence and labeled fact lines — no raw "Source kind: email_po" / internal
 * id dump. The original source id is still included as a Reference for tracing.
 */
export function buildUnfoundTicket(row: UnfoundQueueRow): {
  subject: string;
  description: string;
} {
  const kindLabel = unfoundKindLabel(row.kind);
  const subjectIdentifier =
    row.product_title ?? row.context ?? row.source_id ?? '(no identifier)';
  const subject = `[${kindLabel}] ${subjectIdentifier}`.slice(0, 200);

  const lines: string[] = [
    'This item came through receiving without a matching purchase order and needs review.',
    '',
    `Source: ${kindLabel}`,
  ];
  if (row.product_title) lines.push(`Product: ${row.product_title}`);
  if (row.context) lines.push(`Details: ${row.context}`);
  if (row.serial_numbers) lines.push(`Serial Numbers: ${row.serial_numbers}`);
  lines.push(`Reference: ${row.source_id}`);
  if (row.usa_team_note) lines.push('', 'USA Team Note:', row.usa_team_note);
  if (row.vietnam_team_note) lines.push('', 'Vietnam Team Note:', row.vietnam_team_note);

  return { subject, description: lines.join('\n') };
}

/** Load the queue row through v_unfound_queue (same shape the UI displays). */
export async function loadUnfoundQueueRow(
  organizationId: string | number,
  kind: string,
  sourceId: string,
): Promise<UnfoundQueueRow | null> {
  const { rows } = await pool.query<UnfoundQueueRow>(
    `SELECT kind, source_id, product_title, serial_numbers, context,
            usa_team_note, vietnam_team_note, zendesk_ticket_id
       FROM v_unfound_queue
      WHERE organization_id = $1 AND kind = $2 AND source_id = $3
      LIMIT 1`,
    [organizationId, kind, sourceId],
  );
  return rows[0] ?? null;
}
