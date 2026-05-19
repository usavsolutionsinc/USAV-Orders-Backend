#!/usr/bin/env node
/**
 * Convert all .docx files under public/Manuals/ to PDF and upload them to
 * Vercel Blob under the `manuals/` prefix.
 *
 * Pipeline:
 *   1. Walk public/Manuals/ recursively
 *   2. For each .docx, run LibreOffice headless: soffice --convert-to pdf
 *   3. Drop the PDF in a mirror tree at converted-manuals/<same-relative-path>.pdf
 *   4. Upload the PDF to Blob at manuals/<same-relative-path>.pdf
 *   5. Skip re-uploads when the existing Blob object is the same size
 *
 * Existing .pdf files in public/Manuals/ are NOT uploaded — only converted ones.
 *
 * Usage:
 *   node scripts/convert-and-upload-manuals.mjs               # full run
 *   node scripts/convert-and-upload-manuals.mjs --dry         # convert only, no upload
 *   node scripts/convert-and-upload-manuals.mjs --skip-convert # upload existing converted-manuals/ only
 *   node scripts/convert-and-upload-manuals.mjs --concurrency=4
 *
 * Configuration:
 *   BLOB_READ_WRITE_TOKEN  required for uploads (loaded from .env.local / .env)
 *   SOFFICE_BIN            optional override for the LibreOffice binary path
 */

import { config as loadEnv } from 'dotenv';
import { put, list } from '@vercel/blob';
import { mkdir, readdir, stat, readFile } from 'node:fs/promises';
import { join, dirname, relative, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const sourceRoot = join(repoRoot, 'public', 'Manuals');
const outRoot = join(repoRoot, 'converted-manuals');
const BLOB_PREFIX = 'manuals/';
const BLOB_SOFT_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB Hobby cap

const SOFFICE_CANDIDATES = [
  process.env.SOFFICE_BIN,
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/opt/homebrew/bin/soffice',
  '/usr/local/bin/soffice',
  'soffice',
].filter(Boolean);

function parseArgs(argv) {
  const out = { dryRun: false, skipConvert: false, concurrency: 4 };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry') out.dryRun = true;
    else if (arg === '--skip-convert') out.skipConvert = true;
    else if (arg.startsWith('--concurrency=')) {
      out.concurrency = Math.max(1, Number(arg.slice('--concurrency='.length)) || 4);
    }
  }
  return out;
}

function findSoffice() {
  for (const candidate of SOFFICE_CANDIDATES) {
    try {
      if (candidate.includes('/') && existsSync(candidate)) return candidate;
    } catch {}
  }
  return SOFFICE_CANDIDATES[SOFFICE_CANDIDATES.length - 1]; // fall back to bare name
}

async function walkDocx(dir) {
  const out = [];
  async function recurse(d) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) await recurse(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.docx') && !e.name.startsWith('~$')) {
        out.push(full);
      }
    }
  }
  await recurse(dir);
  return out;
}

function pdfSiblingPath(docxPath) {
  const rel = relative(sourceRoot, docxPath);
  const dir = dirname(rel);
  const stem = basename(rel, extname(rel));
  return join(outRoot, dir, `${stem}.pdf`);
}

function convertOne(soffice, docxPath, workerId = 0) {
  return new Promise((resolve) => {
    const outDir = dirname(pdfSiblingPath(docxPath));
    // Each worker needs its own LibreOffice user profile — running multiple
    // soffice processes against a shared profile races on the singleton lock
    // and silently fails for all but one.
    const userInstallation = `file:///tmp/lo-profile-${process.pid}-${workerId}`;
    mkdir(outDir, { recursive: true })
      .then(() => {
        const proc = spawn(
          soffice,
          [
            `-env:UserInstallation=${userInstallation}`,
            '--headless',
            '--norestore',
            '--nofirststartwizard',
            '--convert-to',
            'pdf',
            '--outdir',
            outDir,
            docxPath,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stderr = '';
        proc.stderr.on('data', (d) => (stderr += d.toString()));
        proc.on('exit', async (code) => {
          const expected = pdfSiblingPath(docxPath);
          if (code === 0 && existsSync(expected)) {
            resolve({ ok: true, pdf: expected });
          } else {
            resolve({ ok: false, reason: stderr.trim() || `exit ${code}`, docx: docxPath });
          }
        });
        proc.on('error', (err) => resolve({ ok: false, reason: err.message, docx: docxPath }));
      })
      .catch((err) => resolve({ ok: false, reason: err.message, docx: docxPath }));
  });
}

async function runPool(items, concurrency, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async (_, workerId) => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx, workerId);
    }
  });
  await Promise.all(workers);
  return results;
}

