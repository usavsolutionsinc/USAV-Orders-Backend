#!/usr/bin/env node
/**
 * Migration runner — applies src/lib/migrations/*.sql files that haven't
 * run yet against DATABASE_URL.
 *
 * Tracks applied migrations in a schema_migrations table (filename + sha256
 * + applied_at). Idempotent: re-running is a no-op until new files appear.
 * If a file has changed since it was applied, the runner exits non-zero
 * rather than re-applying it (Postgres would have already returned an
 * error in practice; this just makes the message clearer).
 *
 * Usage:
 *   node scripts/run-pending-migrations.mjs           # apply all pending
 *   node scripts/run-pending-migrations.mjs --dry     # list pending, don't apply
 *
 * Drizzle's own migrator handles the generated migrations; this runner
 * exists for the hand-written SQL files (the team has used both since
 * before Drizzle landed, and we're not ready to consolidate yet).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';

// Load .env when present so the runner works outside Next.js.
try {
  const { config } = await import('dotenv');
  config({ path: '.env.local' });
  config({ path: '.env' });
} catch {
  // dotenv optional
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'lib', 'migrations');
const isDry = process.argv.includes('--dry');

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .filter((name) => {
      // Skip non-runnable planning docs that share the folder.
      const full = join(MIGRATIONS_DIR, name);
      return statSync(full).isFile();
    })
    .sort();
}

async function ensureSchemaMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      sha256   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function loadApplied(pool) {
  const r = await pool.query('SELECT filename, sha256 FROM schema_migrations');
  return new Map(r.rows.map((row) => [row.filename, row.sha256]));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set');
    process.exit(2);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await ensureSchemaMigrations(pool);
  const applied = await loadApplied(pool);
  const files = listMigrationFiles();

  const pending = [];
  for (const filename of files) {
    const full = join(MIGRATIONS_DIR, filename);
    const sql = readFileSync(full, 'utf8');
    const sum = sha256(sql);
    const prior = applied.get(filename);
    if (!prior) {
      pending.push({ filename, sql, sum });
    } else if (prior !== sum) {
      console.error(
        `migration ${filename} has changed since it was applied (sha256 mismatch). ` +
        `Add a new migration rather than editing an applied one.`,
      );
      process.exit(3);
    }
  }

  if (pending.length === 0) {
    console.log(`up to date — ${applied.size} migrations on record, 0 pending`);
    await pool.end();
    return;
  }

  console.log(`${pending.length} pending migration(s):`);
  for (const m of pending) console.log(`  ${m.filename}`);

  if (isDry) {
    console.log('(--dry: not applying)');
    await pool.end();
    return;
  }

  for (const m of pending) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      console.log(`applying ${m.filename}…`);
      await client.query(m.sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, sha256) VALUES ($1, $2)',
        [m.filename, m.sum],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`failed: ${m.filename}`);
      console.error(err?.message || err);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  console.log(`applied ${pending.length} migration(s)`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
