// One-shot audit: scan QR codes inside every blob-backed manual PDF and check
// whether each decoded URL still resolves to a real PDF. Outputs JSON.
//
// Run: node scripts/audit-manual-qrs.mjs
import 'dotenv/config';
import { mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import sharp from 'sharp';
import zxing from '@zxing/library';
const {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
} = zxing;

const { Pool } = pg;

const CONCURRENCY = Number(process.env.QR_AUDIT_CONCURRENCY || 4);
const RENDER_DPI = Number(process.env.QR_AUDIT_DPI || 220);
const HTTP_TIMEOUT_MS = 15_000;
const OUT_JSON = join(process.cwd(), 'scripts', 'qr-audit-results.json');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function makeReader() {
  const reader = new MultiFormatReader();
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);
  return reader;
}

function bufferToBitmap(rgbBuf, width, height, channels) {
  const argb = new Int32Array(width * height);
  for (let i = 0, p = 0; i < argb.length; i++, p += channels) {
    argb[i] = (0xff << 24) | (rgbBuf[p] << 16) | (rgbBuf[p + 1] << 8) | rgbBuf[p + 2];
  }
  const luminance = new RGBLuminanceSource(argb, width, height);
  return new BinaryBitmap(new HybridBinarizer(luminance));
}

function tryDecode(reader, bitmap) {
  try {
    const r = reader.decodeWithState(bitmap);
    return r?.getText() ?? null;
  } catch {
    try { reader.reset(); } catch {}
    return null;
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${stderr}`))));
  });
}

async function downloadPdf(url, destPath) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(destPath, buf);
    return buf.length;
  } finally {
    clearTimeout(t);
  }
}

async function rasterizePdf(pdfPath, outDir) {
  // pdftoppm -r <dpi> -png file.pdf <outDir>/page  → produces page-1.png, page-2.png, ...
  await run('pdftoppm', ['-r', String(RENDER_DPI), '-png', pdfPath, join(outDir, 'page')]);
  const files = (await readdir(outDir))
    .filter((f) => f.startsWith('page-') && f.endsWith('.png'))
    .sort((a, b) => {
      const na = Number(a.match(/page-(\d+)\.png/)?.[1] ?? 0);
      const nb = Number(b.match(/page-(\d+)\.png/)?.[1] ?? 0);
      return na - nb;
    })
    .map((f) => join(outDir, f));
  return files;
}

async function decodeQrsFromImage(pngPath) {
  // ZXing's MultiFormatReader only finds one QR per pass. To find multiple QRs
  // (e.g. cover page with several codes), we run the decoder on the full image
  // plus a 2x2 tile grid plus a downscaled variant, deduping results.
  const reader = makeReader();
  const found = new Set();

  const { data, info } = await sharp(pngPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Full image
  const txt = tryDecode(reader, bufferToBitmap(data, width, height, channels));
  if (txt) found.add(txt);

  // Downscaled (helps very large, blurry-by-resampling pages)
  if (width > 1600) {
    const ds = await sharp(pngPath).resize({ width: 1600 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const t = tryDecode(reader, bufferToBitmap(ds.data, ds.info.width, ds.info.height, ds.info.channels));
    if (t) found.add(t);
  }

  // 2x2 tiling with 10% overlap
  const tileW = Math.floor(width * 0.55);
  const tileH = Math.floor(height * 0.55);
  const positions = [
    [0, 0],
    [width - tileW, 0],
    [0, height - tileH],
    [width - tileW, height - tileH],
  ];
  for (const [left, top] of positions) {
    const tile = await sharp(pngPath).extract({ left, top, width: tileW, height: tileH }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const t = tryDecode(reader, bufferToBitmap(tile.data, tile.info.width, tile.info.height, tile.info.channels));
    if (t) found.add(t);
  }

  return [...found];
}

async function checkUrl(url) {
  // Returns { ok, status, contentType, isPdfMagic, finalUrl, error }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    // Use GET with a ranged request so we read just enough bytes for the magic number.
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { Range: 'bytes=0-1023', 'User-Agent': 'usav-qr-audit/1.0' },
      signal: ctrl.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    let isPdfMagic = false;
    try {
      const reader = res.body?.getReader();
      if (reader) {
        const { value } = await reader.read();
        if (value && value.length >= 4) {
          isPdfMagic = value[0] === 0x25 && value[1] === 0x50 && value[2] === 0x44 && value[3] === 0x46; // %PDF
        }
        try { await reader.cancel(); } catch {}
      }
    } catch {}
    const looksLikePdf = isPdfMagic || /application\/pdf/i.test(contentType);
    return {
      ok: res.ok && looksLikePdf,
      status: res.status,
      contentType,
      isPdfMagic,
      finalUrl: res.url,
      error: null,
    };
  } catch (e) {
    return { ok: false, status: null, contentType: null, isPdfMagic: false, finalUrl: null, error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function processManual(manual) {
  const workDir = join(tmpdir(), `qraudit-${manual.id}-${Date.now()}`);
  await mkdir(workDir, { recursive: true });
  const pdfPath = join(workDir, 'manual.pdf');
  const result = {
    manualId: manual.id,
    displayName: manual.display_name || manual.file_name || null,
    itemNumber: manual.item_number || null,
    sourceUrl: manual.source_url,
    bytes: 0,
    pageCount: 0,
    qrFindings: [], // [{ page, decoded, check }]
    error: null,
  };
  try {
    result.bytes = await downloadPdf(manual.source_url, pdfPath);
    const pages = await rasterizePdf(pdfPath, workDir);
    result.pageCount = pages.length;
    const seen = new Set();
    for (let i = 0; i < pages.length; i++) {
      const decoded = await decodeQrsFromImage(pages[i]);
      for (const text of decoded) {
        if (seen.has(text)) continue; // dedupe identical QR repeats across pages
        seen.add(text);
        result.qrFindings.push({ page: i + 1, decoded: text, check: null });
      }
    }
    // Validate URLs (only http/https). Non-URL QR payloads are recorded but not URL-checked.
    for (const f of result.qrFindings) {
      if (/^https?:\/\//i.test(f.decoded)) {
        f.check = await checkUrl(f.decoded);
      } else {
        f.check = { ok: null, status: null, contentType: null, isPdfMagic: false, finalUrl: null, error: 'not-a-url' };
      }
    }
  } catch (e) {
    result.error = String(e.message || e);
  } finally {
    try { await rm(workDir, { recursive: true, force: true }); } catch {}
  }
  return result;
}

async function pMapWithLimit(items, limit, fn, onProgress) {
  const results = new Array(items.length);
  let idx = 0;
  let done = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        results[i] = { error: String(e.message || e), manualId: items[i].id };
      }
      done++;
      onProgress?.(done, items.length, results[i]);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  console.log('Querying product_manuals…');
  const { rows } = await pool.query(`
    SELECT id, item_number, display_name, file_name, source_url
    FROM product_manuals
    WHERE source_url IS NOT NULL AND source_url <> ''
    ORDER BY id ASC
    ${process.env.QR_AUDIT_LIMIT ? `LIMIT ${Number(process.env.QR_AUDIT_LIMIT)}` : ''}
  `);
  console.log(`Found ${rows.length} blob-backed manuals.`);
  console.log(`Concurrency=${CONCURRENCY}, DPI=${RENDER_DPI}`);

  const start = Date.now();
  const results = await pMapWithLimit(rows, CONCURRENCY, processManual, (done, total, r) => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    const tag = r?.error ? 'ERR' : `${r?.qrFindings?.length ?? 0} QR`;
    console.log(`[${done}/${total} ${elapsed}s] manual#${r?.manualId} ${tag}${r?.error ? ' — ' + r.error : ''}`);
  });

  await writeFile(OUT_JSON, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${OUT_JSON}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
