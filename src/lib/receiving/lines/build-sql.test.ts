/**
 * DB-free regression tests for the receiving-lines SQL builders
 * (roi-execution/03 #8 decomposition).
 *
 * The safety net: `legacy-route-sql.fixture.ts` is a mechanical, byte-for-byte
 * extraction of the OLD inline GET logic from the route handler. Every combo
 * below asserts the new builders in `./build-sql` produce IDENTICAL
 * { sql, params } — SQL text equality is exact-string, so even a whitespace
 * drift fails. These are permanent: if build-sql is ever deliberately changed,
 * the fixture must be updated in the same PR.
 *
 * Run: `npx tsx --test src/lib/receiving/lines/build-sql.test.ts`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseReceivingLinesQuery } from './query';
import {
  buildReceivingLinesListSql,
  buildUnmatchedPlaceholdersSql,
  buildUnboxOpenedPlaceholdersSql,
  shouldIncludeUnmatchedPlaceholders,
  shouldIncludeUnboxOpenedPlaceholders,
} from './build-sql';
import {
  legacyBuildLineByIdSql,
  legacyBuildLinesByReceivingIdSql,
  legacyBuildListSql,
  legacyBuildUnmatchedPlaceholdersSql,
  legacyBuildUnboxOpenedPlaceholdersSql,
  type LegacySqlOpts,
} from './legacy-route-sql.fixture';
import {
  buildReceivingLineByIdSql,
  buildReceivingLinesByReceivingIdSql,
} from './build-sql';

const ORG = '00000000-0000-0000-0000-000000000001';

const DEFAULT_OPTS: LegacySqlOpts = {
  orgId: ORG,
  // Route computes `Number(ctx?.staffId)` — an anonymous/absent staffId is NaN.
  viewerStaffId: NaN,
  universalIncoming: false,
  applyScannedZohoExclusion: true,
};

interface Combo {
  name: string;
  qs: string;
  opts?: Partial<LegacySqlOpts>;
}

/** Representative filter matrix — every WHERE branch, sort axis, and view. */
const LIST_COMBOS: Combo[] = [
  { name: 'defaults (no params)', qs: '' },
  { name: 'plain search (field=all)', qs: 'search=soundbar' },
  { name: 'R-<id> carton QR search (receiving_id equality arm)', qs: 'search=R-482' },
  { name: 'search_field=po', qs: 'search=PO-1189&search_field=po' },
  { name: 'search_field=tracking', qs: 'search=1Z999AA1&search_field=tracking' },
  { name: 'search_field=sku', qs: 'search=00143&search_field=sku' },
  { name: 'search_field=product', qs: 'search=Bose&search_field=product' },
  { name: 'search_field=serial', qs: 'search=SN12345&search_field=serial' },
  { name: 'search_scope=zoho_po', qs: 'search=abc&search_scope=zoho_po' },
  { name: 'search_scope=unfound alias → unmatched', qs: 'search_scope=unfound' },
  { name: 'valid qa/disposition/workflow filters', qs: 'qa_status=passed&disposition=rtv&workflow_status=unboxed' },
  { name: 'invalid qa/disposition/workflow silently ignored', qs: 'qa_status=BOGUS&disposition=NOPE&workflow_status=NOT_A_STATUS' },
  { name: 'staff filter', qs: 'staff=7' },
  { name: 'staff filter junk value ignored', qs: 'staff=abc' },
  { name: 'staff filter on unbox_opened (actor clause)', qs: 'view=unbox_opened&staff=7' },
  { name: 'view=recent', qs: 'view=recent' },
  { name: 'view=received', qs: 'view=received' },
  { name: 'view=all + search + include=serials (fetch-limit bump)', qs: 'view=all&search=R-12&include=serials' },
  { name: 'view=activity default sort', qs: 'view=activity' },
  { name: 'view=activity sort=unbox_activity', qs: 'view=activity&sort=unbox_activity' },
  { name: 'view=all sort=unboxed_newest', qs: 'view=all&sort=unboxed_newest' },
  { name: 'view=recent sort=received_newest', qs: 'view=recent&sort=received_newest' },
  { name: 'view=recent sort=scanned_oldest', qs: 'view=recent&sort=scanned_oldest' },
  { name: 'view=unbox_opened', qs: 'view=unbox_opened' },
  { name: 'view=scanned (zoho exclusion applied)', qs: 'view=scanned', opts: { applyScannedZohoExclusion: true } },
  { name: 'view=scanned (physical-state-first, exclusion off)', qs: 'view=scanned', opts: { applyScannedZohoExclusion: false } },
  { name: 'view=scanned sort=priority', qs: 'view=scanned&sort=priority', opts: { applyScannedZohoExclusion: true } },
  { name: 'view=testing (all staff)', qs: 'view=testing' },
  { name: 'view=testing scoped to tester', qs: 'view=testing&tester=12' },
  { name: 'view=needs-test', qs: 'view=needs-test' },
  { name: 'view=needs-test scoped to tester', qs: 'view=needs-test&tester=12' },
  { name: 'view=viewed with viewer staff', qs: 'view=viewed', opts: { viewerStaffId: 42 } },
  { name: 'view=viewed without viewer (FALSE feed)', qs: 'view=viewed', opts: { viewerStaffId: NaN } },
  { name: 'view=incoming (legacy zoho-only, default sort)', qs: 'view=incoming' },
  { name: 'view=incoming sort=zoho_oldest + po date range', qs: 'view=incoming&sort=zoho_oldest&po_from=2026-01-01&po_to=2026-02-01' },
  { name: 'view=incoming sort=expected_soonest', qs: 'view=incoming&sort=expected_soonest' },
  { name: 'view=incoming sort=recently_added', qs: 'view=incoming&sort=recently_added' },
  { name: 'view=incoming malformed po range silently no-ops', qs: 'view=incoming&po_from=junk&po_to=2026-13-99x' },
  { name: 'view=incoming delivery_state=DELIVERED_UNOPENED', qs: 'view=incoming&delivery_state=delivered_unopened' },
  { name: 'view=incoming delivery_state=DELIVERED_NOT_UNBOXED', qs: 'view=incoming&delivery_state=delivered_not_unboxed' },
  { name: 'view=incoming delivery_state=DELIVERED_EMAIL', qs: 'view=incoming&delivery_state=DELIVERED_EMAIL' },
  { name: 'view=incoming delivery_state=ARRIVING_TODAY', qs: 'view=incoming&delivery_state=ARRIVING_TODAY' },
  { name: 'view=incoming delivery_state=STALLED', qs: 'view=incoming&delivery_state=STALLED' },
  { name: 'view=incoming delivery_state=IN_TRANSIT', qs: 'view=incoming&delivery_state=IN_TRANSIT' },
  { name: 'view=incoming delivery_state=AWAITING_TRACKING', qs: 'view=incoming&delivery_state=AWAITING_TRACKING' },
  { name: 'view=incoming delivery_state=PENDING_CARRIER', qs: 'view=incoming&delivery_state=PENDING_CARRIER' },
  { name: 'view=incoming delivery_state=CARRIER_MISMATCH', qs: 'view=incoming&delivery_state=CARRIER_MISMATCH' },
  { name: 'view=incoming unknown delivery_state ignored', qs: 'view=incoming&delivery_state=NOT_A_BUCKET' },
  { name: 'view=incoming universal + inbound=ebay + link=zoho_pending', qs: 'view=incoming&inbound=ebay&link=zoho_pending', opts: { universalIncoming: true } },
  { name: 'view=incoming universal + inbound=zoho', qs: 'view=incoming&inbound=zoho', opts: { universalIncoming: true } },
  { name: 'week range fallback (no view)', qs: 'week_start=2026-06-01&week_end=2026-06-07' },
  { name: 'malformed week range silently ignored', qs: 'week_start=junk&week_end=2026-06-07' },
  { name: 'limit clamp + offset', qs: 'limit=900&offset=40' },
  { name: 'junk limit degrades to NaN exactly like the old code', qs: 'limit=abc' },
  { name: 'unknown view falls back to default scoping', qs: 'view=bogus&search=x' },
  { name: 'kitchen sink: activity + search + staff + serials', qs: 'view=activity&search=R-99&staff=3&include=serials&sort=unbox_activity' },
];

