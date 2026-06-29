'use client';

import { useRef, type FormEvent } from 'react';
import { Barcode, MapPin, ClipboardList, Hash } from '@/components/Icons';
import {
  StationScanLeadingIcon,
  StationScanModeRail,
  ThemedStationScanBar,
} from '@/components/station/scan-bar';
import type { ForcedTestingType } from '@/lib/testing/resolve-testing-scan';

export interface TestingScanModeMeta {
  mode: ForcedTestingType;
  label: string;
  Icon: typeof MapPin;
  armedClass: string;
  iconClass: string;
}

export const TESTING_SCAN_MODES: readonly TestingScanModeMeta[] = [
  {
    mode: 'tracking',
    label: 'Tracking',
    Icon: MapPin,
    armedClass: 'text-blue-700 bg-blue-500/10',
    iconClass: 'text-blue-600',
  },
  {
    mode: 'po',
    label: 'PO#',
    Icon: ClipboardList,
    armedClass: 'text-indigo-700 bg-indigo-500/10',
    iconClass: 'text-indigo-600',
  },
  {
    mode: 'serial',
    label: 'Serial',
    Icon: Barcode,
    armedClass: 'text-emerald-700 bg-emerald-500/10',
    iconClass: 'text-emerald-600',
  },
  {
    mode: 'sku',
    label: 'SKU',
    Icon: Hash,
    armedClass: 'text-purple-700 bg-purple-500/10',
    iconClass: 'text-purple-600',
  },
] as const;

export function testingScanModeMeta(mode: ForcedTestingType): TestingScanModeMeta {
  return TESTING_SCAN_MODES.find((m) => m.mode === mode) ?? TESTING_SCAN_MODES[2];
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  isResolving?: boolean;
  staffId?: string;
  armedMode?: ForcedTestingType | null;
  onToggleMode?: (mode: ForcedTestingType) => void;
}

export function TestingScanBar({
  value,
  onChange,
  onSubmit,
  isResolving = false,
  staffId,
  armedMode = null,
  onToggleMode,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    onSubmit();
  };

  const active = armedMode ? testingScanModeMeta(armedMode) : null;
  const ActiveIcon = active?.Icon ?? Barcode;

  return (
    <div data-testing-scan>
      <ThemedStationScanBar
        value={value}
        onChange={onChange}
        onSubmit={handleSubmit}
        inputRef={inputRef}
        staffId={staffId}
        placeholder={armedMode ? `Scan ${active?.label}…` : 'Scan or pick a route →'}
        autoFocus
        rightPadClass="pr-36"
        isResolving={isResolving}
        icon={
          <StationScanLeadingIcon
            Icon={ActiveIcon}
            tintClassName={active?.iconClass ?? 'text-gray-400'}
            ariaLabel={armedMode ? `Armed: ${active?.label}` : 'Auto-detect'}
            title={
              armedMode
                ? `Next scan forced to ${active?.label}`
                : 'Auto-detect (pick a route to force)'
            }
          />
        }
        rightContent={
          <StationScanModeRail
            modes={TESTING_SCAN_MODES}
            armedMode={armedMode}
            onToggleMode={onToggleMode}
            size="compact"
          />
        }
      />
    </div>
  );
}
