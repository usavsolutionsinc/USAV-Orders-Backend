'use client';

import { Loader2 } from '@/components/Icons';
import { useStationTheme } from '@/hooks/useStationTheme';
import { cn } from '@/utils/_cn';
import { StationScanBar, type StationScanBarProps } from './StationScanBar';
import {
  STATION_SCAN_BAR_RIGHT_CONTENT_CLASS,
  stationScanBarFocusInputClass,
} from './tokens';

export interface ThemedStationScanBarProps extends Omit<StationScanBarProps, 'inputBorderClassName'> {
  /** Staff id — resolves theme-colored border + focus ring. */
  staffId?: string | number | null;
  /** Override the themed border when a surface needs a one-off stroke. */
  inputBorderClassName?: string;
  /** Show a spinner in the right rail (lookup in flight). */
  isResolving?: boolean;
  /** Extra right-padding class when mode rails reserve space (e.g. pr-32, pr-36). */
  rightPadClass?: string;
}

/**
 * Master scan-bar shell: {@link StationScanBar} + staff theme border + focus
 * ring + standard right-rail inset. Domain wrappers (tech, testing, receiving,
 * pack, FBA) should compose this instead of re-wiring theme classes by hand.
 */
export function ThemedStationScanBar({
  staffId,
  inputBorderClassName,
  inputClassName,
  rightContentClassName,
  rightContent,
  isResolving = false,
  rightPadClass,
  ...props
}: ThemedStationScanBarProps) {
  const { theme, inputBorder } = useStationTheme({
    staffId: staffId != null ? Number(staffId) : 0,
  });

  const resolvedRight =
    isResolving || rightContent != null ? (
      <>
        {isResolving ? <Loader2 className="h-4 w-4 animate-spin text-gray-700" /> : null}
        {rightContent}
      </>
    ) : null;

  return (
    <StationScanBar
      {...props}
      inputBorderClassName={inputBorderClassName ?? inputBorder}
      inputClassName={cn(stationScanBarFocusInputClass(theme), rightPadClass, inputClassName)}
      rightContentClassName={cn(STATION_SCAN_BAR_RIGHT_CONTENT_CLASS, rightContentClassName)}
      rightContent={resolvedRight}
      hasRightContent={props.hasRightContent ?? Boolean(resolvedRight)}
    />
  );
}
