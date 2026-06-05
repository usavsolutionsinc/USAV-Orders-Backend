'use client';

/**
 * Serial-match result band for the RETURN receiving flow.
 *
 * When a line's receiving type is RETURN, committing a serial (Enter / barcode
 * scan) runs an exact lookup against `serial_units`. This renders the outcome
 * directly under the SERIAL input on the design-system {@link InlineNotice}
 * surface, with the matched unit's facts shown as the same rounded ring-inset
 * pills the condition picker uses:
 *
 *   idle       → nothing (no serial checked yet)
 *   searching  → neutral notice + spinner ("Checking serial…")
 *   found      → success notice + the unit's status / SKU / grade / bin pills.
 *                A unit whose prior status is SHIPPED is a genuine return — we
 *                badge it "Returned item".
 *   not-found  → warning notice ("No match found").
 *
 * Presentational only: state + data are owned by the caller (see
 * {@link useSerialLookup} for the fetch side).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from '@/components/Icons';
import { InlineNotice } from '@/design-system/components';

export type SerialMatchState = 'idle' | 'searching' | 'found' | 'not-found';

export interface SerialMatchUnit {
  serial_number: string;
  sku: string | null;
  current_status: string;
  condition_grade: string | null;
  current_location: string | null;
  updated_at: string | null;
  /** Matched unit was previously SHIPPED → this is a genuine return. */
  is_return: boolean;
}

/** Human label for an enum-ish value (current_status / condition_grade). */
function prettyEnum(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Fact chip — same rounded ring-inset, uppercase-black language as the
 * condition pills, sized down for a metadata row.
 */
function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-micro font-black uppercase tracking-[0.1em] text-emerald-800 ring-1 ring-inset ring-emerald-200">
      <span className="text-emerald-500/70">{label}</span>
      <span>{value}</span>
    </span>
  );
}

export function SerialMatchResult({
  state,
  unit,
  serial,
  className,
}: {
  state: SerialMatchState;
  /** Present when state === 'found'. */
  unit?: SerialMatchUnit | null;
  /** The serial that was searched — echoed on the not-found row. */
  serial?: string;
  className?: string;
}) {
  if (state === 'idle') return null;

  if (state === 'searching') {
    return (
      <InlineNotice
        tone="neutral"
        size="sm"
        className={className}
        icon={<Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      >
        Checking serial…
      </InlineNotice>
    );
  }

  if (state === 'not-found') {
    return (
      <InlineNotice
        tone="warning"
        size="sm"
        className={className}
        title="No match found"
        icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
      >
        {serial ? (
          <>
            <span className="font-mono font-semibold">{serial}</span> isn’t in our
            records — confirm the serial or that the item is ours.
          </>
        ) : (
          'This serial isn’t in our records — confirm the serial or that the item is ours.'
        )}
      </InlineNotice>
    );
  }

  // state === 'found'
  const isReturn = !!unit?.is_return;
  return (
    <InlineNotice
      tone="success"
      size="sm"
      className={className}
      icon={<Check className="h-4 w-4 text-emerald-500" />}
      title={
        <span className="flex items-center gap-2">
          Match found
          {isReturn ? (
            <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-emerald-700 ring-1 ring-inset ring-emerald-500/25">
              Returned item
            </span>
          ) : null}
        </span>
      }
    >
      {unit ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <MetaPill label="Status" value={prettyEnum(unit.current_status)} />
          {unit.sku ? <MetaPill label="SKU" value={unit.sku} /> : null}
          {unit.condition_grade ? (
            <MetaPill label="Grade" value={prettyEnum(unit.condition_grade)} />
          ) : null}
          {unit.current_location ? (
            <MetaPill label="Bin" value={unit.current_location} />
          ) : null}
        </div>
      ) : (
        'This serial is already in our records.'
      )}
    </InlineNotice>
  );
}

/* ───────────────────────────── fetch hook ───────────────────────────────── */

interface SerialLookupResponse {
  success?: boolean;
  found?: boolean;
  is_return?: boolean;
  unit?: SerialMatchUnit | null;
}

/**
 * Latest-wins serial lookup. `check(serial)` fires `GET
 * /api/serial-units/lookup`, aborting any in-flight request first so a fast
 * scan stream only ever resolves to the most recent serial. Exposes the
 * presentational state for {@link SerialMatchResult}.
 */
export function useSerialLookup() {
  const [state, setState] = useState<SerialMatchState>('idle');
  const [unit, setUnit] = useState<SerialMatchUnit | null>(null);
  const [serial, setSerial] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState('idle');
    setUnit(null);
    setSerial('');
  }, []);

  const check = useCallback(async (raw: string) => {
    const trimmed = (raw ?? '').trim();
    abortRef.current?.abort();
    if (!trimmed) {
      abortRef.current = null;
      setState('idle');
      setUnit(null);
      setSerial('');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setSerial(trimmed);
    setState('searching');
    setUnit(null);
    try {
      const res = await fetch(
        `/api/serial-units/lookup?serial=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const data = (await res.json().catch(() => null)) as SerialLookupResponse | null;
      if (controller.signal.aborted) return;
      if (!res.ok || !data?.success) {
        // Treat a lookup error as inconclusive rather than a false "no match".
        setState('idle');
        return;
      }
      if (data.found && data.unit) {
        setUnit({ ...data.unit, is_return: !!data.is_return });
        setState('found');
      } else {
        setUnit(null);
        setState('not-found');
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setState('idle');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  // Abort any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, unit, serial, check, reset };
}
