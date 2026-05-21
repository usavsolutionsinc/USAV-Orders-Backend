import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const envText = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env', 'utf8');
const m = envText.match(/^DATABASE_URL_UNPOOLED=(.+)$/m) || envText.match(/^DATABASE_URL=(.+)$/m);
if (!m) throw new Error('no DATABASE_URL found');
const url = m[1].trim().replace(/^["']|["']$/g, '');
const sql = neon(url);

const PICK_KEYWORDS = ['pick', 'pack', 'allocation', 'wave', 'tote', 'fulfill', 'short_pick', 'session'];

async function main() {
  // 1. Every table in public + any picker-related table by name.
  const tables = await sql`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog','information_schema')
    ORDER BY table_schema, table_name
  `;

  const matching = tables.filter(t => PICK_KEYWORDS.some(k => t.table_name.toLowerCase().includes(k)));
  console.log('\n=== ALL TABLES (' + tables.length + ') ===');
  for (const t of tables) console.log(`  ${t.table_schema}.${t.table_name}`);

  console.log('\n=== PICKER/PACK/ALLOCATION-RELATED TABLES (' + matching.length + ') ===');
  for (const t of matching) {
    console.log(`\n  ── ${t.table_schema}.${t.table_name} ──`);
    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = ${t.table_schema} AND table_name = ${t.table_name}
      ORDER BY ordinal_position
    `;
    for (const c of cols) {
      const nn = c.is_nullable === 'NO' ? 'NOT NULL' : 'NULL';
      const def = c.column_default ? ` DEFAULT ${c.column_default}` : '';
      console.log(`    ${c.column_name.padEnd(34)} ${c.data_type.padEnd(28)} ${nn}${def}`);
    }
    const idx = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = ${t.table_schema} AND tablename = ${t.table_name}
      ORDER BY indexname
    `;
    if (idx.length) {
      console.log('    -- indexes --');
      for (const i of idx) console.log(`    ${i.indexname}: ${i.indexdef}`);
    }
    const cnt = await sql.query(`SELECT COUNT(*)::int AS n FROM "${t.table_schema}"."${t.table_name}"`);
    console.log(`    row_count = ${cnt[0].n}`);
  }

  // 2. Columns named picker/pick anywhere (in case the table itself doesn't have those words).
  console.log('\n=== COLUMNS NAMED LIKE picker/pick/allocation/short ===');
  const cols = await sql`
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog','information_schema')
      AND (column_name ILIKE '%pick%' OR column_name ILIKE '%alloc%' OR column_name ILIKE '%short_pick%' OR column_name ILIKE '%wave%' OR column_name ILIKE '%tote%')
    ORDER BY table_schema, table_name, column_name
  `;
  for (const c of cols) console.log(`  ${c.table_schema}.${c.table_name}.${c.column_name} :: ${c.data_type}`);

  // 3. Allocation state values currently in use.
  const allocExists = matching.some(t => t.table_name === 'order_unit_allocations');
  if (allocExists) {
    console.log('\n=== order_unit_allocations state breakdown ===');
    const states = await sql`SELECT state, COUNT(*)::int AS n FROM order_unit_allocations GROUP BY state ORDER BY n DESC`;
    for (const s of states) console.log(`  ${s.state.padEnd(12)} ${s.n}`);
    const recent = await sql`SELECT id, order_id, serial_unit_id, state, allocated_at, released_at FROM order_unit_allocations ORDER BY id DESC LIMIT 5`;
    console.log('\n  Recent rows:');
    for (const r of recent) console.log(`  ${JSON.stringify(r)}`);
  }

  // 4. inventory_events event_type histogram (picker-relevant transitions).
  const ievExists = tables.some(t => t.table_name === 'inventory_events');
  if (ievExists) {
    console.log('\n=== inventory_events event_type breakdown ===');
    const types = await sql`SELECT event_type, COUNT(*)::int AS n FROM inventory_events GROUP BY event_type ORDER BY n DESC`;
    for (const t of types) console.log(`  ${t.event_type.padEnd(20)} ${t.n}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
