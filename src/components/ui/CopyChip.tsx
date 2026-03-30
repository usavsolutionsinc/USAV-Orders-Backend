'use client';

/**
 * Hover preview uses the site-wide tooltip from `SiteTooltipProvider`.
 * The app wires that in via `src/components/Providers.tsx` (root `layout.tsx`).
 * If the hook returns null (no provider), copy still works; there is no hover bubble.
 */
import React, { MouseEvent, useCallback, useEffect, useId, useRef } from 'react';
import { isEmptyDisplayValue } from '@/utils/empty-display-value';
import { Check, Copy, MapPin, Barcode, Settings, Package, ExternalLink } from '../Icons';
import { monoValue } from '@/design-system/tokens/typography/presets';
import { useSiteTooltipOptional, type SiteTooltipContextValue } from '@/components/providers/SiteTooltipProvider';

// --- Helpers ---

function normalizeCopyText(value: string | null | undefined): string {
  if (isEmptyDisplayValue(value)) return '';
  return String(value || '').trim();
}

export function getLast4(value: string | null | undefined): string {
  const raw = normalizeCopyText(value);
  return raw.length > 4 ? raw.slice(-4) : raw || '---';
}

/**
 * serial_number may be a CSV string aggregated via STRING_AGG (e.g. "SN1, SN2").
 * Parses it, takes the last individual serial, then returns its last 6 chars.
 */
export function getLast6Serial(value: string | null | undefined): string {
  const raw = normalizeCopyText(value);
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const last = parts.length > 0 ? parts[parts.length - 1] : '';
  return last.length > 6 ? last.slice(-6) : last || '---';
}

// --- Icons ---

export const HashIcon = () => (
  <svg
    className="h-4 w-4 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="4" y1="15" x2="20" y2="15" />
    <line x1="10" y1="3" x2="8" y2="21" />
    <line x1="16" y1="3" x2="14" y2="21" />
  </svg>
);

// --- Base CopyChip ---

export interface CopyChipProps {
  value: string;
  display: string;
  icon?: React.ReactNode;
  underlineClass: string;
  iconClass?: string;
  /** Width utility on the wrapper; default sizes to content (still respects `max-w-full` in tight layouts). */
  width?: string;
  disableCopy?: boolean;
  truncateDisplay?: boolean;
}

export function CopyChip({
  value,
  display,
  icon,
  underlineClass,
  iconClass,
  width = 'w-fit max-w-full',
  disableCopy = false,
  truncateDisplay = true,
}: CopyChipProps) {
  const anchorId = useId();
  const chipRef = useRef<HTMLDivElement | null>(null);
  const tooltipCtx = useSiteTooltipOptional();
  const tooltipCtxRef = useRef(tooltipCtx);
  tooltipCtxRef.current = tooltipCtx;

  const getRect = useCallback(() => chipRef.current?.getBoundingClientRect() ?? null, []);

  const normalizedValue = normalizeCopyText(value);
  const normalizedDisplay = normalizeCopyText(display);
  const displayOverflowClass = truncateDisplay ? 'truncate' : 'whitespace-nowrap';
  const canCopy = !disableCopy && !!normalizedValue && normalizedValue !== '---';
  const isDisabled = !canCopy && !disableCopy;

  useEffect(() => {
    tooltipCtxRef.current?.syncValueIfActive(anchorId, normalizedValue);
  }, [canCopy, anchorId, normalizedValue]);

  useEffect(() => {
    if (!canCopy) {
      tooltipCtxRef.current?.closeNow(anchorId);
    }
  }, [canCopy, anchorId]);

  useEffect(() => {
    return () => {
      tooltipCtxRef.current?.closeNow(anchorId);
    };
  }, [anchorId]);

  const openTooltip = () => {
    if (!tooltipCtx || !canCopy) return;
    tooltipCtx.activate({ anchorId, value: normalizedValue, getRect });
  };

  const closeTooltip = () => {
    tooltipCtx?.scheduleClose(anchorId);
  };

  const closeTooltipImmediate = () => {
    tooltipCtx?.closeNow(anchorId);
  };

  const handleCopy = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!canCopy) return;
    navigator.clipboard.writeText(normalizedValue);
    if (tooltipCtxRef.current?.isActiveAnchor(anchorId)) {
      tooltipCtxRef.current.notifyCopied(anchorId);
    }
  };

  return (
    <div
      ref={chipRef}
      className={`relative px-1.5 ${width}`}
      onMouseEnter={openTooltip}
      onMouseLeave={closeTooltip}
    >
      <button
        type="button"
        onClick={handleCopy}
        onFocus={() => openTooltip()}
        onBlur={closeTooltipImmediate}
        disabled={isDisabled}
        title={!tooltipCtx && canCopy ? normalizedValue : undefined}
        className="inline-flex w-fit max-w-full items-center justify-start gap-0.5 py-0 bg-white text-black text-left transition-all active:scale-95 disabled:opacity-30"
      >
        {icon ? <span className={`shrink-0 ${iconClass ?? ''}`}>{icon}</span> : null}
        <span className={`${monoValue} tracking-tight leading-none border-b-2 pb-0.5 min-w-0 text-left ${displayOverflowClass} ${underlineClass}`}>
          {normalizedDisplay || '---'}
        </span>
      </button>
    </div>
  );
}

