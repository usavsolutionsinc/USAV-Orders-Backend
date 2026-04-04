#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const migrationPath = path.resolve(
    process.cwd(),
    'src/lib/migrations'
  );
  const migrationFiles = fs
    .readdirSync(migrationPath)
    .filter((name) => name.includes('product_manuals'))
    .sort((a, b) => {
      const getPriority = (name) => {
        if (name.includes('create_product_manuals')) return 0;
        if (name.includes('align_product_manuals')) return 1;
        if (name.includes('rename_manual_version_to_type')) return 2;
        return 3;
      };
      const priorityDiff = getPriority(a) - getPriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      const aIsAlign = a.includes('align_product_manuals');
      const bIsAlign = b.includes('align_product_manuals');
      if (aIsAlign && !bIsAlign) return -1;
      if (!aIsAlign && bIsAlign) return 1;
      return a.localeCompare(b);
    });
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in environment/.env');
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    for (const fileName of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationPath, fileName), 'utf8');
      await client.query(sql);
      console.log(`Applied: ${fileName}`);
    }
    console.log('product_manuals schema migrations applied successfully.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Failed to apply product_manuals schema migrations:', err.message || err);
  process.exit(1);
});
