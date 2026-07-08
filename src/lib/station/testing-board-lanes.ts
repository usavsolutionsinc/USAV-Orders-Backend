/**
 * Testing history board lanes (station-table-unification-plan §4.5) — the TS SoT
 * for how a tested receiving line buckets by verdict. O3: keyed on the row's
 * `qa_status` (`PENDING` | `PASSED` | `FAILED`, from the line-level QA rollup)
 * plus `needs_test` for the re-test bucket. Dots from the label-registry tone map.
 */

import { TONE_CLASSES } from '@/lib/labels/registry';
import type { LabelTone } from '@/lib/labels/types';

export type TestingHistoryLane = 'PASS' | 'FAIL' | 'RETEST';
export type TestingLaneIconKey = 'check' | 'alert' | 'repeat';

export interface TestingLaneDescriptor {
  id: TestingHistoryLane;
  iconKey: TestingLaneIconKey;
  iconClass: string;
}

export const TESTING_HISTORY_BOARD_LANES: readonly TestingLaneDescriptor[] = [
  { id: 'PASS', iconKey: 'check', iconClass: 'text-emerald-500' },
  { id: 'FAIL', iconKey: 'alert', iconClass: 'text-rose-500' },
  { id: 'RETEST', iconKey: 'repeat', iconClass: 'text-amber-500' },
];

export interface TestingLaneMeta {
  label: string;
  description: string;
  tone: LabelTone;
  dot: string;
}

export const TESTING_HISTORY_STATE_META: Record<TestingHistoryLane, TestingLaneMeta> = {
  PASS: { label: 'Pass', description: 'Line passed QA.', tone: 'emerald', dot: TONE_CLASSES.emerald.dot },
  FAIL: { label: 'Fail', description: 'Line failed QA.', tone: 'rose', dot: TONE_CLASSES.rose.dot },
  RETEST: { label: 'Re-test', description: 'Needs re-test / still pending.', tone: 'amber', dot: TONE_CLASSES.amber.dot },
};

export interface TestingLaneInput {
  qa_status?: string | null;
  needs_test?: boolean | null;
}

export function bucketTestingHistoryLane(r: TestingLaneInput): TestingHistoryLane {
  const qa = String(r.qa_status || '').toUpperCase();
  if (qa.includes('FAIL')) return 'FAIL';
  if (qa.includes('PASS')) return 'PASS';
  // No terminal verdict yet (PENDING) or flagged for re-test → RETEST.
  return 'RETEST';
}
