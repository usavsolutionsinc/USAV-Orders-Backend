'use client';

import { useRef, type FormEvent, type Ref } from 'react';
import { MapPin, Hash, ZendeskMark } from '@/components/Icons';
import {
  StationScanLeadingIcon,
  StationScanModeRail,
  ThemedStationScanBar,
} from '@/components/station/scan-bar';
import { looksLikeTicketScan } from '@/lib/support/tickets';

export type UnboxScanMode = 'ticket' | 'tracking' | 'order';

interface UnboxScanModeMeta {
  mode: UnboxScanMode;
  label: string;
  Icon: typeof MapPin;
  armedClass: string;
  iconClass: string;
}

export const UNBOX_SCAN_MODES: readonly UnboxScanModeMeta[] = [
  {
    mode: 'ticket',
    label: 'Ticket #',
    Icon: ZendeskMark,
    armedClass: 'text-emerald-700 bg-emerald-500/10',
    iconClass: 'text-emerald-600',
  },
  {
    mode: 'tracking',
    label: 'Tracking #',
    Icon: MapPin,
    armedClass: 'text-blue-700 bg-blue-500/10',
    iconClass: 'text-blue-600',
  },
  {
    mode: 'order',
    label: 'PO #',
    Icon: Hash,
    armedClass: 'text-text-muted bg-slate-500/10', // ds-allow-raw-neutral: identity/tone hue — PO-mode slate tint among emerald/blue mode tints
    iconClass: 'text-text-soft',
  },
] as const;

function modeMeta(mode: UnboxScanMode): UnboxScanModeMeta {
  return UNBOX_SCAN_MODES.find((m) => m.mode === mode) ?? UNBOX_SCAN_MODES[1];
}

/**
 * Display-only hint for the leading icon when the operator hasn't armed a mode.
 * It does NOT decide resolution — an un-armed scan submits `'auto'` and the
 * server deep-scans ticket #, PO #, and tracking # before creating a carton.
 */
export function classifyUnboxScan(value: string): UnboxScanMode {
  if (looksLikeTicketScan(value)) return 'ticket';
  return value.includes('-') ? 'order' : 'tracking';
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** `'auto'` when un-armed (server deep-scans ticket/PO/tracking); else the armed mode. */
  onSubmit: (mode: UnboxScanMode | 'auto') => void;
  inputRef?: Ref<HTMLInputElement>;
  isResolving?: boolean;
  staffId?: string;
  armedMode?: UnboxScanMode | null;
  onToggleMode?: (mode: UnboxScanMode) => void;
}

export function ReceivingUnboxScanBar({
  value,
  onChange,
  onSubmit,
  inputRef,
  isResolving = false,
  staffId,
  armedMode = null,
  onToggleMode,
}: Props) {
  const fallbackRef = useRef<HTMLInputElement>(null);

  const effective: UnboxScanMode = armedMode ?? classifyUnboxScan(value);
  const active = modeMeta(effective);
  const ActiveIcon = active.Icon;

  const handleSubmit = (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    // Armed mode is strict; un-armed submits 'auto' so the server deep-scans
    // ticket #, PO #, and tracking # (the icon is just a visual hint).
    onSubmit(armedMode ?? 'auto');
  };

  return (
    <ThemedStationScanBar
      value={value}
      onChange={onChange}
      onSubmit={handleSubmit}
      inputRef={inputRef ?? fallbackRef}
      staffId={staffId}
      placeholder={armedMode ? `Scan ${active.label}` : 'Ticket #, Tracking, PO #'}
      autoFocus
      className="w-full"
      rightPadClass="pr-32"
      isResolving={isResolving}
      icon={
        <StationScanLeadingIcon
          Icon={ActiveIcon}
          tintClassName={active.iconClass}
          ariaLabel={
            armedMode
              ? `Armed: ${active.label}`
              : 'Auto — looks up Ticket #, PO #, and Tracking #'
          }
          title={
            armedMode
              ? `Next scan forced to ${active.label}. Click the icon again to auto-detect.`
              : 'Auto — looks the scan up as a Ticket #, PO #, and Tracking # before creating a carton'
          }
        />
      }
      rightContent={
        <StationScanModeRail
          modes={UNBOX_SCAN_MODES}
          armedMode={armedMode}
          onToggleMode={onToggleMode}
          size="compact"
          getAriaLabel={(mode, armed) =>
            armed
              ? `${mode.label} armed for next scan. Click again to auto-detect.`
              : `Arm ${mode.label}: force the next scan to search ${mode.label}.`
          }
          getTitle={(mode, armed) =>
            armed
              ? `${mode.label} armed — next scan. Click again to auto-detect.`
              : `Search by ${mode.label}`
          }
        />
      }
    />
  );
}
