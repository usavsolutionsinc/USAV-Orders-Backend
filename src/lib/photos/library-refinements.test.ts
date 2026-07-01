import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPhotoLibraryRefinements } from '@/lib/photos/library-refinements';

test('buildPhotoLibraryRefinements uses staff names when provided', () => {
  const refinements = buildPhotoLibraryRefinements(
    {
      sourceScope: 'packing',
      poRef: '4421',
      staffId: '9',
      damageDetected: 'true',
    },
    {
      patch: () => undefined,
      setDatePreset: () => undefined,
      clearStructured: () => undefined,
    },
    {
      staffNameForId: (id) => (id === '9' ? 'Morgan Lee' : undefined),
    },
  );

  assert.deepEqual(
    refinements.map((refinement) => refinement.label),
    ['Morgan Lee', 'Damage detected'],
  );
});
