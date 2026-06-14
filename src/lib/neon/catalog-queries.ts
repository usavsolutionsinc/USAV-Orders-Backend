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

import pool from '@/lib/db';

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
export async function seedOrgCatalog(organizationId: string): Promise<void> {
  for (const [slug, label, tone, sort] of SEED_PLATFORMS) {
    await pool.query(
      `INSERT INTO platforms (organization_id, slug, label, tone, sort_order, is_system)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (organization_id, slug) DO NOTHING`,
      [organizationId, slug, label, tone, sort],
    );
  }
  for (const [slug, label, kind, isReturn, sort] of SEED_TYPES) {
    await pool.query(
      `INSERT INTO types (organization_id, slug, label, kind, is_return, sort_order, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (organization_id, slug) DO NOTHING`,
      [organizationId, slug, label, kind, isReturn, sort],
    );
  }
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
  organizationId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<PlatformRow[]> {
  const res = await pool.query<PlatformRow>(
    `SELECT * FROM platforms
      WHERE organization_id = $1
        AND ($2::boolean OR is_active)
      ORDER BY sort_order ASC, label ASC`,
    [organizationId, opts.includeInactive ?? false],
  );
  return res.rows;
}

export async function getPlatformById(organizationId: string, id: number): Promise<PlatformRow | null> {
  const res = await pool.query<PlatformRow>(
    `SELECT * FROM platforms WHERE organization_id = $1 AND id = $2`,
    [organizationId, id],
  );
  return res.rows[0] ?? null;
}

export async function createPlatform(
  organizationId: string,
  data: { slug: string; label: string; tone?: string | null; provider?: string | null; sortOrder?: number },
): Promise<PlatformRow> {
  const res = await pool.query<PlatformRow>(
    `INSERT INTO platforms (organization_id, slug, label, tone, provider, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [organizationId, data.slug, data.label, data.tone ?? null, data.provider ?? null, data.sortOrder ?? 100],
  );
  return res.rows[0];
}

export async function updatePlatform(
  organizationId: string,
  id: number,
  data: { label?: string; tone?: string | null; provider?: string | null; sortOrder?: number; isActive?: boolean },
): Promise<PlatformRow | null> {
  const res = await pool.query<PlatformRow>(
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
  organizationId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<TypeRow[]> {
  const res = await pool.query<TypeRow>(
    `SELECT * FROM types
      WHERE organization_id = $1
        AND ($2::boolean OR is_active)
      ORDER BY sort_order ASC, label ASC`,
    [organizationId, opts.includeInactive ?? false],
  );
  return res.rows;
}

export async function getTypeById(organizationId: string, id: number): Promise<TypeRow | null> {
  const res = await pool.query<TypeRow>(
    `SELECT * FROM types WHERE organization_id = $1 AND id = $2`,
    [organizationId, id],
  );
  return res.rows[0] ?? null;
}

export async function createType(
  organizationId: string,
  data: { slug: string; label: string; kind?: string; isReturn?: boolean; sortOrder?: number },
): Promise<TypeRow> {
  const res = await pool.query<TypeRow>(
    `INSERT INTO types (organization_id, slug, label, kind, is_return, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [organizationId, data.slug, data.label, data.kind ?? 'receiving', data.isReturn ?? false, data.sortOrder ?? 100],
  );
  return res.rows[0];
}

export async function updateType(
  organizationId: string,
  id: number,
  data: { label?: string; kind?: string; isReturn?: boolean; sortOrder?: number; isActive?: boolean },
): Promise<TypeRow | null> {
  const res = await pool.query<TypeRow>(
    `UPDATE types SET
       label      = COALESCE($3, label),
       kind       = COALESCE($4, kind),
       is_return  = COALESCE($5, is_return),
       sort_order = COALESCE($6, sort_order),
       is_active  = COALESCE($7, is_active)
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
    ],
  );
  return res.rows[0] ?? null;
}
