'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Printer, Database, MapPin, RotateCcw, Barcode } from '../Icons';
import { successFeedback } from '@/lib/feedback/confirm';

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

/**
 * Animated segmented pill. A single shared layoutId pill slides under the
 * active tab; tap fires haptic feedback. Pure visual — no behavior change.
 */
export function ModeSelector({ mode, onModeChange }: ModeSelectorProps) {
    const reduceMotion = useReducedMotion();
    return (
        <div className="px-3 pt-3 pb-2">
            <div
                role="tablist"
                aria-label="Barcode mode"
                className="relative flex items-stretch gap-1 rounded-2xl bg-gray-100/80 p-1 backdrop-blur"
            >
                {MODES.map(({ id, label, Icon }) => {
                    const isActive = mode === id;
                    return (
                        <button
                            key={id}
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => {
                                if (mode === id) return;
                                successFeedback();
                                onModeChange(id);
                            }}
                            className={`relative flex-1 flex flex-col items-center justify-center gap-1 rounded-xl py-2 transition-colors duration-150 outline-none ${
                                isActive ? 'text-gray-900' : 'text-gray-500 hover:text-gray-800'
                            }`}
                        >
                            {isActive && (
                                <motion.span
                                    layoutId="mode-selector-pill"
                                    className="absolute inset-0 rounded-xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]"
                                    transition={
                                        reduceMotion
                                            ? { duration: 0 }
                                            : { type: 'spring', damping: 28, stiffness: 360, mass: 0.6 }
                                    }
                                />
                            )}
                            <span className="relative z-10 flex flex-col items-center gap-0.5">
                                <Icon className="w-4 h-4" />
                                <span className="text-[10px] font-semibold tracking-tight">{label}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
