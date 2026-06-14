/**
 * Download paired NAS photos into a train/eval dataset for the top-N products.
 *
 * Reads vision/data/nas_pairing.json (produced by nas_pair_by_time.mjs). For each
 * of the top-N products by CLEAN paired-photo count, downloads up to TRAIN_CAP+
 * EVAL_CAP "clean" photos, split by TIME (most-recent photos -> eval) so the eval
 * set tests cross-session generalization, not near-duplicate leakage.
 *
 *   vision/data/train/<zoho_item_id>/*.jpg   (enroll these)
 *   vision/data/eval/<zoho_item_id>/*.jpg    (held out — never enrolled)
 *
 * Usage:  node vision/scripts/build_nas_dataset.mjs [topN] [trainCap] [evalCap]
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

const TOP_N = Number(process.argv[2] || 20);
const TRAIN_CAP = Number(process.argv[3] || 45);
const EVAL_CAP = Number(process.argv[4] || 12);
const CONCURRENCY = 8;

const pairing = JSON.parse(readFileSync(path.join(dataDir, 'nas_pairing.json'), 'utf8'));
// NOTE: nas_pairing.json caps photos[] at 30/product. Re-run nas_pair_by_time with a
// higher per-product cap if you want more than 30; for a first high-accuracy pass 30
// recent clean photos/product is plenty. Here we use whatever it captured.
const products = pairing.products
  .filter((p) => p.clean >= 8) // need enough to split
  .slice(0, TOP_N);

const trainRoot = path.join(dataDir, 'train');
const evalRoot = path.join(dataDir, 'eval');
for (const root of [trainRoot, evalRoot]) {
  try { rmSync(root, { recursive: true, force: true }); } catch {}
  mkdirSync(root, { recursive: true });
}

async function download(url, dest) {
  // 30s timeout so one stalled connection over the tunnel can't hang the whole run.
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.length;
}

async function pool(tasks, n) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try { results[idx] = await tasks[idx](); } catch (e) { results[idx] = { err: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

const manifest = [];
let totalTrain = 0, totalEval = 0;
for (const p of products) {
  // p.photos are clean+ambiguous mixed; keep clean only, newest last (sorted by name~time)
  const clean = p.photos.filter((ph) => ph.clean);
  // name encodes IMG_<date>_<time>; sort ascending -> oldest first, newest last
  clean.sort((a, b) => a.name.localeCompare(b.name));
  const evalCount = Math.min(EVAL_CAP, Math.max(2, Math.floor(clean.length * 0.25)));
  const evalSet = clean.slice(clean.length - evalCount);          // most recent -> eval
  const trainSet = clean.slice(0, clean.length - evalCount).slice(0, TRAIN_CAP);
  const id = p.zoho_item_id;
  mkdirSync(path.join(trainRoot, id), { recursive: true });
  mkdirSync(path.join(evalRoot, id), { recursive: true });

  const tasks = [];
  trainSet.forEach((ph, k) => tasks.push(() => download(ph.url, path.join(trainRoot, id, `t${k}_${ph.name}`)).then(() => 'train')));
  evalSet.forEach((ph, k) => tasks.push(() => download(ph.url, path.join(evalRoot, id, `e${k}_${ph.name}`)).then(() => 'eval')));
  const r = await pool(tasks, CONCURRENCY);
  const okTrain = r.filter((x) => x === 'train').length;
  const okEval = r.filter((x) => x === 'eval').length;
  totalTrain += okTrain; totalEval += okEval;
  manifest.push({ zoho_item_id: id, name: p.name, train: okTrain, eval: okEval });
  console.log(`  ${String(okTrain).padStart(3)}tr ${String(okEval).padStart(2)}ev  ${(p.name || id).slice(0, 60)}`);
}

writeFileSync(path.join(dataDir, 'dataset_manifest.json'), JSON.stringify({ topN: TOP_N, trainCap: TRAIN_CAP, evalCap: EVAL_CAP, totalTrain, totalEval, products: manifest }, null, 2));
console.log(`\nDataset: ${manifest.length} products | ${totalTrain} train + ${totalEval} eval photos`);
console.log(`train -> vision/data/train/   eval -> vision/data/eval/`);
console.log(`Next: enroll data/train, then eval against data/eval`);
