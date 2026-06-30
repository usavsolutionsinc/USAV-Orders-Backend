/**
 * Query layer for the org-scoped platform / type catalog
 * (migration 2026-06-13g_platform_account_type_catalog.sql).
 *
 * These power the CRUD editor that lets each org add / rename / hide / reorder
 * its own platforms + receiving flow types instead of the old hardcoded
 * SOURCE_PLATFORMS / RECEIVING_TYPE_OPTS constants. Every query is org-scoped —
 * the caller passes `ctx.organizationId` from withAuth, never the request.
 *
 * Soft delete = `is_active = false` (the row is kept so a slug can be revived
 * and audit history stays intact); the list endpoints return active rows only
 * by default.
 */

import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { SUBSTITUTION_REASONS } from '@/lib/fulfillment/substitution-reasons';
import { SHORT_PICK_REASONS } from '@/lib/picking/short-pick-reasons';
import { REPAIR_FAILURE_REASONS } from '@/lib/repair/repair-failure-reasons';
import { RECEIVING_EXCEPTION_CODES, RECEIVING_EXCEPTION_META } from '@/lib/receiving/exception-codes';
import { SKU_STOCK_REASONS } from '@/lib/sku/sku-stock-reasons';
import { SERIAL_ABSENT_REASONS } from '@/lib/receiving/serial-absent-reasons';

