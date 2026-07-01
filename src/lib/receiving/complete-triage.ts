/**
 * Save-for-unbox — the real triage-complete transition
 * (docs/receiving-triage-redesign-plan.md §3.5).
 *
 * Today `TriagePanel`'s "Save for unbox" button was a client-only
 * `toast.success(...)` — zero server write, zero column touched. This is the
 * server half: stamp `receiving.triage_complete` (+ _at/_by) so the carton has
 * a real, audited "identified, staged, handed to unbox" state.
 *
 * Does NOT require a PO link (B5) or intake photos (D8). DOES require a shelf
 * (`staging_location_id`) and a lane (`priority_lane`) — A1, now enforceable
 * since Phase 2's `StagingSection` picker gives the operator a way to set both.
 *
 * Does NOT advance `workflow_status` — that remains the unbox street's job via
 * the one guarded `transitionReceivingLine()` chokepoint (never duplicated here).
 *
 * Idempotent via `triage_client_event_id` (UNIQUE), mirroring the
 * `inventory_events.client_event_id` pattern in .claude/rules/backend-patterns.md
 * — a retried click/network-flake resolves the SAME row instead of erroring or
 * double-writing.
 */
import { withTenantTransaction } from '@/lib/tenancy/db';

export interface CompleteTriageInput {
  receivingId: number;
  staffId: number;
  clientEventId?: string | null;
}

export interface CompleteTriageResult {
  ok: boolean;
  status: number;
  error?: string;
  receivingId: number;
  triageCompletedAt: string | null;
  idempotent: boolean;
}

/** Minimal query surface — lets the unit test pass a fake client (DB-free). */
export interface TxClient {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

export interface CompleteTriageDeps {
  runTx: <T>(orgId: string, fn: (client: TxClient) => Promise<T>) => Promise<T>;
}

const defaultDeps: CompleteTriageDeps = {
  runTx: (orgId, fn) => withTenantTransaction(orgId, (client) => fn(client as unknown as TxClient)),
};

export async function completeTriage(
  input: CompleteTriageInput,
  orgId: string,
  deps: CompleteTriageDeps = defaultDeps,
): Promise<CompleteTriageResult> {
  const { receivingId, staffId } = input;
  const clientEventId = input.clientEventId?.trim() || null;

  return deps.runTx(orgId, async (client) => {
    // Idempotency: a retried request with the SAME client_event_id resolves the
    // row it already completed, instead of erroring or re-stamping the actor/time.
    if (clientEventId) {
      const existing = await client.query(
        `SELECT id, triage_completed_at::text AS triage_completed_at
           FROM receiving
          WHERE organization_id = $1 AND triage_client_event_id = $2
          LIMIT 1`,
        [orgId, clientEventId],
      );
      if (existing.rowCount) {
        const row = existing.rows[0];
        return {
          ok: true,
          status: 200,
          receivingId: Number(row.id),
          triageCompletedAt: (row.triage_completed_at as string) ?? null,
          idempotent: true,
        };
      }
    }

    const res = await client.query(
      `UPDATE receiving
          SET triage_complete = true,
              triage_completed_at = NOW(),
              triage_completed_by = $3,
              triage_client_event_id = COALESCE($4, triage_client_event_id)
        WHERE id = $1 AND organization_id = $2
          AND staging_location_id IS NOT NULL AND priority_lane IS NOT NULL
        RETURNING triage_completed_at::text AS triage_completed_at`,
      [receivingId, orgId, staffId, clientEventId],
    );

    if (res.rowCount === 0) {
      // Distinguish "doesn't exist" from "exists but isn't staged yet" so the
      // UI can show a precise, actionable error rather than a bare 404.
      const exists = await client.query(
        `SELECT staging_location_id, priority_lane FROM receiving
          WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [receivingId, orgId],
      );
      if (exists.rowCount === 0) {
        return {
          ok: false,
          status: 404,
          error: 'carton not found',
          receivingId,
          triageCompletedAt: null,
          idempotent: false,
        };
      }
      return {
        ok: false,
        status: 422,
        error: 'Assign a shelf and a priority lane before saving for unbox.',
        receivingId,
        triageCompletedAt: null,
        idempotent: false,
      };
    }

    return {
      ok: true,
      status: 200,
      receivingId,
      triageCompletedAt: (res.rows[0].triage_completed_at as string) ?? null,
      idempotent: false,
    };
  });
}
