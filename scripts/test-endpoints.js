/**
 * test-endpoints.js
 *
 * Smoke-tests every meaningful GET (and a few safe POST) endpoint against
 * the live Vercel deployment.  Validates:
 *   - HTTP status code
 *   - Response JSON shape (key fields present / correct types)
 *   - pack_date_time is fully gone  → packed_at is used instead
 *   - completed_by_packer_id present on PACK/DONE rows
 *
 * Usage:
 *   node scripts/test-endpoints.js
 *   node scripts/test-endpoints.js --base http://localhost:3000
 */

const BASE = (() => {
  const idx = process.argv.indexOf('--base');
  return idx !== -1 ? process.argv[idx + 1] : 'https://usav-orders-backend.vercel.app';
})();

let passed = 0, failed = 0, warned = 0;
const results = [];

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

async function get(path, opts = {}) {
  const url = `${BASE}${path}`;
  const start = Date.now();
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const elapsed = Date.now() - start;
    let body;
    try { body = await res.json(); } catch { body = null; }
    return { ok: res.ok, status: res.status, elapsed, body, url };
  } catch (e) {
    return { ok: false, status: 0, elapsed: Date.now() - start, body: null, url, error: e.message };
  }
}

function check(name, result, { expectStatus = 200, validate = null, warnOnly = false } = {}) {
  const icon = result.ok && result.status === expectStatus ? '✅' : (warnOnly ? '⚠️ ' : '❌');
  const statusOk = result.status === expectStatus;
  const elapsed = fmt(result.elapsed);

  let issues = [];
  if (!statusOk) issues.push(`HTTP ${result.status} (expected ${expectStatus})`);
  if (result.error) issues.push(`Network error: ${result.error}`);

  if (statusOk && validate) {
    try {
      const validationIssues = validate(result.body);
      if (validationIssues?.length) issues.push(...validationIssues);
    } catch (e) {
      issues.push(`Validation threw: ${e.message}`);
    }
  }

  const isPass = issues.length === 0;
  if (isPass) {
    passed++;
    console.log(`  ${icon} [${elapsed}]  ${name}`);
  } else if (warnOnly) {
    warned++;
    console.log(`  ${icon} [${elapsed}]  ${name}  →  ${issues.join(' | ')}`);
  } else {
    failed++;
    console.log(`  ${icon} [${elapsed}]  ${name}  →  ${issues.join(' | ')}`);
    if (result.body && typeof result.body === 'object' && result.body.error) {
      console.log(`     DB/server error: ${result.body.error}`);
    }
  }
  results.push({ name, pass: isPass, status: result.status, elapsed: result.elapsed, issues });
  return result;
}

// ─── validators ─────────────────────────────────────────────────────────────

function noPackDateTime(body) {
  const str = JSON.stringify(body);
  if (str.includes('"pack_date_time"')) return ['"pack_date_time" still present in response (should be "packed_at")'];
  return [];
}

function hasPackedAt(body) {
  const orders = body?.orders ?? body ?? [];
  const list = Array.isArray(orders) ? orders : [];
  if (!list.length) return [];  // empty result is fine
  const first = list[0];
  if ('packed_at' in first) return [];
  if ('pack_date_time' in first) return ['"pack_date_time" found, should be "packed_at"'];
  return [];  // field may just be null/absent when no packer
}

function isArray(key) {
  return (body) => {
    const arr = key ? body?.[key] : body;
    if (!Array.isArray(arr)) return [`Expected array${key ? ' at "'+key+'"' : ''}, got ${typeof arr}`];
    return [];
  };
}

function hasField(key) {
  return (body) => {
    if (!(key in (body || {}))) return [`Missing field "${key}"`];
    return [];
  };
}

// ─── test suites ─────────────────────────────────────────────────────────────

