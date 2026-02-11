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

        const normalizedInputSku = normalizeSku(String(sku).trim());
        const result = await pool.query(
            `SELECT stock, sku, size, product_title
             FROM sku_stock`
        );

        for (const row of result.rows) {
            const rowSku = String(row.sku || '').trim();
            if (!rowSku) continue;
            if (normalizeSku(rowSku) !== normalizedInputSku) continue;

            return NextResponse.json({
                sku,
                title: row.product_title || '',
                stock: row.stock ? String(row.stock).trim() : '0',
                location: row.size || ''
            });
        }

        return NextResponse.json({ sku, title: '', stock: '0', location: '' });
    } catch (error: any) {
        console.error('API error', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}
