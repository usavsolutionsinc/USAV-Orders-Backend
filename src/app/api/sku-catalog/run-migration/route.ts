import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

// Break-glass DB migration — admin-only + step-up via admin.manage_features.
export const POST = withAuth(async (_req, ctx) => {
  try {
    // Remove all platform='zoho' entries from sku_platform_ids.
    // Zoho SKUs already live in sku_catalog.sku (source of truth).
    // sku_platform_ids should only contain marketplace entries: ecwid, amazon, ebay, walmart, etc.
    // Tenant-scoped: only clear THIS org's zoho rows.
    const removed = await tenantQuery(
      ctx.organizationId,
      `DELETE FROM sku_platform_ids WHERE platform = 'zoho' AND organization_id = $1`,
      [ctx.organizationId],
    );

    return NextResponse.json({
      success: true,
      removedZohoPlatformEntries: removed.rowCount || 0,
    });
  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}, { permission: 'admin.manage_features', stepUp: true });
