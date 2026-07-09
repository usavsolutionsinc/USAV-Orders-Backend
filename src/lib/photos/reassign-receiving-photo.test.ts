import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PhotoReassignError,
  reassignReceivingPhoto,
  type ReassignReceivingPhotoDeps,
  type ReassignReceivingPhotoScope,
} from './reassign-receiving-photo';

const ORG = 'org-1';

const FROM_RECEIVING: ReassignReceivingPhotoScope = {
  entityType: 'RECEIVING',
  entityId: 10,
  receivingId: 10,
  receivingLineId: null,
};

const TO_RECEIVING: ReassignReceivingPhotoScope = {
  entityType: 'RECEIVING',
  entityId: 20,
  receivingId: 20,
  receivingLineId: null,
};

function fakes(opts: {
  current?: ReassignReceivingPhotoScope | null;
  target?: ReassignReceivingPhotoScope | null;
} = {}) {
  const updates: Array<{
    organizationId: string;
    photoId: number;
    targetEntityType: 'RECEIVING' | 'RECEIVING_LINE';
    targetEntityId: number;
    poRef: string | null;
  }> = [];

  const deps: ReassignReceivingPhotoDeps = {
    loadPrimaryLink: async () => ('current' in opts ? (opts.current ?? null) : FROM_RECEIVING),
    resolveTarget: async () => ('target' in opts ? (opts.target ?? null) : TO_RECEIVING),
    updateAssignment: async (input) => {
      updates.push(input);
    },
  };

  return { deps, updates };
}

test('reassignReceivingPhoto moves primary link to another receiving carton', async () => {
  const { deps, updates } = fakes();
  const result = await reassignReceivingPhoto(
    {
      organizationId: ORG,
      photoId: 99,
      targetEntityType: 'RECEIVING',
      targetEntityId: 20,
    },
    deps,
  );

  assert.equal(result.idempotent, false);
  assert.equal(result.from.receivingId, 10);
  assert.equal(result.to.receivingId, 20);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].organizationId, ORG);
  assert.equal(updates[0].photoId, 99);
  assert.equal(updates[0].targetEntityType, 'RECEIVING');
  assert.equal(updates[0].targetEntityId, 20);
});

test('reassignReceivingPhoto is idempotent when target matches current link', async () => {
  const { deps, updates } = fakes({ target: FROM_RECEIVING });
  const result = await reassignReceivingPhoto(
    {
      organizationId: ORG,
      photoId: 99,
      targetEntityType: 'RECEIVING',
      targetEntityId: 10,
    },
    deps,
  );

  assert.equal(result.idempotent, true);
  assert.equal(updates.length, 0);
});

test('reassignReceivingPhoto returns 404 when photo is not a receiving photo', async () => {
  const { deps } = fakes({ current: null });
  await assert.rejects(
    () =>
      reassignReceivingPhoto(
        {
          organizationId: ORG,
          photoId: 99,
          targetEntityType: 'RECEIVING',
          targetEntityId: 20,
        },
        deps,
      ),
    (err: unknown) => {
      assert.ok(err instanceof PhotoReassignError);
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('reassignReceivingPhoto returns 404 when target entity is missing', async () => {
  const { deps } = fakes({ target: null });
  await assert.rejects(
    () =>
      reassignReceivingPhoto(
        {
          organizationId: ORG,
          photoId: 99,
          targetEntityType: 'RECEIVING',
          targetEntityId: 404,
        },
        deps,
      ),
    (err: unknown) => {
      assert.ok(err instanceof PhotoReassignError);
      assert.equal(err.status, 404);
      return true;
    },
  );
});
