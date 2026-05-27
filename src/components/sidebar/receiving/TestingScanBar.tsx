'use client';

import { useRef, type FormEvent } from 'react';
import { Loader2, Package } from '@/components/Icons';
import { StationScanBar } from '@/components/station/StationScanBar';
import { useStationTheme } from '@/hooks/useStationTheme';

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  isResolving?: boolean;
  /** Staff id used to theme the input border (matches the shipping bar's tint). */
  staffId?: string;
}

/**
 * Testing-only variant of {@link StationScanBar}. Same chrome the shipping
 * scan bar uses — same height, theme-tinted border — but
 * with one fixed left icon (Package) and no right-side mode toggles. Testing
 * accepts a single input shape (receiving QR / PO# / RCV-id / unit-id / tracking)
 * which is fully handled by `resolveTestingScan`, so the multi-mode arming
 * affordances from the shipping bar would be misleading here.
 */
export function TestingScanBar({
  value,
  onChange,
  onSubmit,
  isResolving = false,
  staffId,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { theme: themeColor, inputBorder } = useStationTheme({
    staffId: staffId ? Number(staffId) : 0,
  });

  const handleSubmit = (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    onSubmit();
  };

  return (
    <div data-testing-scan>
      <StationScanBar
        value={value}
        onChange={onChange}
        onSubmit={handleSubmit}
        inputRef={inputRef}
        inputBorderClassName={inputBorder}
        placeholder="Receiving POs, LCPU"
        autoFocus
        icon={
          <span
            className="-ml-1 flex items-center justify-center text-emerald-600"
            aria-label="Testing scan"
            title="Scan a receiving QR / PO# / unit ID"
          >
            <Package className="h-[17px] w-[17px]" />
          </span>
        }
        inputClassName={`pl-[2.2rem] focus:ring-4 focus:ring-${themeColor}-500/10 focus:border-${themeColor}-500 pr-12`}
        rightContentClassName="right-3 gap-0.5"
        rightContent={
          isResolving ? (
            <Loader2 className="h-4 w-4 animate-spin text-gray-700" />
          ) : null
        }
      />
    </div>
  );
}
