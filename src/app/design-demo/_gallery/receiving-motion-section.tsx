'use client';

/**
 * 2026 Receiving Motion Lab.
 * 
 * High-fidelity motion patterns for the receiving flow:
 * - Laser Scan: Visual feedback for barcode resolution.
 * - Hero Transition: Morphing from list-item to workspace header.
 * - Spring Actions: Physical-feeling success/failure states.
 * - Liquid Progress: High-density, fluid feedback.
 */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { 
  Check, 
  X, 
  Search, 
  Package, 
  Zap, 
  Sparkles, 
  Smartphone,
  ChevronRight,
  ArrowRight
} from '@/components/Icons';
import { cx } from './sections';

const spring = { type: 'spring', stiffness: 520, damping: 36 } as const;
const snappySpring = { type: 'spring', stiffness: 600, damping: 30 } as const;
const bouncySpring = { type: 'spring', stiffness: 400, damping: 15 } as const;

/* ═══════════════════════════════ COMPONENTS ═══════════════════════════════ */

/**
 * Variant A: The "Laser Scan"
 * A blue-purple beam that sweeps over a row when it's scanned.
 */
function LaserScanRow({ title, po }: { title: string; po: string }) {
  const [scanning, setScanning] = useState(false);
  
  const trigger = () => {
    if (scanning) return;
    setScanning(true);
    setTimeout(() => setScanning(false), 800);
  };

  return (
    <div 
      onClick={trigger}
      className="relative cursor-pointer overflow-hidden rounded-xl border border-border-soft bg-surface-card p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-canvas ring-1 ring-border-soft">
            <Package className="h-4 w-4 text-text-muted" />
          </div>
          <div>
            <p className="text-[12px] font-bold text-text-default">{title}</p>
            <p className="text-[10px] font-mono text-text-muted">PO-{po}</p>
          </div>
        </div>
        <Search className="h-3.5 w-3.5 text-text-muted opacity-40" />
      </div>

      <AnimatePresence>
        {scanning && (
          <motion.div
            initial={{ left: '-10%', opacity: 0 }}
            animate={{ left: '110%', opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            className="pointer-events-none absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-blue-500/20 to-transparent skew-x-12"
          >
            <div className="absolute inset-y-0 right-0 w-[2px] bg-blue-500 shadow-[0_0_15px_blue]" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Variant B: Hero Transition (layoutId)
 * Morphing a small PO chip into the workspace header.
 */
function HeroTransitionDemo() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex h-[200px] w-full items-center justify-center overflow-hidden rounded-xl bg-surface-canvas/40 ring-1 ring-border-soft/60">
      <AnimatePresence mode="wait">
        {!expanded ? (
          <motion.button
            layoutId="hero-panel"
            onClick={() => setExpanded(true)}
            className="flex items-center gap-2 rounded-full border border-border-soft bg-surface-card px-3 py-1.5 shadow-sm"
          >
            <motion.div layoutId="hero-icon" className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600">
              <Package className="h-3 w-3 text-white" />
            </motion.div>
            <motion.span layoutId="hero-label" className="text-[11px] font-bold text-text-default">PO-4471</motion.span>
            <ChevronRight className="h-3 w-3 text-text-muted" />
          </motion.button>
        ) : (
          <motion.div
            layoutId="hero-panel"
            className="flex h-full w-full flex-col bg-surface-card shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-border-soft bg-surface-canvas/30 px-4 py-3">
              <div className="flex items-center gap-3">
                <motion.div layoutId="hero-icon" className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600">
                  <Package className="h-4 w-4 text-white" />
                </motion.div>
                <div className="leading-tight">
                  <motion.p layoutId="hero-label" className="text-[13px] font-black tracking-tight text-text-default">PO-4471</motion.p>
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[10px] text-text-muted">Bose Lifestyle V25</motion.p>
                </div>
              </div>
              <button 
                onClick={() => setExpanded(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-canvas"
              >
                <X className="h-4 w-4 text-text-muted" />
              </button>
            </header>
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex-1 p-4"
            >
              <div className="h-20 w-full rounded-lg border border-dashed border-border-soft bg-surface-canvas/50" />
              <div className="mt-3 flex gap-2">
                <div className="h-8 flex-1 rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20" />
                <div className="h-8 flex-1 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/20" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Variant C: Spring-loaded Success
 * Physical-feeling success state for the "Pass" action.
 */
function SuccessActionDemo() {
  const [state, setState] = useState<'idle' | 'success' | 'fail'>('idle');

  const handleAction = (s: 'success' | 'fail') => {
    setState(s);
    setTimeout(() => setState('idle'), 2000);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-16 w-16">
        <AnimatePresence mode="wait">
          {state === 'idle' && (
            <motion.div
              key="idle"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="flex h-full w-full items-center justify-center rounded-2xl bg-surface-canvas ring-1 ring-border-soft"
            >
              <Package className="h-8 w-8 text-text-muted opacity-30" />
            </motion.div>
          )}
          {state === 'success' && (
            <motion.div
              key="success"
              initial={{ scale: 0.5, rotate: -45, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={bouncySpring}
              className="flex h-full w-full items-center justify-center rounded-2xl bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.4)]"
            >
              <Check className="h-10 w-10 text-white" />
            </motion.div>
          )}
          {state === 'fail' && (
            <motion.div
              key="fail"
              initial={{ x: -10, opacity: 0 }}
              animate={{ x: [0, -10, 10, -10, 10, 0], opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="flex h-full w-full items-center justify-center rounded-2xl bg-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.4)]"
            >
              <X className="h-10 w-10 text-white" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => handleAction('success')}
          className="rounded-xl bg-emerald-500 px-4 py-2 text-[12px] font-bold text-white shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform"
        >
          Pass · Print
        </button>
        <button
          onClick={() => handleAction('fail')}
          className="rounded-xl bg-rose-500 px-4 py-2 text-[12px] font-bold text-white shadow-lg shadow-rose-500/20 active:scale-95 transition-transform"
        >
          Fail · Flag
        </button>
      </div>
    </div>
  );
}

/**
 * Variant D: Liquid Progress
 * Aurora gradients + fluid progress.
 */
function LiquidProgressDemo() {
  const [progress, setProgress] = useState(30);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress(p => (p >= 100 ? 0 : p + 5));
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="w-full max-w-[240px] space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-black uppercase tracking-wider text-text-muted">Line Progress</span>
        <span className="text-[10px] font-mono font-bold text-blue-600">{progress}%</span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-surface-canvas ring-1 ring-border-soft">
        <motion.div
          animate={{ width: `${progress}%` }}
          transition={snappySpring}
          className="relative h-full overflow-hidden rounded-full bg-blue-600"
        >
          {/* Aurora sweep */}
          <motion.div
            animate={{ left: ['-100%', '200%'] }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12"
          />
        </motion.div>
      </div>
      <p className="text-center text-[9px] text-text-muted italic">Simulating scan-to-scan progress...</p>
    </div>
  );
}

/* ════════════════════════════════ SECTION ═════════════════════════════════ */

function Bay({
  title,
  promote,
  caption,
  children,
  span = 1,
}: {
  title: string;
  promote: string;
  caption?: string;
  children: React.ReactNode;
  span?: 1 | 2;
}) {
  return (
    <div
      className={cx(
        'flex flex-col rounded-2xl border border-border-soft bg-surface-card p-4',
        span === 2 && 'sm:col-span-2',
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold tracking-tight text-text-default">{title}</h3>
          <code className="mt-0.5 block truncate font-mono text-[10px] text-text-muted">{promote}</code>
        </div>
        <span className="inline-flex items-center rounded-full bg-blue-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-600 ring-1 ring-blue-500/20">
          2026 · Motion
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center rounded-xl bg-surface-canvas/60 p-5 ring-1 ring-border-soft/60">
        <div className="w-full">{children}</div>
      </div>
      {caption ? <p className="mt-2.5 text-[11px] leading-snug text-text-muted">{caption}</p> : null}
    </div>
  );
}

export function ReceivingMotionSection() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Bay 
        title="Laser Scan Sweep" 
        promote="framer-motion AnimatePresence" 
        caption="A visual confirmation that a scan is resolving. Sweeps a laser-like beam across the row. Click the row to scan."
      >
        <div className="space-y-2">
          <LaserScanRow title="Bose Lifestyle V25" po="4471" />
          <LaserScanRow title="Klipsch R-120SW" po="4466" />
        </div>
      </Bay>

      <Bay 
        title="Hero Morph (layoutId)" 
        promote="framer-motion layoutId" 
        caption="Shared-element transition from a list item to the workspace header. No 'jumping' — elements physically travel to their new home."
      >
        <HeroTransitionDemo />
      </Bay>

      <Bay 
        title="Spring Action Feedback" 
        promote="framer-motion whileTap + bouncySpring" 
        caption="Physical success/failure states with bouncy spring physics. Replaces simple fade-in toasts with high-signal micro-interactions."
      >
        <SuccessActionDemo />
      </Bay>

      <Bay 
        title="Liquid Progress Bar" 
        promote="CSS Linear() + Aurora gradients" 
        caption="Progress that feels 'alive'. Uses aurora sweeps and snappy spring widths to convey movement during the receiving flow."
      >
        <LiquidProgressDemo />
      </Bay>
    </div>
  );
}
