'use client';

import React from 'react';
import { Check } from '../Icons';
import { Button } from '@/design-system/primitives';
import { cn } from '@/utils/_cn';
import { Gs1DataMatrix, type Gs1DataMatrixSymbology } from '@/components/barcode/Gs1DataMatrix';
export type BarcodeDensity = 'comfortable' | 'compact';

interface BarcodePreviewProps {
    mode: 'print' | 'sn-to-sku' | 'reprint';
    uniqueSku: string;
    sku: string;
    title: string;
    serialNumbers: string[];
    notes: string;
    location: string;
    showNotes: boolean;
    /** DataMatrix payload — same value/symbology that the printed label will encode. */
    dataMatrixValue?: string;
    dataMatrixSymbology?: Gs1DataMatrixSymbology;
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
    dataMatrixValue,
    dataMatrixSymbology = 'datamatrix',
    isPosting,
    isActive,
    density = 'compact',
    getSerialLast6,
    onToggleNotes,
    onNotesChange,
    onPrint,
}: BarcodePreviewProps) {
    const isPrintMode = mode === 'print' || mode === 'reprint';
    const comfy = density === 'comfortable';

    const ctaLabel = mode === 'print'
        ? 'Save & Print Label'
        : mode === 'reprint'
        ? 'Reprint Label'
        : 'Log to Database';

    return (
        <div className={`transition-opacity duration-200 ${!isActive ? 'opacity-15 pointer-events-none' : ''}`}>
            {/* Step label */}
            <div className={`flex items-center gap-3 ${comfy ? 'px-7 pt-7 pb-3' : 'px-5 pt-5 pb-3'}`}>
                <span className={`font-black tabular-nums text-text-soft tracking-widest ${comfy ? 'text-micro' : 'text-eyebrow'}`}>03</span>
                <span className={`font-black uppercase text-text-muted ${comfy ? 'text-caption tracking-[0.16em]' : 'text-eyebrow tracking-[0.18em]'}`}>
                    {`Review & ${mode === 'print' ? 'Print' : mode === 'reprint' ? 'Reprint' : 'Log'}`}
                </span>
            </div>

            {/* Preview area — edge-to-edge */}
            <div className="border-t border-border-soft">
                {isPrintMode ? (
                    // DataMatrix label preview. Title + identifier column on
                    // the left, DataMatrix on the right — mirrors the
                    // printed thermal-label layout. Payload mirrors what
                    // printProductLabel encodes (built via buildUnitPayload).
                    <div className={`flex items-center bg-surface-canvas ${comfy ? 'px-7 py-7 gap-5' : 'px-5 py-5 gap-4'}`}>
                        <div className="min-w-0 flex-1 space-y-1">
                            <p className={`leading-snug text-text-muted ${comfy ? 'text-xs' : 'text-caption'}`}>{title}</p>
                            <p className={`font-mono font-black tracking-tight text-text-default break-all ${comfy ? 'text-base' : 'text-sm'}`}>{uniqueSku}</p>
                            {mode !== 'reprint' && serialNumbers.length > 0 && (
                                <p className={`text-text-soft font-mono ${comfy ? 'text-caption' : 'text-micro'}`}>
                                    SN · {getSerialLast6(serialNumbers)}
                                </p>
                            )}
                            {location && (
                                <p className={`text-text-soft font-mono ${comfy ? 'text-caption' : 'text-micro'}`}>LOC · {location}</p>
                            )}
                        </div>
                        <div className={`shrink-0 bg-surface-card border border-border-soft flex items-center justify-center ${comfy ? 'h-32 w-32 p-2' : 'h-24 w-24 p-1.5'}`}>
                            {dataMatrixValue ? (
                                <Gs1DataMatrix
                                    value={dataMatrixValue}
                                    symbology={dataMatrixSymbology}
                                    size={comfy ? 112 : 84}
                                />
                            ) : null}
                        </div>
                    </div>
                ) : (
                    /* sn-to-sku log mode */
                    <div className="px-5 py-5 space-y-3">
                        <div>
                            <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft mb-1">SKU</p>
                            <p className="text-sm font-black font-mono text-text-default">{sku}</p>
                        </div>
                        <div>
                            <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft mb-1">
                                Serial Numbers ({serialNumbers.length})
                            </p>
                            <p className="text-xs font-mono text-text-muted break-all leading-relaxed">
                                {serialNumbers.join(', ') || '—'}
                            </p>
                        </div>
                        {location && (
                            <div>
                                <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft mb-1">Location</p>
                                <p className="text-xs font-mono text-text-muted">{location}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Notes toggle + input */}
            <div className="border-t border-border-soft">
                <button
                    onClick={onToggleNotes}
                    className="ds-raw-button w-full px-5 py-3 text-left text-eyebrow font-black uppercase tracking-widest text-text-soft hover:text-text-muted transition-colors flex items-center justify-between"
                >
                    <span>Notes {notes ? '(1)' : ''}</span>
                    <span>{showNotes ? '−' : '+'}</span>
                </button>
                {showNotes && (
                    <textarea
                        value={notes}
                        onChange={(e) => onNotesChange(e.target.value)}
                        className="w-full px-5 pb-4 bg-surface-card text-xs text-text-default focus:outline-none resize-none min-h-[72px] placeholder:text-text-soft border-t border-border-soft"
                        placeholder="Optional notes…"
                    />
                )}
            </div>

            {/* CTA */}
            <Button
                variant="primary"
                onClick={onPrint}
                disabled={isPosting}
                className={cn(
                    'w-full justify-center rounded-none h-auto',
                    comfy ? 'py-5' : 'py-4',
                    mode === 'reprint' && 'bg-violet-700 hover:bg-violet-800',
                )}
            >
                {isPosting ? (
                    <span className="flex items-center justify-center gap-2">
                        <span className="h-3 w-3 border-2 border-glass/30 border-t-white rounded-full animate-spin inline-block" />
                        {mode === 'print' ? 'Saving & Printing…' : mode === 'reprint' ? 'Reprinting…' : 'Logging…'}
                    </span>
                ) : (
                    <span className="flex items-center justify-center gap-2.5">
                        <Check className={comfy ? 'h-5 w-5' : 'h-4 w-4'} />
                        {ctaLabel}
                        {comfy && (mode === 'print' || mode === 'reprint') && (
                            <kbd className="rounded border border-glass/30 bg-glass/10 px-1.5 py-0.5 text-eyebrow font-mono font-bold tracking-tighter">⌘P</kbd>
                        )}
                    </span>
                )}
            </Button>
        </div>
    );
}
