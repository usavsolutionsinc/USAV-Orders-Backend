import test from 'node:test';
import assert from 'node:assert/strict';
import { relinkReceivingPo, type RelinkDeps, type TxClient } from '@/lib/receiving/relink-po';

interface Captured {
  text: string;
  params: unknown[];
}

/** DB-free fakes: a client that records queries + answers the carton-exists check. */
function fakes(cartonExists = true) {
  const queries: Captured[] = [];
  const recomputeCalls: number[] = [];
  const client: TxClient = {
    query: async (text: string, params: unknown[] = []) => {
      queries.push({ text, params });
      // The carton existence probe is the only SELECT.
      if (/SELECT id\s+FROM receiving\b/.test(text)) {
        return cartonExists
          ? { rows: [{ id: params[0] }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const deps: RelinkDeps = {
    recompute: async (id) => {
      recomputeCalls.push(id);
    },
    runTx: async (_orgId, fn) => fn(client),
  };
  return { deps, queries, recomputeCalls };
}

test('relink scope "both" rewrites the line, the carton header, and recomputes', async () => {
  const { deps, queries, recomputeCalls } = fakes();

  const res = await relinkReceivingPo(
    {
      receivingId: 5,
      lineId: 9,
      scope: 'both',
      zohoPurchaseorderId: 'PO123',
      zohoPurchaseorderNumber: '6000',
    },
    'org-1',
    deps,
  );

  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.poId, 'PO123');

  // Line rewrite carried the chosen PO id + number, scoped to the line + carton.
  const lineUpdate = queries.find((q) => /UPDATE receiving_lines/.test(q.text));
  assert.ok(lineUpdate, 'expected a receiving_lines UPDATE');
  assert.ok(lineUpdate!.params.includes('PO123'));
  assert.ok(lineUpdate!.params.includes(9));

  // Carton header rewrite flips source to zoho_po (explicit override of upgrade-only).
  const cartonUpdate = queries.find(
    (q) => /UPDATE receiving\b/.test(q.text) && /source = 'zoho_po'/.test(q.text),
  );
  assert.ok(cartonUpdate, 'expected a receiving header UPDATE with source=zoho_po');
  assert.ok(cartonUpdate!.params.includes('PO123'));

  // Carton source link re-derived for this carton.
  assert.deepEqual(recomputeCalls, [5]);
});

test('relink scope "carton" rewrites every line and does NOT need a lineId', async () => {
  const { deps, queries } = fakes();

  const res = await relinkReceivingPo(
    { receivingId: 7, scope: 'carton', zohoPurchaseorderId: 'PO9', zohoPurchaseorderNumber: '777' },
    'org-1',
    deps,
  );

  assert.equal(res.ok, true);
  // Carton-scope line update targets the whole carton (WHERE receiving_id).
  const lineUpdate = queries.find((q) => /UPDATE receiving_lines/.test(q.text));
  assert.ok(lineUpdate);
  assert.ok(/WHERE receiving_id = \$3/.test(lineUpdate!.text));
  assert.ok(lineUpdate!.params.includes(7));
});

test('relink returns 404 when the carton is missing (no writes)', async () => {
  const { deps, queries, recomputeCalls } = fakes(false);

  const res = await relinkReceivingPo(
    { receivingId: 1, scope: 'carton', zohoPurchaseorderId: 'X' },
    'org-1',
    deps,
  );

  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
  // Only the existence probe ran — no UPDATE, no recompute.
  assert.ok(!queries.some((q) => /UPDATE/.test(q.text)));
  assert.deepEqual(recomputeCalls, []);
});

test('SKU correction is threaded into the line UPDATE params', async () => {
  const { deps, queries } = fakes();

  await relinkReceivingPo(
    {
      receivingId: 3,
      lineId: 4,
      scope: 'both',
      zohoPurchaseorderId: 'PO5',
      sku: 'ABC-123',
      zohoItemId: 'zi-99',
    },
    'org-1',
    deps,
  );

  const lineUpdate = queries.find((q) => /UPDATE receiving_lines/.test(q.text));
  assert.ok(lineUpdate);
  assert.ok(lineUpdate!.params.includes('ABC-123'));
  assert.ok(lineUpdate!.params.includes('zi-99'));
});
