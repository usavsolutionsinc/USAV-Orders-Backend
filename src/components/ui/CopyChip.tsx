'use client';

/**
 * The id-chip family. Three layers:
 *   - pure label helpers live in `@/lib/copy-chip-format` (re-exported below
 *     for existing importers);
 *   - copy/tooltip behavior lives in `useCopyChip` / `useChipTooltip`
 *     (`@/hooks`) — hover preview uses the site-wide tooltip from
 *     `SiteTooltipProvider`, wired via `src/components/Providers.tsx`; if the
 *     provider is absent, copy still works and there is no hover bubble;
 *   - this file owns the markup, the {@link CHIP_TONES} registry, and the
 *     named variants that carry the design-system rules.
 */
import React, { MouseEvent } from 'react';
import { isEmptyDisplayValue } from '@/utils/empty-display-value';
import { Barcode, ExternalLink, MapPin, Package, Pencil } from '../Icons';
import { monoValue } from '@/design-system/tokens/typography/presets';
import { useChipTooltip, useCopyChip } from '@/hooks';
import { skuScanPrefixBeforeColon, getExternalUrlByItemNumber } from '@/hooks/useExternalItemUrl';
import {
  getLast4,
  getLast4Serial,
  isEmptyChipDisplay,
  isSkuFormattedScanRef,
  normalizeCopyText,
  resolveChipDisplay,
  resolveSerialDisplay,
} from '@/lib/copy-chip-format';

export {
  getLast4,
  getLast4Serial,
  isEmptyChipDisplay,
  isSkuFormattedScanRef,
  resolveChipDisplay,
  resolveSerialDisplay,
} from '@/lib/copy-chip-format';

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

// --- Tone registry ---

/**
 * The single source of truth for what each chip color MEANS. One entry per
 * identifier concept — change a color here and every chip (including the ×N
 * group-count variants) follows.
 *
 *   id        gray / hash       internal order ids, PO#s, source order #s
 *   tracking  blue / map-pin    outbound carrier tracking numbers ONLY
 *   serial    emerald / barcode device/unit serial numbers
 *   sku       yellow / pencil   SKU-driven values (static scan refs, sku-table serials)
 *   fnsku     purple / package  Amazon FNSKUs scanned at FBA intake ONLY
 *   ticket    orange / hash     support ticket ids
 */
export const CHIP_TONES = {
  id: {
    icon: <HashIcon />,
    underline: 'border-gray-500',
    iconClass: 'text-gray-500',
  },
  tracking: {
    icon: <MapPin className="h-4 w-4 shrink-0" />,
    underline: 'border-blue-500',
    iconClass: 'inline-flex items-center justify-center text-blue-500',
  },
  serial: {
    icon: <Barcode className="h-4 w-4 shrink-0" />,
    underline: 'border-emerald-500',
    iconClass: 'inline-flex items-center justify-center text-emerald-500',
  },
  sku: {
    icon: <Pencil className="h-4 w-4 shrink-0" />,
    underline: 'border-yellow-500',
    iconClass: 'inline-flex items-center justify-center text-yellow-600',
  },
  fnsku: {
    icon: <Package className="h-4 w-4 shrink-0" />,
    underline: 'border-purple-500',
    iconClass: 'text-purple-500',
  },
  ticket: {
    icon: <HashIcon />,
    underline: 'border-orange-500',
    iconClass: 'text-orange-500',
  },
} as const;

export type ChipTone = keyof typeof CHIP_TONES;

// --- Base CopyChip ---

export interface CopyChipProps {
  value: string;
  display: string;
  /** Pulls icon/underline/icon color from {@link CHIP_TONES}; individual props below override. */
  tone?: ChipTone;
  /** `undefined` falls back to the tone's icon; pass `null` for no icon (e.g. icon lives in another column). */
  icon?: React.ReactNode;
  underlineClass?: string;
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
  tone,
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
  const {
    chipRef,
    hasTooltipProvider,
    openTooltip,
    closeTooltip,
    closeTooltipImmediate,
    normalizedValue,
    canCopy,
    isDisabled,
    handleCopy,
  } = useCopyChip({
    value,
    disableCopy,
    disableTooltip,
    onCopy,
    historyKind: tone,
    historyDisplay: display,
  });

