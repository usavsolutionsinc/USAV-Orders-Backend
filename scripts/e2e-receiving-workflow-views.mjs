/**
 * E2E Test — Receiving / Testing workflow-status views
 *
 * Validates, end to end, that every inbound `workflow_status` is bucketed into
 * the right rail/list view after the `view=activity` work:
 *
 *   • view=incoming  → only EXPECTED + nothing received yet (the untouched feed)
 *   • view=activity  → everything that's been physically touched, EXCEPT
 *                      untouched-incoming. (Mirrors `view=all`, which keeps
 *                      terminal fails FAILED/RTV/SCRAP in the per-status filters,
 *                      so they are NOT in activity — same as before.)
 *   • view=received  → MATCHED onward (physically in the warehouse)
 *
 * Three layers, strongest last:
 *   1. Registry      — workflow-stages.ts maps every enum value to a stage
 *                      (dot/badge/label/phase), no value falls through.
 *   2. SQL predicate — the exact WHERE clauses the route uses, run against
 *                      seeded rows, prove each status lands in the right bucket.
 *   3. Live API      — (--with-api) mint a real session, hit the real
 *                      /api/receiving-lines route, assert the same bucketing
 *                      through the full withAuth + handler stack.
 *
 * Usage:
 *   node scripts/e2e-receiving-workflow-views.mjs            # registry + SQL layers
 *   node scripts/e2e-receiving-workflow-views.mjs --with-api # also hit the live route
 *                                                            # (boots `next dev` if none reachable)
 *
 * Requires DATABASE_URL. Seeds rows tagged with a sentinel and removes every
 * one of them (plus the throwaway session) on completion or failure.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.resolve(REPO_ROOT, '.env') });
dotenv.config({ path: path.resolve(REPO_ROOT, '.env.local') });

const { Pool } = pg;
const TEST_WITH_API = process.argv.includes('--with-api');
const PORT = Number(process.env.RECEIVING_E2E_PORT || 3211);
const API_BASE = process.env.RECEIVING_E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const BOOT_TIMEOUT_MS = 180_000;

// Sentinel stamped on every seeded row so we never touch real data.
const TAG = `__e2e_wf__${randomBytes(4).toString('hex')}`;
const COOKIE_NAME = 'usav_sid';

let pool;
let seededLineIds = [];
let sessionSid = null;
let serverProc = null;
let passed = 0;
let failed = 0;

// ── Seed plan ────────────────────────────────────────────────────────────────
// key → { status, qtyReceived }. EXPECTED appears twice: the untouched-incoming
// case (qty 0) and the touched edge case (qty 1, status not yet advanced).
const SEED = [
  { key: 'EXPECTED',         status: 'EXPECTED',      qty: 0 },
  { key: 'EXPECTED_TOUCHED', status: 'EXPECTED',      qty: 1 },
  { key: 'ARRIVED',          status: 'ARRIVED',       qty: 1 },
  { key: 'MATCHED',          status: 'MATCHED',       qty: 1 },
  { key: 'UNBOXED',          status: 'UNBOXED',       qty: 1 },
  { key: 'AWAITING_TEST',    status: 'AWAITING_TEST', qty: 1 },
  { key: 'IN_TEST',          status: 'IN_TEST',       qty: 1 },
  { key: 'PASSED',           status: 'PASSED',        qty: 1 },
  { key: 'FAILED',           status: 'FAILED',        qty: 1 },
  { key: 'RTV',              status: 'RTV',           qty: 1 },
  { key: 'SCRAP',            status: 'SCRAP',         qty: 1 },
  { key: 'DONE',             status: 'DONE',          qty: 1 },
];

// Expected membership by seed key. The route's filters drive these.
const EXPECT = {
  incoming: new Set(['EXPECTED']),
  activity: new Set([
    'EXPECTED_TOUCHED', 'ARRIVED', 'MATCHED', 'UNBOXED',
    'AWAITING_TEST', 'IN_TEST', 'PASSED', 'DONE',
  ]),
  received: new Set([
    'MATCHED', 'UNBOXED', 'AWAITING_TEST', 'IN_TEST', 'PASSED', 'DONE',
  ]),
};

// ── Harness helpers ────────────────────────────────────────────────────────
function ok(name) { passed++; console.log(`  ✓ ${name}`); }
function fail(name, err) { failed++; console.error(`  ✗ ${name}: ${err.message}`); }
async function test(name, fn) {
  try { await fn(); ok(name); } catch (err) { fail(name, err); }
}
async function query(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); } finally { client.release(); }
}

// ── Seeding ──────────────────────────────────────────────────────────────────
async function seed() {
  console.log(`\n── Seeding (${TAG}) ──────────────`);
  for (const s of SEED) {
    const { rows } = await query(
      `INSERT INTO receiving_lines
         (zoho_item_id, zoho_purchaseorder_id, item_name, sku,
          quantity_expected, quantity_received, workflow_status, receiving_type)
       VALUES ($1, $2, $3, $4, 1, $5, $6::inbound_workflow_status_enum, 'PO')
       RETURNING id`,
      [
        `${TAG}_item_${s.key}`,
        `${TAG}_PO`,
        `${TAG} ${s.key}`,
        `${TAG}-SKU`,
        s.qty,
        s.status,
      ],
    );
    seededLineIds.push(rows[0].id);
    s.id = rows[0].id;
  }
  console.log(`  seeded ${seededLineIds.length} lines`);
}

// ── 1. Registry layer ────────────────────────────────────────────────────────
async function testRegistry() {
  console.log('\n── Registry (workflow-stages.ts) ──────');

  const STATUSES = SEED.map((s) => s.status).filter((v, i, a) => a.indexOf(v) === i);
  // Dump the registry via tsx — the module is dependency-free so a relative
  // import resolves with no path-alias plumbing.
  const inline = `
    import("./src/lib/receiving/workflow-stages.ts").then((mod) => {
      // tsx's dynamic import() of a TS module puts the named exports under
      // .default (CJS interop); fall back to that when they're not on the
      // namespace directly.
      const m = mod.workflowStage ? mod : (mod.default || mod);
      const keys = ${JSON.stringify([...STATUSES, 'BOGUS_STATUS', null])};
      const out = {};
      for (const k of keys) {
        const st = m.workflowStage(k);
        out[k ?? 'NULL'] = {
          dot: m.workflowStageDot(k), badge: m.workflowStageBadge(k),
          label: st.label, phase: st.phase, order: st.order, status: st.status,
        };
      }
      out.__later = m.isLaterStage('UNBOXED', 'ARRIVED') && !m.isLaterStage('ARRIVED', 'UNBOXED');
      process.stdout.write(JSON.stringify(out));
    });
  `;
  let reg;
  await test('registry module loads + dumps', () => {
    const raw = execFileSync('npx', ['tsx', '-e', inline], {
      cwd: REPO_ROOT, encoding: 'utf-8', timeout: 60_000,
    });
    reg = JSON.parse(raw.trim());
    assert.ok(reg && typeof reg === 'object');
  });

  await test('every enum status resolves to a real stage (no UNKNOWN fall-through)', () => {
    for (const st of STATUSES) {
      const meta = reg[st];
      assert.ok(meta, `missing ${st}`);
      assert.equal(meta.status, st, `${st} resolved to ${meta.status}`);
      assert.ok(/^bg-/.test(meta.dot), `${st} dot not a bg-* class: ${meta.dot}`);
      assert.ok(meta.badge && meta.badge.includes('text-'), `${st} badge missing text color`);
      assert.ok(meta.label && meta.label.length > 0, `${st} has no label`);
      assert.ok(['INBOUND', 'RECEIVING', 'TESTING', 'TERMINAL'].includes(meta.phase),
        `${st} bad phase ${meta.phase}`);
    }
  });

  await test('unknown + null statuses fall back to UNKNOWN stage', () => {
    assert.equal(reg.BOGUS_STATUS.status, 'UNKNOWN');
    assert.equal(reg.NULL.status, 'UNKNOWN');
  });

  await test('phase grouping matches the receiving → testing → terminal lifecycle', () => {
    assert.equal(reg.EXPECTED.phase, 'INBOUND');
    for (const s of ['ARRIVED', 'MATCHED', 'UNBOXED']) assert.equal(reg[s].phase, 'RECEIVING', s);
    for (const s of ['AWAITING_TEST', 'IN_TEST', 'PASSED']) assert.equal(reg[s].phase, 'TESTING', s);
    for (const s of ['FAILED', 'RTV', 'SCRAP', 'DONE']) assert.equal(reg[s].phase, 'TERMINAL', s);
  });

  await test('ordering increases along the happy path (isLaterStage)', () => {
    assert.equal(reg.__later, true);
    assert.ok(reg.ARRIVED.order < reg.MATCHED.order);
    assert.ok(reg.MATCHED.order < reg.UNBOXED.order);
    assert.ok(reg.UNBOXED.order < reg.IN_TEST.order);
  });
}

// ── 2. SQL predicate layer ────────────────────────────────────────────────────
// The exact WHERE clauses from src/app/api/receiving-lines/route.ts. Running
// them against the seeded rows proves the bucketing logic independent of the
// HTTP stack.
const PREDICATES = {
  incoming: `workflow_status = 'EXPECTED'
             AND COALESCE(quantity_received, 0) = 0
             AND zoho_purchaseorder_id IS NOT NULL`,
  activity: `(workflow_status IS NULL OR workflow_status IN
               ('EXPECTED','ARRIVED','MATCHED','UNBOXED','AWAITING_TEST','IN_TEST','PASSED','DONE'))
             AND NOT (workflow_status = 'EXPECTED' AND COALESCE(quantity_received, 0) = 0)`,
  received: `workflow_status IN
               ('MATCHED','UNBOXED','AWAITING_TEST','IN_TEST','PASSED','DONE')`,
};

async function bucketKeysByPredicate(predicate) {
  const { rows } = await query(
    `SELECT item_name FROM receiving_lines
      WHERE zoho_item_id LIKE $1 AND (${predicate})`,
    [`${TAG}_item_%`],
  );
  // item_name is "<TAG> <KEY>"
  return new Set(rows.map((r) => r.item_name.split(' ').pop()));
}

async function testSqlPredicates() {
  console.log('\n── SQL filter predicates ──────────');
  for (const view of ['incoming', 'activity', 'received']) {
    await test(`view=${view} buckets exactly the right statuses`, async () => {
      const got = await bucketKeysByPredicate(PREDICATES[view]);
      assertSetEqual(got, EXPECT[view], view);
    });
  }
  await test('view=activity excludes untouched-incoming (the original bug)', async () => {
    const got = await bucketKeysByPredicate(PREDICATES.activity);
    assert.ok(!got.has('EXPECTED'), 'untouched EXPECTED leaked into activity');
  });
  await test('view=activity keeps EXPECTED once something is received', async () => {
    const got = await bucketKeysByPredicate(PREDICATES.activity);
    assert.ok(got.has('EXPECTED_TOUCHED'), 'received EXPECTED dropped from activity');
  });
}

function assertSetEqual(got, want, label) {
  const missing = [...want].filter((k) => !got.has(k));
  const extra = [...got].filter((k) => !want.has(k));
  assert.ok(
    missing.length === 0 && extra.length === 0,
    `${label}: missing [${missing}] extra [${extra}]`,
  );
}

// ── 3. Live API layer ─────────────────────────────────────────────────────────
async function mintSession() {
  const sid = randomBytes(32).toString('hex');
  const r = await query(
    `INSERT INTO staff_sessions (sid, staff_id, organization_id, device_kind, expires_at)
     SELECT $1, st.id, st.organization_id, 'station', NOW() + INTERVAL '1 hour'
       FROM staff st ORDER BY st.id LIMIT 1
     RETURNING sid, staff_id`,
    [sid],
  );
  assert.ok(r.rows[0], 'no staff row to attach a session to');
  sessionSid = sid;
  return sid;
}

async function serverReachable() {
  try {
    const res = await fetch(`${API_BASE}/api/receiving-lines?limit=1`, {
      signal: AbortSignal.timeout(4000),
    });
    // Up if it answers at all (401 without cookie is expected).
    return res.status === 401 || res.status === 200;
  } catch { return false; }
}

async function bootServer() {
  console.log(`  booting \`next dev\` on :${PORT} (up to ${BOOT_TIMEOUT_MS / 1000}s)...`);
  serverProc = spawn('npm', ['run', 'dev', '--', '--port', String(PORT)], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT) },
    detached: true,
  });
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await serverReachable()) return true;
    await delay(2000);
  }
  return false;
}

async function apiKeys(view) {
  const res = await fetch(`${API_BASE}/api/receiving-lines?view=${view}&limit=500&offset=0`, {
    headers: { cookie: `${COOKIE_NAME}=${sessionSid}` },
  });
  assert.equal(res.status, 200, `view=${view} HTTP ${res.status}`);
  const data = await res.json();
  assert.ok(Array.isArray(data.receiving_lines), `view=${view} missing receiving_lines[]`);
  return new Set(
    data.receiving_lines
      .filter((r) => typeof r.item_name === 'string' && r.item_name.startsWith(TAG))
      .map((r) => r.item_name.split(' ').pop()),
  );
}

async function testLiveApi() {
  if (!TEST_WITH_API) {
    console.log('\n── Live API (skipped — use --with-api) ──');
    return;
  }
  console.log('\n── Live API (/api/receiving-lines) ────');

  let up = await serverReachable();
  if (!up) up = await bootServer();
  if (!up) {
    console.log(`  ⚠ server not reachable at ${API_BASE} — skipping live API layer`);
    return;
  }

  await mintSession();

  await test('GET without cookie → 401', async () => {
    const res = await fetch(`${API_BASE}/api/receiving-lines?limit=1`);
    assert.equal(res.status, 401);
  });

  for (const view of ['incoming', 'activity', 'received']) {
    await test(`live view=${view} buckets exactly the right statuses`, async () => {
      const got = await apiKeys(view);
      assertSetEqual(got, EXPECT[view], `live ${view}`);
    });
  }

  await test('live view=activity excludes untouched-incoming (regression guard)', async () => {
    const got = await apiKeys('activity');
    assert.ok(!got.has('EXPECTED'), 'untouched EXPECTED leaked into live activity feed');
  });
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanup() {
  console.log('\n  cleaning up...');
  try {
    if (seededLineIds.length) {
      await query('DELETE FROM inventory_events WHERE receiving_line_id = ANY($1)', [seededLineIds]);
      await query('DELETE FROM receiving_lines WHERE id = ANY($1)', [seededLineIds]);
    }
    if (sessionSid) {
      await query('DELETE FROM staff_sessions WHERE sid = $1', [sessionSid]);
    }
    console.log('  ✓ cleanup complete');
  } catch (err) {
    console.error('  ✗ cleanup failed:', err.message);
  }
  if (serverProc && serverProc.pid) {
    try { process.kill(-serverProc.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('ERROR: DATABASE_URL not set'); process.exit(1); }

  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 3,
  });

  console.log('═'.repeat(50));
  console.log(' Receiving / Testing workflow-view E2E');
  console.log('═'.repeat(50));
  console.log(`  DB: ${url.replace(/:[^:@]+@/, ':***@')}`);
  if (TEST_WITH_API) console.log(`  API: ${API_BASE}`);

  try {
    await seed();
    await testRegistry();
    await testSqlPredicates();
    await testLiveApi();
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log('\n' + '═'.repeat(50));
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(50) + '\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  try { await cleanup(); } catch { /* best effort */ }
  process.exit(1);
});
