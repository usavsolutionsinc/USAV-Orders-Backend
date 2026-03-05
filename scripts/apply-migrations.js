#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in .env');
  }

  const migrationsDir = path.resolve(process.cwd(), 'src/lib/migrations');
  const args = process.argv.slice(2);
  const patterns = args.length > 0 ? args : ['*.sql'];

  const allFiles = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const selectedFiles = allFiles.filter((name) =>
    patterns.some((p) => {
      if (p === '*.sql') return true;
      return name.includes(p);
    })
  );

  if (selectedFiles.length === 0) {
    throw new Error(`No migration files matched: ${patterns.join(', ')}`);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    for (const file of selectedFiles) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf8');
      await client.query(sql);
      console.log(`Applied: ${file}`);
    }
    console.log(`Done. Applied ${selectedFiles.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Migration run failed:', error?.message || error);
  process.exit(1);
});
