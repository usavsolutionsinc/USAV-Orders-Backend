import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachOutboundDocument,
  deleteOutboundDocument,
  fetchOutboundDocuments,
  OutboundDocumentConflictError,
  OutboundDocumentNotFoundError,
  OutboundDocumentValidationError,
  type OutboundDocumentDeps,
} from './outbound-documents';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '11111111-1111-1111-1111-111111111111' as OrgId;

interface QueryLog {
  text: string;
  params: unknown[];
}

interface Script {
  orderExists?: boolean;
  dupeExists?: boolean;
  priorLabelExists?: boolean;
  insertedRow?: Record<string, unknown>;
  insertError?: unknown;
  deleteRow?: Record<string, unknown> | null;
  allowedUrlBases?: string[];
}

interface Captured {
  queries: QueryLog[];
  linkShipmentCalls: unknown[];
  createLinkCalls: unknown[];
  resolveShipmentIdCalls: unknown[];
  resolveStnCalls: unknown[];
  resolveAllowedUrlBasesCalls: unknown[];
}

function fakeClientQuery(cap: Captured, script: Script) {
  return async (text: string, params: unknown[] = []) => {
    cap.queries.push({ text, params });

    if (text.includes('SELECT 1 FROM orders WHERE id')) {
      return { rows: script.orderExists === false ? [] : [{ x: 1 }], rowCount: script.orderExists === false ? 0 : 1 };
    }
    if (text.includes("document_data->>'url' = $4")) {
      return { rows: script.dupeExists ? [{ x: 1 }] : [], rowCount: script.dupeExists ? 1 : 0 };
    }
    if (text.includes("document_type = 'shipping_label'") && !text.includes("document_data->>'url'")) {
      return { rows: script.priorLabelExists ? [{ x: 1 }] : [], rowCount: script.priorLabelExists ? 1 : 0 };
    }
    if (text.includes('INSERT INTO documents (entity_type')) {
      if (script.insertError) throw script.insertError;
      return { rows: [script.insertedRow], rowCount: 1 };
    }
    if (text.includes('UPDATE orders SET label_printed_at')) {
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('FROM document_entity_links') && text.includes('document_id = ANY')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('SELECT document_type, entity_type, entity_id FROM documents')) {
      return { rows: script.deleteRow ? [script.deleteRow] : [], rowCount: script.deleteRow ? 1 : 0 };
    }
    if (text.includes('DELETE FROM documents WHERE id = $1')) {
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`fakeClient: unhandled query: ${text}`);
  };
}

function fakes(script: Script = {}) {
  const cap: Captured = {
    queries: [],
    linkShipmentCalls: [],
    createLinkCalls: [],
    resolveShipmentIdCalls: [],
    resolveStnCalls: [],
    resolveAllowedUrlBasesCalls: [],
  };
  const client = { query: fakeClientQuery(cap, script) };

  const deps: OutboundDocumentDeps = {
    withTenantTransaction: (async (_orgId: OrgId, fn: (c: typeof client) => Promise<unknown>) => fn(client)) as OutboundDocumentDeps['withTenantTransaction'],
    resolveShipmentId: (async (rawInput: string, orgId?: OrgId) => {
      cap.resolveShipmentIdCalls.push({ rawInput, orgId });
      return { shipmentId: 555, scanRef: null };
    }) as OutboundDocumentDeps['resolveShipmentId'],
    resolveStnForOrder: (async (orgId: OrgId, orderId: number) => {
      cap.resolveStnCalls.push({ orgId, orderId });
      return null;
    }) as OutboundDocumentDeps['resolveStnForOrder'],
    linkShipment: (async (orgId: OrgId, input: unknown) => {
      cap.linkShipmentCalls.push(input);
      return { id: 1, box_seq: 1, is_primary: false };
    }) as OutboundDocumentDeps['linkShipment'],
    createDocumentEntityLink: (async (_orgId: OrgId, input: unknown) => {
      cap.createLinkCalls.push(input);
      return { id: 1, documentId: 1, entityType: 'ORDER', entityId: 1, linkRole: 'primary', createdAt: 'now' };
    }) as OutboundDocumentDeps['createDocumentEntityLink'],
    resolveAllowedUrlBases: (async (orgId: OrgId) => {
      cap.resolveAllowedUrlBasesCalls.push(orgId);
      // Default fixture matches the `https://nas.example/...` URLs most tests
      // use; the allowlist-specific tests override this explicitly.
      return script.allowedUrlBases ?? ['https://nas.example'];
    }) as OutboundDocumentDeps['resolveAllowedUrlBases'],
  };

  return { deps, cap };
}

