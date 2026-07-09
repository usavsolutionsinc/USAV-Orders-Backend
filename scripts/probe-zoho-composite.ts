import 'dotenv/config';

/**
 * Read-only probe: is this Zoho Inventory org using COMPOSITE (bundle/BOM)
 * items? The app only ever syncs `/api/v1/items`; composite items live under a
 * SEPARATE endpoint (`/api/v1/compositeitems`) that we never call. This answers
 * whether Zoho already encodes parent→child BOMs we could adopt as the SoT for
 * the parts-pairing phase, instead of building manual pairing.
 *
 * Run: npx tsx scripts/probe-zoho-composite.ts
 */
async function main() {
  const { zohoGet } = await import('@/lib/zoho/httpClient');

  console.log('\n=== Zoho composite-items probe (org: default/USAV) ===\n');

  // [1] List composite items.
  let composites: Array<Record<string, any>> = [];
  console.log('[1] GET /api/v1/compositeitems');
  try {
    const raw = await zohoGet<{ composite_items?: Array<Record<string, any>>; page_context?: any }>(
      '/api/v1/compositeitems',
      { per_page: 50 },
    );
    composites = raw.composite_items ?? [];
    console.log(`    → ${composites.length} composite item(s) on page 1`);
    if (raw.page_context) {
      console.log(`    page_context: has_more=${raw.page_context.has_more_page} total=${raw.page_context.total ?? '?'}`);
    }
    for (const c of composites.slice(0, 15)) {
      console.log(`      • id=${c.composite_item_id} sku=${c.sku ?? '—'} name=${c.name} type=${c.composite_type ?? c.item_type ?? '—'}`);
    }
  } catch (e) {
    console.log('    ✗ error:', e instanceof Error ? e.message : e);
  }

  // [2] Detail of the first composite — show its mapped_items (the BOM).
  if (composites.length) {
    const first = composites[0];
    console.log(`\n[2] GET /api/v1/compositeitems/${first.composite_item_id} (BOM detail)`);
    try {
      const detail = await zohoGet<{ composite_item?: Record<string, any> }>(
        `/api/v1/compositeitems/${encodeURIComponent(String(first.composite_item_id))}`,
      );
      const ci = detail.composite_item ?? {};
      const mapped: Array<Record<string, any>> = ci.mapped_items ?? ci.line_items ?? [];
      console.log(`    composite sku=${ci.sku} name=${ci.name}`);
      console.log(`    → ${mapped.length} mapped component(s):`);
      for (const m of mapped.slice(0, 20)) {
        console.log(`      └─ sku=${m.sku ?? '—'} name=${m.name ?? m.item_name ?? '—'} qty=${m.quantity ?? m.quantity_consumed ?? '?'}`);
      }
    } catch (e) {
      console.log('    ✗ error:', e instanceof Error ? e.message : e);
    }
  }

  // [3] Characterize the regular items catalog (item_type / product_type mix).
  console.log('\n[3] GET /api/v1/items (sample item_type / product_type distribution)');
  try {
    const raw = await zohoGet<{ items?: Array<Record<string, any>> }>('/api/v1/items', { per_page: 200 });
    const items = raw.items ?? [];
    const byType = new Map<string, number>();
    let withGroup = 0;
    let dashP = 0;
    for (const it of items) {
      const key = `${it.item_type ?? '—'} / ${it.product_type ?? '—'}`;
      byType.set(key, (byType.get(key) ?? 0) + 1);
      if (it.item_group_id) withGroup += 1;
      if (typeof it.sku === 'string' && /^\d+-P-/i.test(it.sku.trim())) dashP += 1;
    }
    console.log(`    → sampled ${items.length} item(s)`);
    console.log(`    item_type / product_type:`);
    for (const [k, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      • ${k}: ${n}`);
    }
    console.log(`    items with item_group_id: ${withGroup}`);
    console.log(`    items matching <base>-P-... : ${dashP}`);
  } catch (e) {
    console.log('    ✗ error:', e instanceof Error ? e.message : e);
  }

  console.log('\n=== done ===\n');
}

main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(1);
});
