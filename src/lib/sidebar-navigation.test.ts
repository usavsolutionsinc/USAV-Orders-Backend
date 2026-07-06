import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_SIDEBAR_NAV,
  getSidebarNavItems,
  isSidebarRouteMobileRestricted,
  SIDEBAR_PAGE_NAV,
  getSidebarPageNav,
  getSidebarHref,
  getSidebarRouteKey,
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
      const target = mode.to();
      // A mode legitimately sets/clears its OWN params (e.g. sourcing's lookup
      // clears `q`/`status`). `applyModeTarget` only preserves params the mode's
      // delta doesn't touch — so assert preservation for those keys only.
      const delta = target.params ?? {};
      const seed = new URLSearchParams('openOrderId=42&q=widget');
      const { pathname, search } = applyModeTarget({ pathname: page.href, params: seed }, target);
      const params = new URLSearchParams(search);
      if (!('openOrderId' in delta)) assert.equal(params.get('openOrderId'), '42', `${page.id} dropped openOrderId`);
      if (!('q' in delta)) assert.equal(params.get('q'), 'widget', `${page.id} dropped q`);
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

// getSidebarHref must resolve EVERY page id to its route — both the eight
// modeful pages (from SIDEBAR_PAGE_NAV) and the modeless ones (which live only
// in APP_SIDEBAR_NAV). This is the contract the master-nav write path relies on
// so modeless rows don't no-op back to the current pathname.
test('getSidebarHref resolves every sidebar page to its real route', () => {
  for (const item of APP_SIDEBAR_NAV) {
    assert.equal(getSidebarHref(item.id), item.href, `${item.id} href mismatch`);
  }
  // Pages resolve to their canonical href (modeful or modeless).
  assert.equal(getSidebarHref('operations'), '/operations');
  assert.equal(getSidebarHref('admin'), '/admin');
  assert.equal(getSidebarHref('settings'), '/settings');
  // Unknown ids resolve to null (caller falls back to current path).
  assert.equal(getSidebarHref('nope'), null);
});

// resolveSidebarMode returns null for single-surface pages (no mode row).
// NB: `support` gained tickets/voicemail/calls modes in SIDEBAR_PAGE_NAV, so it
// is no longer modeless — use `ai-chat`, which lives only in APP_SIDEBAR_NAV.
test('resolveSidebarMode returns null for pages without modes', () => {
  assert.equal(getSidebarPageNav('ai-chat'), undefined);
  assert.equal(resolveSidebarMode('ai-chat', { pathname: '/ai-chat', params: new URLSearchParams() }), null);
  assert.equal(resolveSidebarMode('settings', { pathname: '/settings', params: new URLSearchParams() }), null);
});

// Operations is modeful: bare /operations is Live; ?mode= drives the rest.
test('resolveSidebarMode reads the operations mode', () => {
  const at = (search = '') => ({ pathname: '/operations', params: new URLSearchParams(search) });
  assert.equal(resolveSidebarMode('operations', at()), 'live');
  assert.equal(resolveSidebarMode('operations', at('mode=analytics')), 'analytics');
  assert.equal(resolveSidebarMode('operations', at('mode=insights')), 'insights');
  assert.equal(resolveSidebarMode('operations', at('mode=history')), 'history');
  assert.equal(resolveSidebarMode('operations', at('mode=signals')), 'signals');
  assert.equal(resolveSidebarMode('operations', at('mode=bogus')), 'live');
});

// Packing is modeful: bare /pack is Standard; ?packMode= drives Fragile/Multi.
// The surface graduated /packer → /pack (operator-surfaces Phase 7); the mode is
// param-based so it resolves identically on either route.
test('resolveSidebarMode reads the packer pack-mode', () => {
  const at = (search = '') => ({ pathname: '/pack', params: new URLSearchParams(search) });
  assert.equal(resolveSidebarMode('packer', at()), 'standard');
  assert.equal(resolveSidebarMode('packer', at('packMode=fragile')), 'fragile');
  assert.equal(resolveSidebarMode('packer', at('packMode=multi')), 'multi');
  assert.equal(resolveSidebarMode('packer', at('packMode=bogus')), 'standard');
  // Legacy route still resolves the same mode (proxy redirects it to /pack).
  assert.equal(
    resolveSidebarMode('packer', { pathname: '/packer', params: new URLSearchParams() }),
    'standard',
  );
});

