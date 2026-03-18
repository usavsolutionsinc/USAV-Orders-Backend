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

  const file = path.resolve(
    process.cwd(),
    'src/lib/migrations/2026-03-17_create_replenishment_subsystem.sql'
  );

  if (!fs.existsSync(file)) {
    throw new Error(`Migration file not found: ${file}`);
  }

  const sql = fs.readFileSync(file, 'utf8');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(sql);
    await client.query(`
      DROP TABLE IF EXISTS order_tasks;
      DROP TABLE IF EXISTS orders_task;
    `);
    console.log(`Applied: ${path.basename(file)}`);
    console.log('Ensured: replenishment_order_lines exists');
    console.log('Dropped: order_tasks / orders_task if present');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Replenishment table creation failed:', error?.message || error);
  process.exit(1);
});
