import test from 'node:test';
import assert from 'node:assert/strict';
import { SURFACE_KEYS, getSurface, surfaceForRoute, type SurfaceKey } from '@/lib/stations/surface-keys';
import {
  getSidebarRouteKey,
  isMobileAllowedPath,
  permissionForPath,
  type SidebarRouteKey,
} from '@/lib/sidebar-navigation';

/**
 * Routing SoT consistency (operator-surfaces refactor Phase 11 — safe subset).
 *
 * Cross-checks the two key systems the plan wants unified — the `SurfaceKey`
 * registry (the operator-job SoT) and the runtime `SidebarRouteKey` nav contract
 * — so that every graduated surface route resolves to the right nav key,
 * permission, and mobile allowance. This pins the mapping as an executable
 * invariant now (the destructive `packer`→`pack` / `tech`→`test` id rename +
 * legacy-nav deletion are a separate, non-concurrent cleanup — see the plan's
 * Phase 11 status note), so any drift fails loudly.
 */

/** Each surface's canonical route → the nav route-key that owns its panel. */
const SURFACE_TO_ROUTE_KEY: Record<SurfaceKey, SidebarRouteKey> = {
  unbox: 'receiving',
  triage: 'receiving',
  incoming: 'receiving',
  pickup: 'receiving',
  history: 'receiving',
  pack: 'packer',
  test: 'tech',
  outbound: 'outbound',
};

test('every SurfaceKey route resolves to its expected nav route-key', () => {
  for (const key of SURFACE_KEYS) {
    const { route } = getSurface(key);
    assert.equal(
      getSidebarRouteKey(route),
      SURFACE_TO_ROUTE_KEY[key],
      `${key} (${route}) should resolve to nav key ${SURFACE_TO_ROUTE_KEY[key]}`,
    );
  }
});

test('every SurfaceKey route is permission-gated (ROUTE_PERMISSIONS)', () => {
  for (const key of SURFACE_KEYS) {
    const { route, permission } = getSurface(key);
    assert.equal(
      permissionForPath(route),
      permission,
      `${key} (${route}) should map to permission ${permission}`,
    );
  }
});

test('every SurfaceKey route is mobile-allowed', () => {
  for (const key of SURFACE_KEYS) {
    const { route } = getSurface(key);
    assert.equal(isMobileAllowedPath(route), true, `${key} (${route}) should be mobile-allowed`);
  }
});

test('every SurfaceKey route round-trips through surfaceForRoute', () => {
  for (const key of SURFACE_KEYS) {
    const { route } = getSurface(key);
    assert.equal(surfaceForRoute(route)?.key, key, `${route} should resolve back to surface ${key}`);
  }
});

// The legacy aliases each graduated surface redirects FROM must still resolve to
// the same nav key (the proxy 307s them, but a stray SSR/nav render of the legacy
// path must not fall through to 'unknown').
test('legacy alias paths resolve to the same nav route-key', () => {
  assert.equal(getSidebarRouteKey('/receiving'), 'receiving'); // unbox/triage/incoming/pickup/history bucket
  assert.equal(getSidebarRouteKey('/packer'), 'packer'); // pack
  assert.equal(getSidebarRouteKey('/tech'), 'tech'); // test
  assert.equal(getSidebarRouteKey('/outbound'), 'outbound');
});
