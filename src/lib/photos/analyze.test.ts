/**
 * analyzePhoto orchestration — routes to the provider the ORG chose, degrades to
 * catalog metadata on any null, and persists the right model tag. Zero DB: every
 * collaborator is a captured fake (the repo's Deps-injection pattern).
 *
 * Run: npx tsx --test src/lib/photos/analyze.test.ts
 */

import { test } from 'node:test';
import { strictEqual, deepStrictEqual, rejects, ok } from 'node:assert';
import { analyzePhoto, type AnalyzePhotoDeps, type PhotoAnalyzeContext } from './analyze-core';
import type { PhotoAnalysisMetadata } from './analyze-types';

const META = (over: Partial<PhotoAnalysisMetadata> = {}): PhotoAnalysisMetadata => ({
  ocr_text: ['SN123'],
  labels: ['BOSE-QC35'],
  damage_detected: false,
  damage_notes: null,
  caption: 'a photo',
  ...over,
});

const CTX = (over: Partial<PhotoAnalyzeContext>): PhotoAnalyzeContext => ({
  poRef: 'PO-1',
  photoType: 'receiving',
  entityType: 'RECEIVING',
  provider: 'local-vision',
  localVisionConfig: { baseUrl: 'https://vision.example', token: 't' },
  ...over,
});

interface Capture {
  persisted: Array<{ model: string; metadata: PhotoAnalysisMetadata }>;
  localCalls: number;
  gcpCalls: number;
  hermesCalls: number;
  readCalls: number;
}

function fakes(
  ctx: PhotoAnalyzeContext | null,
  over: Partial<AnalyzePhotoDeps> = {},
): { deps: AnalyzePhotoDeps; cap: Capture } {
  const cap: Capture = { persisted: [], localCalls: 0, gcpCalls: 0, hermesCalls: 0, readCalls: 0 };
  const deps: AnalyzePhotoDeps = {
    loadContext: async () => ctx,
    readBytes: async () => {
      cap.readCalls++;
      return { bytes: new Uint8Array([1, 2, 3]), filename: 'photo.jpg' };
    },
    runHermes: async () => {
      cap.hermesCalls++;
      return { metadata: META({ caption: 'hermes' }), model: 'hermes:gemma' };
    },
    runGcpVision: async () => {
      cap.gcpCalls++;
      return META({ caption: 'gcp' });
    },
    runLocalVision: async () => {
      cap.localCalls++;
      return META({ caption: 'local' });
    },
    persist: async (args) => {
      cap.persisted.push({ model: args.model, metadata: args.metadata });
    },
    ...over,
  };
  return { deps, cap };
}

test('local-vision: runs the box with bytes+config and persists model=local-vision', async () => {
  let seenConfig: unknown = null;
  let seenFilename = '';
  const { deps, cap } = fakes(CTX({ provider: 'local-vision' }), {
    runLocalVision: async (_buf, config, filename) => {
      seenConfig = config;
      seenFilename = filename;
      return META({ caption: 'local' });
    },
  });
  const meta = await analyzePhoto({ photoId: 7, organizationId: 'org-1' }, deps);

  strictEqual(cap.localCalls, 0); // overridden impl used instead
  strictEqual(cap.readCalls, 1);
  deepStrictEqual(seenConfig, { baseUrl: 'https://vision.example', token: 't' });
  strictEqual(seenFilename, 'photo.jpg');
  strictEqual(meta.caption, 'local');
  strictEqual(cap.persisted[0].model, 'local-vision');
});

test('local-vision returns null → catalog fallback (deterministic, not a throw)', async () => {
  const { deps, cap } = fakes(CTX({ provider: 'local-vision', poRef: 'PO-9' }), {
    runLocalVision: async () => null,
  });
  const meta = await analyzePhoto({ photoId: 1, organizationId: 'org-1' }, deps);
  strictEqual(cap.persisted[0].model, 'catalog-fallback');
  deepStrictEqual(meta.ocr_text, ['PO PO-9']);
  strictEqual(meta.damage_detected, false);
});

test('local-vision with no bytes available → catalog fallback, box never called', async () => {
  const { deps, cap } = fakes(CTX({ provider: 'local-vision' }), {
    readBytes: async () => null,
  });
  const meta = await analyzePhoto({ photoId: 1, organizationId: 'org-1' }, deps);
  strictEqual(cap.localCalls, 0);
  strictEqual(cap.persisted[0].model, 'catalog-fallback');
  strictEqual(meta.caption, 'Photo for PO PO-1');
});

test('gcp-vision: reads bytes, runs GCP, persists model=gcp-vision', async () => {
  const { deps, cap } = fakes(CTX({ provider: 'gcp-vision' }));
  const meta = await analyzePhoto({ photoId: 2, organizationId: 'org-1' }, deps);
  strictEqual(cap.gcpCalls, 1);
  strictEqual(cap.localCalls, 0);
  strictEqual(meta.caption, 'gcp');
  strictEqual(cap.persisted[0].model, 'gcp-vision');
});

test('hermes: no bytes read, uses hermes model string', async () => {
  const { deps, cap } = fakes(CTX({ provider: 'hermes' }));
  const meta = await analyzePhoto({ photoId: 3, organizationId: 'org-1' }, deps);
  strictEqual(cap.hermesCalls, 1);
  strictEqual(cap.readCalls, 0); // hermes is context-only, never touches bytes
  strictEqual(meta.caption, 'hermes');
  strictEqual(cap.persisted[0].model, 'hermes:gemma');
});

test('catalog: no provider is invoked at all', async () => {
  const { deps, cap } = fakes(CTX({ provider: 'catalog', poRef: 'PO-42' }));
  const meta = await analyzePhoto({ photoId: 4, organizationId: 'org-1' }, deps);
  strictEqual(cap.localCalls + cap.gcpCalls + cap.hermesCalls + cap.readCalls, 0);
  strictEqual(cap.persisted[0].model, 'catalog-fallback');
  strictEqual(meta.caption, 'Photo for PO PO-42');
});

test('missing photo → throws Photo not found, nothing persisted', async () => {
  const { deps, cap } = fakes(null);
  await rejects(() => analyzePhoto({ photoId: 999, organizationId: 'org-1' }, deps), /Photo not found/);
  strictEqual(cap.persisted.length, 0);
});

test('persisted metadata is exactly the returned metadata', async () => {
  const { deps, cap } = fakes(CTX({ provider: 'local-vision' }), {
    runLocalVision: async () => META({ caption: 'local', labels: ['X', 'Y'] }),
  });
  const meta = await analyzePhoto({ photoId: 5, organizationId: 'org-1' }, deps);
  ok(cap.persisted.length === 1);
  deepStrictEqual(cap.persisted[0].metadata, meta);
});
