/**
 * Receiving typed-facts store — the read/write chokepoint for
 * `receiving_line_facts`. Validates every write against the per-fact_kind schema
 * in ./registry (so the polymorphic payload is a tagged union, not a junk
 * drawer), org-scopes every statement, and upserts on (org, line, fact_kind).
 *
 * Deps-injected (default real impls) so unit tests run DB-free — same convention
 * as src/lib/receiving/exceptions.ts.
 *
 * The narrow 1:1 facts tables (receiving_line_zoho / _testing / _return /
 * _putaway) have their own typed helpers; this module owns only the open-ended
 * receiving_line_facts registry table.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { parseFactPayload } from './registry';

export interface FactsDeps {
  query: typeof tenantQuery;
}

const defaultDeps: FactsDeps = { query: tenantQuery };

export interface LineFactRow {
  id: number;
  fact_kind: string;
  payload: Record<string, unknown>;
}

/**
 * Upsert one typed fact for a line. The payload is validated against the kind's
 * registered schema first — a malformed payload throws before any SQL runs.
 * Returns the row id.
 */
export async function writeLineFact(
  orgId: OrgId,
  receivingLineId: number,
  factKind: string,
  payload: unknown,
  deps: FactsDeps = defaultDeps,
): Promise<{ id: number }> {
  const validated = parseFactPayload(factKind, payload); // throws (ZodError) on invalid
  const r = await deps.query<{ id: number }>(
    orgId,
    `INSERT INTO receiving_line_facts (organization_id, receiving_line_id, fact_kind, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (organization_id, receiving_line_id, fact_kind)
     DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
     RETURNING id`,
    [orgId, receivingLineId, factKind, JSON.stringify(validated)],
  );
  return { id: r.rows[0].id };
}

/** Read one fact's payload, or null if the line has no fact of that kind. */
export async function readLineFact<T = Record<string, unknown>>(
  orgId: OrgId,
  receivingLineId: number,
  factKind: string,
  deps: FactsDeps = defaultDeps,
): Promise<T | null> {
  const r = await deps.query<{ payload: T }>(
    orgId,
    `SELECT payload
       FROM receiving_line_facts
      WHERE organization_id = $1 AND receiving_line_id = $2 AND fact_kind = $3`,
    [orgId, receivingLineId, factKind],
  );
  return r.rows.length > 0 ? r.rows[0].payload : null;
}

/** All facts for a line, ordered by kind (for the detail panes). */
export async function listLineFacts(
  orgId: OrgId,
  receivingLineId: number,
  deps: FactsDeps = defaultDeps,
): Promise<LineFactRow[]> {
  const r = await deps.query<LineFactRow>(
    orgId,
    `SELECT id, fact_kind, payload
       FROM receiving_line_facts
      WHERE organization_id = $1 AND receiving_line_id = $2
      ORDER BY fact_kind`,
    [orgId, receivingLineId],
  );
  return r.rows;
}

/** Remove a line's fact of a given kind. Returns the number of rows deleted (0/1). */
export async function deleteLineFact(
  orgId: OrgId,
  receivingLineId: number,
  factKind: string,
  deps: FactsDeps = defaultDeps,
): Promise<number> {
  const r = await deps.query<{ id: number }>(
    orgId,
    `DELETE FROM receiving_line_facts
      WHERE organization_id = $1 AND receiving_line_id = $2 AND fact_kind = $3
      RETURNING id`,
    [orgId, receivingLineId, factKind],
  );
  return r.rows.length;
}
