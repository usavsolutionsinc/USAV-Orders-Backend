import { NextRequest, NextResponse } from 'next/server';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { normalizeIdentifier } from '@/lib/product-manuals';
import { resolveSkuCatalogId } from '@/lib/neon/sku-catalog-queries';
import { withAuth } from '@/lib/auth/withAuth';

function extractGoogleFileId(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (!raw.includes('drive.google.com')) return raw;

  const dMatch = raw.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch?.[1]) return dMatch[1];

  const idMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch?.[1]) return idMatch[1];

  return '';
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const body = await req.json();
    const itemNumber = normalizeIdentifier(String(body?.itemNumber || ''));
    const productTitle = String(body?.productTitle || body?.product_title || '').trim() || null;
    const displayName =
      String(body?.displayName || body?.display_name || '').trim()
      || productTitle
      || (itemNumber ? `${itemNumber} Manual` : null);
    const googleFileId = extractGoogleFileId(String(body?.googleLinkOrFileId || ''));
    const type = String(body?.type || '').trim() || null;

    if (!itemNumber) {
      return NextResponse.json({ success: false, error: 'itemNumber is required' }, { status: 400 });
    }
    if (!googleFileId) {
      return NextResponse.json({ success: false, error: 'Valid Google Drive file id/link is required' }, { status: 400 });
    }

    // product_manuals has NO organization_id column and NO RLS policy, so the
    // app.current_org GUC is INERT for this table: withTenantTransaction alone
    // provides ZERO write isolation here. The previous deactivate-UPDATE matched
    // purely on item_number, so org A upserting a manual for a SHARED
    // item_number would flip org B's active manual to is_active=FALSE — a live
    // cross-tenant write clobber.
    //
    // To attribute this org's new row (and let the deactivate be org-scoped) we
    // resolve sku_catalog_id THROUGH THIS TENANT's crosswalk before the write
    // and stamp it on the INSERT (so the row is no longer globally visible via
    // the org-blind item_number fallback in resolve/recent). The deactivate is
    // then constrained so it can only touch rows that belong to this org —
    // either hub-linked to this org's catalog, or genuinely-legacy
    // (sku_catalog_id IS NULL) rows whose item_number does NOT crosswalk to a
    // DIFFERENT org's catalog. (NEEDS-COL: full isolation still requires
    // product_manuals to grow an organization_id column + RLS.)
    const skuCatalogId = await resolveSkuCatalogId(null, itemNumber || null, null, orgId);

    const insertedId = await withTenantTransaction(orgId, async (client) => {
      if (skuCatalogId) {
        // New row is org-attributable via this org's catalog: only deactivate
        // sibling manuals on the same catalog parent (already org-scoped) plus
        // safe-to-claim legacy rows for the same item_number.
        await client.query(
          `UPDATE product_manuals pm
             SET is_active = FALSE
           WHERE pm.is_active = TRUE
             AND (pm.type = $2 OR ($2 IS NULL AND pm.type IS NULL))
             AND (
               pm.sku_catalog_id = $3
               OR (
                 pm.sku_catalog_id IS NULL
                 AND pm.item_number = $1
                 AND NOT EXISTS (
                   SELECT 1
                   FROM sku_platform_ids spi
                   JOIN sku_catalog sc ON sc.id = spi.sku_catalog_id
                   WHERE regexp_replace(UPPER(TRIM(COALESCE(spi.platform_item_id, ''))), '[^A-Z0-9]', '', 'g')
                         = regexp_replace(UPPER(TRIM(COALESCE($1, ''))), '[^A-Z0-9]', '', 'g')
                     AND sc.organization_id <> $4
                 )
               )
             )`,
          [itemNumber, type, skuCatalogId, orgId]
        );
      } else {
        // No catalog parent for this org: only ever touch genuinely-legacy rows
        // (sku_catalog_id IS NULL) for the same item_number, and never one that
        // crosswalks to another org's catalog.
        await client.query(
          `UPDATE product_manuals pm
             SET is_active = FALSE
           WHERE pm.is_active = TRUE
             AND pm.sku_catalog_id IS NULL
             AND pm.item_number = $1
             AND (pm.type = $2 OR ($2 IS NULL AND pm.type IS NULL))
             AND NOT EXISTS (
               SELECT 1
               FROM sku_platform_ids spi
               JOIN sku_catalog sc ON sc.id = spi.sku_catalog_id
               WHERE regexp_replace(UPPER(TRIM(COALESCE(spi.platform_item_id, ''))), '[^A-Z0-9]', '', 'g')
                     = regexp_replace(UPPER(TRIM(COALESCE($1, ''))), '[^A-Z0-9]', '', 'g')
                 AND sc.organization_id <> $3
             )`,
          [itemNumber, type, orgId]
        );
      }

      // product_manuals grew an organization_id column (2026-06-14 phase-B
      // needs-col-2) with a GUC-or-USAV default. Inside this txn the GUC default
      // would stamp correctly, but stamp explicitly so the row is org-attributed
      // even if the default is later restored to GUC-only for tenant #2.
      const inserted = await client.query(
        `INSERT INTO product_manuals (sku, item_number, product_title, display_name, google_file_id, type, sku_catalog_id, is_active, updated_at, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), $8::uuid)
         RETURNING id`,
        [null, itemNumber || null, productTitle, displayName, googleFileId, type, skuCatalogId, orgId]
      );

      return inserted.rows[0]?.id ?? null;
    });

    return NextResponse.json({ success: true, id: insertedId });
  } catch (error: any) {
    console.error('Error upserting product manual:', error);
    return NextResponse.json({ success: false, error: 'Failed to save manual', details: error?.message }, { status: 500 });
  }
}, { permission: 'sku_stock.manage' });
