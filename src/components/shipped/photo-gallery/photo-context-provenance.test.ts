import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describePhotoWorkflow,
  resolveLinkedEntityDisplay,
  resolveProvenanceNavLink,
} from './photo-context-provenance';

test('describePhotoWorkflow badges receiving type without poRef', () => {
  const workflow = describePhotoWorkflow({ photoType: 'RECEIVING', sourceScope: 'unboxing' });
  assert.equal(workflow.kind, 'unboxing');
  assert.equal(workflow.label, 'Unboxing');
});

test('resolveLinkedEntityDisplay separates workflow from missing PO', () => {
  const workflow = describePhotoWorkflow({ photoType: 'RECEIVING', sourceScope: 'unboxing' });
  const linked = resolveLinkedEntityDisplay(workflow, { photoType: 'RECEIVING' }, null);
  assert.equal(linked.primary, null);
  assert.equal(linked.missingHeadline, 'PO not recorded');
  assert.match(linked.missingDetail ?? '', /receiving/i);
});

test('resolveLinkedEntityDisplay shows PO when poRef exists', () => {
  const workflow = describePhotoWorkflow({ photoType: 'RECEIVING', sourceScope: 'unboxing', poRef: '4421' });
  const linked = resolveLinkedEntityDisplay(workflow, { poRef: '4421', photoType: 'RECEIVING' }, null);
  assert.equal(linked.primary, 'PO 4421');
  assert.equal(linked.missingHeadline, null);
});

test('resolveProvenanceNavLink falls back to workflow scope without poRef', () => {
  const workflow = describePhotoWorkflow({ photoType: 'RECEIVING', sourceScope: 'unboxing' });
  const link = resolveProvenanceNavLink(workflow, { photoType: 'RECEIVING' });
  assert.equal(link?.href, '/ops/photos?sourceScope=unboxing');
  assert.equal(link?.label, 'Browse unboxing photos');
});

test('resolveProvenanceNavLink entity-scopes when poRef exists', () => {
  const workflow = describePhotoWorkflow({ photoType: 'RECEIVING', poRef: '4421' });
  const link = resolveProvenanceNavLink(workflow, { poRef: '4421', photoType: 'RECEIVING' });
  assert.equal(link?.href, '/ops/photos?sourceScope=unboxing&poRef=4421');
  assert.equal(link?.label, 'View all from PO 4421');
});
