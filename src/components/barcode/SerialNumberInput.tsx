'use client';

import React from 'react';

interface SerialNumberInputProps {
    sku: string;
    mode: 'print' | 'sn-to-sku';
    title: string;
    stock: string;
    snInput: string;
    location: string;
    snInputRef: React.RefObject<HTMLInputElement>;
    isLoadingTitle: boolean;
    isActive: boolean;
    showChangeSku: boolean;
    onSnInputChange: (value: string) => void;
    onLocationChange: (value: string) => void;
    onNext: () => void;
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
    snInputRef,
    isLoadingTitle,
    isActive, 
    showChangeSku,
    onSnInputChange, 
    onLocationChange, 
    onNext,
    onChangeSku 
}: SerialNumberInputProps) {
    const handleSnChange = (value: string) => {
        onSnInputChange(value);
    };

    return (
        <div className={`space-y-5 transition-all duration-300 ${
            !isActive ? 'opacity-10 pointer-events-none grayscale' : ''
        }`}>
            <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center text-sm font-black border border-white/10">
                    2
                </div>
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-400">Details & SN</h3>
            </div>
            
            {showChangeSku && onChangeSku && (
                <div className="flex justify-end">
                    <button
                        onClick={onChangeSku}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-[10px] font-black uppercase tracking-widest rounded-2xl transition-all active:scale-95 shadow-lg shadow-blue-600/20"
                    >
                        Change SKU
                    </button>
                </div>
            )}

            <div className="bg-white/5 rounded-3xl p-6 border border-white/10 space-y-4">
                <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-1.5">Product</p>
                        <p className="text-sm font-bold text-white leading-relaxed break-words">
                            {isLoadingTitle ? 'Loading...' : title}
                        </p>
                    </div>
                    <div className="text-right ml-4">
                        <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-1.5">Stock</p>
                        <p className={`text-xs font-black px-2 py-0.5 rounded-md ${
                            parseInt(stock) > 0 ? 'text-blue-400 bg-blue-400/10' : 'text-red-400 bg-red-400/10'
                        }`}>
                            {stock}
                        </p>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <input
                    ref={snInputRef}
                    value={snInput}
                    onChange={(e) => handleSnChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onNext()}
                    className="w-full px-5 py-4 bg-white/5 border border-white/10 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/50 outline-none transition-all font-mono placeholder:text-gray-700"
                    placeholder="Comma-separated SNs..."
                />

                <input
                    value={location}
                    onChange={(e) => onLocationChange(e.target.value)}
                    className="w-full px-5 py-3 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest focus:ring-2 focus:ring-blue-500/50 outline-none transition-all placeholder:text-gray-700"
                    placeholder="Location (optional)"
                />

                <button
                    onClick={onNext}
                    className="w-full py-4 bg-white text-gray-950 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] hover:bg-blue-500 hover:text-white transition-all shadow-xl shadow-black/20"
                >
                    Continue to Final
                </button>
            </div>
        </div>
    );
}