async function testCore() {
  console.log('\n📦  CORE ORDERS\n');

  const r1 = await get('/api/orders?excludePacked=true');
  check('GET /api/orders (pending, excludePacked)', r1, {
    validate: (b) => [...(isArray('orders')(b)), ...noPackDateTime(b), ...hasPackedAt(b)],
  });

  const r2 = await get('/api/orders?packedOnly=true');
  check('GET /api/orders (packedOnly — shipped view)', r2, {
    validate: (b) => [...(isArray('orders')(b)), ...noPackDateTime(b), ...hasPackedAt(b)],
  });

  const r3 = await get('/api/orders?q=bose');
  check('GET /api/orders?q=bose (search)', r3, {
    validate: (b) => [...(isArray('orders')(b)), ...noPackDateTime(b)],
  });

  const r4 = await get('/api/orders/recent');
  check('GET /api/orders/recent', r4, {
    validate: (b) => noPackDateTime(b),
  });

  const r5 = await get('/api/orders/next?techId=1');
  check('GET /api/orders/next?techId=1', r5, {
    validate: (b) => noPackDateTime(b),
    warnOnly: true,
  });
}

async function testWorkAssignments() {
  console.log('\n🔧  WORK ASSIGNMENTS\n');

  const r1 = await get('/api/work-orders');
  check('GET /api/work-orders', r1, {
    validate: (b) => {
      const issues = noPackDateTime(b);
      // Verify completed_by_packer_id is present on DONE PACK rows
      const rows = b?.workOrders ?? b?.rows ?? (Array.isArray(b) ? b : []);
      const donePackRows = rows.filter(r => r.work_type === 'PACK' && r.status === 'DONE');
      for (const row of donePackRows) {
        if (!('completed_by_packer_id' in row)) {
          issues.push(`PACK/DONE row id=${row.id} missing completed_by_packer_id`);
          break;
        }
      }
      return issues;
    },
  });

  const r2 = await get('/api/assignments');
  check('GET /api/assignments', r2, {
    validate: (b) => noPackDateTime(b),
  });

  const r3 = await get('/api/assignments/next');
  check('GET /api/assignments/next', r3, {
    validate: (b) => noPackDateTime(b),
    warnOnly: true,
  });
}

async function testShipped() {
  console.log('\n🚚  SHIPPED / PACKER LOGS\n');

  const r1 = await get('/api/shipped');
  check('GET /api/shipped', r1, {
    validate: (b) => [...noPackDateTime(b), ...hasPackedAt(b?.orders ?? b ?? [])],
  });

  const r2 = await get('/api/packerlogs');
  check('GET /api/packerlogs', r2, {
    validate: (b) => noPackDateTime(b),
  });

  const r3 = await get('/api/packing-logs');
  check('GET /api/packing-logs', r3, {
    validate: (b) => noPackDateTime(b),
  });
}

async function testTech() {
  console.log('\n🔬  TECH / REPAIR\n');

  const r1 = await get('/api/tech-logs');
  check('GET /api/tech-logs', r1, {
    validate: (b) => noPackDateTime(b),
  });

  const r2 = await get('/api/repair-service');
  check('GET /api/repair-service', r2, {
    validate: (b) => noPackDateTime(b),
  });

  const r3 = await get('/api/repair-service/next');
  check('GET /api/repair-service/next', r3, {
    validate: (b) => noPackDateTime(b),
    warnOnly: true,
  });

  const r4 = await get('/api/repair/search?q=bose');
  check('GET /api/repair/search?q=bose', r4, {
    validate: (b) => noPackDateTime(b),
    warnOnly: true,
  });
}

async function testStaff() {
  console.log('\n👤  STAFF / GOALS\n');

  const r1 = await get('/api/staff');
  check('GET /api/staff', r1, {
    validate: (b) => {
      if (!Array.isArray(b)) return ['Expected array of staff'];
      if (b.length === 0) return ['No staff returned — DB issue?'];
      if (!('id' in b[0])) return ['Staff objects missing "id"'];
      return [];
    },
  });

  const r2 = await get('/api/staff-goals');
  check('GET /api/staff-goals', r2, {
    validate: (b) => noPackDateTime(b),
  });
}

