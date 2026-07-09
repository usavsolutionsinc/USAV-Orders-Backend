import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyZohoRetry, classifyAmazonLookup, pickMergedRefetchNotice } from './useUnfoundRefetchActions.classify';

// ── Zoho retry-pair → UI state ─────────────────────────────────────────────────
test('zoho: promoted → matched + promote (PO id in the message)', () => {
  const { state, promote } = classifyZohoRetry(true, {
    success: true,
    promoted: true,
    zoho_purchaseorder_id: 'PO-42',
  });
  assert.equal(state.status, 'matched');
  assert.match(state.message ?? '', /PO-42/);
  assert.equal(promote, true);
});

test('zoho: promoted with no PO id still reports a generic match', () => {
  const { state, promote } = classifyZohoRetry(true, { success: true, promoted: true });
  assert.equal(state.status, 'matched');
  assert.equal(state.message, 'Matched to a PO');
  assert.equal(promote, true);
});

test('zoho: success but not promoted → no-match, no promote', () => {
  const { state, promote } = classifyZohoRetry(true, { success: true, promoted: false });
  assert.equal(state.status, 'no-match');
  assert.equal(promote, false);
});

test('zoho: non-OK response → error with server message', () => {
  const { state, promote } = classifyZohoRetry(false, { error: 'boom' });
  assert.equal(state.status, 'error');
  assert.equal(state.message, 'boom');
  assert.equal(promote, false);
});

test('zoho: OK but success=false → error', () => {
  const { state } = classifyZohoRetry(true, { success: false });
  assert.equal(state.status, 'error');
});

// ── Amazon returns lookup → UI state ───────────────────────────────────────────
test('amazon: HTTP 403 → unsupported (not enrolled)', () => {
  const { state, promote } = classifyAmazonLookup(403, false, {});
  assert.equal(state.status, 'unsupported');
  assert.equal(promote, false);
});

test('amazon: 200 with unsupported flag → unsupported', () => {
  const { state } = classifyAmazonLookup(200, true, { success: true, unsupported: true, error: 'not enabled' });
  assert.equal(state.status, 'unsupported');
  assert.equal(state.message, 'not enabled');
});

test('amazon: matched with customer order → matched + promote, order in message', () => {
  const { state, promote } = classifyAmazonLookup(200, true, {
    success: true,
    matched: true,
    customer_order_id: '111-2222222-3333333',
  });
  assert.equal(state.status, 'matched');
  assert.match(state.message ?? '', /111-2222222-3333333/);
  assert.equal(promote, true);
});

test('amazon: matched without customer order still matches', () => {
  const { state, promote } = classifyAmazonLookup(200, true, { success: true, matched: true });
  assert.equal(state.status, 'matched');
  assert.equal(promote, true);
});

test('amazon: success but no match → no-match', () => {
  const { state, promote } = classifyAmazonLookup(200, true, { success: true, matched: false });
  assert.equal(state.status, 'no-match');
  assert.equal(promote, false);
});

test('amazon: non-OK, not 403 → error', () => {
  const { state } = classifyAmazonLookup(502, false, { error: 'upstream' });
  assert.equal(state.status, 'error');
  assert.equal(state.message, 'upstream');
});

// ── Merged strip notice ──────────────────────────────────────────────────────────
test('pickMergedRefetchNotice: prefers matched over no-match', () => {
  const picked = pickMergedRefetchNotice(
    { status: 'no-match', message: 'Still no Zoho match' },
    { status: 'matched', message: 'Amazon return found' },
  );
  assert.equal(picked?.status, 'matched');
  assert.equal(picked?.message, 'Amazon return found');
});

test('pickMergedRefetchNotice: null when both idle', () => {
  assert.equal(
    pickMergedRefetchNotice(
      { status: 'idle', message: null },
      { status: 'loading', message: null },
    ),
    null,
  );
});
