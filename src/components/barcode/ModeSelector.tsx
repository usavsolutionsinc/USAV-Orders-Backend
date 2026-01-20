'use client';

import React from 'react';
import { Printer, Database, MapPin, RotateCcw } from '../Icons';

export type BarcodeMode = 'print' | 'sn-to-sku' | 'change-location' | 'reprint';

interface ModeSelectorProps {
    mode: BarcodeMode;
    onModeChange: (mode: BarcodeMode) => void;
}

/**
 * Mode selector for switching between print label and SN-to-SKU modes
 */
export function ModeSelector({ mode, onModeChange }: ModeSelectorProps) {
    return (
        <div className="p-6 grid grid-cols-2 gap-2">
            <button 
                onClick={() => onModeChange('print')}
                className={`py-3 px-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    mode === 'print' 
                        ? 'bg-blue-600 text-white shadow-[0_10px_20px_rgba(37,99,235,0.2)]' 
                        : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                }`}
            >
                <Printer className="w-3 h-3 inline-block mr-2" />
                Print
            </button>
            <button 
                onClick={() => onModeChange('sn-to-sku')}
                className={`py-3 px-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    mode === 'sn-to-sku' 
                        ? 'bg-emerald-600 text-white shadow-[0_10px_20px_rgba(16,185,129,0.2)]' 
                        : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                }`}
            >
                <Database className="w-3 h-3 inline-block mr-2" />
                Log SN
            </button>
            <button 
                onClick={() => onModeChange('change-location')}
                className={`py-3 px-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    mode === 'change-location' 
                        ? 'bg-orange-600 text-white shadow-[0_10px_20px_rgba(234,88,12,0.2)]' 
                        : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                }`}
            >
                <MapPin className="w-3 h-3 inline-block mr-2" />
                Location
            </button>
            <button 
                onClick={() => onModeChange('reprint')}
                className={`py-3 px-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    mode === 'reprint' 
                        ? 'bg-purple-600 text-white shadow-[0_10px_20px_rgba(147,51,234,0.2)]' 
                        : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                }`}
            >
                <RotateCcw className="w-3 h-3 inline-block mr-2" />
                Reprint
            </button>
        </div>
    );
}
