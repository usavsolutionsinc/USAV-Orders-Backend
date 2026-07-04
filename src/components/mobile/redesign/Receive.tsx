'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Search,
  PackageCheck,
  Camera,
} from '@/components/Icons';
import {
  TOKENS,
  SectionHeader,
  GlassButton,
} from '@/components/mobile/redesign/DesignSystem';
import { IconButton } from '@/design-system/primitives';
import { MobileFeed } from '@/components/mobile/feed/MobileFeed';
import { useFeedWindow } from '@/components/mobile/feed/useMobileFeed';
import { ScanResultRow, type ScanFeedItem } from '@/components/mobile/feed/rows/ScanResultRow';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import {
  INTAKE_CLASSIFICATION_OPTS,
  type IntakeClassification,
  type IntakeTone,
} from '@/lib/receiving/intake-classification';

type UnboxVerdict = 'expedited' | 'normal' | 'unfound';

interface ScanResult {
  id: string;
  tracking: string;
  status: 'matched' | 'unmatched' | 'pending' | 'error';
  at: Date;
  poLabel: string | null;
  receivingId: number | null;
  lineCount: number;
  /** Triage bucket once resolved: unbox-first / normal / go-find-it. */
  verdict: UnboxVerdict | null;
  /** The intake type this carton was tagged with at scan time. */
  classification: IntakeClassification;
}

const INTAKE_STORAGE_KEY = 'receive.intakeClassification.v1';

/** Pill colors for the "Receiving as" selector + scan-row chip. */
function intakeToneClass(tone: IntakeTone, active: boolean): string {
  const A: Record<IntakeTone, string> = {
    slate: 'bg-slate-600 text-white border-slate-600',
    blue: 'bg-blue-600 text-white border-blue-600',
    rose: 'bg-rose-600 text-white border-rose-600',
    amber: 'bg-amber-500 text-white border-amber-500',
    emerald: 'bg-emerald-600 text-white border-emerald-600',
  };
  const I: Record<IntakeTone, string> = {
    slate: 'bg-surface-card text-text-muted border-border-soft',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  };
  return active ? A[tone] : I[tone];
}

type TriageFilter = 'all' | 'unfound' | 'expedited' | 'normal';

const FILTERS: { key: TriageFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unfound', label: 'Unfound' },
  { key: 'expedited', label: 'Expedited' },
  { key: 'normal', label: 'Normal' },
];

