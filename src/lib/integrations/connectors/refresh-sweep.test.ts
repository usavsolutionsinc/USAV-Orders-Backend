/**
 * Run: npx tsx --test src/lib/integrations/connectors/refresh-sweep.test.ts
 * (wired as `npm run test:refresh-sweep`)
 *
 * DB-free: fakes() injects RefreshSweepDeps and captures collaborator calls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OrgId } from '@/lib/tenancy/constants';
import type { IntegrationConnector } from './types';
import {
  DEFAULT_REFRESH_THRESHOLD_MINUTES,
  runTokenRefreshSweep,
  type ExpiringConnection,
  type RefreshSweepDeps,
} from './refresh-sweep';

const ORG_A = 'org-a' as OrgId;
const ORG_B = 'org-b' as OrgId;
const NOW = new Date('2026-07-09T12:00:00Z');

function conn(orgId: OrgId, provider: string, scope: string | null = null): ExpiringConnection {
  return { orgId, provider, scope, expiresAt: new Date(NOW.getTime() + 10 * 60_000) };
}

function fakes(rows: ExpiringConnection[], connectors: Record<string, Partial<IntegrationConnector>>) {
  const calls = {
    listThresholds: [] as Date[],
    refreshes: [] as Array<{ provider: string; orgId: OrgId; scope: string | null | undefined }>,
  };
  const deps: RefreshSweepDeps = {
    listExpiringConnections: async (threshold) => {
      calls.listThresholds.push(threshold);
      return rows;
    },
    getConnector: (provider) => {
      const c = connectors[provider];
      if (!c) return undefined;
      return {
        provider,
        authKind: 'oauth',
        capabilities: [],
        ...c,
        refresh: c.refresh
          ? async (orgId: OrgId, scope?: string | null) => {
              calls.refreshes.push({ provider, orgId, scope });
              return c.refresh!(orgId, scope);
            }
          : undefined,
      } as IntegrationConnector;
    },
    now: () => NOW,
  };
  return { deps, calls };
}

test('refreshes each expiring connection whose connector defines refresh()', async () => {
  const { deps, calls } = fakes(
    [conn(ORG_A, 'google_drive'), conn(ORG_B, 'google_drive', 'drive-2')],
    { google_drive: { refresh: async () => null } },
  );
  const result = await runTokenRefreshSweep({}, deps);

  assert.equal(result.scanned, 2);
  assert.equal(result.refreshed, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.failures, 0);
  // refresh() received the org and the row's scope.
  assert.deepEqual(calls.refreshes, [
    { provider: 'google_drive', orgId: ORG_A, scope: null },
    { provider: 'google_drive', orgId: ORG_B, scope: 'drive-2' },
  ]);
});

test('providers without a wired refresh() are skipped, not failed', async () => {
  const { deps, calls } = fakes(
    [conn(ORG_A, 'ecwid'), conn(ORG_A, 'google_drive')],
    { ecwid: {}, google_drive: { refresh: async () => null } },
  );
  const result = await runTokenRefreshSweep({}, deps);

  assert.equal(result.scanned, 2);
  assert.equal(result.refreshed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failures, 0);
  assert.equal(result.attempts[0].skipped, 'no-refresh');
  assert.equal(calls.refreshes.length, 1);
});

test('unknown/legacy provider strings are skipped', async () => {
  const { deps } = fakes([conn(ORG_A, 'stale_provider')], {});
  const result = await runTokenRefreshSweep({}, deps);
  assert.equal(result.skipped, 1);
  assert.equal(result.failures, 0);
});

test('a throwing refresh() is recorded as a failure and does not stop the sweep', async () => {
  const { deps, calls } = fakes(
    [conn(ORG_A, 'google_drive'), conn(ORG_B, 'google_drive')],
    {
      google_drive: {
        refresh: async (orgId) => {
          if (orgId === ORG_A) throw new Error('revoked');
          return null;
        },
      },
    },
  );
  const result = await runTokenRefreshSweep({}, deps);

  assert.equal(result.failures, 1);
  assert.equal(result.refreshed, 1);
  assert.equal(result.attempts[0].error, 'revoked');
  assert.equal(calls.refreshes.length, 2, 'the second connection still runs after the first fails');
});

test('threshold window derives from now() + thresholdMinutes (default 60)', async () => {
  const { deps, calls } = fakes([], {});
  await runTokenRefreshSweep({}, deps);
  assert.equal(
    calls.listThresholds[0].getTime(),
    NOW.getTime() + DEFAULT_REFRESH_THRESHOLD_MINUTES * 60_000,
  );

  await runTokenRefreshSweep({ thresholdMinutes: 5 }, deps);
  assert.equal(calls.listThresholds[1].getTime(), NOW.getTime() + 5 * 60_000);
});
