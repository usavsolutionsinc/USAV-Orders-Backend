const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve('.env'), quiet: true });
const { Client } = require('pg');

const MIGRATIONS = [
  'src/lib/migrations/2026-03-05_receiving_qa_and_zoho_fields.sql',
  'src/lib/migrations/2026-03-09_receiving_add_purchaseorder_columns.sql',
  'src/lib/migrations/2026-03-09_receiving_lines_nullable_receiving_id.sql',
  'src/lib/migrations/2026-03-09_receiving_lines_workflow.sql',
  'src/lib/migrations/2026-03-10_shipping_backbone.sql',
  'src/lib/migrations/2026-03-17_create_sync_cursors.sql',
  'src/lib/migrations/2026-03-17_improve_customers_table_for_zoho.sql',
  'src/lib/migrations/2026-03-17_create_zoho_domain_tables.sql',
  'src/lib/migrations/2026-03-17_zoho_receiving_lines_sync_metadata.sql',
  'src/lib/migrations/2026-03-17_create_local_pickup_items.sql',
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    for (const relativeFile of MIGRATIONS) {
      const file = path.resolve(relativeFile);
      const sql = fs.readFileSync(file, 'utf8');
      await client.query(sql);
      console.log(`Applied migration: ${path.basename(file)}`);
    }
    console.log('Receiving and Zoho inventory table migrations completed.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
