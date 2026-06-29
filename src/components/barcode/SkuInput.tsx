'use client';

import React from 'react';
import { Search, Clipboard } from '../Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { cn } from '@/utils/_cn';

import type { BarcodeDensity } from './BarcodePreview';

interface SkuInputProps {
    sku: string;
    uniqueSku: string;
    mode: 'print' | 'sn-to-sku' | 'reprint';
    skuInputRef: React.RefObject<HTMLInputElement>;
    isActive: boolean;
    /** Visual density hint — accepted for parity with the horizontal layout. */
    density?: BarcodeDensity;
    onChange: (value: string) => void;
    onNext: () => void;
    onFillAndSearch: (value: string) => void;
}

export function SkuInput({ sku, uniqueSku, mode, skuInputRef, isActive, density = 'compact', onChange, onNext, onFillAndSearch }: SkuInputProps) {
    const comfy = density === 'comfortable';

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
            <div className={`flex items-center gap-3 ${comfy ? 'px-7 pt-6 pb-3' : 'px-5 pt-5 pb-3'}`}>
                <span className={`font-black tabular-nums text-gray-500 tracking-widest ${comfy ? 'text-micro' : 'text-eyebrow'}`}>01</span>
                <span className={`font-black uppercase text-gray-600 ${comfy ? 'text-caption tracking-[0.16em]' : 'text-eyebrow tracking-[0.18em]'}`}>SKU</span>
            </div>

            <div className="flex border-t border-b border-gray-200">
                <input
                    ref={skuInputRef}
                    value={sku}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onNext()}
                    className={`flex-1 bg-white focus:outline-none font-mono placeholder:text-gray-500 text-gray-900 ${
                        comfy ? 'px-6 py-5 text-base' : 'px-4 py-4 text-sm'
                    }`}
                    placeholder="Scan or type SKU…"
                    autoComplete="off"
                    spellCheck={false}
                />

                {/* Paste from clipboard */}
                <HoverTooltip label="Paste from clipboard and search" asChild>
                    <IconButton
                        onClick={handlePaste}
                        ariaLabel="Paste from clipboard and search"
                        icon={<Clipboard className={comfy ? 'h-5 w-5' : 'h-4 w-4'} />}
                        className={cn(
                            'bg-white hover:bg-gray-50 hover:text-gray-800 border-l border-gray-200 flex items-center justify-center',
                            comfy ? 'px-5' : 'px-4',
                        )}
                    />
                </HoverTooltip>

                {/* Search / confirm */}
                <HoverTooltip label="Search" asChild>
                    <IconButton
                        onClick={onNext}
                        ariaLabel="Search"
                        icon={<Search className={cn('text-white', comfy ? 'h-5 w-5' : 'h-4 w-4')} />}
                        className={cn(
                            'bg-blue-600 hover:bg-blue-700 flex items-center justify-center border-l border-blue-600',
                            comfy ? 'px-6' : 'px-5',
                        )}
                    />
                </HoverTooltip>
            </div>
        </div>
    );
}
