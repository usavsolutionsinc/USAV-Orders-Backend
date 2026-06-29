'use client';

import { useCallback, useRef, type WheelEvent } from 'react';

/**
 * Verdict the tech assigns to a receiving line during the testing step.
 *
 *   pass         → workflow_status='PASSED',     qa_status='PASSED'
 *   test_again   → workflow_status='IN_TEST',    qa_status='PENDING'   (stays in queue)
 *   testing_failed → workflow_status='FAILED',   qa_status='FAILED_FUNCTIONAL'
 *
 * The DB enums and persistence layer are unchanged from receiving (see
 * `lib/receiving/receive-line.ts` and `mark-received-po`); we just narrow
 * the visible choices and add a third 'TEST_AGAIN' affordance for re-queue.
 */
export type TestingVerdict = 'PASS' | 'TEST_AGAIN' | 'TESTING_FAILED';

interface Props {
  value: TestingVerdict | null | undefined;
  onChange: (next: TestingVerdict) => void;
  disabled?: boolean;
}

const TEST_OPTS: Array<{
  value: TestingVerdict;
  label: string;
  tone: { active: string; inactive: string };
}> = [
  {
    value: 'PASS',
    label: 'Pass',
    tone: {
      active: 'bg-emerald-600 text-white shadow-sm shadow-emerald-200 ring-emerald-700',
      inactive: 'bg-white text-emerald-800 ring-emerald-200 hover:bg-emerald-50',
    },
  },
  {
    value: 'TEST_AGAIN',
    label: 'Test Again',
    tone: {
      active: 'bg-amber-500 text-white shadow-sm shadow-amber-200 ring-amber-600',
      inactive: 'bg-white text-amber-800 ring-amber-200 hover:bg-amber-50',
    },
  },
  {
    value: 'TESTING_FAILED',
    label: 'Testing Failed',
    tone: {
      active: 'bg-rose-600 text-white shadow-sm shadow-rose-200 ring-rose-700',
      inactive: 'bg-white text-rose-800 ring-rose-200 hover:bg-rose-50',
    },
  },
];

/**
 * Testing verdict picker. Mirrors {@link ConditionPills}' visual primitive
 * (ring-pill row, horizontal-scroll, radio semantics) so the receiving and
 * testing forms feel identical — only the choices differ. Tones intentionally
 * encode meaning: green = ship-ready, amber = re-queue, rose = fail/claim.
 */
export function TestingStatusPills({ value, onChange, disabled = false }: Props) {
  const selected = (value ?? '').toUpperCase();
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const onWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }, []);

  return (
    <div
      ref={scrollerRef}
      onWheel={onWheel}
      role="radiogroup"
      aria-label="Testing verdict"
      aria-disabled={disabled || undefined}
      className={`-mx-1 flex gap-1.5 overflow-x-auto overscroll-x-contain px-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${
        disabled ? 'pointer-events-none opacity-60' : ''
      }`}
    >
      {TEST_OPTS.map((opt) => {
        const isActive = selected === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(opt.value)}
            disabled={disabled}
            className={`ds-raw-button inline-flex h-9 shrink-0 snap-start items-center whitespace-nowrap rounded-full px-4 text-caption font-black uppercase tracking-[0.1em] ring-1 ring-inset transition-all active:scale-[0.98] ${
              isActive ? opt.tone.active : opt.tone.inactive
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Translate a {@link TestingVerdict} into the receiving-lines PATCH body. */
export function verdictToReceivingLinePatch(verdict: TestingVerdict): {
  workflow_status: string;
  qa_status: string;
  disposition_code: string;
} {
  switch (verdict) {
    case 'PASS':
      return {
        workflow_status: 'PASSED',
        qa_status: 'PASSED',
        disposition_code: 'ACCEPT',
      };
    case 'TEST_AGAIN':
      return {
        workflow_status: 'IN_TEST',
        qa_status: 'PENDING',
        disposition_code: 'HOLD',
      };
    case 'TESTING_FAILED':
      return {
        workflow_status: 'FAILED',
        qa_status: 'FAILED_FUNCTIONAL',
        disposition_code: 'REJECT',
      };
  }
}

/** Best-effort reverse mapping for the initial verdict shown to the tech. */
export function workflowToVerdict(
  workflow: string | null | undefined,
): TestingVerdict | null {
  const v = String(workflow ?? '').trim().toUpperCase();
  if (v === 'PASSED' || v === 'DONE') return 'PASS';
  if (v === 'IN_TEST' || v === 'AWAITING_TEST') return 'TEST_AGAIN';
  if (v === 'FAILED' || v.startsWith('FAILED_')) return 'TESTING_FAILED';
  return null;
}

/**
 * Derive the per-unit verdict from a `serial_units.current_status` value.
 *
 * The /api/serial-units/[id]/test endpoint writes these transitions:
 *   PASS         → 'TESTED'
 *   TEST_AGAIN   → 'IN_TEST'
 *   TESTING_FAIL → 'ON_HOLD'
 *
 * Everything else (RECEIVED, GRADED, UNKNOWN, etc.) reads as "no verdict
 * picked yet" so the pills render unselected.
 */
export function unitStatusToVerdict(
  status: string | null | undefined,
): TestingVerdict | null {
  const s = String(status ?? '').trim().toUpperCase();
  if (s === 'TESTED') return 'PASS';
  if (s === 'IN_TEST') return 'TEST_AGAIN';
  if (s === 'ON_HOLD') return 'TESTING_FAILED';
  return null;
}
