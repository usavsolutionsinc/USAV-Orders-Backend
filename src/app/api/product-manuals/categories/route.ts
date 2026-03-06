import { NextResponse } from 'next/server';
import {
  buildEcwidCategoryPathMap,
  fetchAllEcwidProducts,
  fetchAllEcwidCategories,
} from '@/lib/product-manuals';
import { getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';

const CACHE_NS = 'pm:categories';
const CACHE_KEY = 'all';
const CACHE_TTL = 60 * 60; // 1 hour — categories and product counts change rarely

export async function GET() {
  try {
    // Try cache first
    const cached = await getCachedJson<{ success: boolean; categories: unknown[] }>(CACHE_NS, CACHE_KEY);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { 'Cache-Control': 'private, max-age=3600', 'x-cache': 'HIT' },
      });
    }

    // Fetch categories + all products (for per-category counts) in parallel
    const [categories, products] = await Promise.all([
      fetchAllEcwidCategories(),
      fetchAllEcwidProducts(),
    ]);

    const pathMap = buildEcwidCategoryPathMap(categories);

    const productCounts = new Map<string, number>();
    for (const product of products) {
      for (const categoryId of product.categoryIds) {
        productCounts.set(categoryId, (productCounts.get(categoryId) || 0) + 1);
      }
    }

    const results = Array.from(pathMap.entries())
      .map(([id, title]) => ({
        id,
        title,
        productCount: productCounts.get(id) ?? 0,
      }))
      .filter((row) => row.title.trim().length > 0)
      .sort((a, b) => a.title.localeCompare(b.title));

    const payload = { success: true, categories: results };

    // Store in Upstash — tagged so we can invalidate when products change
    await setCachedJson(CACHE_NS, CACHE_KEY, payload, CACHE_TTL, ['pm:categories']);

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, max-age=3600', 'x-cache': 'MISS' },
    });
  } catch (error: any) {
    console.error('Error fetching product-manual categories:', error);
    return NextResponse.json(
      { success: false, categories: [], error: error?.message || 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}
