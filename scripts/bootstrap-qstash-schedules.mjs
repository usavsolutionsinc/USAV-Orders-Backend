#!/usr/bin/env node
/**
 * bootstrap-qstash-schedules.mjs
 * ────────────────────────────────────────────────────────────────────
 * Mirror of POST /api/qstash/schedules/bootstrap.
 *
 * Only processes entries that do NOT have "managedBy": "vercel".
 * Most recurring schedules have migrated to vercel.json crons.
 *
 * Useful for any remaining QStash-driven jobs.
 *
 * Env required: QSTASH_TOKEN, NEXT_PUBLIC_APP_URL (or APP_URL).
 *
 * Usage:
 *   node scripts/bootstrap-qstash-schedules.mjs           # apply + list
 *   node scripts/bootstrap-qstash-schedules.mjs --list    # list only
 * ────────────────────────────────────────────────────────────────────
 */
import 'dotenv/config';
import { Client } from '@upstash/qstash';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const listOnly = process.argv.includes('--list');

function appBaseUrl() {
  const raw = (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  ).trim().replace(/\/$/, '');
  if (!raw) throw new Error('APP_URL / NEXT_PUBLIC_APP_URL / VERCEL_URL must be set');
  return raw;
}

function loadConfig() {
  const path = resolve(__dirname, '..', 'src', 'config', 'qstash-schedules.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function main() {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN must be set');
  const base = appBaseUrl();
  const client = new Client({ token, baseUrl: process.env.QSTASH_URL || undefined });

  if (listOnly) {
    const existing = await client.schedules.list();
    console.log(`QStash has ${existing.length} schedule(s):`);
    for (const s of existing) {
      console.log(`  • ${s.scheduleId}  cron="${s.cron}"  →  ${s.destination}`);
    }
    return;
  }

  const config = loadConfig();
  const qstashManaged = config.filter((s: any) => s.managedBy !== 'vercel');
  console.log(`Bootstrapping ${qstashManaged.length} QStash-managed schedule(s) against ${base} (skipping ${config.length - qstashManaged.length} vercel-managed)`);

  const existing = await client.schedules.list();
  const expectedIds = new Set(qstashManaged.map((s) => s.scheduleId));
  const obsolete = existing.filter((s) => !expectedIds.has(String(s.scheduleId)));
  if (obsolete.length > 0) {
    console.log(`Pruning ${obsolete.length} obsolete schedule(s):`);
    for (const s of obsolete) {
      console.log(`  − ${s.scheduleId}`);
      await client.schedules.delete(String(s.scheduleId));
    }
    console.log('');
  }

  const results = [];
  for (const entry of qstashManaged) {
    const destination = `${base}${entry.path.startsWith('/') ? entry.path : `/${entry.path}`}`;
    const headers = { 'content-type': 'application/json', ...(entry.headers || {}) };
    try {
      const result = await client.schedules.create({
        scheduleId: entry.scheduleId,
        destination,
        cron: entry.cron,
        method: 'POST',
        headers,
        body: entry.body === undefined ? undefined : JSON.stringify(entry.body),
        retries: entry.retries,
        timeout: entry.timeout,
        label: entry.label,
      });
      results.push({ id: entry.scheduleId, cron: entry.cron, destination, ok: true, result });
      console.log(`  ✓ ${entry.scheduleId}  ${entry.cron}  →  ${entry.path}`);
    } catch (err) {
      results.push({ id: entry.scheduleId, ok: false, error: err?.message || String(err) });
      console.error(`  ✗ ${entry.scheduleId}  FAILED: ${err?.message || err}`);
    }
  }

  console.log('\nFinal state:');
  const after = await client.schedules.list();
  console.log(`QStash now has ${after.length} schedule(s):`);
  for (const s of after) {
    console.log(`  • ${s.scheduleId}  cron="${s.cron}"  →  ${s.destination}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