async function walkPdfs(dir) {
  const out = [];
  async function recurse(d) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) await recurse(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) out.push(full);
    }
  }
  await recurse(dir);
  return out;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function existingBlobSizes() {
  const map = new Map();
  let cursor;
  do {
    const page = await list({ prefix: BLOB_PREFIX, limit: 1000, cursor });
    for (const b of page.blobs) map.set(b.pathname, b.size);
    cursor = page.cursor;
  } while (cursor);
  return map;
}

async function main() {
  const args = parseArgs(process.argv);
  const soffice = findSoffice();

  // --- 1. Convert ----------------------------------------------------------
  if (!args.skipConvert) {
    console.log(`\nScanning ${sourceRoot} for .docx files...`);
    const docxFiles = await walkDocx(sourceRoot);
    console.log(`Found ${docxFiles.length} .docx files`);
    if (!docxFiles.length) {
      console.log('Nothing to convert.');
      return;
    }

    console.log(`Using LibreOffice: ${soffice}`);
    console.log(`Output tree:      ${outRoot}`);
    console.log(`Concurrency:      ${args.concurrency}\n`);

    let done = 0;
    let failed = 0;
    const failures = [];
    await runPool(docxFiles, args.concurrency, async (docx, _idx, workerId) => {
      const expected = pdfSiblingPath(docx);
      if (existsSync(expected)) {
        done++;
        process.stdout.write(`\r[${done + failed}/${docxFiles.length}] cached`.padEnd(80));
        return { ok: true, pdf: expected };
      }
      const res = await convertOne(soffice, docx, workerId);
      if (res.ok) done++;
      else {
        failed++;
        failures.push({ docx, reason: res.reason });
      }
      process.stdout.write(
        `\r[${done + failed}/${docxFiles.length}] ${res.ok ? 'ok' : 'FAIL'}: ${basename(docx)}`.padEnd(100),
      );
      return res;
    });
    console.log('');
    console.log(`Converted ${done}/${docxFiles.length} (${failed} failed)`);
    if (failures.length) {
      console.log('\nFailures:');
      for (const f of failures.slice(0, 20)) console.log(`  - ${relative(sourceRoot, f.docx)}: ${f.reason}`);
      if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`);
    }
  }

  // --- 2. Size check -------------------------------------------------------
  const pdfFiles = await walkPdfs(outRoot);
  let total = 0;
  for (const p of pdfFiles) {
    const s = await stat(p);
    total += s.size;
  }
  console.log(`\n${pdfFiles.length} PDFs in ${outRoot} → total ${fmtBytes(total)}`);
  if (total > BLOB_SOFT_LIMIT_BYTES) {
    console.error(`Output exceeds the 1 GB Blob soft limit (${fmtBytes(total)}). Aborting upload.`);
    process.exit(1);
  }
  console.log(`Under the 1 GB Hobby Blob limit by ${fmtBytes(BLOB_SOFT_LIMIT_BYTES - total)}`);

  if (args.dryRun) {
    console.log('\n--dry passed; skipping upload.');
    return;
  }

  // --- 3. Upload -----------------------------------------------------------
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN is not set. Add it to .env.local or .env.');
    process.exit(1);
  }

  console.log('\nFetching existing blob index for skip-by-size...');
  const existing = await existingBlobSizes();
  console.log(`${existing.size} existing manuals/ blobs on record`);

  let uploaded = 0;
  let skipped = 0;
  let failedUploads = 0;
  await runPool(pdfFiles, Math.min(args.concurrency, 6), async (pdfPath) => {
    const rel = relative(outRoot, pdfPath);
    const pathname = `${BLOB_PREFIX}${rel}`;
    const info = await stat(pdfPath);
    const existingSize = existing.get(pathname);
    if (existingSize === info.size) {
      skipped++;
      process.stdout.write(`\r[${uploaded + skipped + failedUploads}/${pdfFiles.length}] skip (same size): ${rel}`.padEnd(120));
      return;
    }
    try {
      const body = await readFile(pdfPath);
      await put(pathname, body, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/pdf',
      });
      uploaded++;
      process.stdout.write(`\r[${uploaded + skipped + failedUploads}/${pdfFiles.length}] uploaded: ${rel}`.padEnd(120));
    } catch (err) {
      failedUploads++;
      console.error(`\nUpload failed for ${rel}: ${err?.message ?? err}`);
    }
  });
  console.log('');
  console.log(`\nUpload summary: ${uploaded} uploaded, ${skipped} unchanged, ${failedUploads} failed`);
}

main().catch((err) => {
  console.error('\nScript failed:', err?.stack ?? err);
  process.exit(1);
});
