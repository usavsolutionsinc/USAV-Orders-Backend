import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_SIDEBAR_NAV,
  getSidebarNavItems,
  isSidebarRouteMobileRestricted,
} from '@/lib/sidebar-navigation';

test('getSidebarNavItems returns the full sidebar list by default', () => {
  assert.deepEqual(getSidebarNavItems(), APP_SIDEBAR_NAV);
});

test('getSidebarNavItems omits mobile-restricted routes in mobile mode', () => {
  const navIds = getSidebarNavItems({ mobileRestricted: true }).map((item) => item.id);

  assert.equal(navIds.includes('operations'), false);
  assert.equal(navIds.includes('work-orders'), false);
  assert.equal(navIds.includes('manuals'), false);
  assert.equal(navIds.includes('support'), false);
  assert.equal(navIds.includes('previous-quarters'), false);
  assert.equal(navIds.includes('admin'), false);
  assert.equal(navIds.includes('dashboard'), true);
  assert.equal(navIds.includes('fba'), true);
  assert.equal(navIds.includes('repair'), true);
});

test('isSidebarRouteMobileRestricted only flags mobile-blocked routes', () => {
  assert.equal(isSidebarRouteMobileRestricted('operations'), true);
  assert.equal(isSidebarRouteMobileRestricted('work-orders'), true);
  assert.equal(isSidebarRouteMobileRestricted('manuals'), true);
  assert.equal(isSidebarRouteMobileRestricted('support'), true);
  assert.equal(isSidebarRouteMobileRestricted('previous-quarters'), true);
  assert.equal(isSidebarRouteMobileRestricted('admin'), true);
  assert.equal(isSidebarRouteMobileRestricted('dashboard'), false);
  assert.equal(isSidebarRouteMobileRestricted('fba'), false);
  assert.equal(isSidebarRouteMobileRestricted('unknown'), false);
});
