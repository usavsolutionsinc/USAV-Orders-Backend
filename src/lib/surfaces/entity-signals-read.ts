/**
 * Org-scoped read of the `entity_signals` spine for the history surfaces
 * (universal-feed plan Phase 5). Powers both the Monitor timeline and the
 * Workbench master-detail. Filters: trailing `sinceDays` window (occurred_at),
 * `signalKind`, `entityType`, and full-text `q` over `notes_tsv` (the GIN index).
 *
 * Reads the tenant's OWN signals only (Monitor rule: never cross-tenant), via
 * tenantQuery (GUC-scoped). Deps-injected (default tenantQuery) so it unit-tests
 * DB-free.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { isSignalKind, isSurfaceEntityType } from '@/lib/surfaces/registry';
import type { EntitySignalTimelineRow } from '@/lib/timeline';

export interface EntitySignalFilter {
  limit?: number;
  /** Trailing window in days (occurred_at >= NOW() - N days). Omit = no window. */
  sinceDays?: number | null;
  signalKind?: string | null;
  entityType?: string | null;
  /** Full-text over notes + reason_code (websearch syntax). */
  q?: string | null;
}

export interface EntitySignalsReadDeps {
  query: typeof tenantQuery;
}

const defaultDeps: EntitySignalsReadDeps = { query: tenantQuery };

export async function readEntitySignals(
  orgId: OrgId,
  filter: EntitySignalFilter,
  deps: EntitySignalsReadDeps = defaultDeps,
): Promise<EntitySignalTimelineRow[]> {
  const limit = Math.max(1, Math.min(Math.round(filter.limit ?? 200), 500));
  const params: unknown[] = [orgId];
  const where: string[] = ['organization_id = $1'];

  if (filter.sinceDays != null && Number.isFinite(filter.sinceDays) && filter.sinceDays > 0) {
    params.push(Math.round(filter.sinceDays));
    where.push(`occurred_at >= NOW() - make_interval(days => $${params.length})`);
  }
  // Registry-validate the discriminators so a bad value narrows to nothing
  // rather than erroring (and never reaches the query as free text).
  if (filter.signalKind && isSignalKind(filter.signalKind)) {
    params.push(filter.signalKind);
    where.push(`signal_kind = $${params.length}`);
  }
  if (filter.entityType && isSurfaceEntityType(filter.entityType)) {
    params.push(filter.entityType);
    where.push(`entity_type = $${params.length}`);
  }
  const q = (filter.q ?? '').trim();
  if (q) {
    params.push(q);
    where.push(`notes_tsv @@ websearch_to_tsquery('simple', $${params.length})`);
  }
  params.push(limit);

  const r = await deps.query<EntitySignalTimelineRow>(
    orgId,
    `SELECT id, occurred_at::text AS occurred_at, signal_kind, entity_type, entity_id,
            reason_code, notes, severity
       FROM entity_signals
      WHERE ${where.join(' AND ')}
      ORDER BY occurred_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  // id + entity_id are BIGINT → the driver returns them as strings; coerce to
  // number so the declared `id: number` holds at runtime (the Workbench keys
  // selection on a numeric id, and the timeline on `sig:${id}`).
  return r.rows.map((row) => ({ ...row, id: Number(row.id), entity_id: Number(row.entity_id) }));
}

/** The full detail of one signal — for the Workbench inspector pane. */
export interface EntitySignalDetail extends EntitySignalTimelineRow {
  meta: Record<string, unknown> | null;
  source_ref: string | null;
  workflow_definition_id: number | null;
  node_id: string | null;
  created_at: string | null;
}

/** One signal by id, org-scoped. Returns null when absent (or not this org's). */
export async function getEntitySignal(
  orgId: OrgId,
  id: number,
  deps: EntitySignalsReadDeps = defaultDeps,
): Promise<EntitySignalDetail | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const r = await deps.query<EntitySignalDetail & { entity_id: string | number }>(
    orgId,
    `SELECT id, occurred_at::text AS occurred_at, signal_kind, entity_type, entity_id,
            reason_code, notes, severity, meta, source_ref, workflow_definition_id, node_id,
            created_at::text AS created_at
       FROM entity_signals
      WHERE organization_id = $1 AND id = $2
      LIMIT 1`,
    [orgId, id],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { ...row, id: Number(row.id), entity_id: Number(row.entity_id) };
}
