import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimOrReplay,
  finalizeIdempotencyClaim,
  releaseIdempotencyClaim,
  withIdempotencyClaim,
} from './api-idempotency';

/**
 * In-memory fake of `api_idempotency_responses` that pattern-matches the SQL the
 * module emits. `now()` is controllable so the stale-reclaim window can be
 * exercised without real time. status_code 0 = pending (the sentinel).
 */
function makeFakeDb() {
  const rows = new Map<
    string,
    { status_code: number; response_body: unknown; created_at: number; staff_id: number | null }
  >();
  let now = 1_000_000;
  const key = (k: string, route: string) => `${k}::${route}`;
  const STALE_MS = 90_000;

  const db = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
      if (sql.includes('SELECT status_code, response_body')) {
        // getApiIdempotencyResponse(db, org=$1, key=$2, route=$3)
        const row = rows.get(key(params[1], params[2]));
        return { rows: row ? [{ status_code: row.status_code, response_body: row.response_body }] : [] };
      }
      if (sql.includes('INSERT INTO api_idempotency_responses') && sql.includes('ON CONFLICT')) {
        // tryClaim(org=$1, key=$2, route=$3, staff=$4)
        const k = key(params[1], params[2]);
        if (rows.has(k)) return { rows: [] }; // conflict → lost
        rows.set(k, { status_code: 0, response_body: { __pending__: true }, created_at: now, staff_id: params[3] });
        return { rows: [{ idempotency_key: params[1] }] }; // won
      }
      if (sql.includes('SET created_at = NOW()')) {
        // takeOverStaleClaim(org=$1, key=$2, route=$3, staff=$4) — pending + stale only
        const k = key(params[1], params[2]);
        const row = rows.get(k);
        if (row && row.status_code === 0 && now - row.created_at >= STALE_MS) {
          row.created_at = now;
          row.staff_id = params[3];
          return { rows: [{ idempotency_key: params[1] }] };
        }
        return { rows: [] };
      }
      if (sql.includes('SET status_code = $5')) {
        // finalizeIdempotencyClaim(org=$1, key=$2, route=$3, staff=$4, status=$5, body=$6)
        const row = rows.get(key(params[1], params[2]));
        if (row) {
          row.status_code = params[4];
          row.response_body = JSON.parse(params[5]);
        }
        return { rows: [] };
      }
      if (sql.startsWith('\n      DELETE') || sql.includes('DELETE FROM api_idempotency_responses')) {
        // releaseIdempotencyClaim(key=$1, route=$2) — pending rows only
        const k = key(params[0], params[1]);
        const row = rows.get(k);
        if (row && row.status_code === 0) rows.delete(k);
        return { rows: [] };
      }
      throw new Error(`unexpected SQL in fake db: ${sql.slice(0, 60)}`);
    },
    advance(ms: number) {
      now += ms;
    },
    _rows: rows,
  };
  return db;
}

const P = { orgId: 'org-1' as never, idempotencyKey: 'key-abc', route: 'r.test', staffId: 7 };

test('claimOrReplay: first caller proceeds, then replays the finalized response', async () => {
  const db = makeFakeDb();
  const first = await claimOrReplay(db, P);
  assert.equal(first.outcome, 'proceed');

  await finalizeIdempotencyClaim(db, P, { status: 200, body: { ok: true, n: 5 } });

  const second = await claimOrReplay<{ ok: boolean; n: number }>(db, P);
  assert.equal(second.outcome, 'replay');
  if (second.outcome === 'replay') {
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { ok: true, n: 5 });
  }
});

test('claimOrReplay: a concurrent second caller (claim still pending) gets in_progress', async () => {
  const db = makeFakeDb();
  const first = await claimOrReplay(db, P);
  assert.equal(first.outcome, 'proceed'); // owns the pending claim, hasn't finalized

  const second = await claimOrReplay(db, P);
  assert.equal(second.outcome, 'in_progress');
});

test('claimOrReplay: an abandoned (stale) pending claim is reclaimed', async () => {
  const db = makeFakeDb();
  await claimOrReplay(db, P); // proceed, leaves a pending claim that "crashes"

  // Before the stale window: still in_progress.
  db.advance(80_000);
  assert.equal((await claimOrReplay(db, P)).outcome, 'in_progress');

  // Past the stale window: a retry takes over.
  db.advance(20_000);
  assert.equal((await claimOrReplay(db, P)).outcome, 'proceed');
});

test('releaseIdempotencyClaim lets a fresh attempt proceed (not in_progress)', async () => {
  const db = makeFakeDb();
  await claimOrReplay(db, P); // proceed
  await releaseIdempotencyClaim(db, { idempotencyKey: P.idempotencyKey, route: P.route });

  const retry = await claimOrReplay(db, P);
  assert.equal(retry.outcome, 'proceed'); // claim was released, so not blocked
});

test('withIdempotencyClaim runs produce exactly once; a replay does not re-run it', async () => {
  const db = makeFakeDb();
  let runs = 0;
  const produce = async () => {
    runs += 1;
    return { status: 200, body: { runs } };
  };

  const a = await withIdempotencyClaim(db, P, produce);
  assert.equal(a.cached, false);
  assert.equal(runs, 1);

  const b = await withIdempotencyClaim(db, P, produce);
  assert.equal(b.cached, true); // replayed
  assert.equal(runs, 1); // produce NOT run again
  assert.deepEqual(b.body, { runs: 1 });
});

test('withIdempotencyClaim: a 5xx releases the claim so a later retry can run', async () => {
  const db = makeFakeDb();
  let attempt = 0;
  const produce = async () => {
    attempt += 1;
    return attempt === 1
      ? { status: 503, body: { transient: true } }
      : { status: 200, body: { ok: true } };
  };

  const a = await withIdempotencyClaim(db, P, produce);
  assert.equal(a.status, 503);

  // The 503 dropped the claim, so the retry runs produce again and succeeds.
  const b = await withIdempotencyClaim(db, P, produce);
  assert.equal(b.status, 200);
  assert.equal(attempt, 2);
});
