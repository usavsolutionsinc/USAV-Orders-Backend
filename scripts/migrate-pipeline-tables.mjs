/**
 * Creates the 5 pipeline tables + 3 enums for the AI training pipeline.
 * Safe to re-run — uses IF NOT EXISTS on everything.
 *
 * Usage: node scripts/migrate-pipeline-tables.mjs
 * Requires DATABASE_URL in .env (repo root).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL is not set. Add it to .env and retry.');
  process.exit(1);
}

const sqlPath = path.resolve(
  __dirname,
  '../src/lib/migrations/2026-03-28_create_pipeline_tables.sql',
);
const sql = fs.readFileSync(sqlPath, 'utf8');

const pool = new Pool({
  connectionString: url,
  ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('Running pipeline migration...');
    console.log(`  SQL: ${sqlPath}`);
    console.log(`  DB:  ${url.replace(/:[^:@]+@/, ':***@')}`); // mask password

    await client.query(sql);

    // Verify tables exist
    const { rows } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'training_samples', 'training_runs', 'model_versions',
          'pipeline_tasks', 'pipeline_cycles'
        )
      ORDER BY table_name
    `);

    const created = rows.map(r => r.table_name);
    const expected = ['model_versions', 'pipeline_cycles', 'pipeline_tasks', 'training_runs', 'training_samples'];
    const missing = expected.filter(t => !created.includes(t));

    if (missing.length > 0) {
      console.error(`\nERROR: Missing tables: ${missing.join(', ')}`);
      process.exit(1);
    }

    // Verify enums
    const { rows: enums } = await client.query(`
      SELECT typname FROM pg_type
      WHERE typname IN ('training_sample_status', 'pipeline_task_source', 'training_run_status')
      ORDER BY typname
    `);
    const enumNames = enums.map(r => r.typname);

    console.log('\n✓ Tables created:');
    created.forEach(t => console.log(`    ${t}`));
    console.log('\n✓ Enums created:');
    enumNames.forEach(e => console.log(`    ${e}`));

    // Count columns per table for sanity check
    for (const table of created) {
      const { rows: cols } = await client.query(`
        SELECT COUNT(*) as col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `, [table]);
      console.log(`    ${table}: ${cols[0].col_count} columns`);
    }

    console.log('\nPipeline migration complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
