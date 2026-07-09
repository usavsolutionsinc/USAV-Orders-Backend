'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Barcode, Package, Settings } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';
import type { StationScanType } from '@/lib/station-scan-routing';
import type { ScanCarrier } from '@/lib/scan-resolver';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MobileScanConfirmationProps {
  scannedValue: string;
  detectedType: StationScanType;
  carrier: ScanCarrier | null;
  onConfirm: (value: string, type: StationScanType) => void;
  onRescan: () => void;
  isLoading?: boolean;
}

// ─── Type badge config ──────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, {
  label: string;
  Icon: typeof MapPin;
  badge: string;
  confirmBtn: string;
  pill: string;
  pillActive: string;
}> = {
  TRACKING: {
    label: 'Tracking',
    Icon: MapPin,
    badge: 'bg-blue-100 text-blue-700 border-blue-200',
    confirmBtn: 'bg-blue-600 active:bg-blue-700',
    pill: 'bg-glass/10 text-white/70 border-glass/20',
    pillActive: 'bg-blue-500/30 text-white border-blue-400/50',
  },
  SERIAL: {
    label: 'Serial',
    Icon: Barcode,
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    confirmBtn: 'bg-emerald-600 active:bg-emerald-700',
    pill: 'bg-glass/10 text-white/70 border-glass/20',
    pillActive: 'bg-emerald-500/30 text-white border-emerald-400/50',
  },
  FNSKU: {
    label: 'FBA / FNSKU',
    Icon: Package,
    badge: 'bg-violet-100 text-violet-700 border-violet-200',
    confirmBtn: 'bg-violet-600 active:bg-violet-700',
    pill: 'bg-glass/10 text-white/70 border-glass/20',
    pillActive: 'bg-violet-500/30 text-white border-violet-400/50',
  },
  REPAIR: {
    label: 'Repair',
    Icon: Settings,
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    confirmBtn: 'bg-amber-600 active:bg-amber-700',
    pill: 'bg-glass/10 text-white/70 border-glass/20',
    pillActive: 'bg-amber-500/30 text-white border-amber-400/50',
  },
  SKU: {
    label: 'SKU',
    Icon: Barcode,
    badge: 'bg-surface-sunken text-text-muted border-border-soft',
    // ds-allow-raw-neutral: neutral member of the per-type colored confirm-button family (blue/emerald/violet/amber-600) — a themed token would drift from its colored siblings
    confirmBtn: 'bg-gray-700 active:bg-gray-800',
    pill: 'bg-glass/10 text-white/70 border-glass/20',
    // ds-allow-raw-neutral: neutral member of the colored active-pill family (blue/emerald/violet/amber-500/30); glass(#fff)/scrim(#020617) can't reproduce a mid-gray wash
    pillActive: 'bg-gray-500/30 text-white border-border-emphasis/50',
  },
  COMMAND: {
    label: 'Command',
    Icon: Settings,
    badge: 'bg-surface-sunken text-text-muted border-border-soft',
    // ds-allow-raw-neutral: neutral member of the per-type colored confirm-button family (blue/emerald/violet/amber-600) — a themed token would drift from its colored siblings
    confirmBtn: 'bg-gray-700 active:bg-gray-800',
    pill: 'bg-glass/10 text-white/70 border-glass/20',
    // ds-allow-raw-neutral: neutral member of the colored active-pill family (blue/emerald/violet/amber-500/30); glass(#fff)/scrim(#020617) can't reproduce a mid-gray wash
    pillActive: 'bg-gray-500/30 text-white border-border-emphasis/50',
  },
};

const OVERRIDE_PILLS: { type: StationScanType; label: string }[] = [
  { type: 'TRACKING', label: 'Tracking' },
  { type: 'SERIAL', label: 'Serial' },
  { type: 'FNSKU', label: 'FBA' },
  { type: 'REPAIR', label: 'Repair' },
];

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileScanConfirmation — bottom-sheet confirmation card after barcode decode.
 *
 * Shows the scanned value, auto-detected type badge, carrier info,
 * and override pills to let users correct the classification.
 */
export function MobileScanConfirmation({
  scannedValue,
  detectedType,
  carrier,
  onConfirm,
  onRescan,
  isLoading = false,
}: MobileScanConfirmationProps) {
  const [currentType, setCurrentType] = useState<StationScanType>(detectedType);

  const config = TYPE_CONFIG[currentType] || TYPE_CONFIG.TRACKING;
  const ActiveIcon = config.Icon;

  return (
    <motion.div
      initial={framerPresenceMobile.confirmation.initial}
      animate={framerPresenceMobile.confirmation.animate}
      exit={framerPresenceMobile.confirmation.exit}
      transition={framerTransitionMobile.confirmationSlideUp}
      className="absolute inset-x-0 bottom-0 z-10"
    >
      <div className="bg-surface-card rounded-t-3xl shadow-2xl px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {/* ── Header: "Detected as" + badge ── */}
        <div className="mb-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-text-faint mb-2">
            Detected As
          </p>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-caption font-black uppercase tracking-wide ${config.badge}`}>
              <ActiveIcon className="h-4 w-4" />
              {config.label}
            </span>
            {carrier && (
              <span className="text-xs font-black text-text-soft uppercase tracking-wider">
                {carrier.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>

        {/* ── Scanned value ── */}
        <div className="bg-surface-canvas rounded-2xl border border-border-soft px-4 py-3 mb-4">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-text-faint mb-1">
            Scanned Value
          </p>
          <p className="text-base font-mono font-black text-text-default break-all leading-snug">
            {scannedValue}
          </p>
        </div>

        {/* ── Override pills ── */}
        <div className="mb-5">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-text-soft mb-2">
            Not right? It&apos;s a:
          </p>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {OVERRIDE_PILLS.map(({ type, label }) => {
              const isActive = currentType === type;
              const pillConfig = TYPE_CONFIG[type] || TYPE_CONFIG.TRACKING;
              const PillIcon = pillConfig.Icon;
              return (
                // ds-raw-button: segmented scan-type override toggle pill — not a DS Button
                <button
                  key={type}
                  type="button"
                  onClick={() => setCurrentType(type)}
                  className={`ds-raw-button flex items-center gap-1.5 rounded-full border px-3.5 min-h-[44px] text-xs font-black uppercase tracking-wider transition-all active:scale-95 whitespace-nowrap ${
                    isActive ? pillConfig.badge : 'bg-surface-sunken text-text-soft border-border-soft'
                  }`}
                >
                  <PillIcon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Action buttons ── */}
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            onClick={() => onConfirm(scannedValue, currentType)}
            loading={isLoading}
            icon={
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            }
            className={`h-[52px] flex-1 ${config.confirmBtn}`}
          >
            Confirm
          </Button>
          <Button variant="secondary" onClick={onRescan} className="h-[52px] px-5">
            Rescan
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
