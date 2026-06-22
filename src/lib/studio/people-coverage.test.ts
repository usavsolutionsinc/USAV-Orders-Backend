/**
 * Unit tests for the People-lens coverage assembler (pure, no DB).
 *   node --import tsx --test src/lib/studio/people-coverage.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assemblePeopleCoverage,
  staffStationForNodeDepartment,
  DEPARTMENT_TO_STAFF_STATION,
} from './people-coverage';

test('department → staff_stations crosswalk: the non-identity hops', () => {
  // RECEIVING/LABELS don't exist in the staff enum — they must remap, not gap.
  assert.equal(staffStationForNodeDepartment('RECEIVING'), 'UNBOX');
  assert.equal(staffStationForNodeDepartment('LABELS'), 'PACK');
  // Identity hops.
  assert.equal(staffStationForNodeDepartment('TECH'), 'TECH');
  assert.equal(staffStationForNodeDepartment('PACK'), 'PACK');
  assert.equal(staffStationForNodeDepartment('FBA'), 'FBA');
  // Case-insensitive.
  assert.equal(staffStationForNodeDepartment('receiving'), 'UNBOX');
  // ADMIN / absent / unknown → no station (coverage gap).
  assert.equal(staffStationForNodeDepartment('ADMIN'), null);
  assert.equal(staffStationForNodeDepartment(null), null);
  assert.equal(staffStationForNodeDepartment(''), null);
  assert.equal(staffStationForNodeDepartment('SOMETHING_NEW'), null);
  // A future catalog key that is already a valid staff enum is accepted directly.
  assert.equal(staffStationForNodeDepartment('SALES'), 'SALES');
  // The crosswalk covers exactly the six catalog departments.
  assert.deepEqual(
    Object.keys(DEPARTMENT_TO_STAFF_STATION).sort(),
    ['ADMIN', 'FBA', 'LABELS', 'PACK', 'RECEIVING', 'TECH'],
  );
});

test('assembles per-node coverage, primary-first ordering, and gaps', () => {
  const r = assemblePeopleCoverage({
    nodes: [
      { id: 'n-unbox', station: 'RECEIVING' }, // → UNBOX
      { id: 'n-test', station: 'TECH' }, // → TECH
      { id: 'n-label', station: 'LABELS' }, // → PACK (shares with n-pack)
      { id: 'n-pack', station: 'PACK' }, // → PACK
      { id: 'n-admin', station: 'ADMIN' }, // → null (gap)
      { id: 'n-bare', station: null }, // no department (gap)
    ],
    assignments: [
      { staffId: 1, name: 'Bea', role: 'tech', station: 'TECH', isPrimary: false },
      { staffId: 2, name: 'Ana', role: 'tech', station: 'TECH', isPrimary: true },
      { staffId: 3, name: 'Cal', role: 'packer', station: 'PACK', isPrimary: true },
      { staffId: 4, name: 'Dan', role: 'unboxer', station: 'UNBOX', isPrimary: true },
      // A SALES staffer maps to no node in this graph — must not inflate totals.
      { staffId: 5, name: 'Eve', role: 'sales', station: 'SALES', isPrimary: true },
    ],
  });

  assert.equal(r.ok, true);

  // TECH node: both techs, primary (Ana) first, then alpha (Bea).
  assert.deepEqual(
    r.nodes['n-test'].staff.map((s) => s.id),
    [2, 1],
  );
  assert.equal(r.nodes['n-test'].coverage, 2);
  assert.equal(r.nodes['n-test'].station, 'TECH');

  // RECEIVING → UNBOX resolves Dan.
  assert.deepEqual(r.nodes['n-unbox'].staff.map((s) => s.id), [4]);
  assert.equal(r.nodes['n-unbox'].station, 'UNBOX');

  // LABELS and PACK both map to PACK → both covered by Cal.
  assert.equal(r.nodes['n-label'].station, 'PACK');
  assert.deepEqual(r.nodes['n-label'].staff.map((s) => s.id), [3]);
  assert.deepEqual(r.nodes['n-pack'].staff.map((s) => s.id), [3]);

  // ADMIN and bare nodes are uncovered.
  assert.equal(r.nodes['n-admin'].coverage, 0);
  assert.equal(r.nodes['n-admin'].station, null);
  assert.equal(r.nodes['n-bare'].coverage, 0);
  assert.deepEqual(r.uncoveredNodeIds.sort(), ['n-admin', 'n-bare']);

  // totalCovering = distinct staff actually covering a node (Eve excluded; Cal
  // counted once though he covers two nodes) → {Ana, Bea, Cal, Dan} = 4.
  assert.equal(r.totalCovering, 4);
});

test('empty graph / no assignments do not crash', () => {
  const r = assemblePeopleCoverage({ nodes: [], assignments: [] });
  assert.equal(r.ok, true);
  assert.equal(r.totalCovering, 0);
  assert.deepEqual(r.uncoveredNodeIds, []);
  assert.deepEqual(r.nodes, {});

  const r2 = assemblePeopleCoverage({
    nodes: [{ id: 'n1', station: 'TECH' }],
    assignments: [],
  });
  assert.equal(r2.nodes['n1'].coverage, 0);
  assert.deepEqual(r2.uncoveredNodeIds, ['n1']);
});
