import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveShipmentForScan,
  type ResolveShipmentDeps,
} from './resolve-shipment-for-scan';

// ─── Deps fakes ───────────────────────────────────────────────────────────────
// The resolver issues at most two queries: an EXACT normalized join (SQL holds
// `tracking_number_normalized = $1`) and, only on a miss, a LAST-8 fallback (SQL
// holds `RIGHT(regexp_replace`). The fake routes canned rows by inspecting the
// SQL and records every call + warning so we can assert on both the result AND
// what the resolver threaded into the DB — DB-free.

interface Captured {
  exactParams: unknown[] | null;
  last8Params: unknown[] | null;
  warnings: Array<{ msg: string; meta?: Record<string, unknown> }>;
}

function fakes(rows: { exact?: unknown[]; last8?: unknown[] }): {
  deps: ResolveShipmentDeps;
  captured: Captured;
} {
  const captured: Captured = { exactParams: null, last8Params: null, warnings: [] };
  const deps: ResolveShipmentDeps = {
    query: async <T>(_orgId: string | undefined, sql: string, params: unknown[]) => {
      if (sql.includes('tracking_number_normalized = $1')) {
        captured.exactParams = params;
        return { rows: (rows.exact ?? []) as T[] };
      }
      captured.last8Params = params;
      return { rows: (rows.last8 ?? []) as T[] };
    },
    warn: (msg, meta) => captured.warnings.push({ msg, meta }),
  };
  return { deps, captured };
}

const ORG = 'org-123';

// ─── EXACT normalized join is preferred ───────────────────────────────────────

test('exact normalized hit → matchKind "exact", no last-8 query, no warning', async () => {
  const { deps, captured } = fakes({
    exact: [{ shipment_id: 7, receiving_id: 42, receiving_source: 'zoho_po' }],
  });
  const res = await resolveShipmentForScan('382141152045', ORG, deps);
  assert.deepEqual(res, {
    shipmentId: 7,
    receivingId: 42,
    receivingSource: 'zoho_po',
    matchKind: 'exact',
  });
  // Exact won — the last-8 fallback must NOT have run.
  assert.equal(captured.last8Params, null);
  assert.equal(captured.warnings.length, 0);
});

test('a scanned GS1/"96" barcode is canonicalized before the exact match', async () => {
  const { deps, captured } = fakes({
    exact: [{ shipment_id: 1, receiving_id: 2, receiving_source: 'unmatched' }],
  });
  await resolveShipmentForScan('9632001960200651497200382141152045', ORG, deps);
  // The exact join keys on the human number embedded in the GS1 barcode, NOT
  // the raw 34-digit gun read — that is the whole reconciliation invariant.
  assert.deepEqual(captured.exactParams, ['382141152045', ORG]);
});

test('exact match on a shipment with no linked carton → shipmentId set, receivingId null', async () => {
  const { deps } = fakes({
    exact: [{ shipment_id: 9, receiving_id: null, receiving_source: null }],
  });
  const res = await resolveShipmentForScan('382141152045', ORG, deps);
  assert.equal(res.shipmentId, 9);
  assert.equal(res.receivingId, null);
  assert.equal(res.matchKind, 'exact');
});

// ─── LAST-8 fallback only on exact miss, and it logs ──────────────────────────

test('exact miss + single last-8 carton → matchKind "last8" and a logged fallback', async () => {
  const { deps, captured } = fakes({
    exact: [],
    last8: [{ shipment_id: 5, receiving_id: 50, receiving_source: 'zoho_po' }],
  });
  const res = await resolveShipmentForScan('382141152045', ORG, deps);
  assert.equal(res.matchKind, 'last8');
  assert.equal(res.receivingId, 50);
  // The fallback MUST be logged — last-8 is ambiguous (live collision groups).
  assert.equal(captured.warnings.length, 1);
  assert.match(captured.warnings[0].msg, /last-8 fallback/);
});

test('exact miss + ambiguous last-8 (≥2 cartons) → matchKind "none" (drop to Zoho)', async () => {
  const { deps } = fakes({
    exact: [],
    last8: [
      { shipment_id: 5, receiving_id: 50, receiving_source: 'zoho_po' },
      { shipment_id: 6, receiving_id: 60, receiving_source: 'zoho_po' },
    ],
  });
  const res = await resolveShipmentForScan('382141152045', ORG, deps);
  assert.equal(res.matchKind, 'none');
  assert.equal(res.receivingId, null);
  assert.equal(res.shipmentId, null);
});

test('exact miss + last-8 miss → matchKind "none"', async () => {
  const { deps } = fakes({ exact: [], last8: [] });
  const res = await resolveShipmentForScan('382141152045', ORG, deps);
  assert.equal(res.matchKind, 'none');
});

// ─── Guards ───────────────────────────────────────────────────────────────────

test('empty / unnormalizable input short-circuits with no DB calls', async () => {
  const { deps, captured } = fakes({});
  const res = await resolveShipmentForScan('   ', ORG, deps);
  assert.equal(res.matchKind, 'none');
  assert.equal(captured.exactParams, null);
  assert.equal(captured.last8Params, null);
});

test('without an orgId the queries carry no org param (un-scoped legacy callers)', async () => {
  const { deps, captured } = fakes({
    exact: [{ shipment_id: 3, receiving_id: 30, receiving_source: 'zoho_po' }],
  });
  await resolveShipmentForScan('382141152045', undefined, deps);
  assert.deepEqual(captured.exactParams, ['382141152045']);
});
