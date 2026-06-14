/**
 * Breadth scan: download a few clean photos for the top-M products into data/scan/
 * (no train/eval split, no wipe of existing dirs), so OCR can surface as many
 * distinct products with legible labels as possible. Timeout-guarded so a stalled
 * tunnel connection can't hang the run.
 *
 * Usage:  node vision/scripts/download_scan.mjs [topM] [perProduct]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const scanRoot = path.join(dataDir, 'scan');

const TOP_M = Number(process.argv[2] || 50);
const PER = Number(process.argv[3] || 25);
const CONCURRENCY = 8;

const pairing = JSON.parse(readFileSync(path.join(dataDir, 'nas_pairing.json'), 'utf8'));
const products = pairing.products.filter((p) => (p.clean + p.ambiguous) >= 2).slice(0, TOP_M);
mkdirSync(scanRoot, { recursive: true });

async function download(url, dest) {
  if (existsSync(dest)) return 'cached';
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return 'ok';
}
async function pool(tasks, n) {
  let i = 0;
  const out = [];
  async function w() { while (i < tasks.length) { const k = i++; try { out[k] = await tasks[k](); } catch (e) { out[k] = 'err'; } } }
  await Promise.all(Array.from({ length: n }, w));
  return out;
}

let total = 0;
for (const p of products) {
  const id = p.zoho_item_id;
  const dir = path.join(scanRoot, id);
  mkdirSync(dir, { recursive: true });
  // prefer clean photos, then fill with ambiguous, up to PER
  const photos = [...p.photos].sort((a, b) => (b.clean === a.clean ? 0 : b.clean ? 1 : -1)).slice(0, PER);
  const tasks = photos.map((ph) => () => download(ph.url, path.join(dir, ph.name)));
  const r = await pool(tasks, CONCURRENCY);
  const ok = r.filter((x) => x === 'ok' || x === 'cached').length;
  total += ok;
  console.log(`  ${String(ok).padStart(3)}  ${(p.name || id).slice(0, 56)}`);
}
console.log(`\nScan dataset: ${products.length} products, ${total} photos -> data/scan/`);
