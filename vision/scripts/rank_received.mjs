/**
 * Rank the most-frequently-received products by their STABLE Zoho identity
 * (receiving_lines.zoho_item_id) — collapsing the many freeform item_name
 * spellings of the same product — so we know which products to ENROLL into the
 * vision index first (highest recurrence = highest payoff).
 *
 * For each Zoho item it also diagnoses, in one pass:
 *   - canonical name / sku from the Zoho `items` master
 *   - whether a reference photo already exists (zoho_item_images bytes,
 *     items.image_document_id, or items.image_url) — our preferred, free source
 *   - whether it resolves to sku_catalog (direct sku OR platform crosswalk) —
 *     a gap here is the "receiving -> zoho -> sku catalog identifying" problem
 *
 * Usage:  node vision/scripts/rank_received.mjs [limit]
 * Output: vision/data/received_ranking.json  (+ console tables)
 *
 * Read-only. Uses DATABASE_URL from the repo .env / .env.local.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL_UNPOOLED) return process.env.DATABASE_URL_UNPOOLED;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const f of ['.env', '.env.local']) {
    try {
      const txt = readFileSync(path.join(repoRoot, f), 'utf8');
      for (const key of ['DATABASE_URL_UNPOOLED', 'DATABASE_URL']) {
        const m = txt.match(new RegExp(`^${key}=\\s*"?([^"\\n]+)"?`, 'm'));
        if (m) return m[1].replace(/\\n$/, '').trim();
      }
    } catch {}
  }
  throw new Error('No DATABASE_URL found in env or .env/.env.local');
}

const limit = Number(process.argv[2] || 80);

const { Client } = pg;
const client = new Client({ connectionString: loadDatabaseUrl(), ssl: { rejectUnauthorized: false } });

// Group receiving by stable Zoho item id. items = Zoho master (canonical name/sku
// /image). zoho_item_images = cached photo bytes keyed by zoho_item_id. Catalog
// linkage is checked two ways: direct sku match AND the platform_item_id crosswalk
// (mirrors resolveSkuCatalogId in sku-catalog-queries.ts).
const SQL = `
  SELECT
    rl.zoho_item_id                               AS zoho_item_id,
    MAX(it.name)                                  AS zoho_name,
    MAX(it.sku)                                   AS zoho_sku,
    MAX(it.status)                                AS zoho_status,
    MAX(it.image_url)                             AS zoho_image_url,
    bool_or(it.image_document_id IS NOT NULL)     AS has_image_doc,
    bool_or(zii.zoho_item_id IS NOT NULL)         AS has_image_bytes,
    MAX(sc_sku.id)                                AS catalog_id_via_sku,
    MAX(sp.sku_catalog_id)                        AS catalog_id_via_crosswalk,
    MAX(COALESCE(sc_sku.product_title, sc_xw.product_title)) AS catalog_title,
    MAX(COALESCE(sc_sku.image_url, sc_xw.image_url))         AS catalog_image_url,
    COUNT(*)                                      AS line_count,
    SUM(COALESCE(rl.quantity_received, 0))        AS qty_received,
    COUNT(DISTINCT NULLIF(TRIM(rl.item_name), '')) AS distinct_titles,
    (array_agg(DISTINCT NULLIF(TRIM(rl.item_name), '')))[1:4] AS sample_titles,
    MAX(rl.created_at)                            AS last_seen
  FROM receiving_lines rl
  LEFT JOIN items it             ON it.zoho_item_id = rl.zoho_item_id
  LEFT JOIN zoho_item_images zii ON zii.zoho_item_id = rl.zoho_item_id
  LEFT JOIN sku_catalog sc_sku   ON sc_sku.sku = it.sku
  LEFT JOIN sku_platform_ids sp
         ON regexp_replace(UPPER(TRIM(COALESCE(sp.platform_item_id, ''))), '[^A-Z0-9]', '', 'g')
          = regexp_replace(UPPER(TRIM(rl.zoho_item_id)), '[^A-Z0-9]', '', 'g')
        AND rl.zoho_item_id <> ''
  LEFT JOIN sku_catalog sc_xw    ON sc_xw.id = sp.sku_catalog_id
  WHERE rl.zoho_item_id IS NOT NULL AND TRIM(rl.zoho_item_id) <> ''
  GROUP BY rl.zoho_item_id
  ORDER BY line_count DESC, qty_received DESC
`;

await client.connect();
const { rows } = await client.query(SQL);
await client.end();

const isBose = (s) => /\bbose\b/i.test(s || '');

const ranked = rows.map((r) => {
  const catalogId = r.catalog_id_via_sku ?? r.catalog_id_via_crosswalk ?? null;
  const name = r.zoho_name || r.catalog_title || (r.sample_titles && r.sample_titles[0]) || '(no zoho item)';
  const hasPhoto = Boolean(r.has_image_bytes || r.has_image_doc || r.zoho_image_url || r.catalog_image_url);
  let photoSource = null;
  if (r.has_image_bytes) photoSource = 'zoho_bytes';
  else if (r.has_image_doc) photoSource = 'zoho_doc';
  else if (r.zoho_image_url) photoSource = 'zoho_url';
  else if (r.catalog_image_url) photoSource = 'catalog_url';
  return {
    zoho_item_id: r.zoho_item_id,
    name,
    zoho_sku: r.zoho_sku || null,
    zoho_status: r.zoho_status || null,
    in_zoho_master: Boolean(r.zoho_name),
    sku_catalog_id: catalogId,
    catalog_linked: catalogId != null,
    link_via: r.catalog_id_via_sku ? 'sku' : r.catalog_id_via_crosswalk ? 'crosswalk' : null,
    has_photo: hasPhoto,
    photo_source: photoSource,
    is_bose: isBose(name) || isBose(r.zoho_sku),
    line_count: Number(r.line_count),
    qty_received: Number(r.qty_received || 0),
    distinct_titles: Number(r.distinct_titles || 0), // dedup strength: spellings collapsed
    sample_titles: (r.sample_titles || []).filter(Boolean),
    last_seen: r.last_seen,
  };
});

const top = ranked.slice(0, limit);
const out = {
  generated_for: 'vision enrollment priority (grouped by zoho_item_id)',
  total_zoho_items: ranked.length,
  diagnostics: {
    not_in_zoho_master: ranked.filter((r) => !r.in_zoho_master).length,
    catalog_unlinked: ranked.filter((r) => !r.catalog_linked).length,
    no_photo_anywhere: ranked.filter((r) => !r.has_photo).length,
    photo_from_zoho_bytes: ranked.filter((r) => r.photo_source === 'zoho_bytes').length,
  },
  ranking: top,
  enroll_now_have_photo: top.filter((r) => r.has_photo),
  need_external_image: top.filter((r) => !r.has_photo),
};

mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
const outPath = path.join(__dirname, '..', 'data', 'received_ranking.json');
writeFileSync(outPath, JSON.stringify(out, null, 2));

const d = out.diagnostics;
console.log(`\nDistinct Zoho items received: ${ranked.length}`);
console.log(`  not in Zoho items master : ${d.not_in_zoho_master}`);
console.log(`  NOT linked to sku_catalog : ${d.catalog_unlinked}   <-- the identifying problem`);
console.log(`  already have a photo      : ${ranked.filter((r)=>r.has_photo).length}  (zoho bytes: ${d.photo_from_zoho_bytes})`);
console.log(`  no photo anywhere         : ${d.no_photo_anywhere}`);

console.log(`\n=== TOP ${Math.min(30, limit)} BY RECURRENCE (grouped by zoho_item_id) ===`);
console.log('rk  lines  qty  titles  photo       cat  name');
top.slice(0, 30).forEach((r, i) => {
  console.log(
    `${String(i + 1).padStart(2)}  ${String(r.line_count).padStart(4)} ${String(r.qty_received).padStart(4)}  ` +
    `${String(r.distinct_titles).padStart(5)}  ${String(r.photo_source || '-').padEnd(10)} ${r.catalog_linked ? (r.link_via==='sku'?'sku':'xw ') : ' - '}  ${r.name}`
  );
});
console.log(`\nWrote ${outPath}`);
