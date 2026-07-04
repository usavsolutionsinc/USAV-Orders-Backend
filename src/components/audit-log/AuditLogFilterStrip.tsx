'use client';

/**
 * Shared date + staff filter strip for every audit-log section.
 *
 * URL contract:
 *   ?day=YYYY-MM-DD   — single-day shortcut (clears start/end)
 *   ?start=ISO&end=ISO — explicit custom range (clears day)
 *   ?staffId=<int>    — actor filter
 *
 * The strip is intentionally section-agnostic so it can sit above any picker
 * (PO, tracking, serial, SKU…). Selections persist across section switches.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, User, X } from '@/components/Icons';
import { AnchoredLayer } from '@/design-system';
import { Button, IconButton } from '@/design-system/primitives';

type Preset = 'today' | 'yesterday' | 'last7' | 'custom' | 'all';

interface StaffOption {
  id: number;
  name: string;
  role: string | null;
  last_seen_at: string | null;
  event_count: number;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localBounds(day: string): { start: string; end: string } {
  // Build local-TZ bounds, then send as UTC ISO.
  const [y, m, d] = day.split('-').map((s) => parseInt(s, 10));
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function presetFromParams(params: URLSearchParams): Preset {
  const day = params.get('day');
  const start = params.get('start');
  const end = params.get('end');
  if (start || end) return 'custom';
  if (!day) return 'all';
  const today = ymd(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yest = ymd(y);
  if (day === today) return 'today';
  if (day === yest) return 'yesterday';
  return 'custom';
}
export function useAuditLogFilterRefinements() {
  const router = useRouter();
  const pathname = usePathname() || '/audit-log/receiving';
  const searchParams = useSearchParams();

  const preset = useMemo(
    () => presetFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const staffIdRaw = searchParams.get('staffId');
  const staffId = staffIdRaw && /^\d+$/.test(staffIdRaw) ? Number(staffIdRaw) : null;

  const replaceParams = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString());
    mutate(next);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const applyPreset = (kind: Preset) => {
    replaceParams((p) => {
      p.delete('day');
      p.delete('start');
      p.delete('end');
      if (kind === 'all') return;
      if (kind === 'today') p.set('day', ymd(new Date()));
      else if (kind === 'yesterday') {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        p.set('day', ymd(y));
      } else if (kind === 'last7') {
        const start = new Date();
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        p.set('start', start.toISOString());
        p.set('end', end.toISOString());
      } else if (kind === 'custom') {
        const { start, end } = localBounds(ymd(new Date()));
        p.set('start', start);
        p.set('end', end);
      }
    });
  };

  const setStaffId = (id: number | null) => {
    replaceParams((p) => {
      if (id == null) p.delete('staffId');
      else p.set('staffId', String(id));
    });
  };

  const refinements = useMemo(() => {
    const out: Array<{ id: string; label: string; onRemove: () => void }> = [];

    if (preset !== 'all') {
      const label = preset === 'today' ? 'Today' : preset === 'yesterday' ? 'Yesterday' : preset === 'last7' ? 'Last 7 days' : 'Custom range';
      out.push({ id: 'date', label, onRemove: () => applyPreset('all') });
    }

    if (staffId != null) {
      out.push({ id: 'staff', label: `Staff: #${staffId}`, onRemove: () => setStaffId(null) });
    }

    return out;
  }, [preset, staffId]);

  return {
    refinements,
    clearAll: () => {
      applyPreset('all');
      setStaffId(null);
    },
    state: { preset, staffId, searchParams },
    actions: { applyPreset, setStaffId, setCustomStart: (day: string) => {
        if (!day) { replaceParams((p) => p.delete('start')); return; }
        const { start } = localBounds(day);
        replaceParams((p) => { p.delete('day'); p.set('start', start); });
      }, setCustomEnd: (day: string) => {
        if (!day) { replaceParams((p) => p.delete('end')); return; }
        const { end } = localBounds(day);
        replaceParams((p) => { p.delete('day'); p.set('end', end); });
      }
    }
  };
}

export function AuditLogFilterDropdown({ onClose }: { onClose: () => void }) {
  const { state, actions } = useAuditLogFilterRefinements();

  const customStart = (() => {
    const s = state.searchParams.get('start');
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '' : ymd(d);
  })();
  const customEnd = (() => {
    const e = state.searchParams.get('end');
    if (!e) return '';
    const d = new Date(e);
    return Number.isNaN(d.getTime()) ? '' : ymd(d);
  })();

  const presetOptions: Array<{ id: Preset; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yest.' },
    { id: 'last7', label: '7d' },
    { id: 'custom', label: 'Custom' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-3 text-caption font-black uppercase tracking-[0.2em] text-text-faint">Date Range</p>
        <div className="grid grid-cols-3 gap-2">
          {/* ds-raw-button: segmented date-preset toggle with custom active fill (bg-blue-500) */}
          {presetOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => actions.applyPreset(opt.id)}
              className={`rounded-xl border px-3 py-2 text-micro font-bold uppercase tracking-wider transition-all ${
                state.preset === opt.id
                  ? 'border-blue-500 bg-blue-500 text-white shadow-md shadow-blue-500/20'
                  : 'border-border-hairline bg-surface-canvas/50 text-text-muted hover:border-border-soft hover:bg-surface-card'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {state.preset === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={customStart}
            onChange={(e) => actions.setCustomStart(e.target.value)}
            className="h-10 rounded-xl border border-border-hairline bg-surface-canvas/50 px-3 text-caption font-bold text-text-default outline-none focus:border-blue-500 focus:bg-surface-card focus:ring-4 focus:ring-blue-500/10"
          />
          <input
            type="date"
            value={customEnd}
            onChange={(e) => actions.setCustomEnd(e.target.value)}
            className="h-10 rounded-xl border border-border-hairline bg-surface-canvas/50 px-3 text-caption font-bold text-text-default outline-none focus:border-blue-500 focus:bg-surface-card focus:ring-4 focus:ring-blue-500/10"
          />
        </div>
      )}

      <div>
        <p className="mb-3 text-caption font-black uppercase tracking-[0.2em] text-text-faint">Staff Member</p>
        <StaffCombobox value={state.staffId} onChange={actions.setStaffId} />
      </div>

      <div className="pt-2">
        <Button
          variant="brand"
          size="lg"
          onClick={onClose}
          className="h-auto w-full rounded-2xl py-3.5 text-sm font-black uppercase tracking-widest"
        >
          Done
        </Button>
      </div>
    </div>
  );
}

/** @deprecated Use {@link AuditLogFilterDropdown} in the new FilterRefinementBar pattern. */
export function AuditLogFilterStrip() {
  const router = useRouter();

  const pathname = usePathname() || '/audit-log/receiving';
  const searchParams = useSearchParams();

  const preset = useMemo(
    () => presetFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const staffIdRaw = searchParams.get('staffId');
  const staffId = staffIdRaw && /^\d+$/.test(staffIdRaw) ? Number(staffIdRaw) : null;

  const replaceParams = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString());
    mutate(next);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const applyPreset = (kind: Preset) => {
    replaceParams((p) => {
      p.delete('day');
      p.delete('start');
      p.delete('end');
      if (kind === 'all') return;
      if (kind === 'today') p.set('day', ymd(new Date()));
      else if (kind === 'yesterday') {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        p.set('day', ymd(y));
      } else if (kind === 'last7') {
        const start = new Date();
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        p.set('start', start.toISOString());
        p.set('end', end.toISOString());
      } else if (kind === 'custom') {
        // Seed today's bounds so the date inputs have something to show.
        const { start, end } = localBounds(ymd(new Date()));
        p.set('start', start);
        p.set('end', end);
      }
    });
  };

  const setCustomStart = (day: string) => {
    if (!day) {
      replaceParams((p) => p.delete('start'));
      return;
    }
    const { start } = localBounds(day);
    replaceParams((p) => {
      p.delete('day');
      p.set('start', start);
    });
  };

  const setCustomEnd = (day: string) => {
    if (!day) {
      replaceParams((p) => p.delete('end'));
      return;
    }
    const { end } = localBounds(day);
    replaceParams((p) => {
      p.delete('day');
      p.set('end', end);
    });
  };

  const setStaffId = (id: number | null) => {
    replaceParams((p) => {
      if (id == null) p.delete('staffId');
      else p.set('staffId', String(id));
    });
  };

  // Custom range inputs hydrate from URL.
  const customStart = (() => {
    const s = searchParams.get('start');
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '' : ymd(d);
  })();
  const customEnd = (() => {
    const e = searchParams.get('end');
    if (!e) return '';
    const d = new Date(e);
    return Number.isNaN(d.getTime()) ? '' : ymd(d);
  })();

  const presetOptions: Array<{ id: Preset; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yest.' },
    { id: 'last7', label: '7d' },
    { id: 'custom', label: 'Custom' },
  ];

  return (
    <div className="border-b border-border-hairline bg-surface-card/60 px-3 py-2.5">
      <p className="px-1 pb-1 text-eyebrow font-black uppercase tracking-widest text-emerald-700/80">
        Filters
      </p>

      {/* Preset chips */}
      <div className="flex gap-1">
        {/* ds-raw-button: segmented date-preset toggle with custom active fill (bg-emerald-600) */}
        {presetOptions.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => applyPreset(opt.id)}
            className={`flex-1 rounded-md px-1.5 py-1 text-micro font-bold uppercase tracking-wider transition ${
              preset === opt.id
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200'
                : 'bg-surface-sunken text-text-muted hover:bg-surface-strong'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Custom date inputs */}
      {preset === 'custom' && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="h-8 rounded-md border border-border-soft bg-surface-card px-2 text-caption text-text-default outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="h-8 rounded-md border border-border-soft bg-surface-card px-2 text-caption text-text-default outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      )}

      {/* Staff combobox */}
      <div className="mt-2">
        <StaffCombobox value={staffId} onChange={setStaffId} />
      </div>
    </div>
  );
}

