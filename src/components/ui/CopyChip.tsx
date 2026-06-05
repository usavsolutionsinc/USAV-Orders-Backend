'use client';

/**
 * Hover preview uses the site-wide tooltip from `SiteTooltipProvider`.
 * The app wires that in via `src/components/Providers.tsx` (root `layout.tsx`).
 * If the hook returns null (no provider), copy still works; there is no hover bubble.
 */
import React, { MouseEvent, useCallback, useEffect, useId, useRef } from 'react';
import { isEmptyDisplayValue } from '@/utils/empty-display-value';
import { Check, Copy, MapPin, Barcode, Settings, Package, ExternalLink, Pencil } from '../Icons';
import { monoValue } from '@/design-system/tokens/typography/presets';
import { useSiteTooltipOptional, type SiteTooltipContextValue } from '@/components/providers/SiteTooltipProvider';
import { skuScanPrefixBeforeColon, getExternalUrlByItemNumber } from '@/hooks/useExternalItemUrl';

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
 * Parses it, takes the last individual serial, then returns its last 4 chars.
 */
export function getLast4Serial(value: string | null | undefined): string {
  const raw = normalizeCopyText(value);
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const last = parts.length > 0 ? parts[parts.length - 1] : '';
  return last.length > 4 ? last.slice(-4) : last || '---';
}

/**
 * Pack/tech "tracking" fields sometimes hold a static SKU code (`PROD:qty`, `:tag`) rather than a carrier number.
 * Those must use the SKU chip, not {@link TrackingChip}.
 */
export function isSkuFormattedScanRef(value: string | null | undefined): boolean {
  const raw = normalizeCopyText(value);
  return raw.includes(':');
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
  /**
   * When true, the label sizes to its text (underline matches full string) and the button is `w-auto`.
   * Use for chips like serial numbers that must grow past a min width without shrinking the glyphs.
   */
  fitDisplayWidth?: boolean;
  /** Called after a successful clipboard write. Use for side-effects (e.g. dispatch a custom event). */
  onCopy?: (value: string) => void;
  /**
   * Outer wrapper horizontal padding — `flush` aligns with sidebar grids where the chip icon lives in another column.
   */
  outerPad?: 'chip' | 'flush';
  /** When true, skip the global hover copy tooltip (e.g. chip has its own action menu). */
  disableTooltip?: boolean;
  /** Smaller label + icons (mobile rows that must keep all chips on one line). */
  dense?: boolean;
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
  fitDisplayWidth = false,
  onCopy,
  outerPad = 'chip',
  disableTooltip = false,
  dense = false,
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
    if (disableTooltip || !tooltipCtx || !canCopy) return;
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
    onCopy?.(normalizedValue);
    if (tooltipCtxRef.current?.isActiveAnchor(anchorId)) {
      tooltipCtxRef.current.notifyCopied(anchorId);
    }
  };

  const outerPx = outerPad === 'flush' ? 'px-0' : 'px-1.5';

  return (
    <div
      ref={chipRef}
      className={`relative flex items-center justify-start ${outerPx} ${width}`}
      onMouseEnter={openTooltip}
      onMouseLeave={closeTooltip}
    >
      <button
        type="button"
        onClick={handleCopy}
        onFocus={() => {
          if (!disableTooltip) openTooltip();
        }}
        onBlur={closeTooltipImmediate}
        disabled={isDisabled}
        title={!disableTooltip && !tooltipCtx && canCopy ? normalizedValue : undefined}
        className={
          fitDisplayWidth
            ? 'inline-flex w-auto max-w-full items-center justify-start gap-0.5 py-0 bg-transparent text-left text-black transition-all active:scale-95 disabled:opacity-30'
            : 'inline-flex w-full max-w-full items-center justify-start gap-0.5 py-0 bg-transparent text-left text-black transition-all active:scale-95 disabled:opacity-30'
        }
      >
        {icon ? <span className={`shrink-0 ${dense ? '[&_svg]:h-3 [&_svg]:w-3' : ''} ${iconClass ?? ''}`}>{icon}</span> : null}
        <span
          className={`${dense ? 'text-[11px] font-bold font-mono text-gray-900' : monoValue} tracking-tight leading-none border-b-2 pb-0.5 text-left ${displayOverflowClass} ${underlineClass} ${
            fitDisplayWidth ? 'min-w-0 shrink-0' : 'min-w-0 flex-1'
          }`}
        >
          {normalizedDisplay || '---'}
        </span>
      </button>
    </div>
  );
}

// --- Pre-configured chips ---

/** Internal order ID. Gray / Hash icon. Do NOT use for tracking numbers or FNSKUs. */
export const OrderIdChip = ({ value, display, dense }: { value: string; display: string; dense?: boolean }) => (
  <CopyChip
    value={value}
    display={isEmptyDisplayValue(display) || String(display || '').trim() === '---' ? '----' : display}
    icon={<HashIcon />}
    underlineClass="border-gray-500"
    iconClass="text-gray-500"
    dense={dense}
  />
);