const insertedLabelRow = {
  id: 1,
  entity_type: 'ORDER',
  entity_id: 42,
  document_type: 'shipping_label',
  document_data: { url: 'https://nas.example/label.pdf' },
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

test('attachOutboundDocument: label with resolvable STN links SHIPMENT primary + ORDER secondary', async () => {
  const { deps, cap } = fakes({ insertedRow: insertedLabelRow });

  const result = await attachOutboundDocument(
    ORG,
    { orderId: 42, documentType: 'shipping_label', url: insertedLabelRow.document_data.url, tracking: '1Z999AA10123456784' },
    deps,
  );

  assert.equal(result.isFirstLabel, true);
  assert.equal(cap.resolveShipmentIdCalls.length, 1);
  assert.equal(cap.resolveStnCalls.length, 0, 'tracking was provided — should not fall back to resolveStnForOrder');
  assert.equal(cap.linkShipmentCalls.length, 1);
  assert.deepEqual(cap.createLinkCalls, [
    { documentId: 1, entityType: 'SHIPMENT', entityId: 555, linkRole: 'primary' },
    { documentId: 1, entityType: 'ORDER', entityId: 42, linkRole: 'secondary' },
  ]);
  assert.ok(
    cap.queries.some((q) => q.text.includes('UPDATE orders SET label_printed_at')),
    'first label should stamp orders.label_printed_at',
  );
});

test('attachOutboundDocument: label with no resolvable STN links ORDER as the sole primary', async () => {
  const { deps, cap } = fakes({ insertedRow: insertedLabelRow, priorLabelExists: true });

  const result = await attachOutboundDocument(
    ORG,
    { orderId: 42, documentType: 'shipping_label', url: insertedLabelRow.document_data.url },
    deps,
  );

  assert.equal(result.isFirstLabel, false, 'a prior label exists — not the first');
  assert.equal(cap.resolveStnCalls.length, 1, 'no tracking given — should resolve via resolveStnForOrder');
  assert.equal(cap.linkShipmentCalls.length, 0, 'no STN resolved — shipment_links must not be touched');
  assert.deepEqual(cap.createLinkCalls, [{ documentId: 1, entityType: 'ORDER', entityId: 42, linkRole: 'primary' }]);
  assert.ok(
    !cap.queries.some((q) => q.text.includes('UPDATE orders SET label_printed_at')),
    'not the first label — must not re-stamp label_printed_at',
  );
});

test('attachOutboundDocument: packing slip always anchors ORDER primary, STN secondary when resolvable', async () => {
  const slipRow = { ...insertedLabelRow, document_type: 'packing_slip' };
  const { deps, cap } = fakes({ insertedRow: slipRow });

  await attachOutboundDocument(
    ORG,
    { orderId: 42, documentType: 'packing_slip', url: 'https://nas.example/slip.pdf', tracking: '1Z999AA10123456784' },
    deps,
  );

  assert.deepEqual(cap.createLinkCalls, [
    { documentId: 1, entityType: 'ORDER', entityId: 42, linkRole: 'primary' },
    { documentId: 1, entityType: 'SHIPMENT', entityId: 555, linkRole: 'secondary' },
  ]);
  assert.ok(
    !cap.queries.some((q) => q.text.includes('UPDATE orders SET label_printed_at')),
    'packing slips never touch the label_printed_at stamp',
  );
});

test('attachOutboundDocument: duplicate url is a conflict, not a second row', async () => {
  const { deps, cap } = fakes({ insertedRow: insertedLabelRow, dupeExists: true });

  await assert.rejects(
    attachOutboundDocument(ORG, { orderId: 42, documentType: 'shipping_label', url: insertedLabelRow.document_data.url }, deps),
    OutboundDocumentConflictError,
  );
  assert.ok(!cap.queries.some((q) => q.text.includes('INSERT INTO documents (entity_type')), 'conflict must short-circuit before insert');
  assert.equal(cap.createLinkCalls.length, 0);
});

test('attachOutboundDocument: a unique-violation on insert (concurrent-duplicate race) maps to the same conflict error', async () => {
  const raceError = Object.assign(new Error('duplicate key value'), { code: '23505' });
  const { deps, cap } = fakes({ insertedRow: insertedLabelRow, insertError: raceError });

  await assert.rejects(
    attachOutboundDocument(ORG, { orderId: 42, documentType: 'shipping_label', url: insertedLabelRow.document_data.url }, deps),
    OutboundDocumentConflictError,
  );
  assert.equal(cap.createLinkCalls.length, 0, 'no links should be created when the insert itself failed');
});

test('attachOutboundDocument: unknown order 404s before any link/insert side-effect', async () => {
  const { deps, cap } = fakes({ orderExists: false });

  await assert.rejects(
    attachOutboundDocument(ORG, { orderId: 999, documentType: 'shipping_label', url: 'https://nas.example/x.pdf' }, deps),
    OutboundDocumentNotFoundError,
  );
  assert.equal(cap.linkShipmentCalls.length, 0);
  assert.equal(cap.createLinkCalls.length, 0);
});

test('attachOutboundDocument: a protocol-relative URL is rejected, never treated as same-origin', async () => {
  // `//evil.example.com/x` starts with '/' but a browser resolves it against
  // the CURRENT scheme onto a different host — must not slip past the
  // same-origin fast path even when the org has no NAS configured.
  const { deps, cap } = fakes({ allowedUrlBases: [] });

  await assert.rejects(
    attachOutboundDocument(ORG, { orderId: 42, documentType: 'shipping_label', url: '//evil.example.com/x' }, deps),
    OutboundDocumentValidationError,
  );
  assert.equal(cap.resolveAllowedUrlBasesCalls.length, 1, 'must consult the allowlist once same-origin is ruled out');
});

test('attachOutboundDocument: an absolute URL outside the configured NAS bases is rejected', async () => {
  const { deps } = fakes({ allowedUrlBases: ['https://nas.example.com'] });

  await assert.rejects(
    attachOutboundDocument(ORG, { orderId: 42, documentType: 'shipping_label', url: 'https://attacker.example/x' }, deps),
    OutboundDocumentValidationError,
  );
});

test('attachOutboundDocument: a URL inside the configured NAS base is allowed', async () => {
  const { deps } = fakes({ allowedUrlBases: ['https://nas.example.com'], insertedRow: { ...insertedLabelRow, document_data: { url: 'https://nas.example.com/label.pdf' } } });

  const result = await attachOutboundDocument(
    ORG,
    { orderId: 42, documentType: 'shipping_label', url: 'https://nas.example.com/label.pdf' },
    deps,
  );
  assert.equal(result.document.data.url, 'https://nas.example.com/label.pdf');
});

test('deleteOutboundDocument: removes an existing row and reports its order id', async () => {
  const { deps, cap } = fakes({ deleteRow: { document_type: 'shipping_label', entity_type: 'ORDER', entity_id: 42 } });

  const result = await deleteOutboundDocument(ORG, 7, {}, deps);

  assert.deepEqual(result, { id: 7, documentType: 'shipping_label', orderId: 42 });
  assert.ok(cap.queries.some((q) => q.text.includes('DELETE FROM documents WHERE id = $1 AND organization_id = $2')));
});

test('deleteOutboundDocument: missing row throws not-found', async () => {
  const { deps } = fakes({ deleteRow: null });

  await assert.rejects(deleteOutboundDocument(ORG, 999, {}, deps), OutboundDocumentNotFoundError);
});

test('deleteOutboundDocument: expectedDocumentType mismatch 404s without deleting', async () => {
  const { deps, cap } = fakes({ deleteRow: { document_type: 'packing_slip', entity_type: 'ORDER', entity_id: 42 } });

  await assert.rejects(
    deleteOutboundDocument(ORG, 7, { expectedDocumentType: 'shipping_label' }, deps),
    OutboundDocumentNotFoundError,
  );
  assert.ok(!cap.queries.some((q) => q.text.includes('DELETE FROM documents')), 'a type mismatch must not delete the row');
});

test('fetchOutboundDocuments: disabled flag returns manual-upload message', async () => {
  const prev = process.env.OUTBOUND_MARKETPLACE_FETCH;
  process.env.OUTBOUND_MARKETPLACE_FETCH = 'false';
  try {
    const result = await fetchOutboundDocuments(ORG, 42, ['shipping_label', 'packing_slip']);
    assert.deepEqual(result.fetched, []);
    assert.equal(result.failed.length, 2);
    assert.match(result.failed[0].error, /disabled/i);
  } finally {
    if (prev === undefined) delete process.env.OUTBOUND_MARKETPLACE_FETCH;
    else process.env.OUTBOUND_MARKETPLACE_FETCH = prev;
  }
});
