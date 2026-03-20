'use client';

import React, { MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, MapPin, Barcode, Settings, Package } from '../Icons';

// --- Helpers ---

function normalizeCopyText(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(not specified|n\/a|null|undefined|none)$/i.test(raw)) return '';
  return raw;
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
    className="w-4 h-4 shrink-0"
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
  width: string;
  disableCopy?: boolean;
}

export function CopyChip({ value, display, icon, underlineClass, iconClass, width, disableCopy = false }: CopyChipProps) {
  const [copied, setCopied] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const chipRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const normalizedValue = normalizeCopyText(value);
  const normalizedDisplay = normalizeCopyText(display);
  const canCopy = !disableCopy && !!normalizedValue && normalizedValue !== '---';
  const isDisabled = !canCopy && !disableCopy;

  const updateTooltipPosition = useCallback(() => {
    if (!chipRef.current || !tooltipRef.current) return;

    const chipRect = chipRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const margin = 8;

    const centeredLeft = chipRect.left + chipRect.width / 2 - tooltipRect.width / 2;
    const minLeft = margin;
    const maxLeft = Math.max(minLeft, window.innerWidth - tooltipRect.width - margin);
    const left = Math.min(Math.max(centeredLeft, minLeft), maxLeft);

    const spaceAbove = chipRect.top - margin;
    const spaceBelow = window.innerHeight - chipRect.bottom - margin;
    const preferAbove = spaceAbove >= tooltipRect.height || spaceAbove > spaceBelow;
    const rawTop = preferAbove ? chipRect.top - tooltipRect.height - margin : chipRect.bottom + margin;
    const minTop = margin;
    const maxTop = Math.max(minTop, window.innerHeight - tooltipRect.height - margin);
    const top = Math.min(Math.max(rawTop, minTop), maxTop);

    setTooltipPosition({ top, left });
  }, []);

  useEffect(() => {
    if (!tooltipOpen) return;
    const rafId = window.requestAnimationFrame(updateTooltipPosition);
    const handleReposition = () => updateTooltipPosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [tooltipOpen, updateTooltipPosition]);

  useEffect(() => {
    if (!canCopy) setTooltipOpen(false);
  }, [canCopy]);

  const openTooltip = () => {
    if (!canCopy) return;
    setTooltipOpen(true);
  };

  const closeTooltip = () => {
    setTooltipOpen(false);
  };

  const handleCopy = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!canCopy) return;
    navigator.clipboard.writeText(normalizedValue);
    setTooltipOpen(true);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div ref={chipRef} className={`relative ${width}`}>
      <button
        type="button"
        onClick={handleCopy}
        onMouseEnter={openTooltip}
        onMouseLeave={closeTooltip}
        onFocus={openTooltip}
        onBlur={closeTooltip}
        disabled={isDisabled}
        className="w-full flex items-center justify-start gap-0.5 py-0 bg-white text-black text-left transition-all active:scale-95 disabled:opacity-30"
      >
        <span className={`shrink-0 ${iconClass}`}>{icon}</span>
        <span className={`font-mono text-[13px] font-bold tracking-tight leading-none border-b-2 pb-0.5 flex-1 text-left ${underlineClass}`}>
          {normalizedDisplay || '---'}
        </span>
      </button>
      {canCopy && tooltipOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={tooltipRef}
              style={{ top: tooltipPosition.top, left: tooltipPosition.left }}
              className="pointer-events-none fixed z-[2147483647]"
            >
              <div className="flex max-w-[min(90vw,24rem)] items-start gap-2 rounded border border-gray-300 bg-gray-100 px-2 py-1 text-[10px] font-bold text-black shadow-sm">
                <span className="font-mono break-all leading-tight">{normalizedValue}</span>
                {copied ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

// --- Pre-configured chips ---

export const OrderIdChip = ({ value, display }: { value: string; display: string }) => (
  <CopyChip
    value={value}
    display={display}
    icon={<HashIcon />}
    underlineClass="border-gray-400"
    iconClass="text-gray-400"
    width="w-[50px]"
  />
);

export const TrackingChip = ({ value, display }: { value: string; display: string }) => (
  <CopyChip
    value={value}
    display={display}
    icon={<MapPin className="w-4 h-4 shrink-0" />}
    underlineClass="border-blue-500"
    iconClass="text-blue-500"
    width="w-[50px]"
  />
);

export const SerialChip = ({ value, display }: { value: string; display: string }) => (
  <CopyChip
    value={value}
    display={display}
    icon={<Barcode className="w-4 h-4 shrink-0" />}
    underlineClass="border-emerald-500"
    iconClass="text-emerald-500"
    width="w-[64px]"
  />
);

export const TicketChip = ({ value, display }: { value: string; display: string }) => (
  <CopyChip
    value={value}
    display={display}
    icon={<Settings className="w-4 h-4 shrink-0" />}
    underlineClass="border-orange-500"
    iconClass="text-orange-500"
    width="w-[52px]"
  />
);

export const FnskuChip = ({ value, width = 'w-[50px]' }: { value: string; width?: string }) => (
  <CopyChip
    value={value}
    display={getLast4(value)}
    icon={<Package className="w-4 h-4 shrink-0" />}
    underlineClass="border-purple-500"
    iconClass="text-purple-500"
    width={width}
  />
);

export const SourceOrderChip = ({
  value,
  display,
  width = 'w-[92px]',
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
    underlineClass="border-gray-400"
    iconClass="text-gray-400"
    width={width}
    disableCopy={disableCopy}
  />
);
