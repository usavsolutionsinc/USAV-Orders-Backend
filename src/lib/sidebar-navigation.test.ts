import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_SIDEBAR_NAV,
  getSidebarNavItems,
  isSidebarRouteMobileRestricted,
  SIDEBAR_PAGE_NAV,
  getSidebarPageNav,
  applyModeTarget,
  resolveSidebarMode,
} from '@/lib/sidebar-navigation';

test('getSidebarNavItems returns the full sidebar list by default', () => {
  assert.deepEqual(getSidebarNavItems(), APP_SIDEBAR_NAV);
});

test('getSidebarNavItems omits mobile-restricted routes in mobile mode', () => {
  const navIds = getSidebarNavItems({ mobileRestricted: true }).map((item) => item.id);

  assert.equal(navIds.includes('operations'), false);
  assert.equal(navIds.includes('support'), false);
  assert.equal(navIds.includes('previous-quarters'), false);
  assert.equal(navIds.includes('admin'), false);
  assert.equal(navIds.includes('dashboard'), true);
  assert.equal(navIds.includes('fba'), true);
  // /repair is routed onto the 'walk-in' nav entry — there's no standalone
  // sidebar item for it.
  assert.equal(navIds.includes('walk-in'), true);
});

test('isSidebarRouteMobileRestricted only flags mobile-blocked routes', () => {
  assert.equal(isSidebarRouteMobileRestricted('operations'), true);
  assert.equal(isSidebarRouteMobileRestricted('support'), true);
  assert.equal(isSidebarRouteMobileRestricted('previous-quarters'), true);
  assert.equal(isSidebarRouteMobileRestricted('admin'), true);
  assert.equal(isSidebarRouteMobileRestricted('dashboard'), false);
  assert.equal(isSidebarRouteMobileRestricted('fba'), false);
  assert.equal(isSidebarRouteMobileRestricted('unknown'), false);
});

/* ──────────────── Master sidebar nav — page + mode config ──────────────── */

// The invariant that lets the master nav trust the config: navigating to a mode
// (the WRITE path, `to()`) and reading the active mode back from the resulting
// URL (the READ path, `resolveMode`) must agree for EVERY mode on EVERY page.
// If a page's URL convention drifts on one side only, this fails loudly.
test('every mode round-trips: resolveMode(apply(to(mode))) === mode', () => {
  for (const page of SIDEBAR_PAGE_NAV) {
    assert.ok(page.modes && page.modes.length > 0, `${page.id} should declare modes`);
    for (const mode of page.modes!) {
      // Start from the page's bare href with no params — the cold-link case.
      const { pathname, search } = applyModeTarget(
        { pathname: page.href, params: new URLSearchParams() },
        mode.to(),
      );
      const resolved = resolveSidebarMode(page.id, {
        pathname,
        params: new URLSearchParams(search),
      });
      assert.equal(
        resolved,
        mode.id,
        `${page.id} › ${mode.id} resolved as "${resolved}" from ${pathname}?${search}`,
      );
    }
  }
});

// Round-trip must also hold when unrelated query params are already present —
// `applyModeTarget` preserves them, and the resolver must ignore them.
test('mode round-trip preserves unrelated params and still resolves', () => {
  for (const page of SIDEBAR_PAGE_NAV) {
    for (const mode of page.modes!) {
      const seed = new URLSearchParams('openOrderId=42&q=widget');
      const { pathname, search } = applyModeTarget({ pathname: page.href, params: seed }, mode.to());
      const params = new URLSearchParams(search);
      assert.equal(params.get('openOrderId'), '42', `${page.id} dropped openOrderId`);
      assert.equal(params.get('q'), 'widget', `${page.id} dropped q`);
      assert.equal(resolveSidebarMode(page.id, { pathname, params }), mode.id);
    }
  }
});

// A page's bare href must resolve to one of its declared modes (its default).
// NB: the default isn't always the leftmost mode — FBA lists plan/combine/
// shipped but defaults to `combine`. The specific defaults are pinned in the
// deep-link spot-check below.
test("a page's bare href resolves to a declared mode (its default)", () => {
  for (const page of SIDEBAR_PAGE_NAV) {
    const resolved = resolveSidebarMode(page.id, {
      pathname: page.href,
      params: new URLSearchParams(),
    });
    const ids = page.modes!.map((m) => m.id);
    assert.ok(resolved && ids.includes(resolved), `${page.id} bare href resolved to "${resolved}", not a declared mode`);
  }
});

// Mode ids must be unique within a page (the dropdown + L2 rail key on them).
test('mode ids are unique within each page', () => {
  for (const page of SIDEBAR_PAGE_NAV) {
    const ids = page.modes!.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length, `${page.id} has duplicate mode ids`);
  }
});

// Every modeful page id must be a real nav route, and carry a resolver.
test('SIDEBAR_PAGE_NAV pages are real APP_SIDEBAR_NAV routes with resolvers', () => {
  const navIds = new Set(APP_SIDEBAR_NAV.map((item) => item.id));
  for (const page of SIDEBAR_PAGE_NAV) {
    assert.ok(navIds.has(page.id), `${page.id} is not in APP_SIDEBAR_NAV`);
    assert.equal(typeof page.resolveMode, 'function', `${page.id} missing resolveMode`);
  }
});

// resolveSidebarMode returns null for single-surface pages (no mode row).
test('resolveSidebarMode returns null for pages without modes', () => {
  assert.equal(getSidebarPageNav('support'), undefined);
  assert.equal(resolveSidebarMode('support', { pathname: '/support', params: new URLSearchParams() }), null);
  assert.equal(resolveSidebarMode('packer', { pathname: '/packer', params: new URLSearchParams() }), null);
});

// Spot-check the gnarly real-world deep-links the panels read today, so the
// resolver provably matches existing behavior (deep-link parity).
test('resolver matches existing panel derivations for known deep-links', () => {
  const at = (pathname: string, search = '') =>
    ({ pathname, params: new URLSearchParams(search) });

  // Receiving: unfound is a sub-path; mode param drives the rest.
  assert.equal(resolveSidebarMode('receiving', at('/receiving/unfound')), 'unfound');
  assert.equal(resolveSidebarMode('receiving', at('/receiving', 'mode=incoming')), 'incoming');
  assert.equal(resolveSidebarMode('receiving', at('/receiving')), 'receive');
  // FBA defaults to combine, not the leftmost-listed plan.
  assert.equal(resolveSidebarMode('fba', at('/fba')), 'combine');
  assert.equal(resolveSidebarMode('fba', at('/fba', 'mode=plan')), 'plan');
  // Dashboard: bare presence params, shipped wins over pending if both present.
  assert.equal(resolveSidebarMode('dashboard', at('/dashboard', 'shipped=')), 'shipped');
  assert.equal(resolveSidebarMode('dashboard', at('/dashboard')), 'pending');
  // Tech: view=testing flips the top mode.
  assert.equal(resolveSidebarMode('tech', at('/tech', 'view=testing')), 'testing');
  assert.equal(resolveSidebarMode('tech', at('/tech', 'staffId=7')), 'shipped');
});