for (const combo of LIST_COMBOS) {
  test(`list SQL matches legacy — ${combo.name}`, () => {
    const sp = new URLSearchParams(combo.qs);
    const opts: LegacySqlOpts = { ...DEFAULT_OPTS, ...combo.opts };
    const legacy = legacyBuildListSql(sp, opts);
    const next = buildReceivingLinesListSql({
      query: parseReceivingLinesQuery(sp),
      orgId: opts.orgId,
      viewerStaffId: opts.viewerStaffId,
      universalIncoming: opts.universalIncoming,
      applyScannedZohoExclusion: opts.applyScannedZohoExclusion,
    });
    assert.equal(next.list.sql, legacy.list.sql, 'list SQL text drifted from legacy');
    assert.deepEqual(next.list.params, legacy.list.params, 'list params drifted from legacy');
    assert.equal(next.count.sql, legacy.count.sql, 'count SQL text drifted from legacy');
    assert.deepEqual(next.count.params, legacy.count.params, 'count params drifted from legacy');
  });
}

// ── Single-row and by-receiving-id branches ───────────────────────────────────

test('single-row (?id=) SQL matches legacy', () => {
  const legacy = legacyBuildLineByIdSql(4821, ORG);
  const next = buildReceivingLineByIdSql(4821, ORG);
  assert.equal(next.sql, legacy.sql);
  assert.deepEqual(next.params, legacy.params);
});

test('?receiving_id= lines + package SQL matches legacy', () => {
  const legacy = legacyBuildLinesByReceivingIdSql(917, ORG);
  const next = buildReceivingLinesByReceivingIdSql(917, ORG);
  assert.equal(next.lines.sql, legacy.lines.sql);
  assert.deepEqual(next.lines.params, legacy.lines.params);
  assert.equal(next.pkg.sql, legacy.pkg.sql);
  assert.deepEqual(next.pkg.params, legacy.pkg.params);
});

