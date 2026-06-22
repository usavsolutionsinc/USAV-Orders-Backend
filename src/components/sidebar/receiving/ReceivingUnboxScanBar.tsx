'use client';

import { useRef, type FormEvent, type Ref } from 'react';
import { MapPin, Hash } from '@/components/Icons';
import {
  StationScanLeadingIcon,
  StationScanModeRail,
  ThemedStationScanBar,
} from '@/components/station/scan-bar';

export type UnboxScanMode = 'tracking' | 'order';

interface UnboxScanModeMeta {
  mode: UnboxScanMode;
  label: string;
  Icon: typeof MapPin;
  armedClass: string;
  iconClass: string;
}

export const UNBOX_SCAN_MODES: readonly UnboxScanModeMeta[] = [
  {
    mode: 'tracking',
    label: 'Tracking #',
    Icon: MapPin,
    armedClass: 'text-blue-700 bg-blue-50',
    iconClass: 'text-blue-600',
  },
  {
    mode: 'order',
    label: 'PO #',
    Icon: Hash,
    armedClass: 'text-gray-700 bg-gray-100',
    iconClass: 'text-gray-500',
  },
] as const;

function modeMeta(mode: UnboxScanMode): UnboxScanModeMeta {
  return UNBOX_SCAN_MODES.find((m) => m.mode === mode) ?? UNBOX_SCAN_MODES[0];
}

export function classifyUnboxScan(value: string): UnboxScanMode {
  return value.includes('-') ? 'order' : 'tracking';
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit: (mode: UnboxScanMode) => void;
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
    onSubmit(armedMode ?? classifyUnboxScan(value));
  };

  return (
    <ThemedStationScanBar
      value={value}
      onChange={onChange}
      onSubmit={handleSubmit}
      inputRef={inputRef ?? fallbackRef}
      staffId={staffId}
      placeholder={armedMode ? `Scan ${active.label}` : 'Tracking, PO #'}
      autoFocus
      className="w-full"
      rightPadClass="pr-24"
      isResolving={isResolving}
      icon={
        <StationScanLeadingIcon
          Icon={ActiveIcon}
          tintClassName={active.iconClass}
          ariaLabel={armedMode ? `Armed: ${active.label}` : `Auto-detect (${active.label})`}
          title={
            armedMode
              ? `Next scan forced to ${active.label}. Click the icon again to auto-detect.`
              : 'Auto-detect — a value with “-” searches PO #, otherwise Tracking'
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
