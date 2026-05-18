'use client';

import React from 'react';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { Check } from '../Icons';
export type BarcodeDensity = 'comfortable' | 'compact';

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
    density?: BarcodeDensity;
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
    density = 'compact',
    getSerialLast6,
    onToggleNotes,
    onNotesChange,
    onPrint,
}: BarcodePreviewProps) {
    const isPrintMode = mode === 'print' || mode === 'reprint';
    const isLocationMode = mode === 'change-location';
    const comfy = density === 'comfortable';

    const accentClass = isLocationMode
        ? 'bg-orange-600 hover:bg-orange-700'
        : mode === 'reprint'
        ? 'bg-violet-700 hover:bg-violet-800'
        : 'bg-blue-600 hover:bg-blue-700';

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
            <div className={`flex items-center gap-3 ${comfy ? 'px-7 pt-7 pb-3' : 'px-5 pt-5 pb-3'}`}>
                <span className={`font-black tabular-nums text-gray-500 tracking-widest ${comfy ? 'text-[10px]' : 'text-[9px]'}`}>03</span>
                <span className={`font-black uppercase text-gray-600 ${comfy ? 'text-[11px] tracking-[0.16em]' : 'text-[9px] tracking-[0.18em]'}`}>
                    {isLocationMode ? 'Confirm' : `Review & ${mode === 'print' ? 'Print' : mode === 'reprint' ? 'Reprint' : 'Log'}`}
                </span>
            </div>

            {/* Preview area — edge-to-edge */}
            <div className="border-t border-gray-200">
                {isPrintMode ? (
                    // QR-only label preview. Title + identifier column on
                    // the left, QR canvas on the right — mirrors the
                    // printed thermal-label layout. The QR encodes the GS1
                    // Digital Link URL returned by /api/units/next-id.
                    <div className={`flex items-center bg-gray-50 ${comfy ? 'px-7 py-7 gap-5' : 'px-5 py-5 gap-4'}`}>
                        <div className="min-w-0 flex-1 space-y-1">
                            <p className={`leading-snug text-gray-700 ${comfy ? 'text-xs' : 'text-[11px]'}`}>{title}</p>
                            <p className={`font-mono font-black tracking-tight text-gray-900 break-all ${comfy ? 'text-base' : 'text-sm'}`}>{uniqueSku}</p>
                            {mode !== 'reprint' && serialNumbers.length > 0 && (
                                <p className={`text-gray-500 font-mono ${comfy ? 'text-[11px]' : 'text-[10px]'}`}>
                                    SN · {getSerialLast6(serialNumbers)}
                                </p>
                            )}
                            {location && (
                                <p className={`text-gray-500 font-mono ${comfy ? 'text-[11px]' : 'text-[10px]'}`}>LOC · {location}</p>
                            )}
                        </div>
                        <div className={`shrink-0 bg-white border border-gray-200 flex items-center justify-center ${comfy ? 'h-32 w-32 p-2' : 'h-24 w-24 p-1.5'}`}>
                            <canvas ref={barcodeCanvasRef} className="h-full w-full" />
                        </div>
                    </div>
                ) : isLocationMode ? (
                    <div className="px-5 py-5 space-y-3">
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">SKU</p>
                            <p className="text-sm font-black font-mono text-gray-900">{sku}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">New Location</p>
                            <p className="text-sm font-black font-mono text-orange-600">{location || '—'}</p>
                        </div>
                        <p className="text-[9px] text-gray-500 italic">Updates master location in Sku-Stock</p>
                    </div>
                ) : (
                    /* sn-to-sku log mode */
                    <div className="px-5 py-5 space-y-3">
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">SKU</p>
                            <p className="text-sm font-black font-mono text-gray-900">{sku}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">
                                Serial Numbers ({serialNumbers.length})
                            </p>
                            <p className="text-xs font-mono text-gray-700 break-all leading-relaxed">
                                {serialNumbers.join(', ') || '—'}
                            </p>
                        </div>
                        {location && (
                            <div>
                                <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">Location</p>
                                <p className="text-xs font-mono text-gray-700">{location}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Notes toggle + input */}
            {!isLocationMode && (
                <div className="border-t border-gray-200">
                    <button
                        onClick={onToggleNotes}
                        className="w-full px-5 py-3 text-left text-[9px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-600 transition-colors flex items-center justify-between"
                    >
                        <span>Notes {notes ? '(1)' : ''}</span>
                        <span>{showNotes ? '−' : '+'}</span>
                    </button>
                    {showNotes && (
                        <textarea
                            value={notes}
                            onChange={(e) => onNotesChange(e.target.value)}
                            className="w-full px-5 pb-4 bg-white text-xs text-gray-900 focus:outline-none resize-none min-h-[72px] placeholder:text-gray-500 border-t border-gray-200"
                            placeholder="Optional notes…"
                        />
                    )}
                </div>
            )}

            {/* CTA */}
            <button
                onClick={onPrint}
                disabled={isPosting}
                className={`w-full ${comfy ? 'py-5' : 'py-4'} ${accentClass} text-white ${sectionLabel} transition-colors disabled:opacity-40`}
            >
                {isPosting ? (
                    <span className="flex items-center justify-center gap-2">
                        <span className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                        {isLocationMode ? 'Updating…' : mode === 'print' ? 'Saving & Printing…' : mode === 'reprint' ? 'Reprinting…' : 'Logging…'}
                    </span>
                ) : (
                    <span className="flex items-center justify-center gap-2.5">
                        <Check className={comfy ? 'h-5 w-5' : 'h-4 w-4'} />
                        {ctaLabel}
                        {comfy && (mode === 'print' || mode === 'reprint') && (
                            <kbd className="rounded border border-white/30 bg-white/10 px-1.5 py-0.5 text-[9px] font-mono font-bold tracking-tighter">⌘P</kbd>
                        )}
                    </span>
                )}
            </button>
        </div>
    );
}
