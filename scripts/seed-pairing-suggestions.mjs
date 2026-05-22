#!/usr/bin/env node
/**
 * One-time seed for sku_pairing_suggestions.
 *
 * Calls the same refresh routine the nightly cron will call. Safe to re-run.
 * Writes ONLY to sku_pairing_suggestions — never to sku_platform_ids.
 *
 * Run with:  npx tsx scripts/seed-pairing-suggestions.mjs
 *   (tsx must be invoked directly — node + --import has loader-API quirks
 *    on Node 24; tsx as the entry handles its own TS resolution cleanly.)
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve('.env.local'), quiet: true });
config({ path: resolve('.env'), quiet: true });

const { refreshAllSuggestions } = await import('../src/lib/neon/pairing-queries.ts');

const started = Date.now();
console.log('refreshing sku_pairing_suggestions…');
const result = await refreshAllSuggestions();
console.log(
  `done in ${Date.now() - started}ms — scanned ${result.catalogsScanned} catalogs, wrote ${result.suggestionsWritten} suggestions`,
);
process.exit(0);
