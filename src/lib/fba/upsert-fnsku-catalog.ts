import type { PoolClient } from 'pg';
import type { OrgId } from '@/lib/tenancy/constants';

interface UpsertFnskuCatalogInput {
  fnsku: unknown;
  productTitle?: unknown;
  asin?: unknown;
  sku?: unknown;
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

function normalizeNullableUpperText(value: unknown): string | null {
  const normalized = normalizeNullableText(value);
  return normalized ? normalized.toUpperCase() : null;
}

/** Returns true when the value looks like an Amazon ASIN (B0 + 8 alphanumeric). */
function looksLikeAsin(value: string): boolean {
  return /^B0[A-Z0-9]{8}$/i.test(value);
}

export async function upsertFnskuCatalogRow(
  client: PoolClient,
  input: UpsertFnskuCatalogInput,
  orgId: OrgId,
) {
  let fnsku = normalizeNullableUpperText(input.fnsku);
  if (!fnsku) {
    throw new Error('fnsku is required');
  }

  const productTitle = normalizeNullableText(input.productTitle);
  let asin = normalizeNullableUpperText(input.asin);
  const sku = normalizeNullableText(input.sku);

  // When the "fnsku" value is actually a B0 ASIN, check if a catalog row
  // already maps that ASIN to a real FNSKU (X00...).  If so, use the real
  // FNSKU as the key.  Either way, ensure the asin column is populated.
  if (looksLikeAsin(fnsku)) {
    if (!asin) asin = fnsku;

    const existing = await client.query(
      `SELECT fnsku, product_title, asin, sku, is_active
       FROM fba_fnskus
       WHERE asin = $1 AND fnsku != $1 AND organization_id = $2
       ORDER BY last_seen_at DESC NULLS LAST
       LIMIT 1`,
      [fnsku, orgId],
    );
    if (existing.rows.length > 0) {
      // A real FNSKU exists for this ASIN — update it and return.
      const realFnsku = existing.rows[0].fnsku as string;
      const result = await client.query(
        `UPDATE fba_fnskus
         SET product_title = COALESCE($2, product_title),
             sku           = COALESCE($3, sku),
             is_active     = TRUE,
             last_seen_at  = NOW(),
             updated_at    = NOW()
         WHERE fnsku = $1 AND organization_id = $4
         RETURNING fnsku, product_title, asin, sku, is_active`,
        [realFnsku, productTitle, sku, orgId],
      );
      return result.rows[0];
    }
    // No real FNSKU mapped yet — fall through and use the ASIN as the fnsku key.
  }

  const result = await client.query(
    `INSERT INTO fba_fnskus (fnsku, product_title, asin, sku, organization_id, is_active, last_seen_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
     ON CONFLICT (organization_id, fnsku) DO UPDATE
       SET product_title = COALESCE(EXCLUDED.product_title, fba_fnskus.product_title),
           asin          = COALESCE(EXCLUDED.asin, fba_fnskus.asin),
           sku           = COALESCE(EXCLUDED.sku, fba_fnskus.sku),
           is_active     = TRUE,
           last_seen_at  = NOW(),
           updated_at    = NOW()
     WHERE fba_fnskus.organization_id = $5
     RETURNING fnsku, product_title, asin, sku, is_active`,
    [fnsku, productTitle, asin, sku, orgId],
  );

  return result.rows[0];
}
