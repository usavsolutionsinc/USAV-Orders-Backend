/**
 * Migration: Receiving + ReceivingLines schema cleanup
 *
 * receiving:
 *   - make condition_grade nullable (it's per-item, not per-shipment for PO receives)
 *   - make disposition_code nullable (same reason)
 *   - add notes TEXT column (already used in code but missing from schema)
 *
 * receiving_lines:
 *   - rename quantity → quantity_received (semantic clarity)
 *   - add item_name TEXT          (product name from Zoho)
 *   - add sku TEXT                (SKU from Zoho)
 *   - add quantity_expected INT   (ordered qty from the PO line)
 *   - add zoho_line_item_id TEXT  (Zoho PO line_item_id reference)
 *   - add zoho_purchase_receive_id TEXT (which Zoho receive record)
 *   - add notes TEXT
 *   - add created_at TIMESTAMPTZ  (backfill from parent receiving row)
 *   - add performance indexes
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';

const ok   = (msg) => console.log(`${GREEN}  ✓ ${msg}${RESET}`);
const skip = (msg) => console.log(`${YELLOW}  ○ ${msg} (already exists / no-op)${RESET}`);
const info = (msg) => console.log(`${CYAN}  → ${msg}${RESET}`);
const fail = (msg) => console.log(`${RED}  ✗ ${msg}${RESET}`);

async function colExists(client, table, column) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return r.rows.length > 0;
}

async function colNullable(client, table, column) {
  const r = await client.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return r.rows[0]?.is_nullable === 'YES';
}

async function indexExists(client, indexName) {
  const r = await client.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = $1`,
    [indexName]
  );
  return r.rows.length > 0;
}

async function run() {
  const client = await pool.connect();
  try {
    // ── Introspect current state ──────────────────────────────────────────────
    console.log(`\n${CYAN}=== Current schema snapshot ===${RESET}`);

    const receivingCols = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'receiving'
       ORDER BY ordinal_position`
    );
    info(`receiving columns (${receivingCols.rows.length}):`);
    receivingCols.rows.forEach(r =>
      console.log(`     ${r.column_name.padEnd(32)} ${r.data_type.padEnd(22)} nullable=${r.is_nullable} default=${r.column_default ?? 'null'}`)
    );

    const linesCols = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'receiving_lines'
       ORDER BY ordinal_position`
    );
    info(`receiving_lines columns (${linesCols.rows.length}):`);
    linesCols.rows.forEach(r =>
      console.log(`     ${r.column_name.padEnd(32)} ${r.data_type.padEnd(22)} nullable=${r.is_nullable} default=${r.column_default ?? 'null'}`)
    );

    await client.query('BEGIN');

    // ── 1. receiving: make condition_grade nullable ───────────────────────────
    console.log(`\n${CYAN}=== Migrating: receiving table ===${RESET}`);

    if (await colExists(client, 'receiving', 'condition_grade')) {
      if (await colNullable(client, 'receiving', 'condition_grade')) {
        skip('receiving.condition_grade already nullable');
      } else {
        await client.query(`ALTER TABLE receiving ALTER COLUMN condition_grade DROP NOT NULL`);
        await client.query(`ALTER TABLE receiving ALTER COLUMN condition_grade DROP DEFAULT`);
        ok('receiving.condition_grade → nullable, default removed');
      }
    } else {
      await client.query(`ALTER TABLE receiving ADD COLUMN condition_grade TEXT`);
      ok('receiving.condition_grade added as TEXT nullable');
    }

    // ── 2. receiving: make disposition_code nullable ──────────────────────────
    if (await colExists(client, 'receiving', 'disposition_code')) {
      if (await colNullable(client, 'receiving', 'disposition_code')) {
        skip('receiving.disposition_code already nullable');
      } else {
        await client.query(`ALTER TABLE receiving ALTER COLUMN disposition_code DROP NOT NULL`);
        await client.query(`ALTER TABLE receiving ALTER COLUMN disposition_code DROP DEFAULT`);
        ok('receiving.disposition_code → nullable, default removed');
      }
    } else {
      await client.query(`ALTER TABLE receiving ADD COLUMN disposition_code TEXT`);
      ok('receiving.disposition_code added as TEXT nullable');
    }

    // ── 3. receiving: add notes column ────────────────────────────────────────
    if (await colExists(client, 'receiving', 'notes')) {
      skip('receiving.notes already exists');
    } else {
      await client.query(`ALTER TABLE receiving ADD COLUMN notes TEXT`);
      ok('receiving.notes added');
    }

    // ── 4. receiving_lines: rename quantity → quantity_received ───────────────
    console.log(`\n${CYAN}=== Migrating: receiving_lines table ===${RESET}`);

    const hasQty     = await colExists(client, 'receiving_lines', 'quantity');
    const hasQtyRecv = await colExists(client, 'receiving_lines', 'quantity_received');

    if (hasQty && !hasQtyRecv) {
      await client.query(`ALTER TABLE receiving_lines RENAME COLUMN quantity TO quantity_received`);
      ok('receiving_lines.quantity renamed → quantity_received');
    } else if (hasQtyRecv) {
      skip('receiving_lines.quantity_received already exists');
      if (hasQty) {
        // Both exist — drop the old one if quantity_received has data
        const cnt = await client.query(`SELECT COUNT(*) AS c FROM receiving_lines WHERE quantity_received IS NULL AND quantity IS NOT NULL`);
        if (parseInt(cnt.rows[0].c) > 0) {
          await client.query(`UPDATE receiving_lines SET quantity_received = quantity WHERE quantity_received IS NULL`);
          ok(`receiving_lines: backfilled ${cnt.rows[0].c} rows quantity → quantity_received`);
        }
        // Safe to drop old column now
        await client.query(`ALTER TABLE receiving_lines DROP COLUMN quantity`);
        ok('receiving_lines.quantity (old column) dropped');
      }
    } else {
      // Neither exists — shouldn't happen but handle gracefully
      await client.query(`ALTER TABLE receiving_lines ADD COLUMN quantity_received INTEGER NOT NULL DEFAULT 0`);
      ok('receiving_lines.quantity_received added (fresh)');
    }

    // ── 5. receiving_lines: add Zoho inventory identity fields ───────────────
    const newLineCols = [
      { col: 'item_name',               def: 'TEXT' },
      { col: 'sku',                     def: 'TEXT' },
      { col: 'quantity_expected',       def: 'INTEGER' },
      { col: 'zoho_line_item_id',       def: 'TEXT' },
      { col: 'zoho_purchase_receive_id',def: 'TEXT' },
      { col: 'notes',                   def: 'TEXT' },
      { col: 'created_at',              def: 'TIMESTAMPTZ NOT NULL DEFAULT now()' },
    ];

    for (const { col, def } of newLineCols) {
      if (await colExists(client, 'receiving_lines', col)) {
        skip(`receiving_lines.${col} already exists`);
      } else {
        await client.query(`ALTER TABLE receiving_lines ADD COLUMN ${col} ${def}`);
        ok(`receiving_lines.${col} added`);
      }
    }

    // Backfill created_at from parent receiving row for existing rows
    const backfillResult = await client.query(`
      UPDATE receiving_lines rl
      SET created_at = r.created_at
      FROM receiving r
      WHERE rl.receiving_id = r.id
        AND rl.created_at = rl.created_at  -- will update all rows since default was just now()
        AND r.created_at < now() - interval '1 minute'
    `);
    if (backfillResult.rowCount > 0) {
      ok(`receiving_lines.created_at backfilled from receiving for ${backfillResult.rowCount} rows`);
    }

    // ── 6. Add performance indexes ────────────────────────────────────────────
    console.log(`\n${CYAN}=== Adding indexes ===${RESET}`);

    const indexes = [
      {
        name: 'idx_receiving_lines_receiving_id',
        sql:  'CREATE INDEX IF NOT EXISTS idx_receiving_lines_receiving_id ON receiving_lines(receiving_id)'
      },
      {
        name: 'idx_receiving_lines_zoho_item_id',
        sql:  'CREATE INDEX IF NOT EXISTS idx_receiving_lines_zoho_item_id ON receiving_lines(zoho_item_id)'
      },
      {
        name: 'idx_receiving_lines_sku',
        sql:  "CREATE INDEX IF NOT EXISTS idx_receiving_lines_sku ON receiving_lines(sku) WHERE sku IS NOT NULL"
      },
      {
        name: 'idx_receiving_lines_zoho_purchase_receive_id',
        sql:  "CREATE INDEX IF NOT EXISTS idx_receiving_lines_zoho_purchase_receive_id ON receiving_lines(zoho_purchase_receive_id) WHERE zoho_purchase_receive_id IS NOT NULL"
      },
      {
        name: 'idx_receiving_zoho_purchase_receive_id',
        sql:  "CREATE INDEX IF NOT EXISTS idx_receiving_zoho_purchase_receive_id ON receiving(zoho_purchase_receive_id) WHERE zoho_purchase_receive_id IS NOT NULL"
      },
    ];

    for (const { name, sql } of indexes) {
      if (await indexExists(client, name)) {
        skip(`index ${name} already exists`);
      } else {
        await client.query(sql);
        ok(`index ${name} created`);
      }
    }

    await client.query('COMMIT');

    // ── Final schema snapshot ─────────────────────────────────────────────────
    console.log(`\n${CYAN}=== Post-migration schema snapshot ===${RESET}`);

    const finalReceiving = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'receiving'
       ORDER BY ordinal_position`
    );
    info(`receiving (${finalReceiving.rows.length} columns):`);
    finalReceiving.rows.forEach(r =>
      console.log(`     ${r.column_name.padEnd(32)} ${r.data_type.padEnd(22)} nullable=${r.is_nullable}`)
    );

    const finalLines = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'receiving_lines'
       ORDER BY ordinal_position`
    );
    info(`receiving_lines (${finalLines.rows.length} columns):`);
    finalLines.rows.forEach(r =>
      console.log(`     ${r.column_name.padEnd(32)} ${r.data_type.padEnd(22)} nullable=${r.is_nullable}`)
    );

    console.log(`\n${GREEN}=== Migration complete ✓ ===${RESET}\n`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(`Migration failed — rolled back`);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
