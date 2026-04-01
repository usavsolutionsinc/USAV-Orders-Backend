#!/usr/bin/env node
/* eslint-disable no-console */
import path from 'path';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in .env');
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const result = await client.query(
      `SELECT * FROM refresh_operations_kpi_rollups_from_state(NOW())`,
    );
    console.log('[kpi-rollups] Incremental refresh:', result.rows[0] || null);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[kpi-rollups] Failed:', error?.message || error);
  process.exit(1);
});

