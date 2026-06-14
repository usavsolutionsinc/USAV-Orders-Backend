/**
 * Organization repository — load/update tenant records.
 *
 * Cached in-process for 30s per orgId. The cache is per-instance which is
 * fine because (a) the cardinality is small (one entry per active tenant),
 * (b) settings changes flow through `updateOrgSettings` which invalidates
 * locally, and (c) cross-instance staleness is bounded to 30s for the
 * fields the request path actually reads (plan, status, settings).
 *
 * For Stripe-driven plan changes that MUST propagate immediately, call
 * `invalidateOrgCache(orgId)` from the webhook handler.
 */

import pool from '@/lib/db';
import { parseOrgSettings, type OrgSettings } from './settings';
import { seedOrgCatalog } from '@/lib/neon/catalog-queries';
import type { OrgId, OrgStatus, PlatformPlan } from './constants';

export interface OrganizationRow {
  id: OrgId;
  slug: string;
  name: string;
  plan: PlatformPlan;
  status: OrgStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  settings: OrgSettings;
  trialEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface CacheEntry {
  org: OrganizationRow;
  expiresAt: number;
}

const orgCache = new Map<OrgId, CacheEntry>();
const slugCache = new Map<string, OrgId>();
const CACHE_TTL_MS = 30_000;

interface OrgDbRow {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  settings: unknown;
  trial_ends_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function mapRow(row: OrgDbRow): OrganizationRow {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    plan: row.plan as PlatformPlan,
    status: row.status as OrgStatus,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    settings: parseOrgSettings(row.settings),
    trialEndsAt: row.trial_ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export async function getOrganization(orgId: OrgId): Promise<OrganizationRow | null> {
  const cached = orgCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.org;

  const r = await pool.query<OrgDbRow>(
    `SELECT id, slug, name, plan, status, stripe_customer_id, stripe_subscription_id,
            settings, trial_ends_at, created_at, updated_at, deleted_at
       FROM organizations
      WHERE id = $1
      LIMIT 1`,
    [orgId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const org = mapRow(row);
  orgCache.set(orgId, { org, expiresAt: Date.now() + CACHE_TTL_MS });
  slugCache.set(org.slug, org.id);
  return org;
}

export async function getOrganizationBySlug(slug: string): Promise<OrganizationRow | null> {
  const cachedId = slugCache.get(slug);
  if (cachedId) {
    const fromCache = orgCache.get(cachedId);
    if (fromCache && fromCache.expiresAt > Date.now()) return fromCache.org;
  }

  const r = await pool.query<OrgDbRow>(
    `SELECT id, slug, name, plan, status, stripe_customer_id, stripe_subscription_id,
            settings, trial_ends_at, created_at, updated_at, deleted_at
       FROM organizations
      WHERE slug = $1
      LIMIT 1`,
    [slug],
  );
  const row = r.rows[0];
  if (!row) return null;
  const org = mapRow(row);
  orgCache.set(org.id, { org, expiresAt: Date.now() + CACHE_TTL_MS });
  slugCache.set(org.slug, org.id);
  return org;
}

export function invalidateOrgCache(orgId?: OrgId): void {
  if (!orgId) {
    orgCache.clear();
    slugCache.clear();
    return;
  }
  const existing = orgCache.get(orgId);
  if (existing) slugCache.delete(existing.org.slug);
  orgCache.delete(orgId);
}

export interface CreateOrganizationInput {
  slug: string;
  name: string;
  plan?: PlatformPlan;
  settings?: Partial<OrgSettings>;
  trialEndsAt?: Date | null;
}

export async function createOrganization(input: CreateOrganizationInput): Promise<OrganizationRow> {
  const settings = JSON.stringify(input.settings ?? {});
  const r = await pool.query<OrgDbRow>(
    `INSERT INTO organizations (slug, name, plan, settings, trial_ends_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id, slug, name, plan, status, stripe_customer_id, stripe_subscription_id,
               settings, trial_ends_at, created_at, updated_at, deleted_at`,
    [input.slug, input.name, input.plan ?? 'trial', settings, input.trialEndsAt ?? null],
  );
  const org = mapRow(r.rows[0]!);
  // Provision the org's editable platform/type catalog with the built-in
  // defaults. Best-effort: a seed failure must not block org creation (the
  // catalog hooks fall back to the built-in constants until seeded).
  try {
    await seedOrgCatalog(org.id);
  } catch (err) {
    console.error('seedOrgCatalog failed for new org', org.id, err);
  }
  invalidateOrgCache(org.id);
  return org;
}

export async function updateOrgSettings(orgId: OrgId, patch: Partial<OrgSettings>): Promise<void> {
  // Merge at the jsonb level so concurrent writes to different keys don't
  // clobber each other.
  await pool.query(
    `UPDATE organizations
        SET settings = settings || $1::jsonb,
            updated_at = now()
      WHERE id = $2`,
    [JSON.stringify(patch), orgId],
  );
  invalidateOrgCache(orgId);
}

export async function setOrgStripeIds(
  orgId: OrgId,
  stripeCustomerId: string | null,
  stripeSubscriptionId: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE organizations
        SET stripe_customer_id = $1,
            stripe_subscription_id = $2,
            updated_at = now()
      WHERE id = $3`,
    [stripeCustomerId, stripeSubscriptionId, orgId],
  );
  invalidateOrgCache(orgId);
}

export async function setOrgPlan(orgId: OrgId, plan: PlatformPlan): Promise<void> {
  await pool.query(
    `UPDATE organizations SET plan = $1, updated_at = now() WHERE id = $2`,
    [plan, orgId],
  );
  invalidateOrgCache(orgId);
}

export async function setOrgStatus(orgId: OrgId, status: OrgStatus): Promise<void> {
  await pool.query(
    `UPDATE organizations SET status = $1, updated_at = now() WHERE id = $2`,
    [status, orgId],
  );
  invalidateOrgCache(orgId);
}
