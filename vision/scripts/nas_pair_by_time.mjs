/**
 * Pair NAS receiving photos to products by TIMESTAMP (the only key the historical
 * IMG_<date>_<time>.JPG photos carry). Strategy: each photo is assigned to the
 * single receiving line whose pairing-time is nearest, within a window. Group the
 * assigned photos by zoho_item_id -> candidate reference sets per product.
 *
 * This is a DIAGNOSTIC pass (stage 1): it does NOT download or OCR. It quantifies
 * coverage + attribution confidence so we know how much OCR disambiguation the
 * actual data needs before building the downloader/enroller.
 *
 *   confidence = time gap to the NEAREST line of a DIFFERENT product.
 *     >= AMBIG_MIN  -> "clean"     (timestamp alone is trustworthy)
 *     <  AMBIG_MIN  -> "ambiguous" (needs OCR label confirmation)
 *
 * Usage:  node vision/scripts/nas_pair_by_time.mjs [windowMin] [topN]
 * Output: vision/data/nas_pairing.json  (+ console summary)
 * Read-only on DB and NAS.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const NAS_BASE = 'https://nas-photos.michaelgarisek.com';
const MONTH_FOLDERS = ['MAR 2026', 'APRIL 2026', 'MAY 2026', 'JUN 2026']; // where receiving_lines live
const WINDOW_MIN = Number(process.argv[2] || 10);   // max |photo - line| to pair
const AMBIG_MIN = 3;                                  // gap (min) to a different product to call it "clean"
const TOP_N = Number(process.argv[3] || 40);

function loadDatabaseUrl() {
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

async function listFolder(folder) {
  const url = `${NAS_BASE}/${folder.split('/').map(encodeURIComponent).join('/')}/`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`NAS ${folder} -> HTTP ${res.status}`);
  const raw = await res.json();
  return raw
    .filter((e) => !e.is_dir && /\.(jpe?g|png|webp)$/i.test(e.name) && e.mod_time)
    .map((e) => ({ folder, name: e.name, url: `${url}${encodeURIComponent(e.name)}`, t: Date.parse(e.mod_time) }))
    .filter((e) => Number.isFinite(e.t));
}

// ---- gather photos from NAS ------------------------------------------------
let photos = [];
for (const f of MONTH_FOLDERS) {
  try {
    const list = await listFolder(f);
    photos.push(...list);
    console.error(`  NAS ${f}: ${list.length} photos`);
  } catch (e) {
    console.error(`  NAS ${f}: ${e.message}`);
  }
}
photos.sort((a, b) => a.t - b.t);

// ---- gather receiving lines (pairing time = COALESCE(unboxed_at, created_at)) ----
const client = new pg.Client({ connectionString: loadDatabaseUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows: lines } = await client.query(`
  SELECT rl.id AS line_id,
         rl.zoho_item_id,
         COALESCE(MAX(it.name), MAX(NULLIF(TRIM(rl.item_name), ''))) AS name,
         EXTRACT(EPOCH FROM COALESCE(r.unboxed_at, rl.created_at)) * 1000 AS t
  FROM receiving_lines rl
  LEFT JOIN receiving r ON r.id = rl.receiving_id
  LEFT JOIN items it    ON it.zoho_item_id = rl.zoho_item_id
  WHERE rl.zoho_item_id IS NOT NULL AND TRIM(rl.zoho_item_id) <> ''
  GROUP BY rl.id, rl.zoho_item_id, r.unboxed_at, rl.created_at
`);
await client.end();
lines.forEach((l) => (l.t = Number(l.t)));
lines.sort((a, b) => a.t - b.t);

// ---- assign each photo to the nearest line in time -------------------------
const windowMs = WINDOW_MIN * 60_000;
const perProduct = new Map(); // zoho_item_id -> { name, clean, ambiguous, photos:[] }
let pairedClean = 0, pairedAmbig = 0, unpaired = 0;

// two-pointer nearest search
let j = 0;
for (const p of photos) {
  while (j < lines.length - 1 && lines[j + 1].t <= p.t) j++;
  // nearest is among lines[j] and lines[j+1] (and a few around for safety)
  let best = null, second = null;
  for (let k = Math.max(0, j - 1); k <= Math.min(lines.length - 1, j + 2); k++) {
    const d = Math.abs(lines[k].t - p.t);
    if (!best || d < best.d) { second = best; best = { line: lines[k], d }; }
    else if (!second || d < second.d) { second = { line: lines[k], d }; }
  }
  if (!best || best.d > windowMs) { unpaired++; continue; }
  // confidence = gap to nearest line of a DIFFERENT product
  let diffGap = Infinity;
  for (let k = Math.max(0, j - 3); k <= Math.min(lines.length - 1, j + 4); k++) {
    if (lines[k].zoho_item_id !== best.line.zoho_item_id) {
      diffGap = Math.min(diffGap, Math.abs(lines[k].t - p.t));
    }
  }
  const clean = diffGap >= AMBIG_MIN * 60_000;
  const id = best.line.zoho_item_id;
  if (!perProduct.has(id)) perProduct.set(id, { zoho_item_id: id, name: best.line.name, clean: 0, ambiguous: 0, photos: [] });
  const rec = perProduct.get(id);
  rec.photos.push({ url: p.url, name: p.name, gapSec: Math.round(best.d / 1000), clean });
  if (clean) { rec.clean++; pairedClean++; } else { rec.ambiguous++; pairedAmbig++; }
}

const ranked = [...perProduct.values()].sort((a, b) => (b.clean + b.ambiguous) - (a.clean + a.ambiguous));
const out = {
  window_min: WINDOW_MIN, ambig_min: AMBIG_MIN,
  totals: { nas_photos: photos.length, lines: lines.length, paired_clean: pairedClean, paired_ambiguous: pairedAmbig, unpaired },
  products: ranked.slice(0, TOP_N).map((r) => ({ ...r, photos: r.photos.slice(0, 160) })),
};
mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
writeFileSync(path.join(__dirname, '..', 'data', 'nas_pairing.json'), JSON.stringify(out, null, 2));

console.log(`\nNAS photos: ${photos.length} | lines: ${lines.length} | window ±${WINDOW_MIN}m`);
console.log(`paired clean: ${pairedClean}  ambiguous: ${pairedAmbig}  unpaired: ${unpaired}`);
console.log(`\n=== TOP ${Math.min(25, TOP_N)} PRODUCTS BY PAIRED PHOTOS ===`);
console.log('clean  ambig  name');
ranked.slice(0, 25).forEach((r) => {
  console.log(`${String(r.clean).padStart(5)}  ${String(r.ambiguous).padStart(5)}  ${(r.name || r.zoho_item_id).slice(0, 70)}`);
});
console.log(`\nWrote vision/data/nas_pairing.json`);
