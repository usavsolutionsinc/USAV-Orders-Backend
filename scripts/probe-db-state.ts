import { Pool } from 'pg';
const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  const tables = await pool.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'sku', 'sku_stock', 'sku_stock_ledger', 'sku_catalog',
        'sku_platform_ids', 'serial_units', 'photos',
        'receiving_lines', 'locations', 'location_transfers',
        'shipping_tracking_numbers', 'orders', 'staff', 'packer_logs',
        'tech_serial_numbers', 'station_activity_logs'
      )
    ORDER BY tablename`);

  const enums = await pool.query(`
    SELECT typname FROM pg_type WHERE typtype = 'e'
      AND typname IN ('serial_status_enum', 'condition_grade_enum', 'inbound_workflow_status_enum')`);

  const views = await pool.query(`
    SELECT viewname FROM pg_views WHERE schemaname = 'public'
      AND viewname IN ('v_sku', 'v_sku_stock_drift')`);

  const triggers = await pool.query(`
    SELECT tgname, tgrelid::regclass AS target FROM pg_trigger
     WHERE NOT tgisinternal AND tgname IN (
       'trg_block_sku_inserts',
       'trg_sku_stock_from_ledger',
       'trg_delete_photos_on_serial_unit_delete'
     )`);

  console.log('Tables present:', tables.rows.map((r) => r.tablename));
  console.log('Enums present: ', enums.rows.map((r) => r.typname));
  console.log('Views present: ', views.rows.map((r) => r.viewname));
  console.log('Triggers:      ', triggers.rows);

  const counts: Record<string, number> = {};
  for (const t of ['sku', 'sku_stock', 'sku_stock_ledger']) {
    if (!tables.rows.find((r) => r.tablename === t)) continue;
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    counts[t] = r.rows[0].n;
  }
  console.log('Row counts:    ', counts);

  await pool.end();
}

main().catch((e) => { console.error(e); pool.end(); process.exit(1); });
