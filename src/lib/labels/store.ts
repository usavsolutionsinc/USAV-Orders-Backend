/**
 * Label layer — per-org override writes (Phase 3 editor backend).
 *
 * A tenant label override is a `reason_codes` row in a `lifecycle_<kind>`
 * vocabulary. Writes are guarded UPSERT / DELETE on the natural key
 * (organization_id, flow_context, code). The stable `code` must already exist
 * in the registry (`LABEL_DEFAULTS`) — callers validate that before writing, so
 * the label API can rename a code's label but never invent or rename a code.
 *
 * Deps-injected (the house pattern); the caller supplies a tenant-scoped client
 * (e.g. from `withTenantTransaction`) so RLS + org stamping apply.
 */
import type { LabelKind, LabelTone } from './types';
import { labelKindToFlowContext } from './load';

export interface LabelStoreDeps {
  query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ id: number }>; rowCount?: number | null }>;
}

export interface LabelOverrideInput {
  kind: LabelKind;
  code: string;
  /** Effective display text (reason_codes.label is NOT NULL). */
  label: string;
  /** Optional tone override; null/undefined keeps the code-side default tone. */
  tone?: LabelTone | null;
}

/** Upsert a tenant's label override; returns the reason_codes row id. */
export async function upsertLabelOverride(
  db: LabelStoreDeps,
  orgId: string,
  input: LabelOverrideInput,
): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO reason_codes (organization_id, code, label, direction, flow_context, tone, is_active)
     VALUES ($1, $2, $3, 'either', $4, $5, true)
     ON CONFLICT (organization_id, flow_context, code)
     DO UPDATE SET label = EXCLUDED.label, tone = EXCLUDED.tone, is_active = true
     RETURNING id`,
    [orgId, input.code, input.label, labelKindToFlowContext(input.kind), input.tone ?? null],
  );
  return Number(rows[0]?.id);
}

/** Remove a tenant's override → the code reverts to its registry default. */
export async function deleteLabelOverride(
  db: LabelStoreDeps,
  orgId: string,
  kind: LabelKind,
  code: string,
): Promise<boolean> {
  const res = await db.query(
    `DELETE FROM reason_codes
      WHERE organization_id = $1 AND flow_context = $2 AND code = $3`,
    [orgId, labelKindToFlowContext(kind), code],
  );
  return (res.rowCount ?? 0) > 0;
}
