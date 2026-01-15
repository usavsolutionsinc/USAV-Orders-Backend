'use client';

import React from 'react';
import { Search } from '../Icons';

interface SkuInputProps {
    sku: string;
    uniqueSku: string;
    mode: 'print' | 'sn-to-sku';
    skuInputRef: React.RefObject<HTMLInputElement>;
    isActive: boolean;
    onChange: (value: string) => void;
    onNext: () => void;
}

/**
 * Step 1: SKU input component
 */
export function SkuInput({ 
    sku, 
    uniqueSku, 
    mode, 
    skuInputRef, 
    isActive, 
    onChange, 
    onNext 
}: SkuInputProps) {
    return (
        <div className={`space-y-4 transition-all duration-300 ${!isActive ? 'opacity-30 pointer-events-none' : ''}`}>
            <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center text-sm font-black border border-white/10">
                    1
                </div>
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-400">Identify SKU</h3>
            </div>
            <div className="flex gap-2">
                <input
                    ref={skuInputRef}
                    value={sku}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onNext()}
                    className="flex-1 px-5 py-4 bg-white/5 border border-white/10 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/50 outline-none transition-all font-mono placeholder:text-gray-700"
                    placeholder="Scan or enter SKU..."
                />
                <button 
                    onClick={onNext}
                    className="p-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20"
                >
                    <Search className="w-5 h-5" />
                </button>
            </div>

            {sku && mode === 'print' && (
                <div className="flex flex-col gap-3 p-4 bg-white/5 rounded-2xl border border-white/10">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Active SKU</p>
                            <p className="font-mono text-sm font-black text-blue-400">{uniqueSku || 'Not Generated'}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
