/**
 * OrgSettings schema validation — defensive parse never crashes the request
 * path, even on bizarre persisted values.
 */

import { test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { parseOrgSettings, getPhotoAnalysisSettings } from './settings';

test('returns defaults for null/undefined/empty input', () => {
  const fromNull = parseOrgSettings(null);
  strictEqual(fromNull.timezone, 'America/Los_Angeles');
  strictEqual(fromNull.currency, 'USD');
  strictEqual(fromNull.emailFirstSignin, false);

  const fromUndefined = parseOrgSettings(undefined);
  strictEqual(fromUndefined.timezone, 'America/Los_Angeles');

  const fromEmpty = parseOrgSettings({});
  strictEqual(fromEmpty.locale, 'en-US');
});

test('preserves valid overrides and merges over defaults', () => {
  const s = parseOrgSettings({
    timezone: 'America/New_York',
    currency: 'EUR',
    brand: { name: 'Acme', primaryColor: '#0066ff' },
    maxConcurrentSessions: 3,
  });
  strictEqual(s.timezone, 'America/New_York');
  strictEqual(s.currency, 'EUR');
  strictEqual(s.brand.name, 'Acme');
  strictEqual(s.brand.primaryColor, '#0066ff');
  strictEqual(s.maxConcurrentSessions, 3);
  // Defaults still apply for fields not overridden.
  strictEqual(s.locale, 'en-US');
});

test('falls back to defaults when input is malformed', () => {
  // Currency must be exactly 3 chars; a 5-char string should trigger the
  // safeParse fallback to defaults rather than throwing.
  const s = parseOrgSettings({ currency: 'EUROS', timezone: 12345 });
  strictEqual(s.currency, 'USD');
  strictEqual(s.timezone, 'America/Los_Angeles');
});

test('passthrough preserves unknown keys', () => {
  const s = parseOrgSettings({ timezone: 'UTC', customKey: 'preserved' });
  deepStrictEqual((s as { customKey?: string }).customKey, 'preserved');
});

test('photoAnalysis: unset leaves provider/enabled undefined (resolver decides default)', () => {
  const s = parseOrgSettings({});
  const pa = getPhotoAnalysisSettings(s);
  strictEqual(pa.provider, undefined);
  strictEqual(pa.enabled, undefined);
  strictEqual(pa.localVisionBaseUrl, '');
});

test('photoAnalysis: a valid explicit provider is preserved', () => {
  const s = parseOrgSettings({
    photoAnalysis: { provider: 'local-vision', enabled: true, localVisionBaseUrl: 'https://vision.example' },
  });
  const pa = getPhotoAnalysisSettings(s);
  strictEqual(pa.provider, 'local-vision');
  strictEqual(pa.enabled, true);
  strictEqual(pa.localVisionBaseUrl, 'https://vision.example');
});

test('photoAnalysis: a bogus provider falls the whole settings parse back to defaults', () => {
  // enum violation → safeParse fails → defaults; provider unset, not crashed.
  const s = parseOrgSettings({ photoAnalysis: { provider: 'midjourney' } });
  strictEqual(getPhotoAnalysisSettings(s).provider, undefined);
});
