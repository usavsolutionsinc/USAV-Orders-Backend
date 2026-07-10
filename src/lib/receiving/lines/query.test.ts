/**
 * DB-free unit tests for the receiving-lines query parser
 * (roi-execution/03 #8 decomposition).
 *
 * Pins the exact coercion/default/fallback semantics the old inline route
 * logic had: invalid values degrade silently (never throw / never a new 400),
 * NaN survives raw-Number params, limit clamps at 500, week/PO date strings
 * keep their raw form for the SQL-time regex gate, etc.
 *
 * Run: `npx tsx --test src/lib/receiving/lines/query.test.ts`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseReceivingLinesQuery, QA_STATUSES, DISPOSITIONS, WORKFLOW_STATUSES } from './query';

const parse = (qs: string) => parseReceivingLinesQuery(new URLSearchParams(qs));

test('defaults: empty search params', () => {
  const q = parse('');
  // Number(null) === 0 — the old code's raw-Number semantics.
  assert.equal(q.id, 0);
  assert.equal(q.receivingId, 0);
  assert.equal(q.limit, 200);
  assert.equal(q.offset, 0);
  assert.equal(q.search, '');
  assert.equal(q.searchField, 'all');
  assert.equal(q.searchScope, 'all');
  assert.equal(q.qaFilter, '');
  assert.equal(q.dispFilter, '');
  assert.equal(q.workflowFilter, '');
  assert.equal(q.weekStart, '');
  assert.equal(q.weekEnd, '');
  assert.equal(q.viewRaw, '');
  assert.equal(q.view, null);
  assert.equal(q.deliveryStateFilter, '');
  assert.equal(q.poFrom, '');
  assert.equal(q.poTo, '');
  assert.equal(q.sortRaw, '');
  assert.equal(q.incomingSort, 'zoho_newest');
  assert.equal(q.historySort, 'scanned_newest');
  assert.equal(q.wantsPrioritySort, false);
  assert.equal(q.hideZohoReceived, false);
  assert.equal(q.testerId, 0);
  assert.equal(q.includeSerials, false);
  assert.equal(q.inboundSourceParam, '');
  assert.equal(q.incomingLinkParam, '');
  assert.equal(q.staffFilterRaw, '');
  assert.equal(q.staffFilterId, 0);
});

test('id / receiving_id: raw Number semantics incl. NaN passthrough', () => {
  assert.equal(parse('id=42').id, 42);
  assert.equal(parse('id=42.5').id, 42.5); // no floor — old code passed it through
  assert.ok(Number.isNaN(parse('id=abc').id));
  assert.equal(parse('id=').id, 0); // Number('') === 0
  assert.equal(parse('receiving_id=17').receivingId, 17);
  assert.ok(Number.isNaN(parse('receiving_id=x').receivingId));
  assert.equal(parse('id=-5').id, -5); // negativity gate lives in the route
});

test('limit: default 200, clamp 500, junk degrades to NaN exactly like before', () => {
  assert.equal(parse('').limit, 200);
  assert.equal(parse('limit=50').limit, 50);
  assert.equal(parse('limit=500').limit, 500);
  assert.equal(parse('limit=900').limit, 500);
  assert.equal(parse('limit=0').limit, 0); // '0' is truthy → Number('0') = 0
  assert.equal(parse('limit=').limit, 200); // '' is falsy → default
  assert.ok(Number.isNaN(parse('limit=abc').limit)); // Math.min(NaN, 500) = NaN
  assert.equal(parse('limit=-10').limit, -10); // no lower clamp — unchanged
});

test('offset: default 0, floor at 0, junk degrades to NaN', () => {
  assert.equal(parse('').offset, 0);
  assert.equal(parse('offset=40').offset, 40);
  assert.equal(parse('offset=-3').offset, 0); // Math.max(-3, 0)
  assert.ok(Number.isNaN(parse('offset=abc').offset)); // Math.max(NaN, 0) = NaN
});

test('search: trimmed, empty stays empty', () => {
  assert.equal(parse('search=%20%20hello%20').search, 'hello');
  assert.equal(parse('search=').search, '');
});

test('search_field: normalized, invalid falls back to all', () => {
  assert.equal(parse('search_field=po').searchField, 'po');
  assert.equal(parse('search_field=TRACKING').searchField, 'tracking');
  assert.equal(parse('search_field=sku').searchField, 'sku');
  assert.equal(parse('search_field=product').searchField, 'product');
  assert.equal(parse('search_field=serial').searchField, 'serial');
  assert.equal(parse('search_field=bogus').searchField, 'all');
  assert.equal(parse('').searchField, 'all');
});

test('search_scope: unmatched + legacy unfound alias; everything else reads as all', () => {
  assert.equal(parse('search_scope=unmatched').searchScope, 'unmatched');
  assert.equal(parse('search_scope=unfound').searchScope, 'unmatched');
  // PO-only scope removed from the History UI — legacy bookmarks read as All.
  assert.equal(parse('search_scope=zoho_po').searchScope, 'all');
  assert.equal(parse('search_scope=junk').searchScope, 'all');
});

test('qa/disposition/workflow filters: uppercased raw strings; validity gate is downstream', () => {
  const q = parse('qa_status=passed&disposition=rtv&workflow_status=unboxed');
  assert.equal(q.qaFilter, 'PASSED');
  assert.equal(q.dispFilter, 'RTV');
  assert.equal(q.workflowFilter, 'UNBOXED');
  // Invalid values are preserved (NOT rejected) — the SQL builder silently
  // ignores them via the vocab sets, exactly like the old inline code.
  const bad = parse('qa_status=bogus&disposition=nope&workflow_status=whatever');
  assert.equal(bad.qaFilter, 'BOGUS');
  assert.equal(bad.dispFilter, 'NOPE');
  assert.equal(bad.workflowFilter, 'WHATEVER');
  assert.equal(QA_STATUSES.has(bad.qaFilter), false);
  assert.equal(DISPOSITIONS.has(bad.dispFilter), false);
  assert.equal(WORKFLOW_STATUSES.has(bad.workflowFilter), false);
  assert.equal(QA_STATUSES.has(q.qaFilter), true);
  assert.equal(DISPOSITIONS.has(q.dispFilter), true);
  assert.equal(WORKFLOW_STATUSES.has(q.workflowFilter), true);
});

test('week range: raw trimmed strings (regex gate stays at SQL build)', () => {
  const q = parse('week_start=2026-06-01&week_end=2026-06-07');
  assert.equal(q.weekStart, '2026-06-01');
  assert.equal(q.weekEnd, '2026-06-07');
  // Malformed values are preserved raw — they simply fail the SQL-time regex.
  assert.equal(parse('week_start=junk').weekStart, 'junk');
});

test('view: known views parse; unknown → null (week-range fallback)', () => {
  for (const v of ['all', 'recent', 'received', 'incoming', 'activity', 'scanned', 'unbox_opened', 'testing', 'needs-test', 'viewed']) {
    const q = parse(`view=${v}`);
    assert.equal(q.view, v);
    assert.equal(q.viewRaw, v);
  }
  assert.equal(parse('view=BOGUS').view, null);
  assert.equal(parse('view=BOGUS').viewRaw, 'bogus'); // lowercased raw survives for surface guards
  assert.equal(parse('view=Testing').view, 'testing'); // case-insensitive
});

test('delivery_state: trimmed + uppercased raw string, no validity gate here', () => {
  assert.equal(parse('delivery_state=delivered_unopened').deliveryStateFilter, 'DELIVERED_UNOPENED');
  assert.equal(parse('delivery_state=NOT_A_BUCKET').deliveryStateFilter, 'NOT_A_BUCKET');
  assert.equal(parse('').deliveryStateFilter, '');
});

test('po_from/po_to: ISO date or empty — malformed silently no-ops (bookmark-safe)', () => {
  const q = parse('po_from=2026-01-01&po_to=2026-02-15');
  assert.equal(q.poFrom, '2026-01-01');
  assert.equal(q.poTo, '2026-02-15');
  const bad = parse('po_from=01/01/2026&po_to=2026-13-99x');
  assert.equal(bad.poFrom, '');
  assert.equal(bad.poTo, '');
});

test('sort: incoming axis mapping with zoho_newest default', () => {
  assert.equal(parse('sort=zoho_oldest').incomingSort, 'zoho_oldest');
  assert.equal(parse('sort=expected_soonest').incomingSort, 'expected_soonest');
  assert.equal(parse('sort=recently_added').incomingSort, 'recently_added');
  assert.equal(parse('sort=zoho_newest').incomingSort, 'zoho_newest');
  assert.equal(parse('sort=bogus').incomingSort, 'zoho_newest');
  assert.equal(parse('').incomingSort, 'zoho_newest');
});

test('sort: history axis mapping with scanned_newest default', () => {
  assert.equal(parse('sort=scanned_oldest').historySort, 'scanned_oldest');
  assert.equal(parse('sort=unboxed_newest').historySort, 'unboxed_newest');
  assert.equal(parse('sort=received_newest').historySort, 'received_newest');
  assert.equal(parse('sort=unbox_activity').historySort, 'unbox_activity');
  assert.equal(parse('sort=bogus').historySort, 'scanned_newest');
  assert.equal(parse('').historySort, 'scanned_newest');
});

test('sort=priority: flags priority sort without disturbing the axis defaults', () => {
  const q = parse('sort=priority');
  assert.equal(q.wantsPrioritySort, true);
  assert.equal(q.incomingSort, 'zoho_newest');
  assert.equal(q.historySort, 'scanned_newest');
  assert.equal(parse('sort=unboxed_newest').wantsPrioritySort, false);
});

test('zohoStatus=open toggles hideZohoReceived (case-insensitive, trimmed)', () => {
  assert.equal(parse('zohoStatus=open').hideZohoReceived, true);
  assert.equal(parse('zohoStatus=OPEN').hideZohoReceived, true);
  assert.equal(parse('zohoStatus=closed').hideZohoReceived, false);
  assert.equal(parse('').hideZohoReceived, false);
});

test('tester: raw Number (absent → 0, junk → NaN)', () => {
  assert.equal(parse('tester=12').testerId, 12);
  assert.equal(parse('').testerId, 0);
  assert.ok(Number.isNaN(parse('tester=me').testerId));
});

test('include=serials: comma-list membership, trimmed entries', () => {
  assert.equal(parse('include=serials').includeSerials, true);
  assert.equal(parse('include=a,%20serials%20,b').includeSerials, true);
  assert.equal(parse('include=SERIALS').includeSerials, true); // lowercased first
  assert.equal(parse('include=serial').includeSerials, false);
  assert.equal(parse('').includeSerials, false);
});

test('inbound / link facets: trimmed + lowercased raw strings', () => {
  assert.equal(parse('inbound=EBAY').inboundSourceParam, 'ebay');
  assert.equal(parse('link=Zoho_Pending').incomingLinkParam, 'zoho_pending');
  assert.equal(parse('').inboundSourceParam, '');
  assert.equal(parse('').incomingLinkParam, '');
});

test('staff filter: raw string + raw Number twin (gate is downstream)', () => {
  const q = parse('staff=7');
  assert.equal(q.staffFilterRaw, '7');
  assert.equal(q.staffFilterId, 7);
  const junk = parse('staff=abc');
  assert.equal(junk.staffFilterRaw, 'abc');
  assert.ok(Number.isNaN(junk.staffFilterId));
  const empty = parse('');
  assert.equal(empty.staffFilterRaw, '');
  assert.equal(empty.staffFilterId, 0); // Number('') === 0 — filter never applies
});

test('parser never throws on hostile input', () => {
  assert.doesNotThrow(() =>
    parse('id=%00&limit=Infinity&view=%20&sort=--&search_field[]=x&week_start=%27;DROP%20TABLE--'),
  );
  // Infinity is a valid number for the schema and clamps via Math.min.
  assert.equal(parse('limit=Infinity').limit, 500);
});
