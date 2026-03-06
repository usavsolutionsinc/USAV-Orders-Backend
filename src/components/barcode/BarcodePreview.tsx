'use client';

import React from 'react';
import { Check } from '../Icons';

interface BarcodePreviewProps {
    mode: 'print' | 'sn-to-sku' | 'change-location' | 'reprint';
    uniqueSku: string;
    sku: string;
    title: string;
    serialNumbers: string[];
    notes: string;
    location: string;
    showNotes: boolean;
    barcodeCanvasRef?: React.RefObject<HTMLCanvasElement>;
    isPosting: boolean;
    isActive: boolean;
    getSerialLast6: (serialNumbers: string[]) => string;
    onToggleNotes: () => void;
    onNotesChange: (value: string) => void;
    onPrint: () => void;
}

export function BarcodePreview({
    mode,
    uniqueSku,
    sku,
    title,
    serialNumbers,
    notes,
    location,
    showNotes,
    barcodeCanvasRef,
    isPosting,
    isActive,
    getSerialLast6,
    onToggleNotes,
    onNotesChange,
    onPrint,
}: BarcodePreviewProps) {
    const isPrintMode = mode === 'print' || mode === 'reprint';
    const isLocationMode = mode === 'change-location';

    const accentClass = isLocationMode
        ? 'bg-orange-600 hover:bg-orange-700'
        : mode === 'reprint'
        ? 'bg-violet-700 hover:bg-violet-800'
        : 'bg-gray-900 hover:bg-gray-700';

    const ctaLabel = isLocationMode
        ? 'Confirm Update'
        : mode === 'print'
        ? 'Save & Print Label'
        : mode === 'reprint'
        ? 'Reprint Label'
        : 'Log to Database';

    return (
        <div className={`transition-opacity duration-200 ${!isActive ? 'opacity-15 pointer-events-none' : ''}`}>
            {/* Step label */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-3">
                <span className="text-[9px] font-black tabular-nums text-gray-300 tracking-widest">03</span>
                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-500">
                    {isLocationMode ? 'Confirm' : `Review & ${mode === 'print' ? 'Print' : mode === 'reprint' ? 'Reprint' : 'Log'}`}
                </span>
            </div>

            {/* Preview area — edge-to-edge */}
            <div className="border-t border-gray-100">
                {isPrintMode ? (
                    <div className="px-5 py-6 flex flex-col items-center gap-4 bg-gray-50">
                        {/* Barcode canvas */}
                        <div className="bg-white border border-gray-200 px-4 py-3 w-full flex justify-center">
                            <canvas ref={barcodeCanvasRef} className="max-w-full" />
                        </div>
                        {/* SKU + meta */}
                        <div className="w-full space-y-1 text-center">
                            <p className="font-mono text-base font-black tracking-tight text-gray-900">{uniqueSku}</p>
                            <p className="text-[11px] text-gray-500 leading-relaxed">{title}</p>
                            {mode !== 'reprint' && serialNumbers.length > 0 && (
                                <p className="text-[10px] text-gray-400 font-mono">
                                    SN: {getSerialLast6(serialNumbers)}
                                </p>
                            )}
                            {location && (
                                <p className="text-[10px] text-gray-400 font-mono">LOC: {location}</p>
                            )}
                        </div>
                    </div>
                ) : isLocationMode ? (
                    <div className="px-5 py-5 space-y-3">
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">SKU</p>
                            <p className="text-sm font-black font-mono text-gray-900">{sku}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">New Location</p>
                            <p className="text-sm font-black font-mono text-orange-600">{location || '—'}</p>
                        </div>
                        <p className="text-[9px] text-gray-400 italic">Updates master location in Sku-Stock</p>
                    </div>
                ) : (
                    /* sn-to-sku log mode */
                    <div className="px-5 py-5 space-y-3">
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">SKU</p>
                            <p className="text-sm font-black font-mono text-gray-900">{sku}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">
                                Serial Numbers ({serialNumbers.length})
                            </p>
                            <p className="text-xs font-mono text-gray-700 break-all leading-relaxed">
                                {serialNumbers.join(', ') || '—'}
                            </p>
                        </div>
                        {location && (
                            <div>
                                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Location</p>
                                <p className="text-xs font-mono text-gray-700">{location}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Notes toggle + input */}
            {!isLocationMode && (
                <div className="border-t border-gray-100">
                    <button
                        onClick={onToggleNotes}
                        className="w-full px-5 py-3 text-left text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 transition-colors flex items-center justify-between"
                    >
                        <span>Notes {notes ? '(1)' : ''}</span>
                        <span>{showNotes ? '−' : '+'}</span>
                    </button>
                    {showNotes && (
                        <textarea
                            value={notes}
                            onChange={(e) => onNotesChange(e.target.value)}
                            className="w-full px-5 pb-4 bg-white text-xs text-gray-900 focus:outline-none resize-none min-h-[72px] placeholder:text-gray-300 border-t border-gray-100"
                            placeholder="Optional notes…"
                        />
                    )}
                </div>
            )}

            {/* CTA */}
            <button
                onClick={onPrint}
                disabled={isPosting}
                className={`w-full py-4 ${accentClass} text-white text-[10px] font-black uppercase tracking-[0.2em] transition-colors disabled:opacity-40`}
            >
                {isPosting ? (
                    <span className="flex items-center justify-center gap-2">
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                        {isLocationMode ? 'Updating…' : mode === 'print' ? 'Saving & Printing…' : mode === 'reprint' ? 'Reprinting…' : 'Logging…'}
                    </span>
                ) : (
                    <span className="flex items-center justify-center gap-2">
                        <Check className="w-4 h-4" />
                        {ctaLabel}
                    </span>
                )}
            </button>
        </div>
    );
}
