'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  useReducedMotion,
  type MotionValue,
  type Variants,
} from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronRight, Package, X } from '@/components/Icons';
import { arrivalFeedback } from '@/lib/feedback/confirm';
import {
  RECEIVING_ARRIVAL_EVENT,
  type ReceivingArrivalDetail,
} from '@/hooks/usePhoneReceivingPhotoBridge';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

const AUTO_ADVANCE_MS = 5000;
const MIN_VISIBLE_MS = 700;

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
}

interface ArrivalState extends ReceivingArrivalDetail {
  /** Key used by AnimatePresence — new arrival should re-mount the card. */
  key: string;
}

/**
 * Global mobile-only overlay that fires when a desktop tracking scan publishes
 * a `receiving_photo_request`. Surfaces PO / item / qty intel with a premium
 * spring entrance, a depleting countdown ring, drag-to-dismiss, and a single
 * "Start photos" CTA that hands off to `/m/r/{id}/photos`. If the tech doesn't
 * intervene, it auto-advances when the ring completes.
 */
export function MobileCartonArrivalHero() {
  const router = useRouter();
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;
  const reduceMotion = useReducedMotion();

  const [arrival, setArrival] = useState<ArrivalState | null>(null);
  const [carton, setCarton] = useState<ReceivingLineRow[] | null>(null);
  const [paused, setPaused] = useState(false);

  // Portal target lives on body so the scrim covers fixed-positioned ancestors.
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalNode(document.body);
  }, []);

  // ── Listen for arrival events ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ReceivingArrivalDetail>).detail;
      if (!detail || !Number.isFinite(detail.receivingId)) return;
      arrivalFeedback();
      setArrival({
        ...detail,
        key: detail.requestId || `${detail.receivingId}-${detail.receivedAt}`,
      });
      setCarton(null);
      setPaused(false);
    };
    window.addEventListener(RECEIVING_ARRIVAL_EVENT, handler);
    return () => window.removeEventListener(RECEIVING_ARRIVAL_EVENT, handler);
  }, []);

  // ── Lock body scroll while open ───────────────────────────────────────────
  useEffect(() => {
    if (!arrival) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [arrival]);

  // ── Fetch carton lines for this receiving id ──────────────────────────────
  useEffect(() => {
    if (!arrival) return;
    const id = arrival.receivingId;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/receiving-lines?receiving_id=${id}`, {
          signal: ctrl.signal,
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data: ApiResponse = await res.json();
        if (!data?.success || !Array.isArray(data.receiving_lines)) return;
        setCarton(data.receiving_lines);
      } catch {
        /* aborted or offline — hero still shows w/ tracking-only fallback */
      }
    })();
    return () => ctrl.abort();
  }, [arrival]);

  // ── Aggregate carton intel ────────────────────────────────────────────────
  const summary = useMemo(() => {
    const lines = carton ?? [];
    const totalExpected = lines.reduce((s, l) => s + (l.quantity_expected ?? 0), 0);
    const totalReceived = lines.reduce((s, l) => s + (l.quantity_received ?? 0), 0);
    const po = lines.find((l) => l.zoho_purchaseorder_number)?.zoho_purchaseorder_number
      || lines.find((l) => l.zoho_purchaseorder_id)?.zoho_purchaseorder_id
      || null;
    const carrier = lines.find((l) => l.carrier)?.carrier || null;
    const tracking = lines.find((l) => l.tracking_number)?.tracking_number
      || arrival?.tracking
      || null;
    const headline = lines[0]?.item_name?.trim() || null;
    const extraCount = Math.max(0, lines.length - 1);
    return { po, totalExpected, totalReceived, carrier, tracking, headline, extraCount, count: lines.length };
  }, [carton, arrival]);

  // ── Navigation handoff ────────────────────────────────────────────────────
  const goToCapture = (immediate: boolean) => {
    if (!arrival) return;
    const params = new URLSearchParams();
    if (staffId > 0) params.set('staffId', String(staffId));
    if (arrival.requestId) params.set('requestId', arrival.requestId);
    const qs = params.toString();
    const href = `/m/r/${arrival.receivingId}/photos${qs ? `?${qs}` : ''}`;
    setArrival(null);
    // Defer slightly so the exit animation gets a frame to start before route flush.
    if (immediate) {
      router.push(href);
    } else {
      setTimeout(() => router.push(href), 80);
    }
  };

  const dismiss = () => setArrival(null);

  if (!portalNode) return null;

  return createPortal(
    <AnimatePresence>
      {arrival && (
        <ArrivalShell
          key={arrival.key}
          summary={summary}
          tracking={arrival.tracking}
          reduceMotion={!!reduceMotion}
          paused={paused}
          onStart={() => goToCapture(true)}
          onAutoAdvance={() => goToCapture(false)}
          onDismiss={dismiss}
          onHoldStart={() => setPaused(true)}
          onHoldEnd={() => setPaused(false)}
        />
      )}
    </AnimatePresence>,
    portalNode,
  );
}

// ─── Shell ───────────────────────────────────────────────────────────────────

interface ArrivalShellProps {
  summary: {
    po: string | null;
    totalExpected: number;
    totalReceived: number;
    carrier: string | null;
    tracking: string | null;
    headline: string | null;
    extraCount: number;
    count: number;
  };
  tracking: string | null;
  reduceMotion: boolean;
  paused: boolean;
  onStart: () => void;
  onAutoAdvance: () => void;
  onDismiss: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}

const containerVariants: Variants = {
  hidden: {},
  shown: {
    transition: {
      delayChildren: 0.08,
      staggerChildren: 0.05,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0 },
};

function ArrivalShell({
  summary,
  tracking,
  reduceMotion,
  paused,
  onStart,
  onAutoAdvance,
  onDismiss,
  onHoldStart,
  onHoldEnd,
}: ArrivalShellProps) {
  const mountedAt = useRef(Date.now());
  const headline = summary.headline || (summary.count === 0 ? 'Carton inbound' : `${summary.count} lines`);
  const trackingTail = (summary.tracking || tracking || '').slice(-6).toUpperCase();

  return (
    <div className="fixed inset-0 z-[300] md:hidden" role="dialog" aria-modal="true" aria-label="New carton arrived">
      {/* Scrim — slow blur ramp, dark gradient */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={() => {
          // Guard against ghost-tap right at mount.
          if (Date.now() - mountedAt.current < MIN_VISIBLE_MS) return;
          onDismiss();
        }}
        className="absolute inset-0 bg-gradient-to-b from-slate-950/80 via-slate-900/70 to-slate-950/85 backdrop-blur-md"
      />

      {/* Card */}
      <motion.div
        initial={{ y: '60%', opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 32, opacity: 0, scale: 0.98 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: 'spring', damping: 28, stiffness: 320, mass: 0.5 }
        }
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragStart={onHoldStart}
        onDragEnd={(_, info) => {
          onHoldEnd();
          if (info.offset.y > 110 || info.velocity.y > 700) onDismiss();
        }}
        className="absolute inset-x-3 bottom-3 overflow-hidden rounded-[28px] border border-white/10 bg-white shadow-[0_24px_64px_-12px_rgba(0,0,0,0.45)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Aurora glow band along the top edge */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[140%] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,_rgba(59,130,246,0.45),_rgba(99,102,241,0.18)_45%,_transparent_70%)] blur-2xl"
        />

        {/* Drag handle */}
        <div className="relative flex justify-center pt-3">
          <div className="h-1.5 w-12 rounded-full bg-slate-200" />
        </div>

        {/* Body — staggered children */}
        <motion.div
          variants={reduceMotion ? undefined : containerVariants}
          initial={reduceMotion ? false : 'hidden'}
          animate="shown"
          className="relative px-5 pb-4 pt-3"
        >
          {/* Eyebrow */}
          <motion.div variants={itemVariants} className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <motion.span
                aria-hidden
                animate={reduceMotion ? undefined : { scale: [1, 2.2, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                className="absolute inline-flex h-full w-full rounded-full bg-blue-400"
              />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
            </span>
            <span className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-700">
              New carton
            </span>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss"
              className="ml-auto -mr-1 grid h-9 w-9 place-items-center rounded-full text-slate-400 transition-colors active:bg-slate-100 active:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>

          {/* Headline */}
          <motion.p variants={itemVariants} className="mt-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
            {summary.po ? `PO ${summary.po}` : 'Inbound shipment'}
          </motion.p>
          <motion.h2 variants={itemVariants} className="mt-1 line-clamp-2 text-[22px] font-black tracking-tight text-slate-900">
            {headline}
          </motion.h2>
          {summary.extraCount > 0 && (
            <motion.p variants={itemVariants} className="mt-0.5 text-[11px] font-bold text-slate-500">
              + {summary.extraCount} more {summary.extraCount === 1 ? 'line' : 'lines'} on this carton
            </motion.p>
          )}

          {/* Stat tiles */}
          <motion.div variants={itemVariants} className="mt-4 grid grid-cols-3 gap-2">
            <StatTile
              label="Expected"
              value={summary.totalExpected > 0 ? String(summary.totalExpected) : '—'}
              accent="amber"
            />
            <StatTile
              label="Tracking"
              value={trackingTail || '—'}
              accent="slate"
            />
            <StatTile
              label="Carrier"
              value={summary.carrier?.toUpperCase() || '—'}
              accent="slate"
            />
          </motion.div>

          {/* Primary CTA with countdown ring */}
          <motion.div variants={itemVariants} className="mt-5">
            <StartButton
              reduceMotion={reduceMotion}
              paused={paused}
              onClick={onStart}
              onComplete={onAutoAdvance}
            />
          </motion.div>

          {/* Secondary action */}
          <motion.div variants={itemVariants} className="mt-2 flex justify-center">
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 transition-colors active:text-slate-900"
            >
              Skip for now
            </button>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}

// ─── Stat tile ───────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'amber' | 'slate';
}) {
  const valueColor = accent === 'amber' ? 'text-amber-600' : 'text-slate-900';
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2">
      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className={`mt-0.5 truncate text-[15px] font-black tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}

// ─── Start button + countdown ring ───────────────────────────────────────────

interface StartButtonProps {
  reduceMotion: boolean;
  paused: boolean;
  onClick: () => void;
  onComplete: () => void;
}

function StartButton({ reduceMotion, paused, onClick, onComplete }: StartButtonProps) {
  // 1 → 0 over AUTO_ADVANCE_MS. Pause-able via the paused prop.
  const progress = useMotionValue(1);
  const labelSeconds = useTransform(progress, (v) => Math.max(0, Math.ceil(v * (AUTO_ADVANCE_MS / 1000))));
  const [seconds, setSeconds] = useState(Math.ceil(AUTO_ADVANCE_MS / 1000));

  useEffect(() => {
    const unsub = labelSeconds.on('change', (v) => setSeconds(v as number));
    return () => unsub();
  }, [labelSeconds]);

  // Drive `progress` on a rAF tick so we can pause cleanly.
  useEffect(() => {
    if (reduceMotion) {
      // Reduced motion: hold for a beat then complete so we don't strand the user.
      const t = setTimeout(onComplete, 1200);
      return () => clearTimeout(t);
    }
    let raf = 0;
    let last = performance.now();
    let remaining = AUTO_ADVANCE_MS;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (!paused) {
        remaining -= dt;
        const next = Math.max(0, remaining / AUTO_ADVANCE_MS);
        progress.set(next);
        if (remaining <= 0) {
          onComplete();
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // We intentionally re-create the loop on paused changes via closure check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, reduceMotion]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex h-16 w-full items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-700 px-5 text-left text-white shadow-[0_10px_28px_-10px_rgba(37,99,235,0.55)] transition-transform active:scale-[0.985]"
    >
      {/* Sheen sweep */}
      <motion.span
        aria-hidden
        initial={{ x: '-120%' }}
        animate={{ x: '220%' }}
        transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
        className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent"
      />

      {/* Countdown ring */}
      <CountdownRing progress={progress} reduceMotion={reduceMotion} />

      <span className="relative flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-100/90">
          Start photos
        </span>
        <span className="truncate text-[15px] font-black tracking-tight">
          {reduceMotion ? 'Tap to begin' : `Auto-starts in ${seconds}s`}
        </span>
      </span>

      <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/25 transition-transform group-active:translate-x-0.5">
        <ChevronRight className="h-5 w-5" />
      </span>
    </button>
  );
}

// ─── Countdown ring (SVG, motion-driven stroke) ──────────────────────────────

function CountdownRing({
  progress,
  reduceMotion,
}: {
  progress: MotionValue<number>;
  reduceMotion: boolean;
}) {
  // Camera-glyph in the middle; ring stroke depletes around it.
  const R = 18;
  const C = 2 * Math.PI * R;
  // Animate the visible portion via strokeDasharray: full perimeter, offset = (1 - p) * C.
  const dashOffset = useTransform(progress, (p) => (1 - p) * C);

  return (
    <span className="relative grid h-12 w-12 shrink-0 place-items-center">
      <svg viewBox="0 0 44 44" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="22" cy="22" r={R} stroke="rgba(255,255,255,0.18)" strokeWidth="3" fill="none" />
        <motion.circle
          cx="22"
          cy="22"
          r={R}
          stroke="white"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={C}
          style={reduceMotion ? { strokeDashoffset: 0 } : { strokeDashoffset: dashOffset }}
        />
      </svg>
      <Package className="relative h-5 w-5 text-white/95" />
    </span>
  );
}