  const toneDef = tone ? CHIP_TONES[tone] : undefined;
  const resolvedIcon = icon === undefined ? toneDef?.icon : icon;
  const resolvedUnderline = underlineClass ?? toneDef?.underline ?? 'border-gray-500';
  const resolvedIconClass = iconClass ?? toneDef?.iconClass;

  const normalizedDisplay = normalizeCopyText(display);
  const displayOverflowClass = truncateDisplay ? 'truncate' : 'whitespace-nowrap';
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
        onFocus={openTooltip}
        onBlur={closeTooltipImmediate}
        disabled={isDisabled}
        title={!disableTooltip && !hasTooltipProvider && canCopy ? normalizedValue : undefined}
        className={
          fitDisplayWidth
            ? 'inline-flex w-auto max-w-full items-center justify-start gap-0.5 py-0 bg-transparent text-left text-black transition-all active:scale-95 disabled:opacity-30'
            : 'inline-flex w-full max-w-full items-center justify-start gap-0.5 py-0 bg-transparent text-left text-black transition-all active:scale-95 disabled:opacity-30'
        }
      >
        {resolvedIcon ? <span className={`shrink-0 ${dense ? '[&_svg]:h-3 [&_svg]:w-3' : ''} ${resolvedIconClass ?? ''}`}>{resolvedIcon}</span> : null}
        <span
          className={`${dense ? 'text-[11px] font-bold font-mono text-gray-900' : monoValue} tracking-tight leading-none border-b-2 pb-0.5 text-left ${displayOverflowClass} ${resolvedUnderline} ${
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
  <CopyChip value={value} display={resolveChipDisplay(display)} tone="id" dense={dense} />
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
    display={resolveChipDisplay(display ?? value)}
    tone="id"
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
    display={resolveChipDisplay(display)}
    tone="tracking"
    icon={showIcon ? undefined : null}
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
    display={resolveChipDisplay(display)}
    tone="sku"
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
    tone="serial"
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
    tone="sku"
    width={width}
    truncateDisplay={false}
    fitDisplayWidth
  />
);

/**
 * Non-interactive "count" variant of an id chip — for grouped/collapsed summary
 * rows where a column holds N differing values (a PO group spanning several
 * SKUs / serials). Keeps the column's own icon + the underlined-mono shape so it
 * lines up with the real chips beneath it, but shows "×N" in yellow so it reads
 * as a count, not a value. No copy/tooltip — there's no single value to copy.
 */
function GroupCountChip({ count, tone, dense }: { count: number; tone: ChipTone; dense?: boolean }) {
  const toneDef = CHIP_TONES[tone];
  return (
    <div className="relative flex w-fit max-w-full items-center justify-start px-1.5">
      <span className="inline-flex w-auto max-w-full items-center gap-0.5">
        <span className={`inline-flex shrink-0 items-center justify-center ${dense ? '[&_svg]:h-3 [&_svg]:w-3' : ''} ${toneDef.iconClass}`}>
          {toneDef.icon}
        </span>
        {/* Reserve the same 4-char footprint the last-4 id chips occupy so the
            icon lands at the same x and the underline matches the sibling chips'
            width. Value sits right within that footprint; underline color matches
            the column's real chip. */}
        <span className={`${dense ? 'text-[11px]' : 'text-sm'} w-[4ch] border-b-2 ${toneDef.underline} pb-0.5 text-right font-mono font-bold leading-none tracking-tight text-yellow-600`}>
          ×{count}
        </span>
      </span>
    </div>
  );
}

/** SKU column count for a collapsed group — yellow pencil + "×N", yellow underline. */
export const SkuCountChip = ({ count, dense }: { count: number; dense?: boolean }) => (
  <GroupCountChip count={count} tone="sku" dense={dense} />
);

/** Serial column count for a collapsed group — emerald barcode + "×N", emerald underline. */
export const SerialCountChip = ({ count, dense }: { count: number; dense?: boolean }) => (
  <GroupCountChip count={count} tone="serial" dense={dense} />
);

/** Tracking column count for a collapsed group — blue pin + "×N", blue underline.
 *  Used when a grouped order's lines carry several distinct tracking numbers. */
export const TrackingCountChip = ({ count, dense }: { count: number; dense?: boolean }) => (
  <GroupCountChip count={count} tone="tracking" dense={dense} />
);

export const TicketChip = ({ value, display }: { value: string; display: string }) => (
  <CopyChip value={value} display={display} tone="ticket" />
);

/**
 * Amazon FNSKU identifier (e.g. X001ABC123). Purple / Package icon.
 * DESIGN SYSTEM RULE: Use ONLY for FNSKU values scanned at FBA intake.
 * Do NOT use for carrier tracking numbers — use TrackingChip (blue/MapPin) for those.
 */
export const FnskuChip = ({ value, width }: { value: string; width?: string }) => (
  <CopyChip value={value} display={getLast4(value)} tone="fnsku" width={width} />
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
  <CopyChip value={value} display={display} tone="id" width={width} disableCopy={disableCopy} />
);

/**
 * The "empty slot, click to fill" affordance for an identity column — a colored
 * icon + a DASHED-underline label, vs the solid underline of a real
 * {@link CopyChip}. The dashed underline is the design-system signal for
 * "nothing here yet, click to add" (it must read differently from a chip that
 * carries a value). Shared by the Incoming "Add TRK#" popover trigger and the
 * dashboard paste-tracking button so the two surfaces can't drift.
 *
 * Presentational only — the caller owns the surrounding <button>/trigger and the
 * action (open a popover, paste from clipboard, …). Pass `colorClass` /
 * `underlineClass` to recolor for transient feedback (saving/success/error).
 */
export function AddValueChipFace({
  label,
  icon,
  colorClass = 'text-blue-600',
  underlineClass = 'border-blue-400',
  dense = false,
}: {
  label: string;
  icon: React.ReactNode;
  /** Icon + label text color. Override for status feedback (emerald/red). */
  colorClass?: string;
  /** Dashed underline border color. Override for status feedback. */
  underlineClass?: string;
  dense?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${colorClass}`}>
      <span className={`shrink-0 ${dense ? '[&_svg]:h-3 [&_svg]:w-3' : ''}`}>{icon}</span>
      <span
        className={`${dense ? 'text-[11px]' : 'text-mini'} whitespace-nowrap border-b-2 border-dashed pb-0.5 font-bold leading-none tracking-tight ${underlineClass}`}
      >
        {label}
      </span>
    </span>
  );
}

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
  const isEmpty = isEmptyChipDisplay(label);
  const { chipRef, openTooltip, closeTooltip } = useChipTooltip({
    enabled: !isEmpty,
    tooltipValue: 'product page',
  });

  const resolvedUnderline = isEmpty ? 'border-gray-500' : underlineClass;
  const resolvedIconClass = isEmpty ? 'text-gray-500' : iconClass;

  return (
    <div
      ref={chipRef}
      className="relative flex w-fit max-w-full items-center justify-start px-1.5"
      onMouseEnter={openTooltip}
      onMouseLeave={closeTooltip}
    >
      <button
        type="button"
        disabled={isEmpty}
        onClick={(e) => {
          e.stopPropagation();
          if (isEmpty) return;
          onClick(e);
        }}
        className="inline-flex w-fit max-w-full items-center justify-start gap-0.5 py-0 bg-transparent text-left text-black transition-all active:scale-95 disabled:opacity-30"
      >
        <span className={`inline-flex shrink-0 items-center ${resolvedIconClass}`}>
          <ExternalLink className="h-4 w-4 shrink-0" />
        </span>
        <span
          className={`min-w-[60px] whitespace-nowrap border-b-2 pb-0.5 text-center font-dm-sans text-sm font-bold leading-none tracking-tight ${resolvedUnderline} ${
            isEmpty ? 'text-transparent select-none' : 'lowercase text-black'
          }`}
          aria-hidden={isEmpty}
        >
          {isEmpty ? '\u00a0' : label}
        </span>
      </button>
    </div>
  );
};
