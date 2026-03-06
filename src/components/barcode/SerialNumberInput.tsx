'use client';

import React from 'react';

interface SerialNumberInputProps {
    sku: string;
    mode: 'print' | 'sn-to-sku' | 'change-location' | 'reprint';
    title: string;
    stock: string;
    snInput: string;
    location: string;
    currentLocation?: string;
    snInputRef: React.RefObject<HTMLInputElement>;
    isLoadingTitle: boolean;
    isActive: boolean;
    showChangeSku: boolean;
    onSnInputChange: (value: string) => void;
    onLocationChange: (value: string) => void;
    onNext: () => void;
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
    location,
    currentLocation,
    snInputRef,
    isLoadingTitle,
    isActive,
    showChangeSku,
    onSnInputChange,
    onLocationChange,
    onNext,
    onFinalAction,
    isPosting,
    onChangeSku,
}: SerialNumberInputProps) {
    const isLocationMode = mode === 'change-location';

    return (
        <div className={`transition-opacity duration-200 ${!isActive ? 'opacity-15 pointer-events-none' : ''}`}>
            {/* Step label */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-3">
                <span className="text-[9px] font-black tabular-nums text-gray-300 tracking-widest">02</span>
                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-500">
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
            <div className="border-t border-gray-100 px-5 py-4">
                <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Product</p>
                        <p className="text-sm font-semibold text-gray-900 leading-snug break-words">
                            {isLoadingTitle ? (
                                <span className="text-gray-400 italic font-normal">Loading…</span>
                            ) : (
                                title || <span className="text-gray-400 italic font-normal">—</span>
                            )}
                        </p>
                    </div>
                    {!isLocationMode && (
                        <div className="text-right flex-shrink-0">
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Stock</p>
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
                    <div className="mt-3 pt-3 border-t border-gray-100">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Current Location</p>
                        <span className="text-xs font-black font-mono text-orange-600">{currentLocation}</span>
                    </div>
                )}
            </div>

            {/* Inputs */}
            <div className="border-t border-gray-100">
                {!isLocationMode && (
                    <input
                        ref={snInputRef}
                        value={snInput}
                        onChange={(e) => onSnInputChange(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && onNext()}
                        className="w-full px-5 py-4 bg-white text-sm focus:outline-none font-mono placeholder:text-gray-300 text-gray-900 border-b border-gray-100"
                        placeholder="Serial numbers, comma-separated…"
                        autoComplete="off"
                        spellCheck={false}
                    />
                )}

                <input
                    value={location}
                    onChange={(e) => onLocationChange(e.target.value)}
                    onKeyDown={(e) => isLocationMode && e.key === 'Enter' && onFinalAction?.()}
                    className={`w-full px-5 py-4 bg-white focus:outline-none placeholder:text-gray-300 text-gray-900 ${
                        isLocationMode ? 'text-sm font-mono' : 'text-[10px] font-black uppercase tracking-widest'
                    }`}
                    placeholder={isLocationMode ? 'Enter new location…' : 'Location (optional)'}
                    autoComplete="off"
                />
            </div>

            {/* CTA */}
            <button
                onClick={isLocationMode ? onFinalAction : onNext}
                disabled={isPosting}
                className={`w-full py-4 ${
                    isLocationMode
                        ? 'bg-orange-600 hover:bg-orange-700'
                        : 'bg-gray-900 hover:bg-gray-700'
                } text-white text-[10px] font-black uppercase tracking-[0.2em] transition-colors disabled:opacity-40`}
            >
                {isPosting ? (
                    <span className="flex items-center justify-center gap-2">
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
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
