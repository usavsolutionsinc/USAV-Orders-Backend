/**
 * Recursively crawl the NAS "1 LCPU" (local-pickup) tree and download every image
 * into vision/data/lcpu/<session>/, so OCR can expand product coverage from the
 * richer local-pickup photo sets (each pickup session = a folder of unique items).
 *
 * Cache-aware (skips files already on disk) and timeout-guarded (no hangs).
 *
 * Usage:  node vision/scripts/crawl_lcpu.mjs ["1 LCPU"] [maxPerSession]
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NAS_BASE = 'https://nas-photos.michaelgarisek.com';
const OUT_ROOT = path.join(__dirname, '..', 'data', 'lcpu');
const ROOT = process.argv[2] || '1 LCPU';
const MAX_PER_SESSION = Number(process.argv[3] || 200);
const CONCURRENCY = 8;
const IMG_RE = /\.(jpe?g|png|webp)$/i;

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

async function listDir(relPath) {
  const url = `${NAS_BASE}/${enc(relPath)}/`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${relPath}`);
  return await res.json();
}

// Walk the tree, collecting { session, name, url } for every image. `session` is the
// path relative to ROOT with the leaf folder as the bucket (flattened, fs-safe).
async function walk(relPath, sessionLabel, acc) {
  let entries;
  try { entries = await listDir(relPath); } catch (e) { console.error('  !', e.message); return; }
  if (!Array.isArray(entries)) return; // empty dir / non-listing -> nothing to walk
  for (const e of entries) {
    const child = `${relPath}/${e.name.replace(/\/$/, '')}`;
    if (e.is_dir) {
      await walk(child, e.name.replace(/[\/:]+/g, '_').replace(/\s+/g, ' ').trim(), acc);
    } else if (IMG_RE.test(e.name)) {
      acc.push({ session: sessionLabel || 'root', name: e.name, url: `${NAS_BASE}/${enc(child)}`, t: e.mod_time });
    }
  }
}

async function download(url, dest) {
  if (existsSync(dest)) return 'cached';
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return 'ok';
}
async function pool(tasks, n) {
  let i = 0; const out = [];
  const w = async () => { while (i < tasks.length) { const k = i++; try { out[k] = await tasks[k](); } catch { out[k] = 'err'; } } };
  await Promise.all(Array.from({ length: n }, w));
  return out;
}

console.log(`Crawling NAS "${ROOT}" ...`);
const images = [];
await walk(ROOT, '', images);
console.log(`Found ${images.length} images across the local-pickup tree.`);

// Bucket by session, cap per session, build download tasks.
const bySession = new Map();
for (const img of images) {
  if (!bySession.has(img.session)) bySession.set(img.session, []);
  bySession.get(img.session).push(img);
}
mkdirSync(OUT_ROOT, { recursive: true });
const tasks = [];
let planned = 0;
for (const [session, imgs] of bySession) {
  const dir = path.join(OUT_ROOT, session.slice(0, 80));
  mkdirSync(dir, { recursive: true });
  for (const img of imgs.slice(0, MAX_PER_SESSION)) {
    planned++;
    tasks.push(() => download(img.url, path.join(dir, img.name)));
  }
}
console.log(`${bySession.size} sessions, downloading ${planned} images (cap ${MAX_PER_SESSION}/session) ...`);
const r = await pool(tasks, CONCURRENCY);
const ok = r.filter((x) => x === 'ok').length, cached = r.filter((x) => x === 'cached').length, err = r.filter((x) => x === 'err').length;
console.log(`\nDone. new=${ok} cached=${cached} err=${err} -> vision/data/lcpu/`);
console.log(`Sessions:`);
for (const [s, imgs] of [...bySession].sort((a, b) => b[1].length - a[1].length).slice(0, 20)) {
  console.log(`  ${String(Math.min(imgs.length, MAX_PER_SESSION)).padStart(4)}  ${s}`);
}
