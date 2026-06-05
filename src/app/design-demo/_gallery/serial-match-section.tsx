'use client';

/**
 * Serial-match check — the RETURN receiving auto-lookup.
 *
 * Dogfoods the real {@link SerialMatchResult} band. The gallery can't hit the
 * live `/api/serial-units/lookup` endpoint (no auth/session here), so this
 * mocks the fetch with a tiny in-memory table: scan one of the seeded serials
 * to see a match (incl. the SHIPPED → "Returned item" case), anything else
 * reads as "No match found". The wired-up version in LineEditPanel calls the
 * real endpoint via `useSerialLookup`.
 */

import { useCallback, useRef, useState } from 'react';
import { TextField } from '@/design-system/primitives';
import {
  SerialMatchResult,
  type SerialMatchState,
  type SerialMatchUnit,
} from '@/components/receiving/workspace/SerialMatchResult';
import { Bay } from './sections';

/** Seeded inventory the mock lookup matches against. */
const MOCK_UNITS: Record<string, SerialMatchUnit> = {
  C02XL0ABJGH5: {
    serial_number: 'C02XL0ABJGH5',
    sku: 'MBP-16-M3',
    current_status: 'SHIPPED',
    condition_grade: 'USED_A',
    current_location: null,
    updated_at: '2026-05-21T00:00:00Z',
    is_return: true,
  },
  DMPX1234ZZ: {
    serial_number: 'DMPX1234ZZ',
    sku: 'IPH-15-PRO',
    current_status: 'STOCKED',
    condition_grade: 'LIKE_NEW',
    current_location: 'A-12-03',
    updated_at: '2026-05-30T00:00:00Z',
    is_return: false,
  },
};

function mockLookup(serial: string, signal: AbortSignal): Promise<SerialMatchUnit | null> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      resolve(MOCK_UNITS[serial.trim().toUpperCase()] ?? null);
    }, 650);
    signal.addEventListener('abort', () => {
      window.clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}

function SerialMatchDemo() {
  const [input, setInput] = useState('');
  const [state, setState] = useState<SerialMatchState>('idle');
  const [unit, setUnit] = useState<SerialMatchUnit | null>(null);
  const [searched, setSearched] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (raw: string) => {
    const serial = raw.trim();
    abortRef.current?.abort();
    if (!serial) {
      setState('idle');
      setUnit(null);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setSearched(serial);
    setState('searching');
    setUnit(null);
    try {
      const found = await mockLookup(serial, controller.signal);
      if (controller.signal.aborted) return;
      if (found) {
        setUnit(found);
        setState('found');
      } else {
        setUnit(null);
        setState('not-found');
      }
    } catch {
      /* aborted — superseded by a newer scan */
    }
  }, []);

  return (
    <div className="w-full max-w-[340px] space-y-3">
      <TextField
        label="Return serial #"
        value={input}
        onChange={setInput}
        onKeyDown={(e) => {
          if (e.key === 'Enter') run(input);
        }}
      />
      <SerialMatchResult state={state} unit={unit} serial={searched} />
      <p className="text-[10px] leading-snug text-text-muted">
        Try <code className="font-mono text-text-default">C02XL0ABJGH5</code>{' '}
        (shipped → return) ·{' '}
        <code className="font-mono text-text-default">DMPX1234ZZ</code> (in stock)
        · anything else → no match. Press Enter to check.
      </p>
    </div>
  );
}

export function SerialMatchSection() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Bay
        title="Serial match check — RETURN flow"
        promote="@/components/receiving/workspace/SerialMatchResult"
        tag="new"
        caption="On a RETURN line, committing a serial (Enter / scan) checks it against serial_units. Match → status + SKU + bin, with a 'Returned item' flag when the unit was previously shipped. No match → amber prompt to confirm the serial."
        span={2}
      >
        <SerialMatchDemo />
      </Bay>
    </div>
  );
}
