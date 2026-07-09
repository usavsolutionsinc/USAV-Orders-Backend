'use client';

/**
 * /warehouse/rma/disposition — the per-unit disposition station.
 *
 * Station archetype (.claude/rules/display/station.md): staff physically hold
 * an already-received, already-graded returned unit and scan its serial to
 * decide its fate — ACCEPT (restock) / HOLD / RTV / REWORK / SCRAP. Scanner-
 * driven, one active unit at a time, act-and-clear. This is the UI Gap #2/
 * Path C of the returns-unification plan named as the single highest-value
 * net-new surface: `recordDisposition()` (src/lib/rma/authorizations.ts) —
 * the only path that can restock a returned unit — had zero UI anywhere
 * until this page.
 *
 * Not the RMA queue (`/warehouse/rma`, a Workbench-ish list of authorizations
 * a supervisor manages) — this is the scan bench a floor operator uses once a
 * unit is in hand. Linked from that page's header, and deep-linkable via
 * `?serial=` from the queue page's disposition-backlog list: the backlog is a
 * Workbench-style worklist, but jumping into it must still land the operator
 * on a scan-driven Station, not a record editor — so `?serial=` pre-fills and
 * auto-fires the same lookup a real scan would, then behaves identically
 * (single active entity, act-and-clear).
 */

import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Barcode,
  CheckCircle,
  Lock,
  RotateCcw,
  AlertTriangle,
  Trash2,
  ChevronLeft,
  Loader2,
  X,
} from '@/components/Icons';
import { StationScanBar } from '@/components/station/scan-bar';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionPresence, useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import { conditionLabel } from '@/lib/conditions';
import { unitStatusBadgeTone } from '@/components/station/receiving-constants';

type DispositionCode = 'ACCEPT' | 'HOLD' | 'RTV' | 'REWORK' | 'SCRAP';

const DISPOSITIONS: Array<{
  code: DispositionCode;
  label: string;
  hint: string;
  icon: typeof CheckCircle;
  activeClass: string;
}> = [
  {
    code: 'ACCEPT',
    label: 'Accept',
    hint: 'Sellable — restocks the unit (RETURNED → STOCKED)',
    icon: CheckCircle,
    activeClass: 'bg-emerald-600 hover:bg-emerald-700',
  },
  {
    code: 'HOLD',
    label: 'Hold',
    hint: 'Needs more review before a decision',
    icon: Lock,
    // ds-allow-raw-neutral: identity/tone hue — HOLD's slate among colored disposition siblings, not chrome
    activeClass: 'bg-slate-600 hover:bg-slate-700',
  },
  {
    code: 'RTV',
    label: 'Return to vendor',
    hint: 'Ship back to the supplier',
    icon: RotateCcw,
    activeClass: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    code: 'REWORK',
    label: 'Rework',
    hint: 'Send back through repair/testing',
    icon: AlertTriangle,
    activeClass: 'bg-amber-600 hover:bg-amber-700',
  },
  {
    code: 'SCRAP',
    label: 'Scrap',
    hint: 'Harvest for parts / dispose',
    icon: Trash2,
    activeClass: 'bg-rose-600 hover:bg-rose-700',
  },
];

interface ActiveUnit {
  id: number;
  serial_number: string;
  sku: string | null;
  product_title: string | null;
  current_status: string;
  condition_grade: string | null;
}

interface DispositionResult {
  code: DispositionCode;
  restocked: boolean;
  at: number;
}

const AUTO_HIDE_MS = 4000;

