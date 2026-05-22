import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';

/**
 * GET /api/sku-catalog/pairing-queue/count
 *
 * Cheap COUNT(*) for the sidebar "Pairing" badge. Reads sku_pairing_suggestions
 * which is populated by the nightly refresh cron — never recomputes scores.
 *
 * Returns: { success, total, highConfidence }
 *   total          — distinct sku_catalog rows with any pending suggestion
 *   highConfidence — distinct sku_catalog rows with at least one suggestion ≥ 80
 */
export const GET = withAuth(
  async () => {
    try {
      const result = await pool.query<{
        total: number;
        high_confidence: number;
      }>(
        `SELECT
           COUNT(DISTINCT s.sku_catalog_id)::int                       AS total,
           COUNT(DISTINCT s.sku_catalog_id) FILTER (WHERE s.confidence >= 80)::int AS high_confidence
         FROM sku_pairing_suggestions s
         JOIN sku_catalog sc ON sc.id = s.sku_catalog_id
         WHERE sc.is_active = true`,
      );
      const row = result.rows[0];
      return NextResponse.json({
        success: true,
        total: row?.total ?? 0,
        highConfidence: row?.high_confidence ?? 0,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'count failed';
      console.error('[pairing-queue/count] error:', err);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  },
  { permission: 'sku_stock.manage' },
);
