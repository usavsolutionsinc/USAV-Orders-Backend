'use client';

import { useRef, type FormEvent } from 'react';
import { Barcode, MapPin, Hash, Pencil } from '@/components/Icons';
import {
  StationScanLeadingIcon,
  StationScanModeRail,
  ThemedStationScanBar,
} from '@/components/station/scan-bar';
import { classifyInput } from '@/lib/scan-resolver';
import {
  looksLikeHandlingUnit,
  looksLikePoNumber,
  looksLikeReceivingRef,
  looksLikeUnitId,
  type ForcedTestingType,
} from '@/lib/testing/resolve-testing-scan';

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
    Icon: Hash,
    armedClass: 'text-text-muted bg-slate-500/10', // ds-allow-raw-neutral: PO# hash tint among mode rail hues
    iconClass: 'text-text-soft',
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
    Icon: Pencil,
    armedClass: 'text-yellow-700 bg-yellow-500/10',
    iconClass: 'text-yellow-600',
  },
] as const;

/**
 * Display-only hint for the leading icon when the operator hasn't armed a mode.
 * Does NOT decide resolution — un-armed scans still auto-detect server-side.
 */
export function classifyTestingScan(value: string): ForcedTestingType {
  const v = value.trim();
  if (!v) return 'serial';
  if (looksLikePoNumber(v)) return 'po';
  if (
    looksLikeReceivingRef(v) ||
    looksLikeUnitId(v) ||
    looksLikeHandlingUnit(v)
  ) {
    return 'serial';
  }
  const classified = classifyInput(v);
  if (classified.type === 'tracking') return 'tracking';
  return 'serial';
}

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

  const effective: ForcedTestingType = armedMode ?? classifyTestingScan(value);
  const active = testingScanModeMeta(effective);
  const ActiveIcon = active.Icon;

  return (
    <div data-testing-scan>
      <ThemedStationScanBar
        value={value}
        onChange={onChange}
        onSubmit={handleSubmit}
        inputRef={inputRef}
        staffId={staffId}
        placeholder={armedMode ? `Scan ${active.label}…` : 'Scan or pick a route →'}
        autoFocus
        rightPadClass="pr-36"
        isResolving={isResolving}
        icon={
          <StationScanLeadingIcon
            Icon={ActiveIcon}
            tintClassName={active.iconClass}
            ariaLabel={
              armedMode
                ? `Armed: ${active.label}`
                : 'Auto-detect — tracking, PO#, serial, or SKU'
            }
            title={
              armedMode
                ? `Next scan forced to ${active.label}. Click the mode again to auto-detect.`
                : 'Auto-detect — pick a route on the right to force the next scan'
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
