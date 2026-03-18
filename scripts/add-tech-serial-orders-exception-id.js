#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
const { Client } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in .env');
  }

  const file = path.resolve(
    process.cwd(),
    'src/lib/migrations/2026-03-17_tech_serial_numbers_add_orders_exception_id.sql'
  );
  const sql = fs.readFileSync(file, 'utf8');

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(sql);
    console.log('Applied migration:', path.basename(file));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
