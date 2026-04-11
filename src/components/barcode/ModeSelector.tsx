'use client';

import React from 'react';
import { Printer, Database, MapPin, RotateCcw, Barcode } from '../Icons';

export type BarcodeMode = 'print' | 'sn-to-sku' | 'change-location' | 'reprint' | 'bin-labels';

interface ModeSelectorProps {
    mode: BarcodeMode;
    onModeChange: (mode: BarcodeMode) => void;
}

const MODES: { id: BarcodeMode; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'print',           label: 'Print',    Icon: Printer   },
    { id: 'sn-to-sku',       label: 'Log SN',   Icon: Database  },
    { id: 'change-location', label: 'Location', Icon: MapPin    },
    { id: 'reprint',         label: 'Reprint',  Icon: RotateCcw },
    { id: 'bin-labels',      label: 'Bins',     Icon: Barcode   },
];

export function ModeSelector({ mode, onModeChange }: ModeSelectorProps) {
    return (
        <div className="flex border-b border-gray-100">
            {MODES.map(({ id, label, Icon }) => {
                const isActive = mode === id;
                return (
                    <button
                        key={id}
                        onClick={() => onModeChange(id)}
                        className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-3 transition-colors duration-150 ${
                            isActive ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
                        }`}
                    >
                        <Icon className="w-3.5 h-3.5" />
                        <span className="text-[8px] font-black uppercase tracking-[0.12em]">{label}</span>
                        {isActive && (
                            <span className="absolute bottom-0 inset-x-0 h-[2px] bg-gray-900" />
                        )}
                    </button>
                );
            })}
        </div>
    );
}
