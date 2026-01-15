'use client';

import React from 'react';
import { Check } from '../Icons';

interface ReasonSelectorProps {
    selectedReasons: string[];
    additionalNotes: string;
    onReasonsChange: (reasons: string[]) => void;
    onNotesChange: (notes: string) => void;
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
    additionalNotes, 
    onReasonsChange, 
    onNotesChange 
}: ReasonSelectorProps) {
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
                <h3 className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-3">
                    Reason for Repair
                </h3>

                <div className="space-y-2">
                    {REPAIR_REASONS.map((reason) => {
                        const isSelected = selectedReasons.includes(reason);
                        
                        return (
                            <button
                                key={reason}
                                onClick={() => toggleReason(reason)}
                                className={`w-full p-3 rounded-xl border-2 transition-all text-left flex items-center gap-3 ${
                                    isSelected
                                        ? 'bg-blue-600 border-blue-600 text-white'
                                        : 'bg-gray-50 border-gray-200 text-gray-900 hover:border-blue-500'
                                }`}
                            >
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                                    isSelected 
                                        ? 'bg-white border-white' 
                                        : 'border-gray-300'
                                }`}>
                                    {isSelected && <Check className="w-3 h-3 text-blue-600" />}
                                </div>
                                <span className="text-xs font-bold uppercase tracking-wide">
                                    {reason}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Additional Notes */}
            <div>
                <label className="block text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-2">
                    Additional Notes (Optional)
                </label>
                <textarea
                    value={additionalNotes}
                    onChange={(e) => onNotesChange(e.target.value)}
                    placeholder="Describe any additional issues or details..."
                    rows={4}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
            </div>
        </div>
    );
}