// ── Placeholder feeds (unmatched / unbox-opened lineless cartons) ─────────────

const UNMATCHED_COMBOS: Combo[] = [
  { name: 'no search', qs: 'view=activity' },
  { name: 'search field=all', qs: 'view=all&search=1Z9' },
  { name: 'search field=po', qs: 'view=activity&search=PO-7&search_field=po' },
  { name: 'search field=tracking', qs: 'view=activity&search=9400&search_field=tracking' },
];

for (const combo of UNMATCHED_COMBOS) {
  test(`unmatched-placeholder SQL matches legacy — ${combo.name}`, () => {
    const sp = new URLSearchParams(combo.qs);
    const legacy = legacyBuildUnmatchedPlaceholdersSql(sp, { orgId: ORG });
    const next = buildUnmatchedPlaceholdersSql(parseReceivingLinesQuery(sp), ORG);
    assert.equal(next.list.sql, legacy.list.sql);
    assert.deepEqual(next.list.params, legacy.list.params);
    assert.equal(next.count.sql, legacy.count.sql);
    assert.deepEqual(next.count.params, legacy.count.params);
  });
}

const UNBOX_COMBOS: Combo[] = [
  { name: 'no search', qs: 'view=unbox_opened' },
  { name: 'search field=all', qs: 'view=unbox_opened&search=1Z9' },
  { name: 'search field=po', qs: 'view=unbox_opened&search=PO-7&search_field=po' },
  { name: 'search field=tracking', qs: 'view=unbox_opened&search=9400&search_field=tracking' },
];

for (const combo of UNBOX_COMBOS) {
  test(`unbox-opened-placeholder SQL matches legacy — ${combo.name}`, () => {
    const sp = new URLSearchParams(combo.qs);
    const legacy = legacyBuildUnboxOpenedPlaceholdersSql(sp, { orgId: ORG });
    const next = buildUnboxOpenedPlaceholdersSql(parseReceivingLinesQuery(sp), ORG);
    assert.equal(next.list.sql, legacy.list.sql);
    assert.deepEqual(next.list.params, legacy.list.params);
    assert.equal(next.count.sql, legacy.count.sql);
    assert.deepEqual(next.count.params, legacy.count.params);
  });
}

// ── Placeholder inclusion gates (mirrors the old inline booleans) ─────────────

test('unmatched placeholders included only for all/activity, non-zoho_po scope, non line-only fields', () => {
  const q = (qs: string) => parseReceivingLinesQuery(new URLSearchParams(qs));
  assert.equal(shouldIncludeUnmatchedPlaceholders(q('view=all')), true);
  assert.equal(shouldIncludeUnmatchedPlaceholders(q('view=activity')), true);
  assert.equal(shouldIncludeUnmatchedPlaceholders(q('view=recent')), false);
  assert.equal(shouldIncludeUnmatchedPlaceholders(q('view=scanned')), false);
  assert.equal(shouldIncludeUnmatchedPlaceholders(q('')), false);
  // `?search_scope=zoho_po` normalizes to 'all' (PO-only scope removed from the
  // History UI; legacy bookmarks read as All) — so the zoho_po gate can never
  // fire from a parsed query today. Preserved behavior, pinned here.
  assert.equal(shouldIncludeUnmatchedPlaceholders(q('view=all&search_scope=zoho_po')), true);
  // Line-only search fields (sku/product/serial) skip lineless placeholders.
  assert.equal(shouldIncludeUnmatchedPlaceholders(q('view=all&search_field=sku')), false);
  assert.equal(shouldIncludeUnmatchedPlaceholders(q('view=all&search_field=product')), false);
  assert.equal(shouldIncludeUnmatchedPlaceholders(q('view=all&search_field=serial')), false);
  assert.equal(shouldIncludeUnmatchedPlaceholders(q('view=all&search_field=po')), true);
  assert.equal(shouldIncludeUnmatchedPlaceholders(q('view=all&search_field=tracking')), true);
});

test('unbox-opened placeholders included only for view=unbox_opened with the same gates', () => {
  const q = (qs: string) => parseReceivingLinesQuery(new URLSearchParams(qs));
  assert.equal(shouldIncludeUnboxOpenedPlaceholders(q('view=unbox_opened')), true);
  assert.equal(shouldIncludeUnboxOpenedPlaceholders(q('view=all')), false);
  // Same normalizer fold as above: zoho_po scope reads as All post-parse.
  assert.equal(shouldIncludeUnboxOpenedPlaceholders(q('view=unbox_opened&search_scope=zoho_po')), true);
  assert.equal(shouldIncludeUnboxOpenedPlaceholders(q('view=unbox_opened&search_field=serial')), false);
  assert.equal(shouldIncludeUnboxOpenedPlaceholders(q('view=unbox_opened&search_field=tracking')), true);
});
