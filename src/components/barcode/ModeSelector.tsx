'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Printer, Database, RotateCcw } from '../Icons';
import { successFeedback } from '@/lib/feedback/confirm';

// 'bin-labels' was previously bundled here; bin/zone printing now lives at
// /warehouse (WarehouseSidebarPanel → Labels tab). Keep this union focused
// on per-SKU barcode workflows.
export type BarcodeMode = 'print' | 'sn-to-sku' | 'reprint';

interface ModeSelectorProps {
    mode: BarcodeMode;
    onModeChange: (mode: BarcodeMode) => void;
    /**
     * `horizontal` — segmented pill across the top.
     * `vertical` — left rail of buttons.
     * `grid` — 2×2 grid used by the sidebar above favorites.
     */
    orientation?: 'horizontal' | 'vertical' | 'grid';
}

export const BARCODE_MODES: { id: BarcodeMode; label: string; description: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'print',     label: 'Print',   description: 'New SKU label',     Icon: Printer   },
    { id: 'sn-to-sku', label: 'Log SN',  description: 'Serial → SKU log',  Icon: Database  },
    { id: 'reprint',   label: 'Reprint', description: 'Same label again',  Icon: RotateCcw },
];

const MODES = BARCODE_MODES;

/**
 * Animated segmented pill (horizontal) or rail (vertical). A single shared
 * `layoutId` highlight slides between the active item; tap fires haptic
 * feedback. The vertical orientation is used by the desktop workspace
 * (right pane), where the picker becomes the left rail of the form area.
 */
const MODE_ACCENT: Record<BarcodeMode, { active: string; ring: string }> = {
    'print':     { active: 'bg-blue-600 text-white',    ring: 'ring-blue-200' },
    'sn-to-sku': { active: 'bg-emerald-600 text-white', ring: 'ring-emerald-200' },
    'reprint':   { active: 'bg-violet-700 text-white',  ring: 'ring-violet-200' },
};

export function ModeSelector({ mode, onModeChange, orientation = 'horizontal' }: ModeSelectorProps) {
    const reduceMotion = useReducedMotion();

    if (orientation === 'grid') {
        return (
            <div
                role="tablist"
                aria-label="Barcode mode"
                className="grid grid-cols-2 gap-1.5"
            >
                {MODES.map(({ id, label, description, Icon }) => {
                    const isActive = mode === id;
                    const accent = MODE_ACCENT[id];
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
                            className={`group relative flex flex-col items-start gap-2 rounded-2xl p-3 text-left transition-all duration-150 outline-none ${
                                isActive
                                    ? `bg-white shadow-sm ring-2 ${accent.ring}`
                                    : 'bg-gray-50 ring-1 ring-gray-200/60 hover:bg-white hover:ring-gray-300'
                            }`}
                        >
                            <span className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${
                                isActive ? accent.active : 'bg-white text-gray-500 ring-1 ring-gray-200 group-hover:text-gray-800'
                            }`}>
                                <Icon className="h-4 w-4" />
                            </span>
                            <span className="flex flex-col">
                                <span className={`text-label font-semibold leading-tight ${isActive ? 'text-gray-900' : 'text-gray-700'}`}>
                                    {label}
                                </span>
                                <span className="text-micro font-medium leading-tight text-gray-500">
                                    {description}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>
        );
    }

    if (orientation === 'vertical') {
        return (
            <nav
                aria-label="Barcode mode"
                role="tablist"
                className="flex h-full flex-col gap-1 border-r border-gray-100 bg-gray-50/60 p-2"
            >
                {MODES.map(({ id, label, description, Icon }) => {
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
                            className={`group relative flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-150 outline-none ${
                                isActive ? 'text-gray-900' : 'text-gray-500 hover:text-gray-800'
                            }`}
                        >
                            {isActive && (
                                <motion.span
                                    layoutId="mode-selector-pill"
                                    className="absolute inset-0 rounded-xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] ring-1 ring-gray-200/60"
                                    transition={
                                        reduceMotion
                                            ? { duration: 0 }
                                            : { type: 'spring', damping: 28, stiffness: 360, mass: 0.6 }
                                    }
                                />
                            )}
                            <span className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                                isActive ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 ring-1 ring-gray-200 group-hover:text-gray-800'
                            }`}>
                                <Icon className="h-4 w-4" />
                            </span>
                            <span className="relative z-10 flex min-w-0 flex-col">
                                <span className={`text-label font-black uppercase tracking-[0.14em] ${isActive ? 'text-gray-900' : 'text-gray-700'}`}>
                                    {label}
                                </span>
                                <span className="truncate text-micro font-semibold text-gray-500">
                                    {description}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </nav>
        );
    }

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
                                <span className="text-micro font-semibold tracking-tight">{label}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