/**
 * Reserves the same width as {@link OrderIdChip} when the real chip is omitted (e.g. SKU rows).
 * Keeps platform / tracking columns aligned with order-id rows.
 */
export function OrderIdChipPlaceholder() {
  return (
    <span className="pointer-events-none inline-flex shrink-0 select-none invisible" aria-hidden>
      <OrderIdChip value="0000" display="0000" />
    </span>
  );
}

/**
 * Purchase order number (vendor PO# / extracted from emails). Gray / Hash icon.
 *
 * Visually matches {@link OrderIdChip} (also gray + hash) — both represent
 * "an identifier this row is keyed by" and live in the left/primary
 * position of their respective row layouts. {@link TrackingChip} stays
 * blue for carrier tracking, which is a different concept (a physical
 * package, not an identifier).
 */
export const PoChip = ({
  value,
  display,
  disableCopy,
  width = 'w-fit max-w-full',
}: {
  value: string;
  display?: string;
  disableCopy?: boolean;
  width?: string;
}) => (
  <CopyChip
    value={value}
    display={
      isEmptyDisplayValue(display ?? value) ||
      String(display ?? value).trim() === '---'
        ? '----'
        : (display ?? value)
    }
    icon={<HashIcon />}
    underlineClass="border-gray-500"
    iconClass="text-gray-500"
    width={width}
    disableCopy={disableCopy}
  />
);

/**
 * Carrier shipping tracking number. Blue / MapPin icon.
 * DESIGN SYSTEM RULE: Use ONLY for outbound carrier tracking numbers (UPS, FedEx, USPS…).
 * Do NOT use FNSKU codes — use FnskuChip (purple/Package) for those.
 */
export const TrackingChip = ({
  value,
  display,
  disableCopy,
  width = 'w-fit max-w-full',
  /** When false, renders copy label only — use with a separate leading icon column so rows align across the FBA sidebar. */
  showIcon = true,
  /**
   * Default true — underline hugs the mono label (last-4 preview). Prevents full-width underline when the wrapper
   * sits in a wide grid/flex slot (e.g. FBA tracking bundle header beside “N SKUs · M units”).
   */
  fitDisplayWidth = true,
  dense,
}: {
  value: string;
  display: string;
  disableCopy?: boolean;
  /** Tailwind width utilities on the wrapper (sidebar grids need `min-w-0 flex-1`). */
  width?: string;
  showIcon?: boolean;
  fitDisplayWidth?: boolean;
  dense?: boolean;
}) => (
  <CopyChip
    value={value}
    display={isEmptyDisplayValue(display) || String(display || '').trim() === '---' ? '----' : display}
    icon={
      showIcon ? <MapPin className="h-4 w-4 shrink-0" /> : undefined
    }
    underlineClass="border-blue-500"
    iconClass="inline-flex items-center justify-center text-blue-500"
    width={width}
    disableCopy={disableCopy}
    outerPad={showIcon ? 'chip' : 'flush'}
    fitDisplayWidth={fitDisplayWidth}
    dense={dense}
  />
);

/**
 * Marketplace listing URL: open link (left) + copy full URL (truncated preview label).
 * Caller supplies {@link previewDisplay} (e.g. host + clipped path).
 */
export function ListingUrlChip({
  rawUrl,
  openHref,
  previewDisplay,
}: {
  rawUrl: string;
  openHref: string | null;
  previewDisplay: string;
}) {
  const trimmed = normalizeCopyText(rawUrl);
  const preview = normalizeCopyText(previewDisplay);
  const chipDisplay = trimmed ? preview || '—' : '—';

  return (
    <div className="flex min-w-0 flex-1 basis-0 items-center gap-0.5">
      <button
        type="button"
        disabled={openHref == null}
        onClick={(e) => {
          e.stopPropagation();
          if (openHref) window.open(openHref, '_blank', 'noopener,noreferrer');
        }}
        aria-label="Open listing URL in new tab"
        title={openHref ? 'Open link' : 'No valid URL'}
        className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
      </button>
      <CopyChip
        value={trimmed}
        display={chipDisplay}
        underlineClass="border-indigo-500"
        width="min-w-0 flex-1 max-w-full"
        disableCopy={!trimmed}
      />
    </div>
  );
}

/**
 * Static SKU code shown where a tracking column is reused (e.g. `SKU:qty`). Yellow / pencil — not carrier tracking.
 */
export const SkuScanRefChip = ({
  value,
  display,
  onCopy,
  dense,
}: {
  value: string;
  display: string;
  onCopy?: (value: string) => void;
  dense?: boolean;
}) => (
  <CopyChip
    value={value}
    display={isEmptyDisplayValue(display) || String(display || '').trim() === '---' ? '----' : display}
    icon={<Pencil className="h-4 w-4 shrink-0" />}
    underlineClass="border-yellow-500"
    iconClass="inline-flex items-center justify-center text-yellow-600"
    onCopy={onCopy}
    dense={dense}
  />
);