export interface PlatformRow {
  id: number;
  organization_id: string;
  slug: string;
  label: string;
  tone: string | null;
  provider: string | null;
  sort_order: number;
  is_active: boolean;
  /** Seeded built-in (hide-only, immutable slug) vs the org's own custom row. */
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface TypeRow {
  id: number;
  organization_id: string;
  slug: string;
  label: string;
  kind: string;
  platform_account_id: number | null;
  workflow_node_id: string | null;
  is_return: boolean;
  sort_order: number;
  is_active: boolean;
  /** Seeded built-in (hide-only, immutable slug) vs the org's own custom row. */
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlatformAccountRow {
  id: number;
  organization_id: string;
  platform_id: number;
  slug: string;
  label: string;
  /** → organization_integrations.scope (the specific connection). */
  integration_scope: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Built-in seed data — the source of truth for `seedOrgCatalog`. Mirrors the
// VALUES in migration 2026-06-13g (keep in sync if you add a default).
const SEED_PLATFORMS: Array<[slug: string, label: string, tone: string, sort: number]> = [
  ['ebay', 'eBay', 'text-yellow-500', 10],
  ['amazon', 'Amazon', 'text-orange-600', 20],
  ['fba', 'FBA', 'text-orange-600', 30],
  ['aliexpress', 'AliExpress', 'text-red-500', 40],
  ['walmart', 'Walmart', 'text-amber-700', 50],
  ['goodwill', 'Goodwill', 'text-sky-600', 60],
  ['ecwid', 'ECWID-RS', 'text-blue-600', 70],
  ['other', 'Other', 'text-slate-500', 99],
];
const SEED_TYPES: Array<[slug: string, label: string, kind: string, isReturn: boolean, sort: number]> = [
  ['po', 'PO', 'both', false, 10],
  ['return', 'Return', 'receiving', true, 20],
  ['trade_in', 'Trade In', 'receiving', false, 30],
  ['pickup', 'Pick Up', 'receiving', false, 40],
];

/**
 * Idempotently seed an org's built-in platforms + types. Called on org
 * creation (provisioning hook) so new tenants start with the defaults; safe to
 * re-run — existing rows (by slug) are left untouched.
 */
export async function seedOrgCatalog(organizationId: OrgId): Promise<void> {
  await withTenantTransaction(organizationId, async (client) => {
    for (const [slug, label, tone, sort] of SEED_PLATFORMS) {
      await client.query(
        `INSERT INTO platforms (organization_id, slug, label, tone, sort_order, is_system)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (organization_id, slug) DO NOTHING`,
        [organizationId, slug, label, tone, sort],
      );
    }
    for (const [slug, label, kind, isReturn, sort] of SEED_TYPES) {
      await client.query(
        `INSERT INTO types (organization_id, slug, label, kind, is_return, sort_order, is_system)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (organization_id, slug) DO NOTHING`,
        [organizationId, slug, label, kind, isReturn, sort],
      );
    }
    // Class-D substitution reason vocabulary (flow_context='substitution'),
    // derived from the built-in registry SoT (substitution-reasons.ts) so the
    // codes/labels never drift. `category` is NULL — the inventory ledger axis
    // doesn't apply. Mirrors migration 2026-06-28_reason_codes_flow_context.sql.
    let subSort = 0;
    for (const r of SUBSTITUTION_REASONS) {
      subSort += 10;
      await client.query(
        `INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
         VALUES ($1, $2, $3, NULL, 'either', 'substitution', $4)
         ON CONFLICT (organization_id, flow_context, code) DO NOTHING`,
        [organizationId, r.code, r.label, subSort],
      );
    }
    let spSort = 0;
    for (const r of SHORT_PICK_REASONS) {
      spSort += 10;
      await client.query(
        `INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
         VALUES ($1, $2, $3, NULL, 'either', 'short_pick', $4)
         ON CONFLICT (organization_id, flow_context, code) DO NOTHING`,
        [organizationId, r.code, r.label, spSort],
      );
    }
    let rfSort = 0;
    for (const r of REPAIR_FAILURE_REASONS) {
      rfSort += 10;
      await client.query(
        `INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
         VALUES ($1, $2, $3, NULL, 'either', 'repair_failure', $4)
         ON CONFLICT (organization_id, flow_context, code) DO NOTHING`,
        [organizationId, r.code, r.label, rfSort],
      );
    }
    // Receiving-exception vocabulary is BEHAVIOR-BEARING (codes stay system, owned
    // by exception-codes.ts); seeded here only so tenants can see/relabel them.
    let reSort = 0;
    for (const code of RECEIVING_EXCEPTION_CODES) {
      reSort += 10;
      await client.query(
        `INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
         VALUES ($1, $2, $3, NULL, 'either', 'receiving_exception', $4)
         ON CONFLICT (organization_id, flow_context, code) DO NOTHING`,
        [organizationId, code, RECEIVING_EXCEPTION_META[code].label, reSort],
      );
    }
    // SKU-stock quick-adjust reasons (codes stay system — the replenish trigger
    // keys on 'SOLD'; seeded for tenant relabeling).
    let ssSort = 0;
    for (const r of SKU_STOCK_REASONS) {
      ssSort += 10;
      await client.query(
        `INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
         VALUES ($1, $2, $3, NULL, 'either', 'inventory_adjust', $4)
         ON CONFLICT (organization_id, flow_context, code) DO NOTHING`,
        [organizationId, r.code, r.label, ssSort],
      );
    }
    // Serial-absent waiver reasons (flow_context='serial_absent_reason') — why a
    // received unit was committed with no serial. Built-in registry SoT is
    // serial-absent-reasons.ts; tenant-relabelable. Mirrors migration
    // 2026-06-29e_reason_codes_serial_absent.sql.
    let saSort = 0;
    for (const r of SERIAL_ABSENT_REASONS) {
      saSort += 10;
      await client.query(
        `INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
         VALUES ($1, $2, $3, NULL, 'either', 'serial_absent_reason', $4)
         ON CONFLICT (organization_id, flow_context, code) DO NOTHING`,
        [organizationId, r.code, r.label, saSort],
      );
    }
    // platform_accounts (mirrors migration 2026-06-14f): eBay storefronts from
    // ebay_accounts, plus one default '<platform>-main' account per non-eBay
    // platform so every channel is reachable through an account.
    await client.query(
      `INSERT INTO platform_accounts (organization_id, platform_id, slug, label, integration_scope, is_active)
       SELECT ea.organization_id, p.id, ea.account_name, ea.account_name, ea.account_name, COALESCE(ea.is_active, true)
         FROM ebay_accounts ea
         JOIN platforms p ON p.organization_id = ea.organization_id AND p.slug = 'ebay'
        WHERE ea.organization_id = $1
          AND ea.account_name IS NOT NULL AND BTRIM(ea.account_name) <> ''
       ON CONFLICT (organization_id, platform_id, slug) DO NOTHING`,
      [organizationId],
    );
    await client.query(
      `INSERT INTO platform_accounts (organization_id, platform_id, slug, label, is_active)
       SELECT p.organization_id, p.id, p.slug || '-main', p.label, true
         FROM platforms p
        WHERE p.organization_id = $1 AND p.slug <> 'ebay'
       ON CONFLICT (organization_id, platform_id, slug) DO NOTHING`,
      [organizationId],
    );
  });
}

/** lowercase-kebab/underscore slug from a free-text label. */
export function slugify(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

// ─── platforms ────────────────────────────────────────────────────────────────

export async function listPlatforms(
  organizationId: OrgId,
  opts: { includeInactive?: boolean } = {},
): Promise<PlatformRow[]> {
  const res = await tenantQuery<PlatformRow>(
    organizationId,
    `SELECT * FROM platforms
      WHERE organization_id = $1
        AND ($2::boolean OR is_active)
      ORDER BY sort_order ASC, label ASC`,
    [organizationId, opts.includeInactive ?? false],
  );
  return res.rows;
}

export async function getPlatformById(organizationId: OrgId, id: number): Promise<PlatformRow | null> {
  const res = await tenantQuery<PlatformRow>(
    organizationId,
    `SELECT * FROM platforms WHERE organization_id = $1 AND id = $2`,
    [organizationId, id],
  );
  return res.rows[0] ?? null;
}

export async function createPlatform(
  organizationId: OrgId,
  data: { slug: string; label: string; tone?: string | null; provider?: string | null; sortOrder?: number },
): Promise<PlatformRow> {
  const res = await tenantQuery<PlatformRow>(
    organizationId,
    `INSERT INTO platforms (organization_id, slug, label, tone, provider, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [organizationId, data.slug, data.label, data.tone ?? null, data.provider ?? null, data.sortOrder ?? 100],
  );
  return res.rows[0];
}

export async function updatePlatform(
  organizationId: OrgId,
  id: number,
  data: { label?: string; tone?: string | null; provider?: string | null; sortOrder?: number; isActive?: boolean },
): Promise<PlatformRow | null> {
  const res = await tenantQuery<PlatformRow>(
    organizationId,
    `UPDATE platforms SET
       label      = COALESCE($3, label),
       tone       = COALESCE($4, tone),
       provider   = COALESCE($5, provider),
       sort_order = COALESCE($6, sort_order),
       is_active  = COALESCE($7, is_active)
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [
      organizationId,
      id,
      data.label ?? null,
      data.tone ?? null,
      data.provider ?? null,
      data.sortOrder ?? null,
      data.isActive ?? null,
    ],
  );
  return res.rows[0] ?? null;
}

// ─── types ──────────────────────────────────────────────────────────────────

export async function listTypes(
  organizationId: OrgId,
  opts: { includeInactive?: boolean } = {},
): Promise<TypeRow[]> {
  const res = await tenantQuery<TypeRow>(
    organizationId,
    `SELECT * FROM types
      WHERE organization_id = $1
        AND ($2::boolean OR is_active)
      ORDER BY sort_order ASC, label ASC`,
    [organizationId, opts.includeInactive ?? false],
  );
  return res.rows;
}

export async function getTypeById(organizationId: OrgId, id: number): Promise<TypeRow | null> {
  const res = await tenantQuery<TypeRow>(
    organizationId,
    `SELECT * FROM types WHERE organization_id = $1 AND id = $2`,
    [organizationId, id],
  );
  return res.rows[0] ?? null;
}

export async function createType(
  organizationId: OrgId,
  data: {
    slug: string;
    label: string;
    kind?: string;
    isReturn?: boolean;
    sortOrder?: number;
    platformAccountId?: number | null;
    workflowNodeId?: string | null;
  },
): Promise<TypeRow> {
  const res = await tenantQuery<TypeRow>(
    organizationId,
    `INSERT INTO types
       (organization_id, slug, label, kind, is_return, sort_order, platform_account_id, workflow_node_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      organizationId,
      data.slug,
      data.label,
      data.kind ?? 'receiving',
      data.isReturn ?? false,
      data.sortOrder ?? 100,
      data.platformAccountId ?? null,
      data.workflowNodeId ?? null,
    ],
  );
  return res.rows[0];
}

export async function updateType(
  organizationId: OrgId,
  id: number,
  data: {
    label?: string;
    kind?: string;
    isReturn?: boolean;
    sortOrder?: number;
    isActive?: boolean;
    // `null` is a meaningful value (clear the binding) — distinct from
    // `undefined` (leave unchanged). The route passes a sentinel so COALESCE
    // can't collapse an intentional clear back to the existing value.
    platformAccountId?: number | null;
    workflowNodeId?: string | null;
  },
): Promise<TypeRow | null> {
  const setBinding = Object.prototype.hasOwnProperty.call(data, 'platformAccountId');
  const setWorkflow = Object.prototype.hasOwnProperty.call(data, 'workflowNodeId');
  const res = await tenantQuery<TypeRow>(
    organizationId,
    `UPDATE types SET
       label               = COALESCE($3, label),
       kind                = COALESCE($4, kind),
       is_return           = COALESCE($5, is_return),
       sort_order          = COALESCE($6, sort_order),
       is_active           = COALESCE($7, is_active),
       platform_account_id = CASE WHEN $8::boolean THEN $9::bigint ELSE platform_account_id END,
       workflow_node_id    = CASE WHEN $10::boolean THEN $11::text ELSE workflow_node_id END
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [
      organizationId,
      id,
      data.label ?? null,
      data.kind ?? null,
      data.isReturn ?? null,
      data.sortOrder ?? null,
      data.isActive ?? null,
      setBinding,
      data.platformAccountId ?? null,
      setWorkflow,
      data.workflowNodeId ?? null,
    ],
  );
  return res.rows[0] ?? null;
}

// ─── platform_accounts ────────────────────────────────────────────────────────

export async function listPlatformAccounts(
  organizationId: OrgId,
  opts: { platformId?: number; includeInactive?: boolean } = {},
): Promise<PlatformAccountRow[]> {
  const res = await tenantQuery<PlatformAccountRow>(
    organizationId,
    `SELECT * FROM platform_accounts
      WHERE organization_id = $1
        AND ($2::boolean OR is_active)
        AND ($3::bigint IS NULL OR platform_id = $3)
      ORDER BY platform_id ASC, label ASC`,
    [organizationId, opts.includeInactive ?? false, opts.platformId ?? null],
  );
  return res.rows;
}

export async function getPlatformAccountById(
  organizationId: OrgId,
  id: number,
): Promise<PlatformAccountRow | null> {
  const res = await tenantQuery<PlatformAccountRow>(
    organizationId,
    `SELECT * FROM platform_accounts WHERE organization_id = $1 AND id = $2`,
    [organizationId, id],
  );
  return res.rows[0] ?? null;
}

export async function createPlatformAccount(
  organizationId: OrgId,
  data: { platformId: number; slug: string; label: string; integrationScope?: string | null },
): Promise<PlatformAccountRow> {
  const res = await tenantQuery<PlatformAccountRow>(
    organizationId,
    `INSERT INTO platform_accounts (organization_id, platform_id, slug, label, integration_scope)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [organizationId, data.platformId, data.slug, data.label, data.integrationScope ?? null],
  );
  return res.rows[0];
}

export async function updatePlatformAccount(
  organizationId: OrgId,
  id: number,
  data: { label?: string; integrationScope?: string | null; isActive?: boolean },
): Promise<PlatformAccountRow | null> {
  const setScope = Object.prototype.hasOwnProperty.call(data, 'integrationScope');
  const res = await tenantQuery<PlatformAccountRow>(
    organizationId,
    `UPDATE platform_accounts SET
       label             = COALESCE($3, label),
       integration_scope = CASE WHEN $4::boolean THEN $5::text ELSE integration_scope END,
       is_active         = COALESCE($6, is_active)
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [organizationId, id, data.label ?? null, setScope, data.integrationScope ?? null, data.isActive ?? null],
  );
  return res.rows[0] ?? null;
}
