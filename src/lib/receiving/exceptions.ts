/**
 * Receiving line-level exception domain — the decomposition home for per-line
 * exception facts that used to be stuck at carton level on the receiving
 * god-table.
 *
 * Scope (deliberately line-level): exceptions that belong to a SPECIFIC line —
 * the PROBLEM lifecycle dimension (DAMAGED / SHORT / OVER / WRONG_ITEM), and
 * line-level claims. A multi-line carton can now say "line A damaged, line B
 * fine" — structurally impossible when these lived on `receiving`.
 *
 * NOT moved here (genuinely carton-level, stays on `receiving`): the NO_PO /
 * CARRIER_MISMATCH scan exception on an UNFOUND carton that has no lines yet,
 * carton `support_notes`, and `return_reason` (a return is a package fact). The
 * god-table critique conflated those with line facts; they are correctly
 * carton-scoped and do not move.
 *
 * Deps-injected (default real impls) so unit tests run DB-free.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { emitEntitySignalSafe } from '@/lib/surfaces/record-entity-signal';

export interface ReceivingExceptionRow {
  id: number;
  receiving_line_id: number;
  receiving_id: number | null;
  exception_code: string;
  reason: string | null;
  support_notes: string | null;
  zendesk_ticket: string | null;
  status: string;
  created_by: number | null;
  created_at: string;
}

export interface RecordReceivingExceptionInput {
  receivingLineId: number;
  receivingId?: number | null;
  exceptionCode: string;
  reason?: string | null;
  supportNotes?: string | null;
  zendeskTicket?: string | null;
  createdBy?: number | null;
}

export interface ReceivingExceptionsDeps {
  query: typeof tenantQuery;
  /** Optional so pre-existing fakes stay valid; defaults to the real emitter. */
  emitSignal?: typeof emitEntitySignalSafe;
}

const defaultDeps: ReceivingExceptionsDeps = { query: tenantQuery, emitSignal: emitEntitySignalSafe };

/**
 * Record one OPEN line-level exception. Org-scoped (organization_id stamped
 * explicitly AND via the GUC default, matching the FORCE-isolation pattern).
 * Returns the inserted id. Best-effort dedup is the caller's concern; this
 * always inserts a row so the audit trail is complete.
 */
export async function recordReceivingException(
  orgId: OrgId,
  input: RecordReceivingExceptionInput,
  deps: ReceivingExceptionsDeps = defaultDeps,
): Promise<{ id: number }> {
  const r = await deps.query<{ id: number }>(
    orgId,
    `INSERT INTO receiving_exceptions
       (organization_id, receiving_line_id, receiving_id, exception_code, reason, support_notes, zendesk_ticket, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      orgId,
      input.receivingLineId,
      input.receivingId ?? null,
      input.exceptionCode,
      input.reason ?? null,
      input.supportNotes ?? null,
      input.zendeskTicket ?? null,
      input.createdBy ?? null,
    ],
  );
  const id = r.rows[0].id;

  // Additive "why" signal (plan §2.3 emitter #2, line-level OS&D). Never
  // fails the exception write — emitEntitySignalSafe swallows all errors.
  await (deps.emitSignal ?? emitEntitySignalSafe)({
    organizationId: orgId,
    entityType: 'RECEIVING_LINE',
    entityId: input.receivingLineId,
    signalKind: 'exception_why',
    reasonCode: input.exceptionCode,
    notes: input.reason ?? null,
    actorStaffId: input.createdBy ?? null,
    meta: { receivingId: input.receivingId ?? null, receivingExceptionId: id },
  });

  return { id };
}

/** All exceptions for a line, newest-first (for the Unbox/History detail panes). */
export async function listReceivingLineExceptions(
  orgId: OrgId,
  receivingLineId: number,
  deps: ReceivingExceptionsDeps = defaultDeps,
): Promise<ReceivingExceptionRow[]> {
  const r = await deps.query<ReceivingExceptionRow>(
    orgId,
    `SELECT id, receiving_line_id, receiving_id, exception_code, reason,
            support_notes, zendesk_ticket, status, created_by, created_at::text AS created_at
       FROM receiving_exceptions
      WHERE organization_id = $1 AND receiving_line_id = $2
      ORDER BY created_at DESC, id DESC`,
    [orgId, receivingLineId],
  );
  return r.rows;
}

/** Mark a line's open exceptions of a given code (or all) RESOLVED. */
export async function resolveReceivingExceptions(
  orgId: OrgId,
  receivingLineId: number,
  opts: { exceptionCode?: string | null; resolvedBy?: number | null } = {},
  deps: ReceivingExceptionsDeps = defaultDeps,
): Promise<number> {
  const r = await deps.query<{ id: number }>(
    orgId,
    `UPDATE receiving_exceptions
        SET status = 'RESOLVED', resolved_by = $3, resolved_at = NOW(), updated_at = NOW()
      WHERE organization_id = $1
        AND receiving_line_id = $2
        AND status = 'OPEN'
        AND ($4::text IS NULL OR exception_code = $4)
      RETURNING id`,
    [orgId, receivingLineId, opts.resolvedBy ?? null, opts.exceptionCode ?? null],
  );
  return r.rows.length;
}
