'use client';

/**
 * Scan-band presentational components for the receiving sidebar.
 *
 * `ScanBandShell` is the shared animated container (staff-tinted halo + fade-in
 * entrance). `TriageScanBand` is the tracking-only entry used by the Receiving
 * (triage) surface; `UnboxScanBand` is the mode-toggling entry used by Unbox.
 * Both are thin: they own no scan logic — submit/value are handed down from the
 * panel's scan hook. Extracted from ReceivingSidebarPanel.
 */

import { motion } from 'framer-motion';
import { cn } from '@/utils/_cn';
import { Loader2 } from '@/components/Icons';
import { receivingScanBandClass, SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { StationScanBar } from '@/components/station/StationScanBar';
import {
  ReceivingUnboxScanBar,
  type UnboxScanMode,
} from '@/components/sidebar/receiving/ReceivingUnboxScanBar';
import { scanBandHaloClass } from '@/components/sidebar/receiving/useScanBandHalo';
import type { StationTheme } from '@/hooks/useStationTheme';

interface ScanBandShellProps {
  themeColor: StationTheme;
  children: React.ReactNode;
}

/**
 * Animated, staff-tinted container for a scan bar. Opacity-only entrance so
 * the band is not clipped by sidebar `overflow-hidden` ancestors.
 */
export function ScanBandShell({ themeColor, children }: ScanBandShellProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn(receivingScanBandClass, scanBandHaloClass(themeColor), SIDEBAR_GUTTER)}
    >
      {children}
    </motion.div>
  );
}

interface TriageScanBandProps {
  themeColor: StationTheme;
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  inputRef: React.Ref<HTMLInputElement>;
  inputBorderClassName: string;
  isResolving: boolean;
}

/**
 * Tracking-only scan entry for the Receiving (triage) surface — no
 * Tracking#/PO# mode toggle. The input doubles as the live rail filter; submit
 * runs the same lookup-po flow as Unbox.
 */
export function TriageScanBand({
  themeColor,
  value,
  onChange,
  onSubmit,
  inputRef,
  inputBorderClassName,
  isResolving,
}: TriageScanBandProps) {
  return (
    <ScanBandShell themeColor={themeColor}>
      <StationScanBar
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        inputRef={inputRef}
        placeholder="Scan tracking #"
        autoFocus
        className="w-full"
        inputBorderClassName={inputBorderClassName}
        hasRightContent={isResolving}
        rightContent={
          isResolving ? <Loader2 className="h-4 w-4 animate-spin text-gray-700" /> : null
        }
      />
    </ScanBandShell>
  );
}

interface UnboxScanBandProps {
  themeColor: StationTheme;
  value: string;
  onChange: (next: string) => void;
  onSubmit: (mode: UnboxScanMode | 'auto') => void;
  inputRef: React.Ref<HTMLInputElement>;
  isResolving: boolean;
  staffId: string;
  armedMode: UnboxScanMode | null;
  onToggleMode: (mode: UnboxScanMode) => void;
}

/** Mode-toggling scan entry for the Unbox workspace. */
export function UnboxScanBand({
  themeColor,
  value,
  onChange,
  onSubmit,
  inputRef,
  isResolving,
  staffId,
  armedMode,
  onToggleMode,
}: UnboxScanBandProps) {
  return (
    <ScanBandShell themeColor={themeColor}>
      <ReceivingUnboxScanBar
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        inputRef={inputRef}
        isResolving={isResolving}
        staffId={staffId}
        armedMode={armedMode}
        onToggleMode={onToggleMode}
      />
    </ScanBandShell>
  );
}