// --- Pre-configured chips ---

/** Internal order ID. Gray / Hash icon. Do NOT use for tracking numbers or FNSKUs. */
export const OrderIdChip = ({ value, display }: { value: string; display: string }) => (
  <CopyChip
    value={value}
    display={isEmptyDisplayValue(display) || String(display || '').trim() === '---' ? '----' : display}
    icon={<HashIcon />}
    underlineClass="border-gray-500"
    iconClass="text-gray-500"
  />
);

/**
 * Carrier shipping tracking number. Blue / MapPin icon.
 * DESIGN SYSTEM RULE: Use ONLY for outbound carrier tracking numbers (UPS, FedEx, USPS…).
 * Do NOT use FNSKU codes — use FnskuChip (purple/Package) for those.
 */
export const TrackingChip = ({ value, display }: { value: string; display: string }) => (
  <CopyChip
    value={value}
    display={isEmptyDisplayValue(display) || String(display || '').trim() === '---' ? '----' : display}
    icon={<MapPin className="h-4 w-4 shrink-0" />}
    underlineClass="border-blue-500"
    iconClass="text-blue-500"
  />
);

/** Device / unit serial number. Emerald / Barcode icon. */
export const SerialChip = ({ value, display }: { value: string; display: string }) => (
  <CopyChip
    value={value}
    display={isEmptyDisplayValue(display) ? 'SERIAL' : display}
    icon={<Barcode className="h-4 w-4 shrink-0" />}
    underlineClass="border-emerald-500"
    iconClass="text-emerald-500"
  />
);

export const TicketChip = ({ value, display }: { value: string; display: string }) => (
  <CopyChip
    value={value}
    display={display}
    icon={<Settings className="h-4 w-4 shrink-0" />}
    underlineClass="border-orange-500"
    iconClass="text-orange-500"
  />
);

/**
 * Amazon FNSKU identifier (e.g. X001ABC123). Purple / Package icon.
 * DESIGN SYSTEM RULE: Use ONLY for FNSKU values scanned at FBA intake.
 * Do NOT use for carrier tracking numbers — use TrackingChip (blue/MapPin) for those.
 */
export const FnskuChip = ({ value, width }: { value: string; width?: string }) => (
  <CopyChip
    value={value}
    display={getLast4(value)}
    icon={<Package className="h-4 w-4 shrink-0" />}
    underlineClass="border-purple-500"
    iconClass="text-purple-500"
    width={width}
  />
);

export const SourceOrderChip = ({
  value,
  display,
  width,
  disableCopy = false,
}: {
  value: string;
  display: string;
  width?: string;
  disableCopy?: boolean;
}) => (
  <CopyChip
    value={value}
    display={display}
    icon={<HashIcon />}
    underlineClass="border-gray-500"
    iconClass="text-gray-500"
    width={width}
    disableCopy={disableCopy}
  />
);

/** Platform chip — opens product page via item number on click, does NOT copy. */
export const PlatformChip = ({
  label,
  underlineClass,
  iconClass,
  onClick,
}: {
  label: string;
  underlineClass: string;
  iconClass: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) => {
  const anchorId = useId();
  const chipRef = useRef<HTMLDivElement | null>(null);
  const tooltipCtx = useSiteTooltipOptional();
  const tooltipCtxRef = useRef(tooltipCtx);
  tooltipCtxRef.current = tooltipCtx;

  const getRect = useCallback(() => chipRef.current?.getBoundingClientRect() ?? null, []);

  const openTooltip = () => {
    if (!tooltipCtx) return;
    tooltipCtx.activate({ anchorId, value: 'product page', getRect });
  };

  useEffect(() => {
    return () => {
      tooltipCtxRef.current?.closeNow(anchorId);
    };
  }, [anchorId]);

  return (
    <div
      ref={chipRef}
      className="relative px-1.5 w-fit max-w-full"
      onMouseEnter={openTooltip}
      onMouseLeave={() => tooltipCtx?.scheduleClose(anchorId)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick(e);
        }}
        className="inline-flex w-fit max-w-full items-center justify-start gap-0.5 py-0 bg-white text-black text-left transition-all active:scale-95"
      >
        <span className={`shrink-0 ${iconClass}`}>
          <ExternalLink className="h-4 w-4 shrink-0" />
        </span>
        <span
          className={`font-dm-sans text-[13px] font-bold tracking-tight leading-none border-b-2 pb-0.5 min-w-[60px] text-center whitespace-nowrap lowercase text-black ${underlineClass}`}
        >
          {label}
        </span>
      </button>
    </div>
  );
};
