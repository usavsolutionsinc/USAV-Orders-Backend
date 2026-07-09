/**
 * DB-free unit tests for the buyer-note mirror derivation (plan §2.3).
 * Run: npm run test:surfaces
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buyerNoteSourceRef,
  deriveBuyerNoteSignals,
  tapBuyerNoteDerivation,
  type BuyerNoteCandidateRow,
  type DeriveBuyerNoteSignalsDeps,
} from './buyer-note-derivation';
import type { RecordEntitySignalInput } from './record-entity-signal';

const ORG = '11111111-2222-3333-4444-555555555555';

function row(patch: Partial<BuyerNoteCandidateRow> = {}): BuyerNoteCandidateRow {
  return {
    id: 101,
    buyer_note: 'Please ship in double box',
    account_source: 'usav-ebay',
    order_id: '12-34567-89012',
    order_date: '2026-07-01',
    created_at: '2026-07-01T10:00:00Z',
    ...patch,
  };
}

function fakes(opts: {
  enabled?: boolean;
  rows?: BuyerNoteCandidateRow[];
  duplicateIds?: number[];
  failIds?: number[];
} = {}) {
  const cap = {
    enabledChecks: [] as string[],
    listCalls: [] as Array<{ orgId: string; limit: number }>,
    signals: [] as RecordEntitySignalInput[],
  };
  const deps: DeriveBuyerNoteSignalsDeps = {
    isEnabled: async (orgId) => {
      cap.enabledChecks.push(orgId);
      return opts.enabled ?? true;
    },
    listCandidates: async (orgId, limit) => {
      cap.listCalls.push({ orgId, limit });
      return opts.rows ?? [row()];
    },
    recordSignal: async (input) => {
      cap.signals.push(input);
      if (opts.failIds?.includes(input.entityId)) throw new Error('db down');
      if (opts.duplicateIds?.includes(input.entityId)) return { ok: true, id: null, duplicate: true };
      return { ok: true, id: input.entityId + 1000, duplicate: false };
    },
  };
  return { deps, cap };
}

test('disabled org: no scan, no signals', async () => {
  const { deps, cap } = fakes({ enabled: false });
  const out = await deriveBuyerNoteSignals(ORG, {}, deps);
  assert.deepEqual(out, { enabled: false, scanned: 0, emitted: 0, duplicates: 0, failed: 0 });
  assert.deepEqual(cap.enabledChecks, [ORG]);
  assert.equal(cap.listCalls.length, 0);
});

test('happy path: derives one external signal per mirror row with sha source_ref', async () => {
  const { deps, cap } = fakes({ rows: [row(), row({ id: 102, buyer_note: 'gift wrap pls' })] });
  const out = await deriveBuyerNoteSignals(ORG, { limit: 50 }, deps);

  assert.deepEqual(out, { enabled: true, scanned: 2, emitted: 2, duplicates: 0, failed: 0 });
  assert.deepEqual(cap.listCalls, [{ orgId: ORG, limit: 50 }]);
  assert.equal(cap.signals.length, 2);

  const s = cap.signals[0];
  assert.equal(s.organizationId, ORG); // org from the connection, never the payload
  assert.equal(s.entityType, 'ORDER');
  assert.equal(s.entityId, 101);
  assert.equal(s.signalKind, 'buyer_note');
  assert.equal(s.notes, 'Please ship in double box');
  assert.equal(s.sourceRef, buyerNoteSourceRef(101, 'Please ship in double box'));
  assert.equal(s.occurredAt, '2026-07-01');
  assert.equal(s.reasonCode, undefined); // no interpretation at ingest (§2.3 p6)
});

test('source_ref is deterministic per (orderPk, note) and changes with either', () => {
  const a = buyerNoteSourceRef(101, 'note');
  assert.equal(a, buyerNoteSourceRef(101, 'note'));
  assert.notEqual(a, buyerNoteSourceRef(102, 'note'));
  assert.notEqual(a, buyerNoteSourceRef(101, 'note edited'));
  assert.match(a, /^ebay-note:101:[0-9a-f]{16}$/);
});

test('duplicates and failures are counted, never thrown; whitespace-only notes skipped', async () => {
  const rows = [row({ id: 1 }), row({ id: 2 }), row({ id: 3 }), row({ id: 4, buyer_note: '   ' })];
  const { deps, cap } = fakes({ rows, duplicateIds: [2], failIds: [3] });
  const out = await deriveBuyerNoteSignals(ORG, {}, deps);
  assert.deepEqual(out, { enabled: true, scanned: 4, emitted: 1, duplicates: 1, failed: 1 });
  assert.equal(cap.signals.length, 3); // whitespace row never reached recordSignal
});

test('limit is clamped to [1, 10000]', async () => {
  const { deps, cap } = fakes({ rows: [] });
  await deriveBuyerNoteSignals(ORG, { limit: 0 }, deps);
  await deriveBuyerNoteSignals(ORG, { limit: 999_999 }, deps);
  assert.deepEqual(cap.listCalls.map((c) => c.limit), [1, 10_000]);
});

test('tapBuyerNoteDerivation never rejects (fresh-path tap contract)', async () => {
  // Force the real default deps path to fail fast by passing an org the flag
  // reader will choke on — the tap must still resolve.
  await tapBuyerNoteDerivation('not-a-uuid');
});
