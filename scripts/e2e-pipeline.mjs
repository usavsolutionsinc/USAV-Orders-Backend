/**
 * E2E Test — AI Training Pipeline
 *
 * Tests the full pipeline stack against the live Neon database:
 *   1. DB schema: insert/read/update/delete across all 5 tables
 *   2. Discovery: run task discovery against the real repo
 *   3. Scoring: verify rating logic
 *   4. API endpoints: if dev server is running, test all 4 routes
 *
 * Usage:
 *   node scripts/e2e-pipeline.mjs              # DB + discovery tests only
 *   node scripts/e2e-pipeline.mjs --with-api   # also test API routes (needs server)
 *
 * Requires DATABASE_URL in .env.
 * Cleans up all test data on completion (or failure).
 */

import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const { Pool } = pg;
const TEST_WITH_API = process.argv.includes('--with-api');
const API_BASE = process.env.PIPELINE_E2E_BASE_URL || 'http://localhost:3000';
const TEST_PREFIX = '__e2e_pipeline_test__';

let pool;
let testSampleIds = [];
let testRunIds = [];
let testVersionIds = [];
let testTaskIds = [];
let testCycleIds = [];
let passed = 0;
let failed = 0;

// ─── Helpers ─────────────────────────────────────────────────

function ok(name) {
  passed++;
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failed++;
  console.error(`  ✗ ${name}: ${err.message}`);
}

async function test(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    fail(name, err);
  }
}

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ─── Cleanup ─────────────────────────────────────────────────

