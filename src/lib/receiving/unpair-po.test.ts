import test from 'node:test';
import assert from 'node:assert/strict';
import { unpairReceivingCarton, type UnpairDeps } from '@/lib/receiving/unpair-po';
import type { TxClient } from '@/lib/receiving/relink-po';

interface Captured {
  text: string;
  params: unknown[];
}

/** DB-free fakes: records queries + answers the carton-state probe. */
function fakes(carton: Record<string, unknown> | null = {
  zoho_purchaseorder_id: null,
  zoho_purchaseorder_number: '6001',
  source: 'zoho_po',
  source_platform: 'ecwid',
  intake_type: 'RETURN',
  is_return: true,
  return_platform: 'AMZ',
}) {
  const queries: Captured[] = [];
  const client: TxClient = {
    query: async (text: string, params: unknown[] = []) => {
      queries.push({ text, params });
      if (/SELECT[\s\S]*FROM receiving\b/.test(text) && /source_platform/.test(text)) {
        return carton ? { rows: [carton], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      // UPDATE receiving_lines reports 2 lines cleared.
      if (/UPDATE receiving_lines/.test(text)) return { rows: [], rowCount: 2 };
      return { rows: [], rowCount: 1 };
    },
  };
  const deps: UnpairDeps = { runTx: async (_orgId, fn) => fn(client) };
  return { deps, queries };
}

test('unpair clears line linkage + carton header and returns the before-snapshot', async () => {
  const { deps, queries } = fakes();

  const res = await unpairReceivingCarton(7, 'org-1', deps);

  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.linesCleared, 2);
  assert.deepEqual(res.before, {
    zoho_purchaseorder_id: null,
    zoho_purchaseorder_number: '6001',
    source: 'zoho_po',
    source_platform: 'ecwid',
    intake_type: 'RETURN',
    is_return: true,
    return_platform: 'AMZ',
  });

  // Lines: source order + PO stripped, scoped by receiving_id + org.
  const lineUpd = queries.find((q) => /UPDATE receiving_lines/.test(q.text));
  assert.ok(lineUpd, 'expected a receiving_lines UPDATE');
  assert.ok(/source_order_id = NULL/.test(lineUpd!.text));
  assert.ok(/is_repair_service = FALSE/.test(lineUpd!.text));
  assert.ok(/receiving_type = CASE/.test(lineUpd!.text));
  assert.deepEqual(lineUpd!.params, [7, 'org-1']);

  const returnFactsDel = queries.find((q) => /DELETE FROM receiving_line_return/.test(q.text));
  assert.ok(returnFactsDel, 'expected receiving_line_return DELETE');

  // Carton: explicit downgrade back to unmatched (PO + platform + return cleared).
  const cartonUpd = queries.find((q) => /UPDATE receiving\b/.test(q.text) && /source = 'unmatched'/.test(q.text));
  assert.ok(cartonUpd, 'expected a carton downgrade UPDATE');
  assert.ok(/zoho_purchaseorder_id = NULL/.test(cartonUpd!.text));
  assert.ok(/source_platform = NULL/.test(cartonUpd!.text));
  assert.ok(/is_return = false/.test(cartonUpd!.text));
  assert.ok(/intake_type = NULL/.test(cartonUpd!.text));
  assert.ok(/return_platform = NULL/.test(cartonUpd!.text));
});

test('unpair 404s a carton that is not in the org', async () => {
  const { deps, queries } = fakes(null);

  const res = await unpairReceivingCarton(7, 'org-1', deps);

  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
  assert.equal(res.before, null);
  // Must not attempt any UPDATE when the carton is absent.
  assert.ok(!queries.some((q) => /UPDATE/.test(q.text)));
});

test('unpair rejects an invalid receiving id without a transaction', async () => {
  let ranTx = false;
  const deps: UnpairDeps = {
    runTx: async (_orgId, fn) => {
      ranTx = true;
      return fn({ query: async () => ({ rows: [], rowCount: 0 }) });
    },
  };

  const res = await unpairReceivingCarton(0, 'org-1', deps);

  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(ranTx, false);
});
