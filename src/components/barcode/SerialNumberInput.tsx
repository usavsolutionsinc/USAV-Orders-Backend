'use client';

import React, { useState, useRef, useEffect } from 'react';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { LocationSelector } from './LocationSelector';

interface SerialNumberInputProps {
    sku: string;
    mode: 'print' | 'sn-to-sku' | 'change-location' | 'reprint';
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
    onSnInputChange: (value: string) => void;
    onSnAdd: (sn: string) => void;
    onLocationChange: (value: string) => void;
    onNext: (pendingSn?: string) => void;
    onFinalAction?: () => void;
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
    onSnInputChange,
    onSnAdd,
    onLocationChange,
    onNext,
    onFinalAction,
    isPosting,
    onChangeSku,
}: SerialNumberInputProps) {
    const isLocationMode = mode === 'change-location';

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
            <div className="flex items-center gap-3 px-5 pt-5 pb-3">
                <span className="text-[9px] font-black tabular-nums text-gray-500 tracking-widest">02</span>
                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-600">
                    {isLocationMode ? 'Update Location' : 'Details & Serial Numbers'}
                </span>
                {showChangeSku && onChangeSku && (
                    <button
                        onClick={onChangeSku}
                        className="ml-auto text-[9px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-800 transition-colors"
                    >
                        ← Change SKU
                    </button>
                )}
            </div>

            {/* Product info */}
            <div className="border-t border-gray-200 px-5 py-4">
                <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">Product</p>
                        <p className="text-sm font-semibold text-gray-900 leading-snug break-words">
                            {isLoadingTitle ? (
                                <span className="text-gray-500 italic font-normal">Loading…</span>
                            ) : (
                                title || <span className="text-gray-500 italic font-normal">—</span>
                            )}
                        </p>
                    </div>
                    {!isLocationMode && (
                        <div className="text-right flex-shrink-0">
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">Stock</p>
                            <span className={`text-xs font-black px-2 py-0.5 ${
                                parseInt(stock) > 0
                                    ? 'text-blue-700 bg-blue-50'
                                    : 'text-red-700 bg-red-50'
                            }`}>
                                {stock || '0'}
                            </span>
                        </div>
                    )}
                </div>

                {isLocationMode && currentLocation && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">Current Location</p>
                        <span className="text-xs font-black font-mono text-orange-600">{currentLocation}</span>
                    </div>
                )}
            </div>

            {/* Inputs */}
            <div className="border-t border-gray-200">
                {!isLocationMode && (
                    <>
                        {/* Scan field — Enter adds to list */}
                        <div className="flex border-b border-gray-200">
                            <input
                                ref={snInputRef}
                                value={scanValue}
                                onChange={handleScanChange}
                                onKeyDown={handleScanKeyDown}
                                className="flex-1 px-5 py-4 bg-white text-sm focus:outline-none font-mono placeholder:text-gray-500 text-gray-900"
                                placeholder="Scan SN → Enter to add…"
                                autoComplete="off"
                                spellCheck={false}
                            />
                            {/* SN count badge */}
                            {serialNumbers.length > 0 && (
                                <div className="flex items-center px-4 bg-blue-50 border-l border-gray-200">
                                    <span className="text-[11px] font-black text-blue-700 tabular-nums">
                                        {serialNumbers.length} SN{serialNumbers.length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Accumulated SN list */}
                        {serialNumbers.length > 0 && (
                            <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-200">
                                <p className="text-[10px] font-mono text-gray-600 break-all leading-relaxed">
                                    {serialNumbers.join(', ')}
                                </p>
                            </div>
                        )}
                    </>
                )}

                <LocationSelector
                    value={location}
                    currentLocation={currentLocation}
                    onChange={onLocationChange}
                    compact={!isLocationMode}
                />
            </div>

            {/* CTA */}
            <button
                onClick={isLocationMode ? onFinalAction : () => {
                    const pending = scanValue.trim() || undefined;
                    if (pending) setScanValue('');
                    onNext(pending);
                }}
                disabled={isPosting}
                className={`w-full py-4 ${
                    isLocationMode
                        ? 'bg-orange-600 hover:bg-orange-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                } text-white ${sectionLabel} transition-colors disabled:opacity-40`}
            >
                {isPosting ? (
                    <span className="flex items-center justify-center gap-2">
                        <span className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                        {isLocationMode ? 'Updating…' : 'Processing…'}
                    </span>
                ) : isLocationMode ? (
                    'Update Location'
                ) : (
                    'Continue →'
                )}
            </button>
        </div>
    );
}