// ─── Staff combobox ────────────────────────────────────────────────────────

function StaffCombobox({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<StaffOption[]>([]);
  const [selected, setSelected] = useState<StaffOption | null>(null);
  const [loading, setLoading] = useState(false);
  const inputWrapRef = useRef<HTMLDivElement | null>(null);

  // Debounce typeahead.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Fetch options when open or query changes.
  useEffect(() => {
    if (!open && options.length > 0) return;
    let cancelled = false;
    setLoading(true);
    const url = new URL('/api/audit-log/staff-directory', window.location.origin);
    if (debounced) url.searchParams.set('q', debounced);
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setOptions(Array.isArray(d.rows) ? d.rows : []);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, open, options.length]);

  // Resolve label for current value when not in the dropdown's options.
  useEffect(() => {
    if (value == null) {
      setSelected(null);
      return;
    }
    const match = options.find((o) => o.id === value);
    if (match) {
      setSelected(match);
      return;
    }
    // Fetch single-staff fallback.
    fetch(`/api/audit-log/staff-directory?includeAll=true`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.success) return;
        const found = (d.rows as StaffOption[] | undefined)?.find((o) => o.id === value);
        if (found) setSelected(found);
      })
      .catch(() => {});
  }, [value, options]);

  const label = selected ? selected.name : value != null ? `#${value}` : '';

  return (
    <div className="relative">
      <div ref={inputWrapRef} className="relative">
        <User className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
        <input
          type="text"
          value={open ? query : label}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          placeholder="Filter by staff…"
          className="h-8 w-full rounded-md border border-border-soft bg-surface-card pl-7 pr-7 text-caption text-text-default outline-none transition placeholder:text-text-faint focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
        />
        {value != null && !open && (
          <IconButton
            icon={<X className="h-3 w-3" />}
            ariaLabel="Clear staff filter"
            onClick={() => onChange(null)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-text-faint hover:bg-surface-sunken hover:text-text-muted"
          />
        )}
      </div>

      <AnchoredLayer
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={inputWrapRef}
        placement="bottom-stretch"
        gap={-1}
      >
        <div className="max-h-60 overflow-y-auto rounded-b-lg rounded-t-none border border-border-soft border-t-0 bg-surface-card shadow-lg">
          {/* ds-raw-button: full-width left-aligned dropdown menu row (composite content) */}
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-caption text-text-soft hover:bg-surface-hover"
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-surface-sunken">
              <Search className="h-2.5 w-2.5" />
            </span>
            All staff
          </button>
          {loading && (
            <div className="px-2.5 py-2 text-caption text-text-faint">Loading…</div>
          )}
          {!loading && options.length === 0 && (
            <div className="px-2.5 py-2 text-caption text-text-faint">No matches.</div>
          )}
          {/* ds-raw-button: full-width left-aligned dropdown menu row (name/role/count composite) */}
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                onChange(opt.id);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition hover:bg-emerald-50 ${
                opt.id === value ? 'bg-emerald-50' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-caption font-semibold text-text-default">
                  {opt.name}
                </div>
                <div className="truncate text-micro text-text-soft">
                  {opt.role ?? '—'}
                </div>
              </div>
              <div className="shrink-0 text-micro tabular-nums text-text-faint">
                {opt.event_count.toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      </AnchoredLayer>
    </div>
  );
}
