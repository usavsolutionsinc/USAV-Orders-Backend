'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  History,
  Camera,
  Search,
  ClipboardList,
  ShieldCheck,
  Database,
} from '@/components/Icons';
import {
  TOKENS,
  SectionHeader,
  GlassButton,
} from '@/components/mobile/redesign/DesignSystem';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { MobileFeed } from '@/components/mobile/feed/MobileFeed';
import { useFeedWindow } from '@/components/mobile/feed/useMobileFeed';
import { ScanResultRow, type ScanFeedItem } from '@/components/mobile/feed/rows/ScanResultRow';
import { ScanTestingPanel } from '@/components/mobile/redesign/ScanTestingPanel';
import { detectScanMode, type ScanMode } from '@/components/mobile/redesign/scan-mode';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useFeedback } from '@/hooks/useFeedback';
import { useRouter } from 'next/navigation';

const MODES: Array<{ id: ScanMode; label: string; icon: (p: { className?: string }) => JSX.Element; placeholder: string }> = [
  { id: 'receiving', label: 'Receiving Scans', icon: ClipboardList, placeholder: 'Scan a tracking number…' },
  { id: 'testing', label: 'Testing Orders', icon: ShieldCheck, placeholder: 'Scan a PO label (R-####)…' },
  { id: 'cms', label: 'Prepacked Products', icon: Database, placeholder: 'Scan a product / unit label…' },
];

