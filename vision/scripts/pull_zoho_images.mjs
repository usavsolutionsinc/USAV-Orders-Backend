/**
 * Pull product reference photos that ALREADY live in our DB (zoho_item_images
 * bytea, synced from Zoho) into vision/data/reference/<zoho_item_id>/, so they can
 * be enrolled into the vision index with zero external calls / zero cost.
 *
 * Folder name = zoho_item_id  (the stable identity). /identify returns that label;
 * the Vercel resolver maps it back via resolveSkuCatalogByPlatformId (crosswalk).
 * A manifest.json records the human name + zoho_sku for debugging.
 *
 * Only items that were actually received (intersect receiving_lines) are pulled,
 * ordered by receiving recurrence (most-received first).
 *
 * Usage:  node vision/scripts/pull_zoho_images.mjs [limit]
 * Read-only on the DB. Writes image files under vision/data/reference/.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const referenceDir = path.join(__dirname, '..', 'data', 'reference');

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
  throw new Error('No DATABASE_URL found');
}

const extFor = (ct) =>
  ct?.includes('png') ? 'png' : ct?.includes('webp') ? 'webp' : ct?.includes('gif') ? 'gif' : 'jpg';

const limit = Number(process.argv[2] || 200);

const { Client } = pg;
const client = new Client({ connectionString: loadDatabaseUrl(), ssl: { rejectUnauthorized: false } });

// Received Zoho items that have cached photo bytes, ordered by recurrence.
const SQL = `
  SELECT
    zii.zoho_item_id,
    zii.content_type,
    zii.bytes,
    MAX(it.name) AS name,
    MAX(it.sku)  AS sku,
    COUNT(rl.id) AS line_count
  FROM zoho_item_images zii
  JOIN receiving_lines rl ON rl.zoho_item_id = zii.zoho_item_id
  LEFT JOIN items it      ON it.zoho_item_id = zii.zoho_item_id
  WHERE zii.bytes IS NOT NULL AND length(zii.bytes) > 0
  GROUP BY zii.zoho_item_id, zii.content_type, zii.bytes
  ORDER BY line_count DESC
  LIMIT $1
`;

await client.connect();
const { rows } = await client.query(SQL, [limit]);
await client.end();

mkdirSync(referenceDir, { recursive: true });
const manifest = [];
let written = 0;
for (const r of rows) {
  const dir = path.join(referenceDir, r.zoho_item_id);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `zoho.${extFor(r.content_type)}`);
  writeFileSync(file, r.bytes); // r.bytes is a Node Buffer from bytea
  written++;
  manifest.push({
    zoho_item_id: r.zoho_item_id,
    name: r.name || null,
    zoho_sku: r.sku || null,
    line_count: Number(r.line_count),
    file: path.relative(path.join(__dirname, '..'), file),
    bytes: r.bytes.length,
  });
  console.log(`  + ${r.zoho_item_id}  ${String(r.line_count).padStart(3)} lines  ${Math.round(r.bytes.length/1024)}KB  ${r.name || ''}`.slice(0, 110));
}

writeFileSync(path.join(referenceDir, '_zoho_manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nWrote ${written} reference photo(s) into ${referenceDir}`);
console.log(`Manifest: data/reference/_zoho_manifest.json`);
console.log(`Next:  vision/.venv/Scripts/python -m vision.scripts.enroll_folder data/reference`);
