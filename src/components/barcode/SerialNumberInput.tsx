'use client';

import React, { useState, useRef, useEffect } from 'react';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { LocationSelector } from './LocationSelector';
import type { BarcodeDensity } from './BarcodePreview';

interface SerialNumberInputProps {
    sku: string;
    mode: 'print' | 'sn-to-sku' | 'reprint';
    title: string;
    stock: string;
    snInput: string;
    serialNumbers: string[];
    location: string;
    currentLocation?: string;
    snInputRef: React.RefObject<HTMLInputElement>;
    isLoadingTitle: boolean;
    isActive: boolean;
    showChangeSku: boolean;
    /** Visual density hint — accepted for parity with the horizontal layout. */
    density?: BarcodeDensity;
    /** Optional product thumbnail from `sku_catalog.image_url`. */
    imageUrl?: string;
    onSnInputChange: (value: string) => void;
    onSnAdd: (sn: string) => void;
    onLocationChange: (value: string) => void;
    onNext: (pendingSn?: string) => void;
    isPosting?: boolean;
    onChangeSku?: () => void;
}

export function SerialNumberInput({
    sku,
    mode,
    title,
    stock,
    snInput,
    serialNumbers,
    location,
    currentLocation,
    snInputRef,
    isLoadingTitle,
    isActive,
    showChangeSku,
    density = 'compact',
    imageUrl,
    onSnInputChange,
    onSnAdd,
    onLocationChange,
    onNext,
    isPosting,
    onChangeSku,
}: SerialNumberInputProps) {
    const comfy = density === 'comfortable';

    // Local state for the current scan field — cleared after each Enter scan
    const [scanValue, setScanValue] = useState('');

    // Reset scan field when sku changes (new item cycle)
    useEffect(() => { setScanValue(''); }, [sku]);

    const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const trimmed = scanValue.trim();
            if (!trimmed) return;
            setScanValue('');
            if (mode === 'print') {
                // In print mode: scan + Enter auto-proceeds to preview/print
                onNext(trimmed);
            } else {
                onSnAdd(trimmed);
            }
        }
    };

    const handleScanChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        // If user pastes a comma-separated list, add each one immediately
        if (val.includes(',')) {
            val.split(',').map(s => s.trim()).filter(Boolean).forEach(onSnAdd);
            setScanValue('');
        } else {
            setScanValue(val);
        }
    };

    return (
        <div className={`transition-opacity duration-200 ${!isActive ? 'opacity-15 pointer-events-none' : ''}`}>
            {/* Step label */}
            <div className={`flex items-center gap-3 ${comfy ? 'px-7 pt-7 pb-3' : 'px-5 pt-5 pb-3'}`}>
                <span className={`font-black tabular-nums text-gray-500 tracking-widest ${comfy ? 'text-[10px]' : 'text-[9px]'}`}>02</span>
                <span className={`font-black uppercase text-gray-600 ${comfy ? 'text-[11px] tracking-[0.16em]' : 'text-[9px] tracking-[0.18em]'}`}>
                    Details & Serial Numbers
                </span>
                {showChangeSku && onChangeSku && (
                    <button
                        onClick={onChangeSku}
                        className={`ml-auto font-black uppercase tracking-widest text-blue-600 hover:text-blue-800 transition-colors ${comfy ? 'text-[10px]' : 'text-[9px]'}`}
                    >
                        ← Change SKU
                    </button>
                )}
            </div>

            {/* Product info card */}
            <div className={`border-t border-gray-200 ${comfy ? 'px-7 py-5' : 'px-5 py-4'}`}>
                <div className="flex justify-between items-start gap-4">
                    {/* Thumbnail (comfortable density only — sidebar stays text-only) */}
                    {comfy && (imageUrl || isLoadingTitle) && (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-50 ring-1 ring-gray-200">
                            {isLoadingTitle ? (
                                <div className="h-full w-full animate-pulse bg-gray-200" />
                            ) : imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={imageUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                    onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                                    }}
                                />
                            ) : null}
                        </div>
                    )}

                    <div className="flex-1 min-w-0">
                        <p className={`font-black uppercase tracking-widest text-gray-500 ${comfy ? 'text-[10px] mb-1.5' : 'text-[9px] mb-1'}`}>Product</p>
                        {isLoadingTitle ? (
                            <div className={`animate-pulse rounded bg-gray-200 ${comfy ? 'h-5 w-3/4' : 'h-4 w-2/3'}`} />
                        ) : (
                            <p className={`font-semibold text-gray-900 leading-snug break-words ${comfy ? 'text-base' : 'text-sm'}`}>
                                {title || <span className="text-gray-500 italic font-normal">—</span>}
                            </p>
                        )}
                        {comfy && currentLocation && (
                            <p className="mt-2 text-[11px] font-mono text-gray-500">
                                <span className="text-gray-400">LAST LOC </span>
                                <span className="font-bold text-orange-600">{currentLocation}</span>
                            </p>
                        )}
                    </div>
                    <div className="text-right flex-shrink-0">
                        <p className={`font-black uppercase tracking-widest text-gray-500 ${comfy ? 'text-[10px] mb-1.5' : 'text-[9px] mb-1'}`}>Stock</p>
                        <span className={`font-black ${
                            comfy ? 'text-base px-2.5 py-1' : 'text-xs px-2 py-0.5'
                        } ${
                            parseInt(stock) > 0
                                ? 'text-blue-700 bg-blue-50'
                                : 'text-red-700 bg-red-50'
                        }`}>
                            {stock || '0'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Inputs */}
            <div className="border-t border-gray-200">
                {/* Scan field — Enter adds to list */}
                <div className="flex border-b border-gray-200">
                    <input
                        ref={snInputRef}
                        value={scanValue}
                        onChange={handleScanChange}
                        onKeyDown={handleScanKeyDown}
                        className={`flex-1 bg-white focus:outline-none font-mono placeholder:text-gray-500 text-gray-900 ${comfy ? 'px-7 py-5 text-base' : 'px-5 py-4 text-sm'}`}
                        placeholder="Scan SN → Enter to add…"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {/* SN count badge */}
                    {serialNumbers.length > 0 && (
                        <div className={`flex items-center bg-blue-50 border-l border-gray-200 ${comfy ? 'px-5' : 'px-4'}`}>
                            <span className={`font-black text-blue-700 tabular-nums ${comfy ? 'text-xs' : 'text-[11px]'}`}>
                                {serialNumbers.length} SN{serialNumbers.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                    )}
                </div>

                {/* Accumulated SN list */}
                {serialNumbers.length > 0 && (
                    <div className={`bg-gray-50 border-b border-gray-200 ${comfy ? 'px-7 py-3' : 'px-5 py-2.5'}`}>
                        <p className={`font-mono text-gray-600 break-all leading-relaxed ${comfy ? 'text-[11px]' : 'text-[10px]'}`}>
                            {serialNumbers.join(', ')}
                        </p>
                    </div>
                )}

                <LocationSelector
                    value={location}
                    currentLocation={currentLocation}
                    onChange={onLocationChange}
                    compact
                />
            </div>

            {/* CTA */}
            <button
                onClick={() => {
                    const pending = scanValue.trim() || undefined;
                    if (pending) setScanValue('');
                    onNext(pending);
                }}
                disabled={isPosting}
                className={`w-full ${comfy ? 'py-5' : 'py-4'} bg-blue-600 hover:bg-blue-700 text-white ${sectionLabel} transition-colors disabled:opacity-40`}
            >
                {isPosting ? (
                    <span className="flex items-center justify-center gap-2">
                        <span className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                        Processing…
                    </span>
                ) : (
                    <span className="flex items-center justify-center gap-2.5">
                        Continue →
                        {comfy && (
                            <kbd className="rounded border border-white/30 bg-white/10 px-1.5 py-0.5 text-[9px] font-mono font-bold tracking-tighter">⏎</kbd>
                        )}
                    </span>
                )}
            </button>
        </div>
    );
}
