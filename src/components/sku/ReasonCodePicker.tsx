'use client';

import { useEffect, useMemo, useState } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ReasonCode {
  id: number;
  code: string;
  label: string;
  category: string;
  direction: 'in' | 'out' | 'either';
  requires_note: boolean;
  requires_photo: boolean;
}

interface ReasonCodePickerProps {
  /** Filter codes by the direction of the impending adjustment. */
  direction: 'in' | 'out';
  value: number | null;
  onChange: (next: ReasonCode | null) => void;
  /** Optional cap on dropdown height. */
  maxHeight?: number;
  /** Compact rendering for tight sheets. */
  compact?: boolean;
}

// Memoize the fetch so opening the same picker on different sheets doesn't
// fire repeat requests. Reasons rarely change.
const cache: Map<string, Promise<ReasonCode[]>> = new Map();

async function loadReasons(direction: 'in' | 'out'): Promise<ReasonCode[]> {
  const key = `direction=${direction}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = fetch(`/api/reason-codes?direction=${direction}`, { cache: 'no-store' })
    .then((res) => res.json())
    .then((data) =>
      Array.isArray(data?.reason_codes) ? (data.reason_codes as ReasonCode[]) : [],
    )
    .catch(() => []);
  cache.set(key, promise);
  return promise;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Compact dropdown for picking a `reason_codes` row. Used inside the Numpad
 * sheet's footer and the Details sheet's swap section. Pre-selects the
 * highest-priority default for the given direction.
 */
export function ReasonCodePicker({
  direction,
  value,
  onChange,
  compact = false,
}: ReasonCodePickerProps) {
  const [reasons, setReasons] = useState<ReasonCode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadReasons(direction).then((rows) => {
      if (cancelled) return;
      setReasons(rows);
      setLoading(false);
      // Auto-select the canonical movement code for the direction when the
      // caller hasn't already picked one — e.g. TAKE defaults to BIN_PULL.
      if (value == null && rows.length > 0) {
        const fallback =
          rows.find((r) => r.code === (direction === 'out' ? 'BIN_PULL' : 'BIN_ADD')) ??
          rows[0];
        onChange(fallback);
      }
    });
    return () => {
      cancelled = true;
    };
    // value/onChange intentionally not in deps — we only seed on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction]);

  const selected = useMemo(
    () => reasons.find((r) => r.id === value) ?? null,
    [reasons, value],
  );

  return (
    <label className={`block ${compact ? '' : 'space-y-1'}`}>
      <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
        Reason
      </span>
      <select
        value={value ?? ''}
        onChange={(e) => {
          const id = Number(e.target.value);
          const match = reasons.find((r) => r.id === id) ?? null;
          onChange(match);
        }}
        disabled={loading || reasons.length === 0}
        className={`mt-1 w-full rounded-md border border-slate-300 bg-white px-2 ${
          compact ? 'py-1.5 text-[12px]' : 'py-2 text-sm'
        } font-bold text-slate-900 focus:border-blue-500 focus:outline-none disabled:opacity-50`}
      >
        {loading && <option>Loading…</option>}
        {!loading &&
          reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
      </select>
      {selected?.requires_note && (
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-amber-700">
          Reason needs a note
        </p>
      )}
    </label>
  );
}

export { loadReasons };
