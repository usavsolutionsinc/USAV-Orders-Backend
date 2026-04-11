import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST() {
  try {
    // Remove all platform='zoho' entries from sku_platform_ids.
    // Zoho SKUs already live in sku_catalog.sku (source of truth).
    // sku_platform_ids should only contain marketplace entries: ecwid, amazon, ebay, walmart, etc.
    const removed = await pool.query(
      `DELETE FROM sku_platform_ids WHERE platform = 'zoho'`
    );

    return NextResponse.json({
      success: true,
      removedZohoPlatformEntries: removed.rowCount || 0,
    });
  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
