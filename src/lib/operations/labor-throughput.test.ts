import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLaborThroughput,
  type LaborThroughputDeps,
  type StaffUnitsRow,
  type StaffHoursRow,
} from './labor-throughput';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '00000000-0000-0000-0000-000000000001' as unknown as OrgId;
const WINDOW = { from: new Date('2026-06-22T00:00:00Z'), to: new Date('2026-06-29T00:00:00Z') };

interface Captured {
  totalCalls: Array<{ orgId: OrgId; from: Date; to: Date }>;
  unitsCalls: Array<{ orgId: OrgId; from: Date; to: Date }>;
  hoursCalls: Array<{ orgId: OrgId; from: Date; to: Date }>;
}

function fakes(opts: { total: number; units: StaffUnitsRow[]; hours: StaffHoursRow[] }) {
  const cap: Captured = { totalCalls: [], unitsCalls: [], hoursCalls: [] };
  const deps: LaborThroughputDeps = {
    fetchTotalUnitsProcessed: async (orgId, from, to) => {
      cap.totalCalls.push({ orgId, from, to });
      return opts.total;
    },
    fetchUnitsByStaff: async (orgId, from, to) => {
      cap.unitsCalls.push({ orgId, from, to });
      return opts.units;
    },
    fetchLaborHoursByStaff: async (orgId, from, to) => {
      cap.hoursCalls.push({ orgId, from, to });
      return opts.hours;
    },
  };
  return { deps, cap };
}

test('computeLaborThroughput: composes units/hour and threads org + window into every dep', async () => {
  const { deps, cap } = fakes({
    total: 40,
    units: [
      { staffId: 1, staffName: 'Ana', unitsProcessed: 25 },
      { staffId: 2, staffName: 'Ben', unitsProcessed: 15 },
    ],
    hours: [
      { staffId: 1, staffName: 'Ana', laborHours: 10 },
      { staffId: 2, staffName: 'Ben', laborHours: 10 },
    ],
  });

  const out = await computeLaborThroughput(ORG, WINDOW, deps);

  // Aggregate: 40 units / 20 labor-hours = 2.0 units/hr.
  assert.equal(out.unitsProcessed, 40);
  assert.equal(out.laborHours, 20);
  assert.equal(out.unitsPerLaborHour, 2);

  // Per-staff merged by id, ratio computed per worker, sorted by units desc.
  assert.equal(out.perStaff.length, 2);
  assert.deepEqual(out.perStaff[0], {
    staffId: 1,
    staffName: 'Ana',
    unitsProcessed: 25,
    laborHours: 10,
    unitsPerLaborHour: 2.5,
  });
  assert.deepEqual(out.perStaff[1], {
    staffId: 2,
    staffName: 'Ben',
    unitsProcessed: 15,
    laborHours: 10,
    unitsPerLaborHour: 1.5,
  });

  // Threading: each dep got the org id and the exact window.
  assert.equal(cap.totalCalls.length, 1);
  assert.deepEqual(cap.totalCalls[0], { orgId: ORG, from: WINDOW.from, to: WINDOW.to });
  assert.deepEqual(cap.unitsCalls[0], { orgId: ORG, from: WINDOW.from, to: WINDOW.to });
  assert.deepEqual(cap.hoursCalls[0], { orgId: ORG, from: WINDOW.from, to: WINDOW.to });
});

test('computeLaborThroughput: zero labor hours never divides by zero', async () => {
  const { deps } = fakes({
    total: 12,
    units: [{ staffId: 1, staffName: 'Ana', unitsProcessed: 12 }],
    hours: [], // nobody clocked in
  });

  const out = await computeLaborThroughput(ORG, WINDOW, deps);

  assert.equal(out.unitsProcessed, 12);
  assert.equal(out.laborHours, 0);
  assert.equal(out.unitsPerLaborHour, 0, 'guarded: 12 / 0 → 0, not Infinity/NaN');
  assert.ok(Number.isFinite(out.unitsPerLaborHour));
  // The lone worker still appears, with 0 hours → 0/hr.
  assert.equal(out.perStaff[0].unitsPerLaborHour, 0);
  assert.equal(out.perStaff[0].laborHours, 0);
});

test('computeLaborThroughput: a worker in only one spine is merged with 0 on the other', async () => {
  const { deps } = fakes({
    total: 8,
    units: [{ staffId: 1, staffName: 'Ana', unitsProcessed: 8 }], // Ana processed, no clock
    hours: [{ staffId: 2, staffName: 'Ben', laborHours: 6 }],     // Ben clocked, no units
  });

  const out = await computeLaborThroughput(ORG, WINDOW, deps);

  // Total hours come from the hours spine only (6); units from the total (8).
  assert.equal(out.laborHours, 6);
  assert.equal(out.unitsProcessed, 8);
  assert.equal(out.unitsPerLaborHour, round2(8 / 6));

  const ana = out.perStaff.find((p) => p.staffId === 1)!;
  const ben = out.perStaff.find((p) => p.staffId === 2)!;
  assert.deepEqual(ana, { staffId: 1, staffName: 'Ana', unitsProcessed: 8, laborHours: 0, unitsPerLaborHour: 0 });
  assert.deepEqual(ben, { staffId: 2, staffName: 'Ben', unitsProcessed: 0, laborHours: 6, unitsPerLaborHour: 0 });
});

test('computeLaborThroughput: fractional hours round to 2dp and stay finite', async () => {
  const { deps } = fakes({
    total: 10,
    units: [{ staffId: 1, staffName: 'Ana', unitsProcessed: 10 }],
    hours: [{ staffId: 1, staffName: 'Ana', laborHours: 3 }],
  });

  const out = await computeLaborThroughput(ORG, WINDOW, deps);
  // 10 / 3 = 3.333… → 3.33
  assert.equal(out.unitsPerLaborHour, 3.33);
  assert.equal(out.perStaff[0].unitsPerLaborHour, 3.33);
});

/** Local mirror of the module's rounding so the expectation is explicit. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
