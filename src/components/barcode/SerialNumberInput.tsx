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

/**
 * Step 2: Serial number and location input component
 */
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
    onChangeSku 
}: SerialNumberInputProps) {
    const isLocationMode = mode === 'change-location';
    const isReprintMode = mode === 'reprint';

    return (
        <div className={`space-y-5 transition-all duration-300 ${
            !isActive ? 'opacity-10 pointer-events-none grayscale' : ''
        }`}>
            <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-900 flex items-center justify-center text-sm font-black border border-gray-200">
                    2
                </div>
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500">
                    {isLocationMode ? 'Update Location' : 'Details & SN'}
                </h3>
            </div>
            
            {showChangeSku && onChangeSku && (
                <div className="flex justify-end">
                    <button
                        onClick={onChangeSku}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl transition-all active:scale-95 shadow-lg shadow-blue-600/10"
                    >
                        Change SKU
                    </button>
                </div>
            )}

            <div className="bg-gray-50 rounded-3xl p-6 border border-gray-200 space-y-4">
                <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Product</p>
                        <p className="text-sm font-bold text-gray-900 leading-relaxed break-words">
                            {isLoadingTitle ? 'Loading...' : title}
                        </p>
                    </div>
                    {!isLocationMode && (
                        <div className="text-right ml-4">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Stock</p>
                            <p className={`text-xs font-black px-2 py-0.5 rounded-md ${
                                parseInt(stock) > 0 ? 'text-blue-600 bg-blue-50' : 'text-red-600 bg-red-50'
                            }`}>
                                {stock}
                            </p>
                        </div>
                    )}
                </div>

                {isLocationMode && (
                    <div className="pt-4 border-t border-gray-200">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Current Location</p>
                        <div className="flex items-center gap-2 text-orange-600 bg-orange-50 px-3 py-2 rounded-xl border border-orange-100">
                            <span className="text-xs font-black font-mono">{currentLocation || 'No location set'}</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="space-y-4">
                {!isLocationMode && (
                    <input
                        ref={snInputRef}
                        value={snInput}
                        onChange={(e) => onSnInputChange(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && onNext()}
                        className="w-full px-5 py-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono placeholder:text-gray-400 text-gray-900"
                        placeholder="Comma-separated SNs..."
                    />
                )}

                <div className={isLocationMode ? "pt-8" : ""}>
                    {isLocationMode && (
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-1">New Location Entry</p>
                    )}
                    <input
                        value={location}
                        onChange={(e) => onLocationChange(e.target.value)}
                        onKeyDown={(e) => isLocationMode && e.key === 'Enter' && onFinalAction?.()}
                        className={`w-full px-5 py-4 bg-gray-50 border border-gray-200 rounded-2xl ${isLocationMode ? 'text-sm font-mono' : 'text-[10px] font-black uppercase tracking-widest'} focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-gray-400 text-gray-900`}
                        placeholder={isLocationMode ? "Enter new location..." : "Location (optional)"}
                    />
                </div>

                <button
                    onClick={isLocationMode ? onFinalAction : onNext}
                    disabled={isPosting}
                    className={`w-full py-4 ${isLocationMode ? 'bg-orange-600 hover:bg-orange-700' : 'bg-gray-900 hover:bg-blue-600'} text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-gray-200 disabled:opacity-50`}
                >
                    {isPosting ? (
                        <div className="flex items-center justify-center gap-2">
                            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Updating...
                        </div>
                    ) : isLocationMode ? (
                        'Update Location'
                    ) : (
                        'Continue to Final'
                    )}
                </button>
            </div>
        </div>
    );
}
