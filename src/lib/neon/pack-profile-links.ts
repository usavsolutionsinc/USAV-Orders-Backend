import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export type PackTier = 'SMALL' | 'MEDIUM' | 'LARGE';

/**
 * Upsert the SKU→pack profile link for KPI weighting.
 *
 * - When packTier is null and estimatedMinutes is null, the link is deleted.
 * - Otherwise we upsert a pack_profiles row and point the SKU link to it.
 *
 * Polymorphic owner_type: today only 'SKU_CATALOG', but the schema is designed
 * to expand (MODEL, CATEGORY, LISTING, etc.) without changing callers.
 */
export async function upsertSkuPackProfileLink(
  params: {
    skuCatalogId: number;
    packTier: PackTier | null;
    estimatedMinutes: number | null;
    source?: 'manual' | 'rules' | 'import';
  },
  orgId: OrgId,
): Promise<void> {
  const ownerType = 'SKU_CATALOG';

  // Clear path: remove the polymorphic link (falls back to rules/defaults).
  if (!params.packTier && params.estimatedMinutes == null) {
    await tenantQuery(
      orgId,
      `DELETE FROM pack_profile_links
        WHERE organization_id = $1 AND owner_type = $2 AND owner_id = $3`,
      [orgId, ownerType, params.skuCatalogId],
    );
    return;
  }

  // Ensure a profile row exists (or updates). We keep profile rows immutable-ish
  // but allow updates so admins can tune minutes without unlink/relink churn.
  const source = params.source ?? 'manual';
  const profile = await tenantQuery<{ id: number }>(
    orgId,
    `INSERT INTO pack_profiles (organization_id, pack_tier, estimated_minutes, source)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [orgId, params.packTier, params.estimatedMinutes, source],
  );
  const profileId = profile.rows[0]?.id;
  if (!profileId) throw new Error('Failed to create pack profile');

  // Link the SKU to the newest profile row.
  await tenantQuery(
    orgId,
    `INSERT INTO pack_profile_links (organization_id, owner_type, owner_id, pack_profile_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, owner_type, owner_id)
     DO UPDATE SET pack_profile_id = EXCLUDED.pack_profile_id, updated_at = NOW()`,
    [orgId, ownerType, params.skuCatalogId, profileId],
  );
}

/**
 * Read a SKU's pack profile override (if present).
 */
export async function getSkuPackProfileLink(
  skuCatalogId: number,
  orgId: OrgId,
): Promise<{ packTier: PackTier; estimatedMinutes: number | null } | null> {
  const ownerType = 'SKU_CATALOG';
  const result = await tenantQuery<{ pack_tier: PackTier; estimated_minutes: number | null }>(
    orgId,
    `SELECT p.pack_tier, p.estimated_minutes
       FROM pack_profile_links l
       JOIN pack_profiles p ON p.id = l.pack_profile_id
      WHERE l.organization_id = $1
        AND l.owner_type = $2
        AND l.owner_id = $3
      LIMIT 1`,
    [orgId, ownerType, skuCatalogId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { packTier: row.pack_tier, estimatedMinutes: row.estimated_minutes };
}