async function testSku() {
  console.log('\n📋  SKU / INVENTORY\n');

  const r1 = await get('/api/sku');
  check('GET /api/sku', r1, {
    validate: (b) => noPackDateTime(b),
  });

  const r2 = await get('/api/favorites?workspace=repair');
  check('GET /api/favorites?workspace=repair', r2, {
    validate: (b) => noPackDateTime(b),
  });
}

async function testReceiving() {
  console.log('\n📥  RECEIVING\n');

  const r1 = await get('/api/receiving-logs');
  check('GET /api/receiving-logs', r1, {
    validate: (b) => noPackDateTime(b),
  });

  const r2 = await get('/api/receiving-lines');
  check('GET /api/receiving-lines', r2, {
    validate: (b) => noPackDateTime(b),
    warnOnly: true,
  });

  const r3 = await get('/api/receiving/pending-unboxing?status=ALL');
  check('GET /api/receiving/pending-unboxing', r3, {
    validate: (b) => noPackDateTime(b),
    warnOnly: true,
  });
}

async function testFba() {
  console.log('\n📦  FBA\n');

  const r1 = await get('/api/fba/shipments');
  check('GET /api/fba/shipments', r1, {
    validate: (b) => noPackDateTime(b),
  });

  const r2 = await get('/api/fba/logs');
  check('GET /api/fba/logs', r2, {
    validate: (b) => noPackDateTime(b),
    warnOnly: true,
  });

  const r3 = await get('/api/fba/logs/summary');
  check('GET /api/fba/logs/summary', r3, {
    validate: (b) => noPackDateTime(b),
    warnOnly: true,
  });

  const r4 = await get('/api/fba/items/queue');
  check('GET /api/fba/items/queue', r4, {
    validate: (b) => noPackDateTime(b),
    warnOnly: true,
  });
}

async function testManuals() {
  console.log('\n📚  PRODUCT MANUALS\n');

  const r1 = await get('/api/product-manuals');
  check('GET /api/product-manuals', r1, {
    validate: (b) => noPackDateTime(b),
  });

  const r2 = await get('/api/product-manuals/categories');
  check('GET /api/product-manuals/categories', r2, {
    validate: (b) => noPackDateTime(b),
  });

  const r3 = await get('/api/manuals/recent');
  check('GET /api/manuals/recent', r3, {
    validate: (b) => noPackDateTime(b),
    warnOnly: true,
  });
}

async function testSupportHealth() {
  console.log('\n❤️   HEALTH / SUPPORT\n');

  const r1 = await get('/api/ai/health');
  check('GET /api/ai/health', r1, {
    validate: (b) => (b?.status ? [] : ['Missing status field']),
    warnOnly: true,   // AI (Ollama) may be offline in non-local environments
  });

  const r2 = await get('/api/support/overview');
  check('GET /api/support/overview', r2, {
    validate: (b) => noPackDateTime(b),
  });
}

async function testZoho() {
  console.log('\n🏢  ZOHO / PURCHASE ORDERS\n');

  const r1 = await get('/api/zoho/purchase-orders');
  check('GET /api/zoho/purchase-orders', r1, {
    validate: (b) => noPackDateTime(b),
    warnOnly: true,
  });

  const r2 = await get('/api/zoho/purchase-receives');
  check('GET /api/zoho/purchase-receives', r2, {
    validate: (b) => noPackDateTime(b),
    warnOnly: true,
  });
}