function DispositionStationInner() {
  const searchParams = useSearchParams();
  const [scan, setScan] = useState('');
  const [unit, setUnit] = useState<ActiveUnit | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<DispositionCode | null>(null);
  const [result, setResult] = useState<DispositionResult | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const autoScannedRef = useRef(false);

  const cardPresence = useMotionPresence(framerPresence.stationCard);
  const cardTransition = useMotionTransition(framerTransition.stationCardMount);

  const refocus = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // Act-and-clear: a completed decision auto-clears the card so the bench is
  // visibly ready for the next scan (station.md §5).
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => {
      setUnit(null);
      setResult(null);
      setNotes('');
      refocus();
    }, AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [result, refocus]);

  const lookupSerial = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/serial-units/${encodeURIComponent(trimmed)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      const u = data.serial_unit;
      setUnit({
        id: u.id,
        serial_number: u.serial_number,
        sku: u.sku ?? null,
        product_title: u.product_title ?? null,
        current_status: u.current_status,
        condition_grade: u.condition_grade ?? null,
      });
    } catch (err) {
      setUnit(null);
      setError(err instanceof Error ? err.message : 'Serial not found');
    } finally {
      setScan('');
      setLoading(false);
      refocus();
    }
  }, [loading, refocus]);

  const handleSubmit = useCallback(async () => {
    await lookupSerial(scan);
  }, [scan, lookupSerial]);

  // Deep-link from the backlog worklist (?serial=) — pre-fills and fires the
  // same lookup a real scan would, once, then the station behaves identically
  // to a manual scan (single active card, act-and-clear).
  useEffect(() => {
    if (autoScannedRef.current) return;
    const initial = searchParams.get('serial');
    if (!initial) return;
    autoScannedRef.current = true;
    setScan(initial);
    void lookupSerial(initial);
  }, [searchParams, lookupSerial]);

  const disposition = useCallback(
    async (code: DispositionCode) => {
      if (!unit || deciding) return;
      setDeciding(code);
      setError(null);
      try {
        const res = await fetch('/api/rma/disposition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serial_unit_id: unit.id,
            disposition_code: code,
            notes: notes.trim() || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        setResult({ code, restocked: Boolean(data.restocked), at: Date.now() });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Disposition failed');
      } finally {
        setDeciding(null);
      }
    },
    [unit, deciding, notes],
  );

  const notReturned = unit != null && unit.current_status !== 'RETURNED';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <Link
            href="/warehouse/rma"
            className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-soft hover:text-text-muted"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            RMA queue
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-text-default">Disposition station</h1>
          <p className="mt-1 text-sm text-text-soft">Scan a returned unit, decide what happens to it.</p>
        </div>
      </header>

      <div className="space-y-2">
        <StationScanBar
          value={scan}
          onChange={setScan}
          onSubmit={(e) => {
            e?.preventDefault();
            void handleSubmit();
          }}
          inputRef={inputRef}
          placeholder="Scan serial number"
          autoFocus
          icon={<Barcode className="h-[17px] w-[17px] text-emerald-600" />}
          rightContent={loading ? <Loader2 className="h-4 w-4 animate-spin text-text-muted" /> : undefined}
        />
        {error && (
          <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}
      </div>

      <div className="mt-4">
        <AnimatePresence mode="wait" initial={false}>
          {unit ? (
            <motion.div
              key={unit.id}
              {...cardPresence}
              transition={cardTransition}
              className="rounded-2xl border border-border-soft bg-surface-card p-5 shadow-sm"
            >
              {result ? (
                <ResultBanner result={result} onDismiss={() => { setUnit(null); setResult(null); refocus(); }} />
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-lg font-black text-text-default">{unit.serial_number}</p>
                      {unit.product_title && (
                        <p className="truncate text-caption text-text-soft">{unit.product_title}</p>
                      )}
                      {unit.sku && <p className="truncate font-mono text-eyebrow text-text-faint">{unit.sku}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {unit.condition_grade && (
                        <span className="rounded bg-surface-canvas px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-text-muted ring-1 ring-inset ring-border-soft">
                          {conditionLabel(unit.condition_grade, 'compact')}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-eyebrow font-black uppercase tracking-widest ${unitStatusBadgeTone(unit.current_status)}`}
                      >
                        {unit.current_status}
                      </span>
                    </div>
                  </div>

                  {notReturned && (
                    <div className="mt-3 rounded-xl border border-dashed border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      This unit isn't currently RETURNED — Accept will record the decision but won't restock it.
                    </div>
                  )}

                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Notes (optional)"
                    className="mt-3 w-full resize-none rounded-xl border border-border-soft bg-surface-card px-3 py-2 text-caption text-text-default placeholder:text-text-faint focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {DISPOSITIONS.map((d) => (
                      <HoverTooltip key={d.code} label={d.hint}>
                        {/* ds-raw-button: 5-way disposition action grid, tone per disposition — no single DS variant covers this */}
                        <button
                          type="button"
                          disabled={deciding != null}
                          onClick={() => void disposition(d.code)}
                          className={`flex h-16 flex-col items-center justify-center gap-1 rounded-xl text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${d.activeClass}`}
                        >
                          {deciding === d.code ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <d.icon className="h-4 w-4" />
                          )}
                          <span className="text-micro font-black uppercase tracking-wide">{d.label}</span>
                        </button>
                      </HoverTooltip>
                    ))}
                  </div>
                </>
              )}
            </motion.div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border-soft bg-surface-canvas px-4 py-10 text-center text-sm text-text-soft">
              Scan a unit to begin.
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function RmaDispositionPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <div className="h-10 w-64 animate-pulse rounded bg-surface-sunken" />
          <div className="mt-4 h-14 w-full animate-pulse rounded-xl bg-surface-sunken" />
        </div>
      }
    >
      <DispositionStationInner />
    </Suspense>
  );
}

function ResultBanner({ result, onDismiss }: { result: DispositionResult; onDismiss: () => void }) {
  const def = DISPOSITIONS.find((d) => d.code === result.code)!;
  const Icon = def.icon;
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-white ${def.activeClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-text-default">{def.label} recorded</p>
          <p className="text-xs text-text-soft">
            {result.code === 'ACCEPT'
              ? result.restocked
                ? 'Unit restocked — back in sellable inventory.'
                : 'Decision recorded — not restocked (unit was not RETURNED).'
              : 'Decision recorded.'}
          </p>
        </div>
      </div>
      <HoverTooltip label="Clear now">
        <IconButton
          onClick={onDismiss}
          ariaLabel="Clear"
          className="rounded-md p-1.5 text-text-faint hover:bg-surface-sunken hover:text-text-muted"
          icon={<X className="h-4 w-4" />}
        />
      </HoverTooltip>
    </div>
  );
}
