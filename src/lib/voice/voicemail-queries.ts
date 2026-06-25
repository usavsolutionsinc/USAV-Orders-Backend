/**
 * Voicemail read paths for the Workbench picker + detail pane.
 *
 * The to-do list = voicemails JOIN voicemail_followups, filtered by the
 * follow-up status; ordered newest voicemail first. All reads go through
 * `tenantQuery` (org GUC) so they are tenant-scoped by construction.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  toIso,
  type VoicemailDetailDTO,
  type VoicemailListItemDTO,
  type VoicemailStatus,
} from './types';

export type VoicemailStatusFilter = 'open' | 'snoozed' | 'done' | 'all';

export interface ListVoicemailsParams {
  status: VoicemailStatusFilter;
  query?: string | null;
  assignedStaffId?: number | null;
  limit?: number;
}

export interface ListVoicemailsResult {
  items: VoicemailListItemDTO[];
  openCount: number;
}

interface VoicemailListRow {
  id: number;
  from_number: string | null;
  counterparty_e164: string | null;
  matched_customer_name: string | null;
  mailbox: string | null;
  left_at: unknown;
  duration_seconds: number | null;
  is_read: boolean;
  transcript_preview: string | null;
  followup_status: VoicemailStatus;
  assigned_staff_name: string | null;
  linked_ticket_id: number | string | null;
}

function mapListRow(r: VoicemailListRow): VoicemailListItemDTO {
  return {
    id: Number(r.id),
    fromNumber: r.from_number,
    counterparty: r.counterparty_e164,
    matchedCustomerName: r.matched_customer_name,
    mailbox: r.mailbox,
    leftAt: toIso(r.left_at),
    durationSeconds: r.duration_seconds,
    isRead: r.is_read,
    transcriptPreview: r.transcript_preview,
    followupStatus: r.followup_status,
    assignedStaffName: r.assigned_staff_name,
    linkedTicketId: r.linked_ticket_id != null ? Number(r.linked_ticket_id) : null,
  };
}

export async function listVoicemails(
  orgId: OrgId,
  params: ListVoicemailsParams,
): Promise<ListVoicemailsResult> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 200);
  const conds: string[] = ['v.organization_id = $1'];
  const args: unknown[] = [orgId];

  // status filter
  if (params.status === 'open') conds.push(`f.status = 'open'`);
  else if (params.status === 'snoozed') conds.push(`f.status = 'snoozed'`);
  else if (params.status === 'done') conds.push(`f.status IN ('done','no_action')`);
  // 'all' → no status predicate

  if (params.assignedStaffId != null) {
    args.push(params.assignedStaffId);
    conds.push(`f.assigned_staff_id = $${args.length}`);
  }

  const q = (params.query ?? '').trim();
  if (q) {
    args.push(`%${q}%`);
    const i = args.length;
    conds.push(
      `(v.from_number ILIKE $${i} OR v.counterparty_e164 ILIKE $${i}
        OR v.transcript ILIKE $${i} OR (v.matched_customer->>'name') ILIKE $${i})`,
    );
  }

  args.push(limit);
  const limitParam = args.length;

  const r = await tenantQuery<VoicemailListRow>(
    orgId,
    `SELECT v.id,
            v.from_number,
            v.counterparty_e164,
            (v.matched_customer->>'name') AS matched_customer_name,
            v.mailbox,
            v.left_at,
            v.duration_seconds,
            v.is_read,
            LEFT(v.transcript, 140) AS transcript_preview,
            v.linked_ticket_id,
            f.status AS followup_status,
            s.name AS assigned_staff_name
       FROM voicemails v
       JOIN voicemail_followups f
         ON f.voicemail_id = v.id AND f.organization_id = v.organization_id
       LEFT JOIN staff s ON s.id = f.assigned_staff_id
      WHERE ${conds.join(' AND ')}
      ORDER BY v.left_at DESC NULLS LAST
      LIMIT $${limitParam}`,
    args,
  );

  const countRes = await tenantQuery<{ open_count: string }>(
    orgId,
    `SELECT COUNT(*)::int AS open_count
       FROM voicemail_followups f
      WHERE f.organization_id = $1 AND f.status = 'open'`,
    [orgId],
  );

  return {
    items: r.rows.map(mapListRow),
    openCount: Number(countRes.rows[0]?.open_count ?? 0),
  };
}

/** Raw recording source for the proxy route (never exposed to the browser). */
export async function getVoicemailRecordingSource(
  orgId: OrgId,
  id: number,
): Promise<{ recordingUrl: string | null; blobKey: string | null } | null> {
  const r = await tenantQuery<{ recording_url: string | null; recording_blob_key: string | null }>(
    orgId,
    `SELECT recording_url, recording_blob_key
       FROM voicemails
      WHERE organization_id = $1 AND id = $2
      LIMIT 1`,
    [orgId, id],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { recordingUrl: row.recording_url, blobKey: row.recording_blob_key };
}

interface VoicemailDetailRow extends VoicemailListRow {
  transcript: string | null;
  recording_url: string | null;
  recording_blob_key: string | null;
  snooze_until: unknown;
  note: string | null;
  linked_order_id: number | string | null;
}

export async function getVoicemail(orgId: OrgId, id: number): Promise<VoicemailDetailDTO | null> {
  const r = await tenantQuery<VoicemailDetailRow>(
    orgId,
    `SELECT v.id,
            v.from_number,
            v.counterparty_e164,
            (v.matched_customer->>'name') AS matched_customer_name,
            v.mailbox,
            v.left_at,
            v.duration_seconds,
            v.is_read,
            v.transcript,
            LEFT(v.transcript, 140) AS transcript_preview,
            v.recording_url,
            v.recording_blob_key,
            v.linked_ticket_id,
            v.linked_order_id,
            f.status AS followup_status,
            f.snooze_until,
            f.note,
            s.name AS assigned_staff_name
       FROM voicemails v
       JOIN voicemail_followups f
         ON f.voicemail_id = v.id AND f.organization_id = v.organization_id
       LEFT JOIN staff s ON s.id = f.assigned_staff_id
      WHERE v.organization_id = $1 AND v.id = $2
      LIMIT 1`,
    [orgId, id],
  );
  const row = r.rows[0];
  if (!row) return null;

  const hasRecording = Boolean(row.recording_url || row.recording_blob_key);
  return {
    ...mapListRow(row),
    transcript: row.transcript,
    recordingUrl: hasRecording ? `/api/voicemails/${Number(row.id)}/recording` : null,
    snoozeUntil: toIso(row.snooze_until),
    note: row.note,
    linkedOrderId: row.linked_order_id != null ? Number(row.linked_order_id) : null,
  };
}
