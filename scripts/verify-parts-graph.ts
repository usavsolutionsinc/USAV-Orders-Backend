import 'dotenv/config';

/**
 * Read-only end-to-end check of the parts-graph data pipeline against the LIVE
 * `items` mirror — mirrors exactly what GET /api/inventory/parts-graph returns,
 * so we can confirm real numbers without going through the auth wall.
 *
 * Run: npx tsx scripts/verify-parts-graph.ts
 */
async function main() {
  const { tenantQuery } = await import('@/lib/tenancy/db');
  const { USAV_ORG_ID } = await import('@/lib/tenancy/constants');
  const { parsePartSku, normalizeBase } = await import('@/lib/inventory/part-sku');

  const orgId = USAV_ORG_ID;
  const result = await tenantQuery(
    orgId,
    `SELECT sku, name, quantity_on_hand, quantity_available
       FROM items
      WHERE organization_id = $1
        AND status = 'active'
        AND sku IS NOT NULL
        AND TRIM(sku) <> ''`,
    [orgId],
  );
  const rows = result.rows as Array<{ sku: string; name: string | null; quantity_on_hand: any; quantity_available: any }>;

  const nonPartByBase = new Map<string, { sku: string; name: string }>();
  for (const r of rows) {
    if (!parsePartSku(r.sku).isPart) {
      const k = normalizeBase(r.sku);
      if (k && !nonPartByBase.has(k)) nonPartByBase.set(k, { sku: r.sku, name: r.name ?? '' });
    }
  }

  const bases = new Map<string, { base: string; baseUnit: any; parts: Map<string, { label: string; instances: number; onHand: number; skus: string[] }> }>();
  let partSkuCount = 0;
  for (const r of rows) {
    const p = parsePartSku(r.sku);
    if (!p.isPart || !p.base || !p.logicalKey) continue;
    partSkuCount += 1;
    let b = bases.get(p.base);
    if (!b) {
      b = { base: p.base, baseUnit: nonPartByBase.get(normalizeBase(p.base)) ?? null, parts: new Map() };
      bases.set(p.base, b);
    }
    let part = b.parts.get(p.logicalKey);
    if (!part) {
      part = { label: p.logicalLabel ?? p.base, instances: 0, onHand: 0, skus: [] };
      b.parts.set(p.logicalKey, part);
    }
    part.instances += 1;
    part.onHand += Number(r.quantity_on_hand) || 0;
    part.skus.push(r.sku);
  }

  const ordered = [...bases.values()].sort((a, b) => a.base.localeCompare(b.base, undefined, { numeric: true }));
  const logicalParts = ordered.reduce((s, b) => s + b.parts.size, 0);

  console.log('\n=== parts-graph live verification (USAV) ===\n');
  console.log(`active items:        ${rows.length}`);
  console.log(`part SKUs (-P):       ${partSkuCount}`);
  console.log(`base units:           ${ordered.length}`);
  console.log(`logical parts:        ${logicalParts}`);
  console.log(`base units w/ a matched whole-unit item: ${ordered.filter((b) => b.baseUnit).length}`);

  console.log('\n--- sample (first 6 bases) ---');
  for (const b of ordered.slice(0, 6)) {
    console.log(`\n▼ ${b.base}  ${b.baseUnit ? `· ${b.baseUnit.name || b.baseUnit.sku}` : '· (no whole-unit item)'}  · ${b.parts.size} part(s)`);
    for (const part of b.parts.values()) {
      console.log(`    ${part.label.padEnd(34)}  ×${part.instances} inst · ${part.onHand} on hand   [${part.skus.slice(0, 4).join(', ')}${part.skus.length > 4 ? ', …' : ''}]`);
    }
  }
  console.log('\n=== done ===\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('verify failed:', e);
  process.exit(1);
});
