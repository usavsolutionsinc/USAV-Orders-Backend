import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeSku } from '@/utils/sku';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const sku = searchParams.get('sku');

        if (!sku) {
            return NextResponse.json({ error: 'Missing sku query param' }, { status: 400 });
        }

        const trimmedSku = String(sku).trim();
        const normalizedInputSku = normalizeSku(trimmedSku);

        const result = await pool.query(
            `SELECT
               ss.stock,
               ss.sku,
               ss.location,
               COALESCE(sp.display_name, sc.product_title, ss.product_title) AS product_title
             FROM sku_stock ss
             LEFT JOIN sku_catalog sc ON sc.sku = ss.sku
             LEFT JOIN sku_platform_ids sp
               ON sp.sku_catalog_id = sc.id
               AND sp.platform = 'ecwid'
               AND sp.is_active = true
               AND sp.display_name IS NOT NULL
             WHERE ss.sku = $1
             LIMIT 1`,
            [trimmedSku],
        );

        if (result.rows.length > 0) {
            const row = result.rows[0];
            return NextResponse.json({
                sku: trimmedSku,
                title: row.product_title || '',
                stock: row.stock != null ? String(row.stock) : '0',
                location: row.location || '',
            });
        }

        // Fallback: search sku_platform_ids directly by platform_sku
        const platformResult = await pool.query(
            `SELECT sp.display_name, ss.stock, ss.location
             FROM sku_platform_ids sp
             LEFT JOIN sku_catalog sc ON sc.id = sp.sku_catalog_id
             LEFT JOIN sku_stock ss ON ss.sku = sc.sku
             WHERE sp.platform = 'ecwid'
               AND sp.is_active = true
               AND sp.platform_sku = $1
             LIMIT 1`,
            [trimmedSku],
        );

        if (platformResult.rows.length > 0) {
            const row = platformResult.rows[0];
            return NextResponse.json({
                sku: trimmedSku,
                title: row.display_name || '',
                stock: row.stock != null ? String(row.stock) : '0',
                location: row.location || '',
            });
        }

        return NextResponse.json({ sku: trimmedSku, title: '', stock: '0', location: '' });
    } catch (error: any) {
        console.error('API error', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}