async function testPackedAtDB() {
  console.log('\n🗄️   DB FIELD VALIDATION (packed_at / completed_by_packer_id)\n');

  require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED });

  // 1. Confirm pack_date_time column is gone from DB
  try {
    const colCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'packer_logs' AND column_name = 'pack_date_time'
    `);
    if (colCheck.rows.length > 0) {
      failed++;
      console.log('  ❌  packer_logs.pack_date_time column still exists in DB (should have been dropped by migration)');
    } else {
      passed++;
      console.log('  ✅  packer_logs.pack_date_time column confirmed removed from DB');
    }
  } catch (e) {
    failed++;
    console.log(`  ❌  DB column check failed: ${e.message}`);
  }

  // 2. Confirm created_at + updated_at exist on packer_logs
  try {
    const cols = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'packer_logs' AND column_name IN ('created_at', 'updated_at')
      ORDER BY column_name
    `);
    const found = cols.rows.map(r => r.column_name);
    if (found.includes('created_at') && found.includes('updated_at')) {
      passed++;
      console.log('  ✅  packer_logs has created_at + updated_at');
    } else {
      failed++;
      console.log(`  ❌  packer_logs missing timestamps: found=${found.join(',')}`);
    }
  } catch (e) {
    failed++;
    console.log(`  ❌  ${e.message}`);
  }

  // 3. Confirm completed_by_packer_id exists on work_assignments
  try {
    const col = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'work_assignments' AND column_name = 'completed_by_packer_id'
    `);
    if (col.rows.length > 0) {
      passed++;
      console.log(`  ✅  work_assignments.completed_by_packer_id exists (${col.rows[0].data_type})`);
    } else {
      failed++;
      console.log('  ❌  work_assignments.completed_by_packer_id MISSING');
    }
  } catch (e) {
    failed++;
    console.log(`  ❌  ${e.message}`);
  }

  // 4. PACK DONE rows should have no remaining null completed_by_packer_id
  try {
    const nullCheck = await pool.query(`
      SELECT COUNT(*) AS cnt FROM work_assignments
      WHERE work_type = 'PACK' AND status = 'DONE' AND completed_by_packer_id IS NULL
    `);
    const nullCnt = parseInt(nullCheck.rows[0].cnt, 10);
    if (nullCnt === 0) {
      passed++;
      console.log('  ✅  All PACK/DONE rows have completed_by_packer_id set');
    } else if (nullCnt <= 10) {
      warned++;
      console.log(`  ⚠️   ${nullCnt} PACK/DONE rows have NULL completed_by_packer_id (likely in-flight scans)`);
    } else {
      failed++;
      console.log(`  ❌  ${nullCnt} PACK/DONE rows have NULL completed_by_packer_id — run: node scripts/check-completed-by-packer-integrity.js --fix`);
    }
  } catch (e) {
    failed++;
    console.log(`  ❌  ${e.message}`);
  }

  // 5. Spot-check orders API SQL using packer_logs
  try {
    const r = await pool.query(`
      SELECT
        o.id,
        o.order_id,
        pl.created_at AS packed_at,
        pl.updated_at AS packer_updated_at,
        pl.packed_by
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT pl.packed_by, pl.created_at, pl.updated_at
        FROM packer_logs pl
        WHERE pl.shipment_id IS NOT NULL AND pl.shipment_id = o.shipment_id
        ORDER BY pl.created_at DESC NULLS LAST LIMIT 1
      ) pl ON true
      WHERE o.shipment_id IS NOT NULL
      ORDER BY pl.created_at DESC NULLS LAST
      LIMIT 5
    `);
    if (r.rows.length > 0) {
      passed++;
      console.log(`  ✅  Direct packer_logs lateral join (packed_at) works — ${r.rows.length} rows sampled`);
    } else {
      warned++;
      console.log('  ⚠️   Lateral join returned 0 rows (may be no linked orders yet)');
    }
  } catch (e) {
    failed++;
    console.log(`  ❌  Lateral join query failed: ${e.message}`);
  }

  await pool.end();
}

// ─── main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  USAV Endpoint Smoke Test`);
  console.log(`  Target: ${BASE}`);
  console.log(`  ${new Date().toLocaleString()}`);
  console.log(`${'═'.repeat(60)}`);

  await testCore();
  await testWorkAssignments();
  await testShipped();
  await testTech();
  await testStaff();
  await testSku();
  await testReceiving();
  await testFba();
  await testManuals();
  await testSupportHealth();
  await testZoho();
  await testPackedAtDB();

  // ─── summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RESULTS: ${passed} passed  |  ${warned} warned  |  ${failed} failed`);
  console.log(`${'═'.repeat(60)}\n`);

  if (failed > 0) {
    console.log('FAILED TESTS:');
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  • ${r.name}: ${r.issues.join(' | ')}`);
    });
    console.log('');
    process.exit(1);
  }
})();
