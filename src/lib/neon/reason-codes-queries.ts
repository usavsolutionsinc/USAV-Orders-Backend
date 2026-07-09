import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { getOrSet, invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_NS, CACHE_TAGS } from '@/lib/cache/tags';

export interface ReasonCodeRow {
  id: number;
  code: string;
  label: string;
  category: string;
  direction: 'in' | 'out' | 'either';
  requires_note: boolean;
  requires_photo: boolean;
  sort_order: number;
  is_active: boolean;
  /** Class-D vocabulary discriminator: inventory_event | substitution | short_pick | receiving_exception | repair_failure | verdict_detail | warranty_denial | inventory_adjust. */
  flow_context: string;
  /** D3: workflow_node ids / item-type tags this reason is scoped to; null = global. */
  applies_to: unknown[] | null;
}

const COLS = `id, code, label, category, direction, requires_note, requires_photo, sort_order, is_active, flow_context, applies_to`;

/**
 * Active reason codes for an org, filtered by the Class-D `flow_context`
 * vocabulary discriminator and, for inventory rows, the ledger `category` +
 * `direction`. The single server-side read SoT for every reason picker — see
 * docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md §3.D / D1.
 */
export async function getActiveReasonCodes(
  orgId: OrgId,
  filters: {
    flowContext?: string;
    category?: string;
    direction?: 'in' | 'out' | 'either';
    /** D3: a node's palette = global reasons (applies_to NULL) + reasons scoped to this node. */
    workflowNodeId?: string;
  } = {},
): Promise<ReasonCodeRow[]> {
  const clauses: string[] = ['is_active = true', 'organization_id = $1'];
  const params: string[] = [orgId];
  if (filters.flowContext) {
    params.push(filters.flowContext);
    clauses.push(`flow_context = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    clauses.push(`category = $${params.length}`);
  }
  // 'either'-direction codes stay available when the caller asks for in/out.
  if (filters.direction === 'in' || filters.direction === 'out') {
    params.push(filters.direction);
    clauses.push(`(direction = $${params.length} OR direction = 'either')`);
  }
  if (filters.workflowNodeId) {
    params.push(JSON.stringify([filters.workflowNodeId]));
    clauses.push(`(applies_to IS NULL OR applies_to @> $${params.length}::jsonb)`);
  }
  // Reason pickers open on every station panel; the vocabulary changes only on
  // reason-code CRUD. Cache per (org, filter combo); busted by the mutations below.
  const key = `${filters.flowContext ?? ''}:${filters.category ?? ''}:${filters.direction ?? ''}:${filters.workflowNodeId ?? ''}`;
  return getOrSet<ReasonCodeRow[]>(
    CACHE_NS.reasons,
    orgId,
    key,
    600, // 10 min; writes invalidate the tag
    [CACHE_TAGS.reasonCodes],
    async () => {
      const r = await tenantQuery<ReasonCodeRow>(
        orgId,
        `SELECT ${COLS} FROM reason_codes WHERE ${clauses.join(' AND ')} ORDER BY sort_order ASC, label ASC`,
        params,
      );
      return r.rows;
    },
  );
}

export async function getReasonCodeById(id: number, orgId: OrgId): Promise<ReasonCodeRow | null> {
  const r = await tenantQuery<ReasonCodeRow>(
    orgId,
    `SELECT ${COLS} FROM reason_codes WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [id, orgId],
  );
  return r.rows[0] ?? null;
}

export async function createReasonCode(
  input: {
    code: string;
    label: string;
    category: string;
    direction?: 'in' | 'out' | 'either';
    requiresNote?: boolean;
    requiresPhoto?: boolean;
    sortOrder?: number;
  },
  orgId: OrgId,
): Promise<ReasonCodeRow> {
  const r = await tenantQuery<ReasonCodeRow>(
    orgId,
    `INSERT INTO reason_codes
       (code, label, category, direction, requires_note, requires_photo, sort_order, is_active, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
     RETURNING ${COLS}`,
    [
      input.code.trim(),
      input.label.trim(),
      input.category.trim(),
      input.direction ?? 'either',
      input.requiresNote ?? false,
      input.requiresPhoto ?? false,
      input.sortOrder ?? 0,
      orgId,
    ],
  );
  await invalidateCacheTags(orgId, [CACHE_TAGS.reasonCodes]);
  return r.rows[0];
}

/**
 * Partial update. Only the provided fields change; `undefined` leaves the
 * column untouched via COALESCE. Returns the updated row, or null if not found.
 */
export async function updateReasonCode(
  id: number,
  patch: {
    label?: string;
    category?: string;
    direction?: 'in' | 'out' | 'either';
    requiresNote?: boolean;
    requiresPhoto?: boolean;
    sortOrder?: number;
    isActive?: boolean;
    /** D3 per-node scoping. undefined = leave untouched; null/[] = clear to global; array = set. */
    appliesTo?: string[] | null;
  },
  orgId: OrgId,
): Promise<ReasonCodeRow | null> {
  // applies_to can't use COALESCE (it must be settable back to NULL): a CASE on a
  // "provided" flag distinguishes "leave untouched" from "clear to global".
  const appliesToProvided = patch.appliesTo !== undefined;
  const appliesToValue =
    patch.appliesTo != null && patch.appliesTo.length > 0 ? JSON.stringify(patch.appliesTo) : null;
  const r = await tenantQuery<ReasonCodeRow>(
    orgId,
    `UPDATE reason_codes SET
        label          = COALESCE($2, label),
        category       = COALESCE($3, category),
        direction      = COALESCE($4, direction),
        requires_note  = COALESCE($5, requires_note),
        requires_photo = COALESCE($6, requires_photo),
        sort_order     = COALESCE($7, sort_order),
        is_active      = COALESCE($8, is_active),
        applies_to     = CASE WHEN $9 THEN $10::jsonb ELSE applies_to END
      WHERE id = $1 AND organization_id = $11
      RETURNING ${COLS}`,
    [
      id,
      patch.label?.trim() ?? null,
      patch.category?.trim() ?? null,
      patch.direction ?? null,
      patch.requiresNote ?? null,
      patch.requiresPhoto ?? null,
      patch.sortOrder ?? null,
      patch.isActive ?? null,
      appliesToProvided,
      appliesToValue,
      orgId,
    ],
  );
  await invalidateCacheTags(orgId, [CACHE_TAGS.reasonCodes]);
  return r.rows[0] ?? null;
}

/**
 * Soft-delete (is_active = false). Reason codes are referenced by FK from
 * inventory_events / bin adjustments, so we never hard-delete. Returns the
 * now-inactive row, or null if it didn't exist or was already inactive.
 */
export async function softDeleteReasonCode(id: number, orgId: OrgId): Promise<ReasonCodeRow | null> {
  const r = await tenantQuery<ReasonCodeRow>(
    orgId,
    `UPDATE reason_codes
        SET is_active = false
      WHERE id = $1 AND organization_id = $2 AND is_active = true
      RETURNING ${COLS}`,
    [id, orgId],
  );
  await invalidateCacheTags(orgId, [CACHE_TAGS.reasonCodes]);
  return r.rows[0] ?? null;
}
