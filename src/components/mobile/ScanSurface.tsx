'use client';

/**
 * ScanSurface — reusable camera scanner surface for mobile task screens.
 *
 * Wraps `useBarcodeScanner` with the standard 2026-feel chrome:
 *   - Corner brackets framing the active scan region
 *   - Sweeping horizontal line animation (visual heartbeat)
 *   - Torch toggle (top-left)
 *   - Manual entry expander (text input slides in from below the camera)
 *   - Permission / error guidance overlay
 *
 * The hook is owned by the caller — pass it in so the parent decides scanner
 * lifecycle (start, stop, accept). This keeps multiple screens from each
 * acquiring camera permission independently.
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ScanLine } from 'lucide-react';
import type { UseBarcodeScanner } from '@/hooks/useBarcodeScanner';

interface ScanSurfaceProps {
  /** Scanner hook instance from `useBarcodeScanner()`. */
  scanner: UseBarcodeScanner;
  /** Called with the decoded value when a scan is accepted. */
  onDecode: (value: string) => void;
  /** Optional placeholder for the manual entry input. */
  manualPlaceholder?: string;
  /** Tone for the corner brackets — defaults to brand blue. */
  bracketTone?: 'blue' | 'emerald' | 'amber';
  /** Aspect ratio for the camera frame. Default `4 / 3`. */
  aspectRatio?: string;
}

const BRACKET_TONE: Record<NonNullable<ScanSurfaceProps['bracketTone']>, string> = {
  blue:    'border-blue-400',
  emerald: 'border-emerald-400',
  amber:   'border-amber-400',
};

export function ScanSurface({
  scanner,
  onDecode,
  manualPlaceholder = 'Type code…',
  bracketTone = 'blue',
  aspectRatio = '4 / 3',
}: ScanSurfaceProps) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Hand decoded values up to the caller and reset the scanner for the next read.
  useEffect(() => {
    const value = scanner.lastScannedValue;
    if (!value) return;
    onDecode(value);
    scanner.acceptScan();
    // Brief delay so the corner brackets pulse before clearing.
    const t = window.setTimeout(() => scanner.resetLastScan(), 600);
    return () => window.clearTimeout(t);
  }, [scanner.lastScannedValue, onDecode, scanner]);

  // Focus the input when the manual entry expands.
  useEffect(() => {
    if (manualOpen) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [manualOpen]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualValue.trim();
    if (!trimmed) return;
    onDecode(trimmed);
    setManualValue('');
    setManualOpen(false);
  };

  const bracketCls = BRACKET_TONE[bracketTone];
  const isScanError = scanner.scanStatus === 'error';
  const isPulse = scanner.lastScannedValue != null;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-900">
      {/* Camera frame */}
      <div className="relative w-full bg-black" style={{ aspectRatio }}>
        <video
          ref={scanner.videoRef as React.RefObject<HTMLVideoElement>}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* Corner brackets */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[64%] w-[80%]">
            <Corner pos="tl" tone={bracketCls} pulse={isPulse} />
            <Corner pos="tr" tone={bracketCls} pulse={isPulse} />
            <Corner pos="bl" tone={bracketCls} pulse={isPulse} />
            <Corner pos="br" tone={bracketCls} pulse={isPulse} />

            {/* Sweeping line — quiet visual heartbeat while scanning */}
            {!isScanError && (
              <motion.div
                aria-hidden="true"
                initial={{ y: '0%' }}
                animate={{ y: ['0%', '100%', '0%'] }}
                transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
                className={`absolute inset-x-0 h-[2px] ${
                  bracketTone === 'blue'
                    ? 'bg-blue-400/80'
                    : bracketTone === 'emerald'
                      ? 'bg-emerald-400/80'
                      : 'bg-amber-400/80'
                } shadow-[0_0_8px_currentColor]`}
              />
            )}
          </div>
        </div>

        {/* Torch toggle */}
        {scanner.isScanning && (
          <button
            type="button"
            onClick={scanner.toggleTorch}
            aria-label="Toggle flashlight"
            aria-pressed={scanner.torchOn}
            className={`absolute top-3 left-3 grid h-10 w-10 place-items-center rounded-full text-lg backdrop-blur transition-colors ${
              scanner.torchOn ? 'bg-yellow-400/90 text-black' : 'bg-white/15 text-white/85'
            }`}
          >
            ⚡
          </button>
        )}

        {/* Status pill — top right */}
        <span
          className={`absolute top-3 right-3 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur ${
            isScanError
              ? 'bg-red-500/85 text-white'
              : scanner.isScanning
                ? 'bg-emerald-500/85 text-white'
                : 'bg-white/15 text-white/85'
          }`}
        >
          {isScanError ? 'Camera error' : scanner.isScanning ? 'Scanning' : 'Paused'}
        </span>

        {/* Error overlay */}
        {isScanError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
            <p className="max-w-[280px] text-sm text-red-200">
              {scanner.error || 'Camera unavailable. Check browser permissions and reload.'}
            </p>
            <button
              type="button"
              onClick={() => void scanner.startScanning()}
              className="rounded-2xl bg-white/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-white hover:bg-white/20"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* Manual entry dock — collapsed by default */}
      <div className="bg-slate-900 px-3 py-2.5">
        {manualOpen ? (
          <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder={manualPlaceholder}
              autoComplete="off"
              inputMode="text"
              className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40"
            />
            <button
              type="submit"
              disabled={!manualValue.trim()}
              className="h-11 rounded-xl bg-blue-600 px-4 text-xs font-semibold uppercase tracking-wider text-white active:bg-blue-700 disabled:opacity-50"
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => {
                setManualValue('');
                setManualOpen(false);
              }}
              className="h-11 rounded-xl bg-white/5 px-3 text-xs font-semibold uppercase tracking-wider text-white/80 active:bg-white/10"
              aria-label="Cancel manual entry"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-semibold uppercase tracking-wider text-white/75 active:text-white"
          >
            <ScanLine className="h-4 w-4" aria-hidden="true" />
            Type code manually
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Corner bracket ──────────────────────────────────────────────────────────

function Corner({
  pos,
  tone,
  pulse,
}: {
  pos: 'tl' | 'tr' | 'bl' | 'br';
  tone: string;
  pulse: boolean;
}) {
  const sides: Record<typeof pos, string> = {
    tl: 'top-0 left-0 border-t-4 border-l-4 rounded-tl-2xl',
    tr: 'top-0 right-0 border-t-4 border-r-4 rounded-tr-2xl',
    bl: 'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-2xl',
    br: 'bottom-0 right-0 border-b-4 border-r-4 rounded-br-2xl',
  };
  return (
    <span
      aria-hidden="true"
      className={`absolute h-8 w-8 ${sides[pos]} ${tone} transition-all ${
        pulse ? 'scale-110 brightness-150' : 'scale-100'
      }`}
    />
  );
}
