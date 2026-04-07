#!/usr/bin/env node

/**
 * Ingest Bose service manual markdown files into NemoClaw RAG.
 *
 * Reads all .md files from public/Bose product service manuals/converted_md/,
 * skips files containing NEEDS_VISION_PASS (schematic-only), parses optional
 * YAML frontmatter for source/path metadata, and POSTs each to the NemoClaw
 * RAG ingest endpoint.
 *
 * Usage:
 *   node scripts/ingest-bose-manuals.mjs [--dry-run] [--url http://127.0.0.1:8765]
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

// Primary: NemoClaw data dir (WSL). Fallback: old public/ location.
const CONVERTED_MD_DIR =
  process.env.BOSE_MANUALS_DIR ||
  '\\\\wsl.localhost\\Ubuntu-22.04\\home\\avion\\nemoclaw-fork\\data\\bose-service-manuals';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const urlFlagIdx = args.indexOf('--url');
const NEMOCLAW_RAG_URL =
  urlFlagIdx !== -1 && args[urlFlagIdx + 1]
    ? args[urlFlagIdx + 1]
    : process.env.NEMOCLAW_RAG_URL || 'http://127.0.0.1:8765';

const INGEST_ENDPOINT = `${NEMOCLAW_RAG_URL}/api/rag/ingest`;
const DELAY_MS = 100;

/** Strip YAML frontmatter and return { frontmatter, body }. */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const fm = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
    if (key) fm[key] = val;
  }
  return { frontmatter: fm, body: match[2] };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`[ingest] Reading markdown files from:\n  ${CONVERTED_MD_DIR}`);
  console.log(`[ingest] NemoClaw RAG endpoint: ${INGEST_ENDPOINT}`);
  if (DRY_RUN) console.log('[ingest] DRY RUN — no requests will be sent');

  let files;
  try {
    files = (await readdir(CONVERTED_MD_DIR)).filter((f) => f.endsWith('.md'));
  } catch (err) {
    console.error(`[ingest] Could not read directory: ${err.message}`);
    process.exit(1);
  }

  console.log(`[ingest] Found ${files.length} .md files`);

  let ingested = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = join(CONVERTED_MD_DIR, file);

    let raw;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err) {
      console.error(`  [${i + 1}/${files.length}] ERROR reading ${file}: ${err.message}`);
      errors++;
      continue;
    }

    // Skip schematic-only files that need vision processing
    if (raw.includes('NEEDS_VISION_PASS')) {
      console.log(`  [${i + 1}/${files.length}] SKIP (NEEDS_VISION_PASS): ${file}`);
      skipped++;
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(raw);
    const content = body.trim();

    if (!content) {
      console.log(`  [${i + 1}/${files.length}] SKIP (empty body): ${file}`);
      skipped++;
      continue;
    }

    // Derive a readable source name from the filename
    const sourceName =
      frontmatter.source ||
      basename(file, '.md').replace(/_/g, ' ');

    const payload = {
      content,
      metadata: {
        source: sourceName,
        path: frontmatter.path || file,
        type: 'bose_service_manual',
      },
    };

    if (DRY_RUN) {
      console.log(`  [${i + 1}/${files.length}] DRY: ${sourceName} (${content.length} chars)`);
      ingested++;
      continue;
    }

    try {
      const res = await fetch(INGEST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(
          `  [${i + 1}/${files.length}] ERROR ${res.status}: ${sourceName} — ${errText.slice(0, 200)}`,
        );
        errors++;
      } else {
        console.log(`  [${i + 1}/${files.length}] OK: ${sourceName} (${content.length} chars)`);
        ingested++;
      }
    } catch (err) {
      console.error(`  [${i + 1}/${files.length}] FETCH ERROR: ${sourceName} — ${err.message}`);
      errors++;
    }

    if (i < files.length - 1) await sleep(DELAY_MS);
  }

  console.log('\n[ingest] Done.');
  console.log(`  Ingested: ${ingested}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Total:    ${files.length}`);
}

main().catch((err) => {
  console.error('[ingest] Fatal error:', err);
  process.exit(1);
});