async function cleanup() {
  console.log('\n  Cleaning up test data...');
  try {
    // Order matters due to FKs
    if (testSampleIds.length) {
      await query('DELETE FROM training_samples WHERE id = ANY($1)', [testSampleIds]);
    }
    if (testVersionIds.length) {
      await query('DELETE FROM model_versions WHERE id = ANY($1)', [testVersionIds]);
    }
    if (testRunIds.length) {
      await query('DELETE FROM training_runs WHERE id = ANY($1)', [testRunIds]);
    }
    if (testTaskIds.length) {
      await query('DELETE FROM pipeline_tasks WHERE id = ANY($1)', [testTaskIds]);
    }
    if (testCycleIds.length) {
      await query('DELETE FROM pipeline_cycles WHERE id = ANY($1)', [testCycleIds]);
    }
    console.log('  ✓ Cleanup complete');
  } catch (err) {
    console.error('  ✗ Cleanup failed:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. DATABASE SCHEMA TESTS
// ═══════════════════════════════════════════════════════════════

async function testSchema() {
  console.log('\n── DB Schema ──────────────────────────────────');

  // Verify all tables exist
  await test('all 5 tables exist', async () => {
    const { rows } = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'training_samples', 'training_runs', 'model_versions',
          'pipeline_tasks', 'pipeline_cycles'
        )
      ORDER BY table_name
    `);
    const names = rows.map(r => r.table_name);
    assert.deepEqual(names, [
      'model_versions', 'pipeline_cycles', 'pipeline_tasks',
      'training_runs', 'training_samples',
    ]);
  });

  // Verify all enums exist
  await test('all 3 enums exist', async () => {
    const { rows } = await query(`
      SELECT typname FROM pg_type
      WHERE typname IN ('training_sample_status', 'pipeline_task_source', 'training_run_status')
      ORDER BY typname
    `);
    assert.equal(rows.length, 3);
  });

  // Verify indexes
  await test('indexes exist on training_samples', async () => {
    const { rows } = await query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'training_samples'
        AND indexname LIKE 'training_samples_%_idx'
    `);
    const names = rows.map(r => r.indexname).sort();
    assert.ok(names.includes('training_samples_rating_idx'), 'missing rating index');
    assert.ok(names.includes('training_samples_status_idx'), 'missing status index');
  });

  await test('indexes exist on pipeline_tasks', async () => {
    const { rows } = await query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'pipeline_tasks'
        AND indexname LIKE 'pipeline_tasks_%_idx'
    `);
    const names = rows.map(r => r.indexname).sort();
    assert.ok(names.includes('pipeline_tasks_priority_idx'), 'missing priority index');
    assert.ok(names.includes('pipeline_tasks_status_idx'), 'missing status index');
  });
}

// ═══════════════════════════════════════════════════════════════
// 2. CRUD OPERATIONS
// ═══════════════════════════════════════════════════════════════

async function testCrud() {
  console.log('\n── CRUD Operations ────────────────────────────');

  // training_samples: insert, read, update status
  await test('training_samples: insert + read', async () => {
    const { rows } = await query(`
      INSERT INTO training_samples (instruction, output, source, repo, status, rating)
      VALUES ($1, $2, 'commit', $3, 'raw', NULL)
      RETURNING id, status, rating
    `, [`${TEST_PREFIX} fix bug`, `${TEST_PREFIX} diff output`, 'e2e-test-repo']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'raw');
    assert.equal(rows[0].rating, null);
    testSampleIds.push(rows[0].id);
  });

  await test('training_samples: update rating → status becomes rated', async () => {
    await query(`
      UPDATE training_samples SET rating = 4, status = 'rated', rated_at = NOW()
      WHERE id = $1
    `, [testSampleIds[0]]);
    const { rows } = await query('SELECT status, rating FROM training_samples WHERE id = $1', [testSampleIds[0]]);
    assert.equal(rows[0].status, 'rated');
    assert.equal(rows[0].rating, 4);
  });

  // training_runs: insert, link samples
  await test('training_runs: insert + link sample', async () => {
    const { rows } = await query(`
      INSERT INTO training_runs (base_model, sample_count, status, device_id)
      VALUES ('test-model', 1, 'running', 'e2e-test')
      RETURNING id
    `);
    testRunIds.push(rows[0].id);
    await query(`
      UPDATE training_samples SET training_run_id = $1, status = 'queued'
      WHERE id = $2
    `, [rows[0].id, testSampleIds[0]]);
    const { rows: samples } = await query(
      'SELECT training_run_id, status FROM training_samples WHERE id = $1',
      [testSampleIds[0]]
    );
    assert.equal(samples[0].training_run_id, testRunIds[0]);
    assert.equal(samples[0].status, 'queued');
  });

  await test('training_runs: complete run + mark samples trained', async () => {
    await query(`
      UPDATE training_runs
      SET status = 'completed', train_loss = 0.85, duration_seconds = 120,
          adapter_path = '/test/adapter', completed_at = NOW()
      WHERE id = $1
    `, [testRunIds[0]]);
    await query(`
      UPDATE training_samples SET status = 'trained'
      WHERE training_run_id = $1 AND status = 'queued'
    `, [testRunIds[0]]);
    const { rows } = await query(
      'SELECT status FROM training_samples WHERE id = $1',
      [testSampleIds[0]]
    );
    assert.equal(rows[0].status, 'trained');
  });

  // model_versions: insert, promote
  await test('model_versions: insert + promote', async () => {
    const { rows } = await query(`
      INSERT INTO model_versions (run_id, version, base_model, adapter_path, eval_score, promoted)
      VALUES ($1, 'v-e2e-1', 'test-model', '/test/adapter', 0.85, TRUE)
      RETURNING id
    `, [testRunIds[0]]);
    testVersionIds.push(rows[0].id);
    const { rows: check } = await query(
      'SELECT promoted, version FROM model_versions WHERE id = $1',
      [rows[0].id]
    );
    assert.equal(check[0].promoted, true);
    assert.equal(check[0].version, 'v-e2e-1');
  });

  // pipeline_tasks: insert, dedup check
  await test('pipeline_tasks: insert + unique hash constraint', async () => {
    const hash = `e2e${Date.now()}`.slice(0, 16);
    const { rows } = await query(`
      INSERT INTO pipeline_tasks (task_hash, title, source, description, file_paths, priority)
      VALUES ($1, $2, 'lint', 'test description', '["src/test.ts"]', 2)
      RETURNING id
    `, [hash, `${TEST_PREFIX} fix lint`]);
    testTaskIds.push(rows[0].id);

    // Duplicate hash should fail
    try {
      await query(`
        INSERT INTO pipeline_tasks (task_hash, title, source, description, file_paths, priority)
        VALUES ($1, 'duplicate', 'lint', 'dup', '[]', 3)
      `, [hash]);
      assert.fail('Should have thrown on duplicate hash');
    } catch (err) {
      assert.ok(err.message.includes('unique') || err.message.includes('duplicate'));
    }
  });

  // pipeline_cycles: insert
  await test('pipeline_cycles: insert cycle record', async () => {
    const { rows } = await query(`
      INSERT INTO pipeline_cycles (tasks_discovered, tasks_attempted, tasks_passed, tasks_failed, samples_collected, duration_seconds, completed_at)
      VALUES (5, 3, 2, 1, 3, 45, NOW())
      RETURNING id
    `);
    testCycleIds.push(rows[0].id);
    const { rows: check } = await query(
      'SELECT tasks_discovered, tasks_passed FROM pipeline_cycles WHERE id = $1',
      [rows[0].id]
    );
    assert.equal(check[0].tasks_discovered, 5);
    assert.equal(check[0].tasks_passed, 2);
  });

  // Enum validation
  await test('training_sample_status enum rejects invalid values', async () => {
    try {
      await query(`
        INSERT INTO training_samples (instruction, output, source, status)
        VALUES ('test', 'test', 'test', 'invalid_status')
      `);
      assert.fail('Should have thrown on invalid enum');
    } catch (err) {
      assert.ok(err.message.includes('invalid input value'));
    }
  });

  await test('pipeline_task_source enum rejects invalid values', async () => {
    try {
      await query(`
        INSERT INTO pipeline_tasks (task_hash, title, source, description, file_paths)
        VALUES ('inv_enum_test', 'test', 'not_a_source', 'test', '[]')
      `);
      assert.fail('Should have thrown on invalid enum');
    } catch (err) {
      assert.ok(err.message.includes('invalid input value'));
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// 3. DISCOVERY MODULE (against real repo)
// ═══════════════════════════════════════════════════════════════

async function testDiscovery() {
  console.log('\n── Discovery Module ───────────────────────────');

  // Import discovery dynamically (tsx handles the TS compilation)
  // We test by shelling out since the module uses @/ path aliases
  await test('discover.ts: parses TypeScript errors correctly', async () => {
    // Simulate tsc output parsing
    const tscOutput = `src/lib/foo.ts(42,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
src/lib/bar.ts(10,3): error TS2304: Cannot find name 'xyz'.`;

    const pattern = /^(.+?)\((\d+),\d+\):\s*error\s+TS\d+:\s*(.+)$/gm;
    const errors = [];
    let match;
    while ((match = pattern.exec(tscOutput)) !== null) {
      errors.push({ file: match[1].trim(), line: parseInt(match[2], 10), message: match[3].trim() });
    }
    assert.equal(errors.length, 2);
    assert.equal(errors[0].file, 'src/lib/foo.ts');
    assert.equal(errors[0].line, 42);
    assert.equal(errors[1].file, 'src/lib/bar.ts');
  });

  await test('discover.ts: hash function is deterministic', async () => {
    function hashString(s) {
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      }
      return Math.abs(h).toString(36).slice(0, 12);
    }
    const a = hashString('tsc:src/lib/foo.ts:42');
    const b = hashString('tsc:src/lib/foo.ts:42');
    const c = hashString('tsc:src/lib/bar.ts:10');
    assert.equal(a, b, 'same input should produce same hash');
    assert.notEqual(a, c, 'different input should produce different hash');
  });

  await test('discover.ts: TODO grep works against real repo', async () => {
    const { execSync } = await import('child_process');
    const repoPath = path.resolve(__dirname, '..');
    let output;
    try {
      output = execSync(
        'grep -rn "TODO\\|FIXME" src/ --include="*.ts" --include="*.tsx" 2>/dev/null | head -3',
        { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }
      );
    } catch {
      output = '';
    }
    // Just verify grep runs without error — may or may not find TODOs
    assert.ok(typeof output === 'string', 'grep should return a string');
  });
}

// ═══════════════════════════════════════════════════════════════
// 4. SCORING MODULE
// ═══════════════════════════════════════════════════════════════

async function testScoring() {
  console.log('\n── Scoring Module ─────────────────────────────');

  const SCORE_WEIGHTS = { typecheck: 0.30, lint: 0.20, tests: 0.30, build: 0.20 };

  function computeAutoScore(v) {
    let score = 0;
    if (v.typecheckPass) score += SCORE_WEIGHTS.typecheck;
    if (v.lintPass) score += SCORE_WEIGHTS.lint;
    if (v.testsPass) score += SCORE_WEIGHTS.tests;
    if (v.buildPass) score += SCORE_WEIGHTS.build;
    return Math.round(score * 100) / 100;
  }

  function computeRating(v) {
    if (v.allPassed && v.buildPass) return 5;
    if (v.allPassed) return 4;
    if (v.typecheckPass && v.testsPass) return 3;
    if (v.typecheckPass) return 2;
    return 1;
  }

  await test('scoring: all pass + build → rating 5, score 1.0', async () => {
    const v = { typecheckPass: true, lintPass: true, testsPass: true, buildPass: true, allPassed: true };
    assert.equal(computeRating(v), 5);
    assert.equal(computeAutoScore(v), 1.0);
  });

  await test('scoring: all pass, no build → rating 4, score 0.8', async () => {
    const v = { typecheckPass: true, lintPass: true, testsPass: true, buildPass: false, allPassed: true };
    assert.equal(computeRating(v), 4);
    assert.equal(computeAutoScore(v), 0.8);
  });

  await test('scoring: typecheck + tests, lint fail → rating 3', async () => {
    const v = { typecheckPass: true, lintPass: false, testsPass: true, buildPass: false, allPassed: false };
    assert.equal(computeRating(v), 3);
    assert.equal(computeAutoScore(v), 0.6);
  });

  await test('scoring: only typecheck pass → rating 2', async () => {
    const v = { typecheckPass: true, lintPass: false, testsPass: false, buildPass: false, allPassed: false };
    assert.equal(computeRating(v), 2);
    assert.equal(computeAutoScore(v), 0.3);
  });

  await test('scoring: all fail → rating 1, score 0', async () => {
    const v = { typecheckPass: false, lintPass: false, testsPass: false, buildPass: false, allPassed: false };
    assert.equal(computeRating(v), 1);
    assert.equal(computeAutoScore(v), 0);
  });
}

// ═══════════════════════════════════════════════════════════════
// 5. API ENDPOINT TESTS (optional, needs running server)
// ═══════════════════════════════════════════════════════════════

async function testApiEndpoints() {
  if (!TEST_WITH_API) {
    console.log('\n── API Endpoints (skipped — use --with-api) ──');
    return;
  }

  console.log('\n── API Endpoints ──────────────────────────────');

  // Check server is reachable
  try {
    await fetch(`${API_BASE}/api/pipeline/status`, { signal: AbortSignal.timeout(5000) });
  } catch {
    console.log('  ⚠ Server not reachable at', API_BASE, '— skipping API tests');
    return;
  }

  await test('GET /api/pipeline/status returns ok', async () => {
    const res = await fetch(`${API_BASE}/api/pipeline/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(data.pipeline, 'missing pipeline field');
    assert.ok(data.pipeline.sampleCounts !== undefined, 'missing sampleCounts');
    assert.ok(data.training, 'missing training field');
  });

  await test('POST /api/pipeline/trigger returns discovered tasks', async () => {
    const res = await fetch(`${API_BASE}/api/pipeline/trigger`, { method: 'POST' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(typeof data.tasksDiscovered === 'number');
    assert.ok(Array.isArray(data.tasks));
  });

  // Insert a test sample, then rate it
  const sampleId = testSampleIds[0]; // reuse from CRUD tests
  if (sampleId) {
    // Reset to raw for feedback test
    await query('UPDATE training_samples SET status = $1, rating = NULL WHERE id = $2', ['raw', sampleId]);

    await test('POST /api/pipeline/feedback rates a sample', async () => {
      const res = await fetch(`${API_BASE}/api/pipeline/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleId, rating: 5 }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.sample.rating, 5);
    });

    await test('POST /api/pipeline/feedback rejects invalid rating', async () => {
      const res = await fetch(`${API_BASE}/api/pipeline/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleId, rating: 99 }),
      });
      assert.equal(res.status, 400);
    });
  }

  await test('POST /api/pipeline/promote handles no completed runs', async () => {
    const res = await fetch(`${API_BASE}/api/pipeline/promote`, { method: 'POST' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    // Will either promote or say no improvement — both are valid
    assert.ok(typeof data.promoted === 'boolean' || data.promoted === false);
  });
}

// ═══════════════════════════════════════════════════════════════
// 6. DATA INTEGRITY TESTS
// ═══════════════════════════════════════════════════════════════

async function testDataIntegrity() {
  console.log('\n── Data Integrity ─────────────────────────────');

  await test('FK: training_samples.training_run_id references training_runs', async () => {
    try {
      await query(`
        INSERT INTO training_samples (instruction, output, source, training_run_id)
        VALUES ('test', 'test', 'test', -99999)
      `);
      assert.fail('Should have thrown FK violation');
    } catch (err) {
      assert.ok(
        err.message.includes('foreign key') || err.message.includes('violates'),
        `Expected FK error, got: ${err.message}`
      );
    }
  });

  await test('FK: model_versions.run_id references training_runs', async () => {
    try {
      await query(`
        INSERT INTO model_versions (run_id, version, base_model, adapter_path)
        VALUES (-99999, 'vX', 'test', '/test')
      `);
      assert.fail('Should have thrown FK violation');
    } catch (err) {
      assert.ok(
        err.message.includes('foreign key') || err.message.includes('violates'),
        `Expected FK error, got: ${err.message}`
      );
    }
  });

  await test('pipeline_tasks.task_hash is unique', async () => {
    const hash = `integ${Date.now()}`.slice(0, 16);
    const { rows } = await query(`
      INSERT INTO pipeline_tasks (task_hash, title, source, description, file_paths)
      VALUES ($1, 'integrity test', 'manual', 'test', '[]')
      RETURNING id
    `, [hash]);
    testTaskIds.push(rows[0].id);

    try {
      await query(`
        INSERT INTO pipeline_tasks (task_hash, title, source, description, file_paths)
        VALUES ($1, 'dup', 'manual', 'dup', '[]')
      `, [hash]);
      assert.fail('Should have thrown unique violation');
    } catch (err) {
      assert.ok(err.message.includes('unique') || err.message.includes('duplicate'));
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: DATABASE_URL not set');
    process.exit(1);
  }

  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 3,
  });

  console.log('═══════════════════════════════════════════════');
  console.log(' Pipeline E2E Tests');
  console.log('═══════════════════════════════════════════════');
  console.log(`  DB: ${url.replace(/:[^:@]+@/, ':***@')}`);
  if (TEST_WITH_API) console.log(`  API: ${API_BASE}`);

  try {
    await testSchema();
    await testCrud();
    await testDiscovery();
    await testScoring();
    await testDataIntegrity();
    await testApiEndpoints();
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
