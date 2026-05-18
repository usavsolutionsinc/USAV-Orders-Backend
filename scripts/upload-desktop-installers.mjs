#!/usr/bin/env node
/**
 * Upload Electron installers from `desktop-dist/` to Vercel Blob.
 *
 * The `/api/desktop-app/release` route lists Blob objects under the
 * `desktop-installers/` prefix at request time, so any `*.dmg` or `*.exe`
 * placed there becomes available to the install page.
 *
 * Usage:
 *   npm run desktop:upload                       # uploads everything in desktop-dist/
 *   node scripts/upload-desktop-installers.mjs --only=arm64    # filter by name substring
 *
 * Re-running with the same filenames overwrites the previous objects
 * (allowOverwrite: true), so version bumps don't leave stale assets.
 */

import { config as loadEnv } from 'dotenv';
import { put } from '@vercel/blob';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Match project convention: .env.local takes precedence over .env.
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const distDir = join(repoRoot, 'desktop-dist');
const PREFIX = 'desktop-installers/';
const INSTALLER_RE = /\.(dmg|exe)$/i;

function contentTypeFor(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (lower.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  return 'application/octet-stream';
}

function parseArgs(argv) {
  const out = { only: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--only=')) out.only = arg.slice('--only='.length).toLowerCase();
  }
  return out;
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN is not set. Add it to .env.local or .env.');
    process.exit(1);
  }

  const { only } = parseArgs(process.argv);

  let entries;
  try {
    entries = await readdir(distDir);
  } catch (err) {
    console.error(`Could not read ${distDir}: ${err.message}`);
    console.error('Build the installers first: npm run desktop:dist:mac && npm run desktop:dist:win');
    process.exit(1);
  }

  const files = entries
    .filter((f) => INSTALLER_RE.test(f))
    .filter((f) => (only ? f.toLowerCase().includes(only) : true));

  if (files.length === 0) {
    console.error(
      only
        ? `No installer files in ${distDir} matching "--only=${only}".`
        : `No installer files in ${distDir}. Build first with electron-builder.`,
    );
    process.exit(1);
  }

  const results = [];
  for (const file of files) {
    const full = join(distDir, file);
    const info = await stat(full);
    const sizeMb = (info.size / 1024 / 1024).toFixed(1);
    const pathname = `${PREFIX}${file}`;
    process.stdout.write(`Uploading ${file} (${sizeMb} MB) → ${pathname} ... `);

    const body = await readFile(full);
    const blob = await put(pathname, body, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: contentTypeFor(file),
    });
    console.log('done');
    results.push({ file, url: blob.url, size: info.size });
  }

  console.log('\nUploaded:');
  for (const r of results) {
    console.log(`  ${r.file}\n    ${r.url}`);
  }
}

main().catch((err) => {
  console.error('\nUpload failed:', err?.message ?? err);
  process.exit(1);
});
