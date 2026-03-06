import { NextRequest, NextResponse } from 'next/server';
import { fetchProductsByEcwidCategory } from '@/lib/product-manuals';
import pool from '@/lib/db';
import { getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';

// Cache TTLs
const ECWID_PRODUCTS_TTL = 30 * 60;   // 30 min — Ecwid product list changes infrequently
const COMBINED_TTL = 5 * 60;          // 5 min  — manual assignments can change often

interface ProductWithManual {
  id: string;
  item_number: string;
  product_title: string;
  category: string;
  google_doc_id: string;
}

/**
 * Fetch Ecwid products for a category, server-side cached in Upstash.
 */
async function getCachedEcwidProducts(categoryId: string) {
  const ns = 'pm:ecwid-products';
  const key = `cat:${categoryId}`;

  const cached = await getCachedJson<Array<{ id: string; item_number: string; product_title: string; category: string }>>(ns, key);
  if (cached) return cached;

  const products = await fetchProductsByEcwidCategory(categoryId);
  const rows = products
    .map((p) => ({
      id: String(p.id),
      item_number: String(p.sku || p.id).trim(),
      product_title: String(p.name || '').trim(),
      category: categoryId,
    }))
    .filter((r) => r.item_number.length > 0)
    .sort((a, b) => a.item_number.localeCompare(b.item_number));

  await setCachedJson(ns, key, rows, ECWID_PRODUCTS_TTL, [`pm:cat:${categoryId}`]);
  return rows;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = String(searchParams.get('category') || '').trim();

    if (!category) {
      return NextResponse.json({ success: false, error: 'category is required' }, { status: 400 });
    }

    // Check combined cache (products + manuals merged)
    const combinedNs = 'pm:by-category';
    const combinedKey = `cat:${category}`;
    const cached = await getCachedJson<{ success: boolean; products: ProductWithManual[] }>(combinedNs, combinedKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { 'Cache-Control': 'private, max-age=300', 'x-cache': 'HIT' },
      });
    }

    // Fetch Ecwid products for this category (cached separately at 30 min)
    const ecwidRows = await getCachedEcwidProducts(category);

    if (ecwidRows.length === 0) {
      const payload = { success: true, products: [] };
      await setCachedJson(combinedNs, combinedKey, payload, COMBINED_TTL, [`pm:cat:${category}`, 'pm:manuals']);
      return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=300' } });
    }

    // Targeted DB query — only fetch manuals for the item_numbers in this category
    const itemNumbers = ecwidRows.map((r) => r.item_number);
    const placeholders = itemNumbers.map((_, i) => `$${i + 1}`).join(', ');
    const dbResult = await pool.query(
      `SELECT item_number, google_file_id AS google_doc_id
       FROM product_manuals
       WHERE is_active = TRUE
         AND item_number IN (${placeholders})`,
      itemNumbers
    );

    // Build O(1) lookup
    const manualMap = new Map<string, string>();
    for (const row of dbResult.rows) {
      if (row.item_number) manualMap.set(String(row.item_number), String(row.google_doc_id || ''));
    }

    // Merge
    const products: ProductWithManual[] = ecwidRows.map((r) => ({
      ...r,
      google_doc_id: manualMap.get(r.item_number) || '',
    }));

    const payload = { success: true, products };

    // Cache combined result — tagged so saves can invalidate it
    await setCachedJson(combinedNs, combinedKey, payload, COMBINED_TTL, [`pm:cat:${category}`, 'pm:manuals']);

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, max-age=300', 'x-cache': 'MISS' },
    });
  } catch (error: any) {
    console.error('Error fetching category products:', error);
    return NextResponse.json(
      { success: false, products: [], error: error?.message || 'Failed to fetch category products' },
      { status: 500 }
    );
  }
}
