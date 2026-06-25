/**
 * Call-log read path for the Calls Monitor stream. Org-scoped, newest-first.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { toIso, type CallDirection, type CallEventDTO } from './types';

export type CallDirectionFilter = 'all' | CallDirection;

export interface ListCallEventsParams {
  direction: CallDirectionFilter;
  query?: string | null;
  limit?: number;
}

interface CallEventRow {
  id: number;
  direction: CallDirection;
  from_number: string | null;
  to_number: string | null;
  counterparty_e164: string | null;
  matched_customer_name: string | null;
  agent_name: string | null;
  status: string | null;
  started_at: unknown;
  duration_seconds: number | null;
}

export async function listCallEvents(orgId: OrgId, params: ListCallEventsParams): Promise<CallEventDTO[]> {
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
  const conds: string[] = ['c.organization_id = $1'];
  const args: unknown[] = [orgId];

  if (params.direction !== 'all') {
    args.push(params.direction);
    conds.push(`c.direction = $${args.length}`);
  }

  const q = (params.query ?? '').trim();
  if (q) {
    args.push(`%${q}%`);
    const i = args.length;
    conds.push(
      `(c.from_number ILIKE $${i} OR c.to_number ILIKE $${i}
        OR c.counterparty_e164 ILIKE $${i} OR (c.matched_customer->>'name') ILIKE $${i})`,
    );
  }

  args.push(limit);
  const limitParam = args.length;

  const r = await tenantQuery<CallEventRow>(
    orgId,
    `SELECT c.id,
            c.direction,
            c.from_number,
            c.to_number,
            c.counterparty_e164,
            (c.matched_customer->>'name') AS matched_customer_name,
            s.name AS agent_name,
            c.status,
            c.started_at,
            c.duration_seconds
       FROM call_events c
       LEFT JOIN staff s ON s.id = c.agent_staff_id
      WHERE ${conds.join(' AND ')}
      ORDER BY c.started_at DESC NULLS LAST
      LIMIT $${limitParam}`,
    args,
  );

  return r.rows.map((row) => ({
    id: Number(row.id),
    direction: row.direction,
    fromNumber: row.from_number,
    toNumber: row.to_number,
    counterparty: row.counterparty_e164,
    matchedCustomerName: row.matched_customer_name,
    agentName: row.agent_name,
    status: row.status,
    startedAt: toIso(row.started_at),
    durationSeconds: row.duration_seconds,
  }));
}