/**
 * Picks blue carrier {@link TrackingChip} vs yellow {@link SkuScanRefChip} when the value contains `:`.
 * For SKU-formatted scans (`SKU:ID`), also renders an Ecwid {@link PlatformChip} that opens the
 * product search page using the base SKU (segment before `:`).
 * Label is always last 4 characters of the raw value (same for carrier and SKU scans).
 */
export function TrackingOrSkuScanChip({ value }: { value: string }) {
  const raw = normalizeCopyText(value);
  const display = getLast4(raw);
  if (isSkuFormattedScanRef(raw)) {
    const sku = skuScanPrefixBeforeColon(raw);
    const productUrl = getExternalUrlByItemNumber(sku);
    return (
      <>
        <PlatformChip
          label="ecwid"
          underlineClass="border-blue-600"
          iconClass="text-blue-600"
          onClick={() => {
            if (productUrl) window.open(productUrl, '_blank', 'noopener,noreferrer');
          }}
        />
        <SourceOrderChip value={sku} display={getLast4(sku)} />
        <SkuScanRefChip value={raw} display={display} />
      </>
    );
  }
  return <TrackingChip value={raw} display={display} />;
}

/**
 * The single source of truth for a serial chip's label. Derives the last-4
 * preview from the raw serial (or CSV of serials), and collapses every "no
 * serial" spelling callers used to pass — `''`/`null`, the literal sentinel
 * `'SERIAL'`, or `'---'` — to one `'----'` placeholder that matches the empty
 * state of the other id chips (OrderIdChip/TrackingChip), so an empty serial
 * column reads like a 4-char value and lines up with filled rows instead of
 * showing the wider `SERIAL` word. (Blindly running {@link getLast4Serial} on
 * the `'SERIAL'` sentinel used to yield `'RIAL'`, which is why every table
 * previously hand-rolled its own variant.)
 */
export function resolveSerialDisplay(value: string | null | undefined): string {
  const raw = (value || '').trim();
  if (isEmptyDisplayValue(raw) || raw === '---' || raw.toUpperCase() === 'SERIAL') {
    return '----';
  }
  return getLast4Serial(raw);
}

/**
 * Device / unit serial number. Emerald / Barcode icon.
 *
 * The label is derived internally from `value` via {@link resolveSerialDisplay},
 * so callers pass only the serial (or a comma-joined CSV) — no `getLast4Serial`
 * / empty-state handling at the call site. `display` is an optional override and
 * should almost never be needed.
 */
export const SerialChip = ({
  value,
  display,
  width = 'w-[84px] shrink-0',
  disableTooltip = false,
  dense,
}: {
  value: string;
  /** Optional label override; normally derived from `value`. */
  display?: string;
  /** Tailwind width utilities on the wrapper; default is a fixed width sized
   *  for the Barcode icon + 4-char mono value. Table rows pass a content-fit
   *  width so the serial column hugs its value like the other id chips. */
  width?: string;
  disableTooltip?: boolean;
  dense?: boolean;
}) => (
  <CopyChip
    value={value}
    display={resolveSerialDisplay(display ?? value)}
    icon={<Barcode className="h-4 w-4 shrink-0" />}
    underlineClass="border-emerald-500"
    iconClass="inline-flex items-center justify-center text-emerald-500"
    width={width}
    truncateDisplay={false}
    fitDisplayWidth
    disableTooltip={disableTooltip}
    dense={dense}
  />
);

/**
 * Serial sourced from the `sku` table (pack SKU rows or tech SKU_PULL). Yellow / pencil icon.
 * DESIGN SYSTEM RULE: Use only when the row is SKU-driven — not for carrier or FNSKU serials.
 */
export const SkuSerialChip = ({
  value,
  display,
  width = 'w-[84px] shrink-0',
}: {
  value: string;
  display: string;
  width?: string;
}) => (
  <CopyChip
    value={value}
    display={isEmptyDisplayValue(display) ? 'SKU' : getLast4Serial(display)}
    icon={<Pencil className="h-4 w-4 shrink-0" />}
    underlineClass="border-yellow-500"
    iconClass="inline-flex items-center justify-center text-yellow-600"
    width={width}
    truncateDisplay={false}
    fitDisplayWidth
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
      className="relative flex w-fit max-w-full items-center justify-start px-1.5"
      onMouseEnter={openTooltip}
      onMouseLeave={() => tooltipCtx?.scheduleClose(anchorId)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick(e);
        }}
        className="inline-flex w-fit max-w-full items-center justify-start gap-0.5 py-0 bg-transparent text-left text-black transition-all active:scale-95"
      >
        <span className={`inline-flex shrink-0 items-center ${iconClass}`}>
          <ExternalLink className="h-4 w-4 shrink-0" />
        </span>
        <span
          className={`min-w-[60px] whitespace-nowrap border-b-2 pb-0.5 text-center font-dm-sans text-sm font-bold lowercase leading-none tracking-tight text-black ${underlineClass}`}
        >
          {label}
        </span>
      </button>
    </div>
  );
};
