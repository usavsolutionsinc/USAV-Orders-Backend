import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getReceivingModeDescriptor,
  resolveReceivingTableMode,
  RECEIVING_MODES,
  INCOMING_PAGE_SIZE,
  RECEIVING_TABLE_LIMIT,
  historySortGroupAxis,
  type ReceivingModeContext,
} from '@/lib/receiving/receiving-modes';
import {
  parseReceivingView,
  isReceivingView,
  RECEIVING_VIEWS,
} from '@/lib/receiving/receiving-views';

/** A neutral context — no search, no facets, default page. */
function ctx(overrides: Partial<ReceivingModeContext> = {}): ReceivingModeContext {
  return {
    historySearch: '',
    historySearchField: 'all',
    historySearchScope: 'all',
    historySort: '',
    incomingSearch: '',
    incomingState: null,
    incomingSort: '',
    incomingPoFrom: '',
    incomingPoTo: '',
    incomingPage: 1,
    isDeliveredUnscannedFacet: false,
    ...overrides,
  };
}

// ── Mode resolution ──────────────────────────────────────────────────────────

test('resolveReceivingTableMode maps the URL ?mode= to a table mode', () => {
  assert.equal(resolveReceivingTableMode('incoming'), 'incoming');
  assert.equal(resolveReceivingTableMode('history'), 'history');
  assert.equal(resolveReceivingTableMode('receive'), 'receive');
  // Unknown / absent / sidebar-only modes fall back to Receive.
  assert.equal(resolveReceivingTableMode(null), 'receive');
  assert.equal(resolveReceivingTableMode(undefined), 'receive');
  assert.equal(resolveReceivingTableMode('pickup'), 'receive');
  assert.equal(resolveReceivingTableMode('unfound'), 'receive');
});

// ── The core invariant: History is the scanned/unpacked log, NOT incoming ────

test('History requests view=activity, NOT all (incoming rows must not leak in)', () => {
  const history = getReceivingModeDescriptor('history');
  assert.equal(history.apiView, 'activity');
  // Regression guard for the original bug: 'all' includes untouched-incoming
  // EXPECTED rows, so History must never use it.
  assert.notEqual(history.apiView, 'all');
});

test('Incoming requests view=incoming and paginates server-side', () => {
  const incoming = getReceivingModeDescriptor('incoming');
  assert.equal(incoming.apiView, 'incoming');
  assert.equal(incoming.pageSize, INCOMING_PAGE_SIZE);
  assert.equal(incoming.serverSorted, true);
  assert.equal(incoming.isIncoming, true);
  assert.equal(incoming.groupAxis, 'po_date');
});

test('Receive uses the broad all bucket on a long scroll', () => {
  const receive = getReceivingModeDescriptor('receive');
  assert.equal(receive.apiView, 'all');
  assert.equal(receive.pageSize, null);
  assert.equal(receive.serverSorted, false);
  assert.equal(receive.groupAxis, 'activity');
});

// ── buildParams ──────────────────────────────────────────────────────────────

test('history buildParams sets view=activity + search facets', () => {
  const p = RECEIVING_MODES.history.buildParams(
    ctx({ historySearch: 'acme', historySearchField: 'po', historySearchScope: 'unmatched' }),
  );
  assert.equal(p.get('view'), 'activity');
  assert.equal(p.get('search'), 'acme');
  assert.equal(p.get('search_field'), 'po');
  assert.equal(p.get('search_scope'), 'unmatched');
  assert.equal(p.get('limit'), String(RECEIVING_TABLE_LIMIT));
  assert.equal(p.get('offset'), '0');
});

test('history buildParams omits search when blank but always sends field/scope', () => {
  const p = RECEIVING_MODES.history.buildParams(ctx());
  assert.equal(p.has('search'), false);
  assert.equal(p.get('search_field'), 'all');
  assert.equal(p.get('search_scope'), 'all');
});

test('history sort: default unboxed is always sent to the API; scanned when selected', () => {
  assert.equal(
    RECEIVING_MODES.history.buildParams(ctx()).get('sort'),
    'unboxed_newest',
  );
  assert.equal(
    RECEIVING_MODES.history.buildParams(ctx({ historySort: 'unboxed_newest' })).get('sort'),
    'unboxed_newest',
  );
  assert.equal(
    RECEIVING_MODES.history.buildParams(ctx({ historySort: 'scanned_newest' })).get('sort'),
    'scanned_newest',
  );
});

test('historySortGroupAxis maps sort ids to lifecycle axes', () => {
  assert.equal(historySortGroupAxis(''), 'unboxed');
  assert.equal(historySortGroupAxis('unboxed_newest'), 'unboxed');
  assert.equal(historySortGroupAxis('scanned_newest'), 'scanned');
  assert.equal(historySortGroupAxis('received_newest'), 'unboxed');
});

