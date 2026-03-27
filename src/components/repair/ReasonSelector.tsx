'use client';

import React from 'react';
import { Check } from '../Icons';

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
                <p className="text-[8px] font-black uppercase tracking-[0.2em] text-blue-600 mb-0.5">
                    Diagnosis
                </p>
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-tight mb-3">
                    Reason for Repair
                </h3>

                <div className="space-y-1.5">
                    {reasons.map((reason) => {
                        const isSelected = selectedReasons.includes(reason);

                        return (
                            <button
                                key={reason}
                                onClick={() => toggleReason(reason)}
                                className={`w-full px-4 py-3.5 border-2 transition-colors text-left flex items-center gap-3 ${
                                    isSelected
                                        ? 'bg-blue-600 border-blue-600 text-white'
                                        : 'bg-white border-gray-300 text-gray-900 hover:border-blue-600 active:bg-blue-50'
                                }`}
                            >
                                <div className={`w-5 h-5 border-2 flex items-center justify-center flex-shrink-0 ${
                                    isSelected
                                        ? 'bg-white border-white'
                                        : 'border-gray-400'
                                }`}>
                                    {isSelected && <Check className="w-3 h-3 text-blue-600" />}
                                </div>
                                <span className="text-xs font-black uppercase tracking-wide">
                                    {reason}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Repair Notes */}
            <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase tracking-[0.15em] text-gray-500">
                    Repair Notes <span className="text-gray-400 font-normal normal-case tracking-normal">— Optional</span>
                </label>
                <textarea
                    value={notes}
                    onChange={(e) => onNotesChange(e.target.value)}
                    placeholder="Describe any additional issues or details..."
                    rows={3}
                    className="w-full px-4 py-3.5 bg-white border-2 border-gray-300 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-600 transition-colors resize-none"
                />
            </div>
        </div>
    );
}
