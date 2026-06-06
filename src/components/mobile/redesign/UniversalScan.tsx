'use client';

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  History,
  ClipboardList,
  ShieldCheck,
  Box,
} from '@/components/Icons';
import {
  TOKENS,
  SectionHeader,
} from '@/components/mobile/redesign/DesignSystem';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { MobileFeed } from '@/components/mobile/feed/MobileFeed';
import { useFeedWindow } from '@/components/mobile/feed/useMobileFeed';
import { ScanResultRow, type ScanFeedItem } from '@/components/mobile/feed/rows/ScanResultRow';
import { ScanTestingPanel } from '@/components/mobile/redesign/ScanTestingPanel';
import { ScanInput } from '@/components/mobile/redesign/ScanInput';
import { PrepackedProductSheet } from '@/components/mobile/redesign/PrepackedProductSheet';
import { detectScanMode, type ScanMode } from '@/components/mobile/redesign/scan-mode';
import { useFeedback } from '@/hooks/useFeedback';

const MODES: Array<{ id: ScanMode; label: string; icon: (p: { className?: string }) => JSX.Element; placeholder: string }> = [
  { id: 'receiving', label: 'Receiving Scans', icon: ClipboardList, placeholder: 'Scan a tracking number…' },
  { id: 'testing', label: 'Testing Orders', icon: ShieldCheck, placeholder: 'Scan a PO label (R-####)…' },
  { id: 'cms', label: 'Prepacked Products', icon: Box, placeholder: 'Scan a product / unit label…' },
];

export default function RedesignedMobileUniversalScan() {
  const [mode, setMode] = useState<ScanMode>('receiving');
  // Each mode keeps its own history — a receiving door-scan and a prepacked
  // product lookup are different lists and must not bleed into each other.
  const [receivingScans, setReceivingScans] = useState<ScanFeedItem[]>([]);
  const [cmsScans, setCmsScans] = useState<ScanFeedItem[]>([]);
  const [testingScans, setTestingScans] = useState<ScanFeedItem[]>([]);
  const [testingQuery, setTestingQuery] = useState('');
  // The scanned unit label whose Prepacked Products sheet is open (null = closed).
  const [prepackScan, setPrepackScan] = useState<string | null>(null);
  const feedback = useFeedback();
  const inFlight = useRef(false);

  const active = MODES.find((m) => m.id === mode) ?? MODES[0];
  const ActiveIcon = active.icon;

  // ── receiving handler (door scan-in → lookup-po) ───────────────────────────
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

  // ── dispatch: detect mode → animate slider → run the mode's handler ────────
  const dispatch = useCallback(
    async (value: string) => {
      const raw = value.trim();
      if (!raw || inFlight.current) return;
      inFlight.current = true;

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
          // Keep a recent-scans history for testing too (its own list), so the
          // mode matches Receiving/Prepacked. De-dupe the active label to top.
          setTestingScans((prev) =>
            [
              { id: `${Date.now()}-${raw}`, primary: raw, at: new Date(), state: 'ok', statusLabel: 'PO label', href: null } as ScanFeedItem,
              ...prev.filter((s) => s.primary !== raw),
            ].slice(0, 12),
          );
          return;
        }

        const id = `${Date.now()}-${raw}`;
        const setList = target === 'cms' ? setCmsScans : setReceivingScans;
        setList((prev) =>
          [{ id, primary: raw, at: new Date(), state: 'pending', statusLabel: 'Resolving…', href: null } as ScanFeedItem, ...prev].slice(0, 12),
        );
        const patch = (p: Partial<ScanFeedItem>) =>
          setList((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));

        if (target === 'receiving') {
          await runReceiving(raw, patch);
        } else {
          // Prepacked: open the detail/verify sheet. The sheet owns resolution
          // (live unit → product metadata → unknown) so there's no dead-end.
          patch({ state: 'ok', statusLabel: 'Opening…' });
          setPrepackScan(raw);
        }
      } finally {
        inFlight.current = false;
      }
    },
    [mode, feedback, runReceiving],
  );

  // Show only the active mode's own history (receiving vs prepacked products).
  const activeScans = mode === 'cms' ? cmsScans : receivingScans;
  const { rows: feedRows, scrollRef } = useFeedWindow(activeScans, { limit: 12, anchor: 'top', freshPulse: false });

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

      {/* Scan surface — manual input + camera, shared with the location step. */}
      <div className="px-6 pb-4">
        <ScanInput
          onDecode={dispatch}
          placeholder={active.placeholder}
          autoFocus
          cameraSuspended={prepackScan != null}
        />
      </div>

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
              {/* Recent Scans — testing mode keeps its own history under the
                  scan bar, matching Receiving/Prepacked. The active PO's items
                  render below in the testing panel. */}
              <div className="px-6">
                <SectionHeader title="Recent Scans" />
              </div>
              {testingScans.length === 0 ? (
                <div className="py-8 text-center opacity-40">
                  <History className="mx-auto mb-3 h-10 w-10 text-blue-200" />
                  <p className="text-xs font-black uppercase tracking-widest text-blue-300">
                    Scan a PO label to begin…
                  </p>
                </div>
              ) : (
                <div className="pb-2">
                  {testingScans.map((item) => (
                    <ScanResultRow key={item.id} item={item} />
                  ))}
                </div>
              )}
              <ScanTestingPanel query={testingQuery} />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col pt-3">
              <div className="px-6">
                <SectionHeader title="Recent Scans" />
              </div>
              <MobileFeed<ScanFeedItem>
                rows={feedRows}
                expandLast={false}
                scrollRef={scrollRef}
                className="pb-32"
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

      {/* Prepacked Products: scan-to-verify detail + scan-to-locate put-away. */}
      <PrepackedProductSheet scanned={prepackScan} onClose={() => setPrepackScan(null)} />
    </div>
  );
}
