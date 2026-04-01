'use client';

import React from 'react';
import { Check } from '../Icons';
import {
    SIDEBAR_INTAKE_LABEL_CLASS,
    SIDEBAR_INTAKE_INPUT_CLASS,
} from '@/design-system/components';

interface ReasonSelectorProps {
    selectedReasons: string[];
    notes: string;
    onReasonsChange: (reasons: string[]) => void;
    onNotesChange: (notes: string) => void;
    skuIssues?: string[];
}

const REPAIR_REASONS = [
    'Please wait',
    'Skip',
    'No sound',
    'Speaker Buzz',
    'CD Issues',
    'LCD Issues'
];

export function ReasonSelector({
    selectedReasons,
    notes,
    onReasonsChange,
    onNotesChange,
    skuIssues,
}: ReasonSelectorProps) {
    const reasons = skuIssues && skuIssues.length > 0 ? skuIssues : REPAIR_REASONS;

    const toggleReason = (reason: string) => {
        if (selectedReasons.includes(reason)) {
            onReasonsChange(selectedReasons.filter(r => r !== reason));
        } else {
            onReasonsChange([...selectedReasons, reason]);
        }
    };

    return (
        <div className="space-y-4">
            <div>
                <p className={SIDEBAR_INTAKE_LABEL_CLASS}>Reason for Repair</p>

                <div className="mt-2 space-y-2">
                    {reasons.map((reason) => {
                        const isSelected = selectedReasons.includes(reason);

                        return (
                            <button
                                key={reason}
                                type="button"
                                onClick={() => toggleReason(reason)}
                                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all ${
                                    isSelected
                                        ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                        : 'border border-gray-200 bg-gray-50 text-gray-900 hover:border-blue-300 hover:bg-blue-50'
                                }`}
                            >
                                <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md ${
                                    isSelected
                                        ? 'bg-white'
                                        : 'border border-gray-300 bg-white'
                                }`}>
                                    {isSelected && <Check className="h-3 w-3 text-blue-600" />}
                                </div>
                                <span className="text-xs font-bold uppercase tracking-wide">
                                    {reason}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Repair Notes */}
            <div className="space-y-2">
                <label className={SIDEBAR_INTAKE_LABEL_CLASS}>
                    Repair Notes <span className="text-gray-400">-- Optional</span>
                </label>
                <textarea
                    value={notes}
                    onChange={(e) => onNotesChange(e.target.value)}
                    placeholder="Describe any additional issues or details..."
                    rows={3}
                    className={`${SIDEBAR_INTAKE_INPUT_CLASS} resize-none`}
                />
            </div>
        </div>
    );
}