test('history sort axis varies the query key so a sort flip refetches', () => {
  const unboxed = RECEIVING_MODES.history.queryKey(ctx());
  const scanned = RECEIVING_MODES.history.queryKey(ctx({ historySort: 'scanned_newest' }));
  assert.notDeepEqual(unboxed, scanned);
});

test('incoming buildParams computes server offset from the 1-based page', () => {
  const p = RECEIVING_MODES.incoming.buildParams(ctx({ incomingPage: 3 }));
  assert.equal(p.get('view'), 'incoming');
  assert.equal(p.get('limit'), String(INCOMING_PAGE_SIZE));
  assert.equal(p.get('offset'), String(2 * INCOMING_PAGE_SIZE));
});

test('incoming buildParams forwards facet + sort + date range, defaults search to PO#', () => {
  const p = RECEIVING_MODES.incoming.buildParams(
    ctx({
      incomingSearch: '12345',
      incomingState: 'STALLED',
      incomingSort: 'zoho_oldest',
      incomingPoFrom: '2026-01-01',
      incomingPoTo: '2026-02-01',
    }),
  );
  assert.equal(p.get('search'), '12345');
  assert.equal(p.get('search_field'), 'po');
  assert.equal(p.get('delivery_state'), 'STALLED');
  assert.equal(p.get('sort'), 'zoho_oldest');
  assert.equal(p.get('po_from'), '2026-01-01');
  assert.equal(p.get('po_to'), '2026-02-01');
});

// ── skipWeekFilter ───────────────────────────────────────────────────────────

test('skipWeekFilter: receive keeps weeks; incoming always skips', () => {
  assert.equal(RECEIVING_MODES.receive.skipWeekFilter(ctx()), false);
  assert.equal(RECEIVING_MODES.incoming.skipWeekFilter(ctx()), true);
});

test('skipWeekFilter: history skips only when a search or non-default scope is active', () => {
  assert.equal(RECEIVING_MODES.history.skipWeekFilter(ctx()), false);
  assert.equal(RECEIVING_MODES.history.skipWeekFilter(ctx({ historySearch: 'x' })), true);
  assert.equal(
    RECEIVING_MODES.history.skipWeekFilter(ctx({ historySearchScope: 'zoho_po' })),
    true,
  );
});

// ── emptyMessage ─────────────────────────────────────────────────────────────

test('emptyMessage reflects mode + facet context', () => {
  assert.match(RECEIVING_MODES.history.emptyMessage(ctx({ historySearch: 'x' })), /No lines match/);
  assert.match(RECEIVING_MODES.history.emptyMessage(ctx()), /start scanning/);
  assert.match(RECEIVING_MODES.incoming.emptyMessage(ctx()), /No incoming POs/);
  assert.match(
    RECEIVING_MODES.incoming.emptyMessage(ctx({ isDeliveredUnscannedFacet: true })),
    /delivered-and-unscanned/,
  );
});

// ── queryKey isolation ───────────────────────────────────────────────────────

test('each mode produces a distinct query-key namespace', () => {
  const h = RECEIVING_MODES.history.queryKey(ctx());
  const i = RECEIVING_MODES.incoming.queryKey(ctx());
  const r = RECEIVING_MODES.receive.queryKey(ctx());
  assert.equal(h[2], 'history');
  assert.equal(i[2], 'incoming');
  assert.equal(r[2], 'receive');
  // Incoming page must be part of its key so paging refetches.
  const i2 = RECEIVING_MODES.incoming.queryKey(ctx({ incomingPage: 2 }));
  assert.notDeepEqual(i, i2);
});

// ── Shared view contract ─────────────────────────────────────────────────────

test('parseReceivingView accepts the full server set and rejects junk', () => {
  for (const v of RECEIVING_VIEWS) {
    assert.equal(parseReceivingView(v), v);
  }
  // The two views that previously existed only server-side must round-trip.
  assert.equal(parseReceivingView('activity'), 'activity');
  assert.equal(parseReceivingView('testing'), 'testing');
  assert.equal(parseReceivingView('needs-test'), 'needs-test'); // testing to-do (P1-PCK-03)
  assert.equal(parseReceivingView('ALL'), 'all'); // case-insensitive
  assert.equal(parseReceivingView('bogus'), null);
  assert.equal(parseReceivingView(''), null);
  assert.equal(parseReceivingView(null), null);
});

test('every descriptor apiView is a valid ReceivingView', () => {
  for (const descriptor of Object.values(RECEIVING_MODES)) {
    assert.ok(isReceivingView(descriptor.apiView), `${descriptor.id} -> ${descriptor.apiView}`);
  }
});