export default function RedesignedMobileUniversalScan() {
  const router = useRouter();
  const [mode, setMode] = useState<ScanMode>('receiving');
  const [cameraActive, setCameraActive] = useState(false);
  const [input, setInput] = useState('');
  const [scans, setScans] = useState<ScanFeedItem[]>([]);
  const [testingQuery, setTestingQuery] = useState('');
  const scanner = useBarcodeScanner({ dedupMs: 2000 });
  const feedback = useFeedback();
  const inFlight = useRef(false);

  const active = MODES.find((m) => m.id === mode) ?? MODES[0];
  const ActiveIcon = active.icon;

  // ── per-mode handlers ──────────────────────────────────────────────────────
  const runReceiving = useCallback(
    async (raw: string, patch: (p: Partial<ScanFeedItem>) => void) => {
      try {
        const res = await fetch('/api/receiving/lookup-po', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ trackingNumber: raw }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) {
          patch({ state: 'error', statusLabel: 'Lookup failed' });
          feedback('error');
          return;
        }
        const matched = Boolean(data.po_matched ?? data.matched);
        const poLabel = Array.isArray(data.po_ids) && data.po_ids.length > 0 ? `PO ${data.po_ids[0]}` : null;
        const receivingId = typeof data.receiving_id === 'number' ? data.receiving_id : null;
        const lineCount = Array.isArray(data.lines) ? data.lines.length : 0;
        patch({
          state: matched ? 'ok' : 'warn',
          statusLabel: matched ? poLabel ?? 'Matched' : 'No PO match',
          meta: matched && lineCount > 0 ? `${lineCount} line${lineCount === 1 ? '' : 's'}` : null,
          href: receivingId ? `/m/r/${receivingId}` : null,
        });
        feedback(matched ? 'scanAccepted' : 'confirm');
      } catch {
        patch({ state: 'error', statusLabel: 'Lookup failed' });
        feedback('error');
      }
    },
    [feedback],
  );

  const runCms = useCallback(
    async (raw: string, patch: (p: Partial<ScanFeedItem>) => void) => {
      try {
        const res = await fetch(`/api/scan/resolve?input=${encodeURIComponent(raw)}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) {
          patch({ state: 'error', statusLabel: 'No match' });
          feedback('scanRejected');
          return;
        }
        const outcome: string = data.matchOutcome ?? 'none';
        const route: string | null = data.mobileRoute ?? null;
        const label: string | null = data.kind ? String(data.kind).replace(/_/g, ' ') : null;
        if (route && outcome === 'single') {
          patch({ state: 'ok', statusLabel: label ? `Matched ${label}` : 'Matched', href: route });
          feedback('scanAccepted');
          // Found + opening the record → close the camera scanner so it isn't
          // left running over the destination page.
          setCameraActive(false);
          router.push(route);
        } else if (outcome === 'multi') {
          patch({ state: 'warn', statusLabel: 'Multiple matches' });
          feedback('confirm');
        } else {
          patch({ state: 'error', statusLabel: 'No match' });
          feedback('scanRejected');
        }
      } catch {
        patch({ state: 'error', statusLabel: 'No match' });
        feedback('scanRejected');
      }
    },
    [feedback, router],
  );

  // ── dispatch: detect mode → animate slider → run the mode's handler ────────
  const dispatch = useCallback(
    async (value: string) => {
      const raw = value.trim();
      if (!raw || inFlight.current) return;
      inFlight.current = true;
      setInput('');

      const detected = detectScanMode(raw);
      const target: ScanMode = detected ?? mode;
      if (target !== mode) {
        setMode(target);
        feedback('selection'); // slider animates to the detected mode
      } else {
        feedback('confirm');
      }

      try {
        if (target === 'testing') {
          setTestingQuery(raw);
          return;
        }
        const id = `${Date.now()}-${raw}`;
        setScans((prev) =>
          [{ id, primary: raw, at: new Date(), state: 'pending', statusLabel: 'Resolving…', href: null } as ScanFeedItem, ...prev].slice(0, 12),
        );
        const patch = (p: Partial<ScanFeedItem>) =>
          setScans((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
        if (target === 'receiving') await runReceiving(raw, patch);
        else await runCms(raw, patch);
      } finally {
        inFlight.current = false;
      }
    },
    [mode, feedback, runReceiving, runCms],
  );

  useEffect(() => {
    if (cameraActive) scanner.startScanning();
    else scanner.stopScanning();
    return () => { scanner.stopScanning(); };
  }, [cameraActive, scanner]);

  useEffect(() => {
    if (scanner.lastScannedValue) void dispatch(scanner.lastScannedValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner.lastScannedValue]);

  const { rows: feedRows, scrollRef } = useFeedWindow(scans, { limit: 12, anchor: 'top', freshPulse: false });

  return (
    <div className={`h-full ${TOKENS.colors.background} flex flex-col`}>
      {/* Mode slider (icons) + title */}
      <div className="px-4 pt-3 pb-2">
        <HorizontalButtonSlider
          variant="segmented"
          aria-label="Scan mode"
          value={mode}
          onChange={(id) => setMode(id as ScanMode)}
          items={MODES.map((m) => ({ id: m.id, label: m.label, icon: m.icon }))}
        />
        <div className="mt-2 flex items-center gap-2 px-1">
          <ActiveIcon className="h-5 w-5 text-blue-600" />
          <h1 className="text-xl font-black tracking-tight text-blue-950">{active.label}</h1>
        </div>
      </div>

      {/* Input bar (camera toggle is pinned above the nav — see bottom of file) */}
      <div className="px-6 pb-4">
        <div className="relative group">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-blue-400" />
          </div>
          <input
            autoFocus
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && dispatch(input)}
            placeholder={active.placeholder}
            className="w-full bg-white border border-blue-100 rounded-[24px] pl-11 pr-28 py-5 text-base font-bold text-blue-950 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm placeholder:text-blue-300"
          />
          <button
            onClick={() => dispatch(input)}
            className="absolute right-2 top-2 bottom-2 px-5 bg-blue-600 text-white rounded-[18px] flex items-center gap-2 active:scale-95 transition-all shadow-lg shadow-blue-600/10"
          >
            <span className="text-[10px] font-black uppercase tracking-wider">Find</span>
          </button>
        </div>
      </div>

      {/* Camera Viewfinder (Only when active) */}
      <AnimatePresence>
        {cameraActive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: '36vh', opacity: 1 }}
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
              <div className="w-56 h-56 rounded-[40px] border-2 border-white/40 bg-white/5 backdrop-blur-[1px] relative">
                <motion.div
                  animate={{ top: ['5%', '95%', '5%'] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute left-6 right-6 h-[2px] bg-blue-400 shadow-[0_0_15px_rgba(96,165,250,1)]"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result area — swaps per mode with a brief fade so the surface change reads. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          className="flex min-h-0 flex-1 flex-col bg-slate-50"
        >
          {mode === 'testing' ? (
            <div className="min-h-0 flex-1 overflow-y-auto pt-3">
              <ScanTestingPanel query={testingQuery} />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col pt-6">
              <div className="px-6">
                <SectionHeader title={mode === 'receiving' ? 'Recent Receipts' : 'Recent Scans'} />
              </div>
              <MobileFeed<ScanFeedItem>
                rows={feedRows}
                expandLast={false}
                scrollRef={scrollRef}
                className="px-3 pb-32"
                empty={
                  <div className="py-12 text-center opacity-40">
                    <History className="mx-auto mb-3 h-10 w-10 text-blue-200" />
                    <p className="text-xs font-black uppercase tracking-widest text-blue-300">
                      {mode === 'receiving' ? 'Scan tracking to begin…' : 'Waiting for first scan…'}
                    </p>
                  </div>
                }
                renderRow={(item) => <ScanResultRow item={item} />}
              />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Camera toggle pinned just above the bottom nav. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 px-6">
        <GlassButton
          variant={cameraActive ? 'primary' : 'secondary'}
          className={`pointer-events-auto w-full !rounded-[24px] shadow-xl ${cameraActive ? 'bg-blue-600 border-blue-500 shadow-blue-600/20' : 'shadow-blue-950/10'}`}
          onClick={() => setCameraActive(!cameraActive)}
          icon={Camera}
        >
          {cameraActive ? 'Close Camera' : 'Open Camera Scanner'}
        </GlassButton>
      </div>
    </div>
  );
}