export default function RedesignedMobileReceive() {
  const [cameraActive, setCameraActive] = useState(false);
  const [input, setInput] = useState('');
  const [scans, setScans] = useState<ScanResult[]>([]);
  const [filter, setFilter] = useState<TriageFilter>('all');
  // Sticky session default — pick "FBA Return" once, scan the whole pallet.
  const [intake, setIntake] = useState<IntakeClassification>('UNKNOWN');
  const scanner = useBarcodeScanner({ dedupMs: 2000 });
  const inFlight = useRef(false);
  const intakeRef = useRef<IntakeClassification>('UNKNOWN');
  intakeRef.current = intake;

  // Restore + persist the sticky intake default across reloads.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(INTAKE_STORAGE_KEY);
      if (saved && INTAKE_CLASSIFICATION_OPTS.some((o) => o.value === saved)) {
        setIntake(saved as IntakeClassification);
      }
    } catch {
      /* private mode */
    }
  }, []);
  const selectIntake = useCallback((next: IntakeClassification) => {
    setIntake(next);
    try {
      window.localStorage.setItem(INTAKE_STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
  }, []);

  const lookup = useCallback(
    async (value: string) => {
      const tracking = value.trim();
      if (!tracking || inFlight.current) return;
      inFlight.current = true;
      setInput('');

      const tempId = `${Date.now()}-${tracking}`;
      const intakeForScan = intakeRef.current;
      // Optimistic "pending" row while the lookup runs.
      setScans((prev) =>
        [
          { id: tempId, tracking, status: 'pending' as const, at: new Date(), poLabel: null, receivingId: null, lineCount: 0, verdict: null, classification: intakeForScan },
          ...prev,
        ].slice(0, 50),
      );

      try {
        const res = await fetch('/api/receiving/lookup-po', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            trackingNumber: tracking,
            // Tag the carton with the sticky intake default (omit UNKNOWN).
            ...(intakeForScan !== 'UNKNOWN' ? { classification: intakeForScan } : {}),
          }),
        });
        const data = await res.json().catch(() => null);

        if (!res.ok || !data) {
          setScans((prev) =>
            prev.map((s) => (s.id === tempId ? { ...s, status: 'error' as const } : s)),
          );
          return;
        }

        const matched = Boolean(data.po_matched ?? data.matched);
        const poLabel: string | null = Array.isArray(data.po_ids) && data.po_ids.length > 0
          ? `PO ${data.po_ids[0]}`
          : null;

        // Prefer the server's explicit verdict; fall back to deriving it from
        // po_matched + pending_order_skus for older response shapes.
        const verdict: UnboxVerdict = ((): UnboxVerdict => {
          const v = data.unbox_verdict;
          if (v === 'expedited' || v === 'normal' || v === 'unfound') return v;
          if (!matched) return 'unfound';
          return Array.isArray(data.pending_order_skus) && data.pending_order_skus.length > 0
            ? 'expedited'
            : 'normal';
        })();

        setScans((prev) =>
          prev.map((s) =>
            s.id === tempId
              ? {
                  ...s,
                  status: matched ? 'matched' : 'unmatched',
                  poLabel,
                  receivingId: typeof data.receiving_id === 'number' ? data.receiving_id : null,
                  lineCount: Array.isArray(data.lines) ? data.lines.length : 0,
                  verdict,
                }
              : s,
          ),
        );
      } catch {
        setScans((prev) =>
          prev.map((s) => (s.id === tempId ? { ...s, status: 'error' as const } : s)),
        );
      } finally {
        inFlight.current = false;
      }
    },
    [],
  );

  // Feed camera-decoded values into the same lookup path. Start/stop strictly
  // off `cameraActive` using the stable callbacks — depending on the whole
  // `scanner` object re-ran this every render and could leave the camera live
  // after Close (a stop racing an in-flight async start).
  const { startScanning, stopScanning } = scanner;
  useEffect(() => {
    if (cameraActive) void startScanning();
    else void stopScanning();
    return () => { void stopScanning(); };
  }, [cameraActive, startScanning, stopScanning]);

  useEffect(() => {
    if (scanner.lastScannedValue) void lookup(scanner.lastScannedValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner.lastScannedValue]);

  // Which verdict bucket a scan belongs to (in-flight scans count as 'all' only).
  const bucketOf = useCallback((s: ScanResult): TriageFilter | null => s.verdict, []);

  // Live counts per filter so the chips can show how many need attention.
  const counts = useMemo(() => {
    const c: Record<TriageFilter, number> = { all: scans.length, unfound: 0, expedited: 0, normal: 0 };
    for (const s of scans) {
      if (s.verdict) c[s.verdict] += 1;
    }
    return c;
  }, [scans]);

  const visibleScans = useMemo(
    () => (filter === 'all' ? scans : scans.filter((s) => bucketOf(s) === filter)),
    [scans, filter, bucketOf],
  );

  // Map the local lookup rows onto the shared scan-feed shape.
  const feedItems = useMemo<ScanFeedItem[]>(
    () =>
      visibleScans.map((s) => {
        const state: ScanFeedItem['state'] =
          s.status === 'pending'
            ? 'pending'
            : s.status === 'error'
              ? 'error'
              : s.verdict === 'expedited'
                ? 'urgent'
                : s.verdict === 'unfound'
                  ? 'warn'
                  : 'ok';
        const statusLabel =
          s.status === 'pending'
            ? 'Looking up…'
            : s.status === 'error'
              ? 'Lookup failed'
              : s.verdict === 'expedited'
                ? `Unbox first · ${s.poLabel ?? 'Matched'}`
                : s.verdict === 'unfound'
                  ? 'Unfound'
                  : s.poLabel ?? 'Matched';
        const intakeShort =
          s.classification !== 'UNKNOWN'
            ? INTAKE_CLASSIFICATION_OPTS.find((o) => o.value === s.classification)?.short ?? null
            : null;
        const lineMeta =
          s.status === 'matched' && s.lineCount > 0
            ? `${s.lineCount} line${s.lineCount === 1 ? '' : 's'}`
            : null;
        return {
          id: s.id,
          primary: s.tracking,
          at: s.at,
          state,
          statusLabel,
          meta: [intakeShort, lineMeta].filter(Boolean).join(' · ') || null,
          href: s.receivingId ? `/m/r/${s.receivingId}` : null,
        };
      }),
    [visibleScans],
  );
  const { rows: feedRows, scrollRef } = useFeedWindow(feedItems, { limit: 50, anchor: 'top', freshPulse: false });

  return (
    <div className={`h-full ${TOKENS.colors.background} flex flex-col`}>
      {/* Input Section */}
      <div className="px-6 pt-4 pb-4">
        {/* Input Bar */}
        <div className="flex flex-col gap-4">
          {/* "Receiving as" — sticky intake default applied to every scan, so a
              whole pallet of FBA returns can be tagged with one pick. */}
          <div>
            <p className="mb-1.5 px-1 text-micro font-black uppercase tracking-widest text-blue-300">
              Receiving as
            </p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {INTAKE_CLASSIFICATION_OPTS.map((o) => {
                const active = intake === o.value;
                return (
                  // ds-raw-button: segmented "Receiving as" intake toggle pill — not a DS Button
                  <button
                    key={o.value}
                    onClick={() => selectIntake(o.value)}
                    className={`ds-raw-button shrink-0 rounded-full border px-3 py-1.5 text-caption font-black uppercase tracking-wider transition-all active:scale-95 ${intakeToneClass(o.tone, active)}`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative group">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-blue-400" />
            </div>
            <input
              autoFocus
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lookup(input)}
              placeholder="Scan or enter tracking..."
              className="w-full bg-surface-card border border-blue-100 rounded-[24px] pl-11 pr-14 py-5 text-base font-bold text-blue-950 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm placeholder:text-blue-300"
            />
            <IconButton
              ariaLabel="Look up tracking"
              onClick={() => lookup(input)}
              icon={<Plus className="h-6 w-6" />}
              className="absolute right-2 top-2 bottom-2 flex h-12 w-12 items-center justify-center rounded-[18px] bg-blue-600 text-white shadow-lg active:scale-90"
            />
          </div>

          <GlassButton
            variant={cameraActive ? 'primary' : 'secondary'}
            className={`w-full !rounded-[24px] ${cameraActive ? 'bg-blue-600 border-blue-500 shadow-blue-600/20' : ''}`}
            onClick={() => setCameraActive(!cameraActive)}
            icon={Camera}
          >
            {cameraActive ? 'Close Camera' : 'Open Camera Scanner'}
          </GlassButton>
        </div>
      </div>

      {/* Camera Viewfinder */}
      <AnimatePresence>
        {cameraActive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: '35vh', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative w-full bg-blue-950 overflow-hidden"
          >
            <video
              ref={scanner.videoRef as any}
              className="absolute inset-0 h-full w-full object-cover opacity-70 contrast-125"
              autoPlay
              playsInline
              muted
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-36 rounded-2xl border-2 border-white/40 bg-white/5 backdrop-blur-[1px] relative">
                <motion.div
                  animate={{ top: ['5%', '95%', '5%'] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute left-6 right-6 h-[2px] bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,1)]"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* History Tray — shared feed, newest at the top. */}
      <div className="flex min-h-0 flex-1 flex-col bg-surface-canvas pt-6">
        <div className="px-6">
          <SectionHeader title="Recent Receipts" />
        </div>
        {/* Triage filter — isolate unfound packages to go find, or expedited
            ones to open first. Counts update live as scans resolve. */}
        <div className="flex gap-2 overflow-x-auto px-6 pb-3 pt-1 no-scrollbar">
          {FILTERS.map(({ key, label }) => {
            const active = filter === key;
            const count = counts[key];
            const tone =
              key === 'unfound'
                ? active
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-amber-50 text-amber-700 border-amber-100'
                : key === 'expedited'
                  ? active
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-rose-50 text-rose-700 border-rose-100'
                  : active
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-surface-card text-blue-600 border-blue-100';
            return (
              // ds-raw-button: segmented triage filter toggle pill (with count) — not a DS Button
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`ds-raw-button flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-caption font-black uppercase tracking-wider transition-all active:scale-95 ${tone}`}
              >
                {label}
                <span className={`tabular-nums ${active ? 'opacity-90' : 'opacity-50'}`}>{count}</span>
              </button>
            );
          })}
        </div>
        <MobileFeed<ScanFeedItem>
          rows={feedRows}
          expandLast={false}
          scrollRef={scrollRef}
          className="pb-32"
          empty={
            <div className="py-12 text-center opacity-40">
              <PackageCheck className="mx-auto mb-3 h-10 w-10 text-blue-200" />
              <p className="text-xs font-black uppercase tracking-widest text-blue-300">
                {filter === 'all' ? 'Scan tracking to begin...' : `No ${filter} packages`}
              </p>
            </div>
          }
          renderRow={(item) => <ScanResultRow item={item} />}
        />
      </div>
    </div>
  );
}
