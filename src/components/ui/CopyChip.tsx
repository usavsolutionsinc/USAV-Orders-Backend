'use client';

import React, { MouseEvent, useState } from 'react';
import { Check, Copy, MapPin, Barcode } from '../Icons';

// --- Helpers ---

export function getLast4(value: string | null | undefined): string {
  const raw = String(value || '');
  return raw.length > 4 ? raw.slice(-4) : raw || '---';
}

/**
 * serial_number may be a CSV string aggregated via STRING_AGG (e.g. "SN1, SN2").
 * Parses it, takes the last individual serial, then returns its last 6 chars.
 */
export function getLast6Serial(value: string | null | undefined): string {
  const raw = String(value || '').trim();
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
}

export function CopyChip({ value, display, icon, underlineClass, iconClass, width }: CopyChipProps) {
  const [copied, setCopied] = useState(false);
  const isEmpty = !value || value === '---';

  const handleCopy = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (isEmpty) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`relative group ${width}`}>
      <button
        type="button"
        onClick={handleCopy}
        disabled={isEmpty}
        className="w-full flex items-center gap-0.5 py-0 bg-white text-black transition-all active:scale-95 disabled:opacity-30"
      >
        <span className={`shrink-0 ${iconClass}`}>{icon}</span>
        <span className={`font-mono text-[13px] font-bold tracking-tight leading-none border-b-2 pb-0.5 flex-1 ${underlineClass}`}>
          {isEmpty ? '---' : display}
        </span>
      </button>
      {!isEmpty && (
        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-150">
          <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 border border-gray-300 rounded text-[10px] font-bold text-black whitespace-nowrap shadow-sm">
            {copied ? 'Copied!' : 'Copy'}
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </div>
        </div>
      )}
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
