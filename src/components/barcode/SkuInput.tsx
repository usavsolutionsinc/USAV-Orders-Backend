'use client';

import React from 'react';
import { Search, Clipboard } from '../Icons';

interface SkuInputProps {
    sku: string;
    uniqueSku: string;
    mode: 'print' | 'sn-to-sku' | 'change-location' | 'reprint';
    skuInputRef: React.RefObject<HTMLInputElement>;
    isActive: boolean;
    onChange: (value: string) => void;
    onNext: () => void;
    onFillAndSearch: (value: string) => void;
}

export function SkuInput({ sku, uniqueSku, mode, skuInputRef, isActive, onChange, onNext, onFillAndSearch }: SkuInputProps) {

    const handlePaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            const trimmed = text.trim();
            if (trimmed) onFillAndSearch(trimmed);
        } catch {
            // clipboard permission denied — user can type manually
        }
    };

    return (
        <div className={`transition-opacity duration-200 ${!isActive ? 'opacity-25 pointer-events-none' : ''}`}>
            <div className="flex items-center gap-3 px-5 pt-5 pb-3">
                <span className="text-[9px] font-black tabular-nums text-gray-300 tracking-widest">01</span>
                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-500">SKU</span>
            </div>

            <div className="flex border-t border-b border-gray-100">
                <input
                    ref={skuInputRef}
                    value={sku}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onNext()}
                    className="flex-1 px-4 py-4 bg-white text-sm focus:outline-none font-mono placeholder:text-gray-300 text-gray-900"
                    placeholder="Scan or type SKU…"
                    autoComplete="off"
                    spellCheck={false}
                />

                {/* Paste from clipboard */}
                <button
                    onClick={handlePaste}
                    title="Paste from clipboard and search"
                    className="px-4 bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors border-l border-gray-100 flex items-center justify-center"
                >
                    <Clipboard className="w-4 h-4" />
                </button>

                {/* Search / confirm */}
                <button
                    onClick={onNext}
                    title="Search"
                    className="px-5 bg-gray-900 text-white hover:bg-gray-700 transition-colors flex items-center justify-center border-l border-gray-900"
                >
                    <Search className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
