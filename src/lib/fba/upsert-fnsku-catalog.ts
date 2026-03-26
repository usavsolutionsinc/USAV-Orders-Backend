import type { PoolClient } from 'pg';

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

export async function upsertFnskuCatalogRow(
  client: PoolClient,
  input: UpsertFnskuCatalogInput,
) {
  const fnsku = normalizeNullableUpperText(input.fnsku);
  if (!fnsku) {
    throw new Error('fnsku is required');
  }

  const productTitle = normalizeNullableText(input.productTitle);
  const asin = normalizeNullableUpperText(input.asin);
  const sku = normalizeNullableText(input.sku);

  const result = await client.query(
    `INSERT INTO fba_fnskus (fnsku, product_title, asin, sku, is_active, last_seen_at, updated_at)
     VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
     ON CONFLICT (fnsku) DO UPDATE
       SET product_title = COALESCE(EXCLUDED.product_title, fba_fnskus.product_title),
           asin          = COALESCE(EXCLUDED.asin, fba_fnskus.asin),
           sku           = COALESCE(EXCLUDED.sku, fba_fnskus.sku),
           is_active     = TRUE,
           last_seen_at  = NOW(),
           updated_at    = NOW()
     RETURNING fnsku, product_title, asin, sku, is_active`,
    [fnsku, productTitle, asin, sku],
  );

  return result.rows[0];
}
