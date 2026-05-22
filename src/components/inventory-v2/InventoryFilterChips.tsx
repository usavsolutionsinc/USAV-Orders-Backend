'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@/components/Icons';
import {
    SERIAL_STATUS_VALUES,
    CONDITION_GRADE_VALUES,
} from './types';

interface InventoryFilterChipsProps {
    states: string[];
    conditions: string[];
    onChange: (next: { states?: string[]; conditions?: string[] }) => void;
    onClear: () => void;
}

const STATUS_COLOR: Record<string, string> = {
    UNKNOWN: 'bg-gray-100 text-gray-600 ring-gray-200',
    RECEIVED: 'bg-blue-50 text-blue-700 ring-blue-200',
    TRIAGED: 'bg-blue-50 text-blue-700 ring-blue-200',
    IN_TEST: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    IN_REPAIR: 'bg-amber-50 text-amber-700 ring-amber-200',
    REPAIR_DONE: 'bg-amber-50 text-amber-700 ring-amber-200',
    TESTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    GRADED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    STOCKED: 'bg-green-50 text-green-700 ring-green-200',
    ALLOCATED: 'bg-purple-50 text-purple-700 ring-purple-200',
    PICKED: 'bg-purple-50 text-purple-700 ring-purple-200',
    PACKED: 'bg-purple-50 text-purple-700 ring-purple-200',
    LABELED: 'bg-purple-50 text-purple-700 ring-purple-200',
    STAGED: 'bg-purple-50 text-purple-700 ring-purple-200',
    SHIPPED: 'bg-gray-100 text-gray-700 ring-gray-200',
    RETURNED: 'bg-orange-50 text-orange-700 ring-orange-200',
    RMA: 'bg-orange-50 text-orange-700 ring-orange-200',
    ON_HOLD: 'bg-red-50 text-red-700 ring-red-200',
    SCRAPPED: 'bg-red-100 text-red-700 ring-red-300',
};

const CONDITION_COLOR: Record<string, string> = {
    BRAND_NEW: 'bg-white text-gray-700 ring-gray-300',
    USED_A: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    USED_B: 'bg-yellow-50 text-yellow-700 ring-yellow-200',
    USED_C: 'bg-orange-50 text-orange-700 ring-orange-200',
    PARTS: 'bg-red-50 text-red-700 ring-red-200',
};

export function InventoryFilterChips({
    states,
    conditions,
    onChange,
    onClear,
}: InventoryFilterChipsProps) {
    const [stateOpen, setStateOpen] = useState(false);
    const [conditionOpen, setConditionOpen] = useState(false);

    const stateSet = new Set(states);
    const conditionSet = new Set(conditions);

    const toggleState = (value: string) => {
        const next = new Set(stateSet);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        onChange({ states: Array.from(next) });
    };
    const toggleCondition = (value: string) => {
        const next = new Set(conditionSet);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        onChange({ conditions: Array.from(next) });
    };

    const totalSelected = states.length + conditions.length;

    return (
        <div className="flex flex-wrap items-start gap-2">
            <FilterDropdown
                label="State"
                count={states.length}
                open={stateOpen}
                onToggle={() => {
                    setStateOpen((o) => !o);
                    setConditionOpen(false);
                }}
                onClose={() => setStateOpen(false)}
            >
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {SERIAL_STATUS_VALUES.map((s) => {
                        const selected = stateSet.has(s);
                        const tone = STATUS_COLOR[s] || 'bg-gray-100 text-gray-700 ring-gray-200';
                        return (
                            <button
                                key={s}
                                type="button"
                                onClick={() => toggleState(s)}
                                className={`rounded-full px-2 py-1 text-[11px] font-medium ring-1 ring-inset transition-opacity ${tone} ${selected ? '' : 'opacity-50 hover:opacity-100'}`}
                            >
                                {s}
                            </button>
                        );
                    })}
                </div>
            </FilterDropdown>

            <FilterDropdown
                label="Condition"
                count={conditions.length}
                open={conditionOpen}
                onToggle={() => {
                    setConditionOpen((o) => !o);
                    setStateOpen(false);
                }}
                onClose={() => setConditionOpen(false)}
            >
                <div className="flex flex-wrap gap-1">
                    {CONDITION_GRADE_VALUES.map((c) => {
                        const selected = conditionSet.has(c);
                        const tone = CONDITION_COLOR[c] || 'bg-gray-100 text-gray-700 ring-gray-200';
                        return (
                            <button
                                key={c}
                                type="button"
                                onClick={() => toggleCondition(c)}
                                className={`rounded-full px-2 py-1 text-[11px] font-medium ring-1 ring-inset transition-opacity ${tone} ${selected ? '' : 'opacity-50 hover:opacity-100'}`}
                            >
                                {c.replace('_', ' ')}
                            </button>
                        );
                    })}
                </div>
            </FilterDropdown>

            {totalSelected > 0 ? (
                <button
                    type="button"
                    onClick={onClear}
                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                >
                    Clear
                    <X className="h-3 w-3" />
                </button>
            ) : null}
        </div>
    );
}

interface FilterDropdownProps {
    label: string;
    count: number;
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
    children: React.ReactNode;
}

function FilterDropdown({ label, count, open, onToggle, onClose, children }: FilterDropdownProps) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    useLayoutEffect(() => {
        if (!open) return;
        const update = () => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (!rect) return;
            setCoords({ top: rect.bottom + 4, left: rect.left });
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [open]);

    return (
        <div className="relative">
            <button
                ref={triggerRef}
                type="button"
                onClick={onToggle}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    count > 0
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
                aria-expanded={open}
            >
                {label}
                {count > 0 ? (
                    <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {count}
                    </span>
                ) : null}
                <svg
                    className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden
                >
                    <path
                        fillRule="evenodd"
                        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                        clipRule="evenodd"
                    />
                </svg>
            </button>

            {open && mounted && coords
                ? createPortal(
                    <>
                        <div
                            className="fixed inset-0 z-[120]"
                            onClick={onClose}
                            aria-hidden
                        />
                        <div
                            className="fixed z-[121] w-[min(28rem,calc(100vw-2rem))] rounded-md border border-gray-200 bg-white p-2 shadow-lg"
                            style={{ top: coords.top, left: coords.left }}
                        >
                            {children}
                        </div>
                    </>,
                    document.body,
                  )
                : null}
        </div>
    );
}
