/**
 * Per-org provider resolution — precedence (org → env → local-first default),
 * the legacy `vision` alias, and graceful coercion of junk. Pure, DB-free.
 *
 * Run: npx tsx --test src/lib/photos/analyze-provider.test.ts
 */

import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import {
  normalizeProvider,
  resolvePhotoAnalyzeProvider,
  resolvePhotoAnalyzeEnabled,
  DEFAULT_PHOTO_ANALYZE_PROVIDER,
} from './analyze-provider';
import type { PhotoAnalysisSettings } from '@/lib/tenancy/settings';

const pa = (over: Partial<PhotoAnalysisSettings>): PhotoAnalysisSettings => ({
  localVisionBaseUrl: '',
  ...over,
});

test('the product default is local-first', () => {
  strictEqual(DEFAULT_PHOTO_ANALYZE_PROVIDER, 'local-vision');
});

test('normalizeProvider maps legacy + alias spellings', () => {
  strictEqual(normalizeProvider('vision'), 'gcp-vision'); // legacy env value
  strictEqual(normalizeProvider('gcp'), 'gcp-vision');
  strictEqual(normalizeProvider('GCP-Vision'), 'gcp-vision');
  strictEqual(normalizeProvider('local'), 'local-vision');
  strictEqual(normalizeProvider('vision-box'), 'local-vision');
  strictEqual(normalizeProvider('hermes'), 'hermes');
  strictEqual(normalizeProvider('off'), 'catalog');
  strictEqual(normalizeProvider('catalog'), 'catalog');
});

test('normalizeProvider returns null for junk / empty / nullish', () => {
  strictEqual(normalizeProvider('midjourney'), null);
  strictEqual(normalizeProvider(''), null);
  strictEqual(normalizeProvider('   '), null);
  strictEqual(normalizeProvider(null), null);
  strictEqual(normalizeProvider(undefined), null);
});

test('precedence 1: an explicit org setting wins over the env', () => {
  strictEqual(
    resolvePhotoAnalyzeProvider(pa({ provider: 'gcp-vision' }), 'local-vision'),
    'gcp-vision',
  );
  strictEqual(
    resolvePhotoAnalyzeProvider(pa({ provider: 'local-vision' }), 'hermes'),
    'local-vision',
  );
});

test('precedence 2: env decides when the org has no explicit provider', () => {
  strictEqual(resolvePhotoAnalyzeProvider(pa({}), 'hermes'), 'hermes');
  strictEqual(resolvePhotoAnalyzeProvider(undefined, 'vision'), 'gcp-vision');
});

test('precedence 3: local-first default when neither org nor env is set', () => {
  strictEqual(resolvePhotoAnalyzeProvider(undefined, undefined), 'local-vision');
  strictEqual(resolvePhotoAnalyzeProvider(pa({}), ''), 'local-vision');
  // A junk env value is ignored, not honored.
  strictEqual(resolvePhotoAnalyzeProvider(pa({}), 'nonsense'), 'local-vision');
});

test('enabled: per-org flag wins over env when explicitly set', () => {
  strictEqual(resolvePhotoAnalyzeEnabled(pa({ enabled: true }), false), true);
  strictEqual(resolvePhotoAnalyzeEnabled(pa({ enabled: false }), true), false);
});

test('enabled: env decides when the org has not set the flag', () => {
  strictEqual(resolvePhotoAnalyzeEnabled(pa({}), true), true);
  strictEqual(resolvePhotoAnalyzeEnabled(pa({}), false), false);
  strictEqual(resolvePhotoAnalyzeEnabled(undefined, true), true);
});
