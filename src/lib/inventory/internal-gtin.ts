/**
 * internal-gtin.ts
 * ────────────────────────────────────────────────────────────────────
 * Internal pseudo-GTIN generator for USAV unit labels.
 *
 * Real GTINs are 8/12/13/14 digits assigned by GS1 to companies that
 * pay for membership. Since our QR codes are internal-only (warehouse
 * staff scan them with the app — customers never see them), we mint
 * our own GTIN-14 values in the GS1-reserved "company internal" range
 * (indicator digit 0, prefix `02`).
 *
 * Format:
 *   GTIN-14 = "02" + 11-digit zero-padded sku_catalog.id + mod-10 check
 *
 * This gives ~100 billion unique values, deterministic per SKU, and
 * passes any GS1-validating scanner because the check digit is correct.
 *
 * Persistence:
 *   `getOrCreateInternalGtin(skuCatalogId)` returns the GTIN from
 *   sku_catalog.gtin if present, otherwise generates + stores it in
 *   a single UPDATE … RETURNING. Safe under concurrency: the first
 *   writer wins and concurrent callers see the same value.
 */

import { queryOne } from '@/lib/neon-client';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

/** GS1-internal indicator + prefix. Real GS1 prefixes start at 03+, so
 *  values starting with `02` cannot collide with real public GTINs. */
const INTERNAL_GTIN_PREFIX = '02';

/**
 * GS1 mod-10 check-digit algorithm. The body is the 13-digit prefix
 * (everything before the check digit). Multipliers alternate 3,1 from
 * the rightmost body digit leftward.
 */
export function gs1CheckDigit(body13: string): string {
  if (body13.length !== 13 || !/^\d{13}$/.test(body13)) {
    throw new Error(`gs1CheckDigit: body must be exactly 13 digits, got "${body13}"`);
  }
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const digit = Number(body13[12 - i]); // rightmost first
    const multiplier = i % 2 === 0 ? 3 : 1;
    sum += digit * multiplier;
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * Deterministic 14-digit GTIN for a given sku_catalog.id. Does not
 * touch the DB.
 */
export function generateInternalGtin(skuCatalogId: number): string {
  if (!Number.isInteger(skuCatalogId) || skuCatalogId < 0 || skuCatalogId > 9_999_999_999_99) {
    throw new Error(`generateInternalGtin: invalid sku_catalog id ${skuCatalogId}`);
  }
  const idPart = String(skuCatalogId).padStart(11, '0');
  const body = INTERNAL_GTIN_PREFIX + idPart;
  return body + gs1CheckDigit(body);
}

/** Sanity check for GTIN-14 strings. */
export function isValidGtin14(gtin: string): boolean {
  if (!/^\d{14}$/.test(gtin)) return false;
  return gs1CheckDigit(gtin.slice(0, 13)) === gtin[13];
}

/**
 * Returns the GTIN for a sku_catalog row, generating + persisting one
 * if it doesn't already have a value. Idempotent under concurrency:
 * the first writer wins and subsequent callers see the same value.
 *
 * Caller MUST pass a valid sku_catalog.id. We don't take the SKU text
 * because that adds an extra round trip and the mapping is 1:1.
 *
 * Tenant-awareness (backward-compatible): pass an optional trailing
 * `orgId` to run the read + write inside a tenant transaction with the
 * `app.current_org` GUC set and an explicit `organization_id = $n`
 * predicate on both the SELECT and the UPDATE (org-ownership 404 if the
 * row doesn't belong to the org). When `orgId` is omitted the original
 * raw-pool (`queryOne`) path runs byte-for-byte as before, so existing
 * un-migrated callers keep compiling and behaving identically.
 *
 * `sku_catalog` is tenant-owned and carries `organization_id`
 * (docs/tenancy/org-id-coverage.generated.md), so the scoping is a
 * direct predicate on the row — no parent join needed.
 */
export async function getOrCreateInternalGtin(
  skuCatalogId: number,
  orgId?: OrgId,
): Promise<string> {
  if (orgId) {
    // Tenant-scoped path: read + write inside one transaction with the
    // org GUC set, and explicit organization_id predicates for defense
    // in depth (matches the future FORCE-RLS posture).
    return withTenantTransaction(orgId, async (client) => {
      // Fast path: read existing (org-scoped).
      const existingRes = await client.query<{ gtin: string | null }>(
        'SELECT gtin FROM sku_catalog WHERE id = $1 AND organization_id = $2 LIMIT 1',
        [skuCatalogId, orgId],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        // Org-ownership 404: either the id doesn't exist or isn't this org's.
        throw new Error(`getOrCreateInternalGtin: sku_catalog id ${skuCatalogId} not found`);
      }
      if (existing.gtin && existing.gtin.trim()) return existing.gtin.trim();

      // Generate + persist. COALESCE so a concurrent writer's value wins
      // and we return the final stored value, not our newly-computed one.
      const candidate = generateInternalGtin(skuCatalogId);
      const updatedRes = await client.query<{ gtin: string }>(
        `UPDATE sku_catalog
            SET gtin = COALESCE(NULLIF(gtin, ''), $1),
                updated_at = NOW()
          WHERE id = $2 AND organization_id = $3
          RETURNING gtin`,
        [candidate, skuCatalogId, orgId],
      );
      const updated = updatedRes.rows[0];
      if (!updated?.gtin) {
        throw new Error(`getOrCreateInternalGtin: UPDATE returned no row for id ${skuCatalogId}`);
      }
      return updated.gtin;
    });
  }

  // Fast path: read existing.
  const existing = await queryOne<{ gtin: string | null }>`
    SELECT gtin FROM sku_catalog WHERE id = ${skuCatalogId} LIMIT 1
  `;
  if (!existing) {
    throw new Error(`getOrCreateInternalGtin: sku_catalog id ${skuCatalogId} not found`);
  }
  if (existing.gtin && existing.gtin.trim()) return existing.gtin.trim();

  // Generate + persist. COALESCE so a concurrent writer's value wins
  // and we return the final stored value, not our newly-computed one.
  const candidate = generateInternalGtin(skuCatalogId);
  const updated = await queryOne<{ gtin: string }>`
    UPDATE sku_catalog
       SET gtin = COALESCE(NULLIF(gtin, ''), ${candidate}),
           updated_at = NOW()
     WHERE id = ${skuCatalogId}
     RETURNING gtin
  `;
  if (!updated?.gtin) {
    throw new Error(`getOrCreateInternalGtin: UPDATE returned no row for id ${skuCatalogId}`);
  }
  return updated.gtin;
}