// The Pack surface + its legacy alias both resolve to the `packer` nav key so the
// sidebar item stays active across the migration.
test('getSidebarRouteKey maps the Pack surface + legacy alias to packer', () => {
  assert.equal(getSidebarRouteKey('/pack'), 'packer');
  assert.equal(getSidebarRouteKey('/pack/'), 'packer');
  assert.equal(getSidebarRouteKey('/packer'), 'packer');
});

// Spot-check the gnarly real-world deep-links the panels read today, so the
// resolver provably matches existing behavior (deep-link parity).
test('resolver matches existing panel derivations for known deep-links', () => {
  const at = (pathname: string, search = '') =>
    ({ pathname, params: new URLSearchParams(search) });

  // Receiving: mode param drives it; default receive. (The former unfound
  // sub-path was relocated to Admin › PO Mailbox.)
  assert.equal(resolveSidebarMode('receiving', at('/receiving', 'mode=incoming')), 'incoming');
  assert.equal(resolveSidebarMode('receiving', at('/receiving', 'mode=pickup')), 'pickup');
  assert.equal(resolveSidebarMode('receiving', at('/receiving')), 'receive');
  // Unbox + Triage are now their own first-class surface routes — resolved
  // path-based, even with a deep-link param present.
  assert.equal(resolveSidebarMode('receiving', at('/unbox')), 'receive');
  assert.equal(resolveSidebarMode('receiving', at('/unbox', 'recvId=123')), 'receive');
  assert.equal(resolveSidebarMode('receiving', at('/triage')), 'triage');
  assert.equal(resolveSidebarMode('receiving', at('/triage', 'triview=unfound')), 'triage');
  assert.equal(resolveSidebarMode('receiving', at('/incoming')), 'incoming');
  assert.equal(resolveSidebarMode('receiving', at('/incoming', 'state=IN_TRANSIT')), 'incoming');
  // Pickup + History graduated to their own routes (Phase 9) — resolved path-based
  // (`/receiving/history` must beat the `/receiving` params fall-through), while the
  // legacy `?mode=` deep-links still resolve for back-compat.
  assert.equal(resolveSidebarMode('receiving', at('/pickup')), 'pickup');
  assert.equal(resolveSidebarMode('receiving', at('/receiving/history')), 'history');
  assert.equal(resolveSidebarMode('receiving', at('/receiving/history', 'q=abc')), 'history');
  assert.equal(getSidebarRouteKey('/pickup'), 'receiving');
  assert.equal(getSidebarRouteKey('/receiving/history'), 'receiving');
  // FBA defaults to combine, not the leftmost-listed plan.
  assert.equal(resolveSidebarMode('fba', at('/fba')), 'combine');
  assert.equal(resolveSidebarMode('fba', at('/fba', 'mode=plan')), 'plan');
  // Dashboard: bare presence params, shipped wins; default + legacy ?pending → unshipped.
  assert.equal(resolveSidebarMode('dashboard', at('/dashboard', 'shipped=')), 'shipped');
  assert.equal(resolveSidebarMode('dashboard', at('/dashboard')), 'unshipped');
  assert.equal(resolveSidebarMode('dashboard', at('/dashboard', 'pending=')), 'unshipped');
  // Tech: top-mode switch only — view=testing flips to Testing, else Shipping.
  // The surface graduated /tech → /test (operator-surfaces Phase 8); the mode is
  // param-based so it resolves identically on the canonical route + legacy alias.
  assert.equal(resolveSidebarMode('tech', at('/test', 'view=testing')), 'testing');
  assert.equal(resolveSidebarMode('tech', at('/test', 'staffId=7')), 'shipping');
  assert.equal(resolveSidebarMode('tech', at('/tech', 'view=testing')), 'testing');
  assert.equal(resolveSidebarMode('tech', at('/tech', 'view=testing-history')), 'history');
});

// The Test surface + its legacy alias both resolve to the `tech` nav key so the
// sidebar item stays active across the migration.
test('getSidebarRouteKey maps the Test surface + legacy alias to tech', () => {
  assert.equal(getSidebarRouteKey('/test'), 'tech');
  assert.equal(getSidebarRouteKey('/test/'), 'tech');
  assert.equal(getSidebarRouteKey('/tech'), 'tech');
});
