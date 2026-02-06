import 'dotenv/config';
import { Client } from 'pg';

const sql = `
BEGIN;

CREATE TABLE IF NOT EXISTS packer_logs (
  id SERIAL PRIMARY KEY,
  shipping_tracking_number TEXT NOT NULL,
  tracking_type VARCHAR(20) NOT NULL,
  pack_date_time TIMESTAMP,
  packed_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  packer_photos_url JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_packer_logs_tracking ON packer_logs (shipping_tracking_number);
CREATE INDEX IF NOT EXISTS idx_packer_logs_pack_date_time ON packer_logs (pack_date_time DESC);
CREATE INDEX IF NOT EXISTS idx_packer_logs_packed_by ON packer_logs (packed_by);

COMMIT;
`;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in .env');
  }

  const client = new Client({ connectionString, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false });
  try {
    await client.connect();
    await client.query(sql);
    console.log('packer_logs table ensured.');
  } catch (err) {
    try {
      await client.query('ROLLBACK;');
    } catch {}
    console.error('Failed to create packer_logs:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void main();
