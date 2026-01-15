'use client';

import React from 'react';
import { Check, X } from '../Icons';

interface BarcodePreviewProps {
    mode: 'print' | 'sn-to-sku';
    uniqueSku: string;
    sku: string;
    title: string;
    serialNumbers: string[];
    notes: string;
    showNotes: boolean;
    barcodeCanvasRef?: React.RefObject<HTMLCanvasElement>;
    isPosting: boolean;
    isActive: boolean;
    getSerialLast6: (serialNumbers: string[]) => string;
    onToggleNotes: () => void;
    onNotesChange: (value: string) => void;
    onPrint: () => void;
}

/**
 * Step 3: Barcode preview and print/log component
 */
export function BarcodePreview({ 
    mode,
    uniqueSku,
    sku,
    title, 
    serialNumbers, 
    notes,
    showNotes,
    barcodeCanvasRef,
    isPosting,
    isActive, 
    getSerialLast6,
    onToggleNotes,
    onNotesChange,
    onPrint 
}: BarcodePreviewProps) {
    return (
        <div className={`space-y-6 transition-all duration-300 ${!isActive ? 'opacity-10 pointer-events-none' : ''}`}>
            <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center text-sm font-black border border-white/10">
                    3
                </div>
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-400">
                    Review & {mode === 'print' ? 'Print' : 'Log'}
                </h3>
            </div>

            <div className="bg-white/[0.03] border-2 border-dashed border-white/10 rounded-[2.5rem] p-8 flex flex-col items-center gap-6 text-center">
                {mode === 'print' ? (
                    <>
                        <div className="bg-white p-4 rounded-2xl">
                            <canvas ref={barcodeCanvasRef} className="max-w-full" />
                        </div>
                        <div className="space-y-3 w-full">
                            <div className="flex flex-col items-center gap-2">
                                <p className="font-mono text-lg font-black tracking-tighter text-white">{uniqueSku}</p>
                            </div>
                            <p className="text-[11px] text-gray-500 break-words px-4 leading-relaxed font-medium">{title}</p>
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 rounded-full">
                                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                                <p className="text-[9px] text-blue-400 font-black uppercase tracking-widest">
                                    SN: {getSerialLast6(serialNumbers)}
                                </p>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="py-4 space-y-4 w-full">
                        <div className="p-6 bg-emerald-500/10 text-emerald-400 rounded-[2rem] border border-emerald-500/20">
                            <p className="text-[10px] font-black uppercase tracking-widest mb-1.5 opacity-60">Logging Mode</p>
                            <p className="text-sm font-black">Static SKU + {serialNumbers.length} SNs</p>
                        </div>
                        <div className="text-left space-y-3 px-4">
                            <div className="flex flex-col gap-1">
                                <p className="text-[9px] font-black text-gray-600 uppercase tracking-widest">Selected SKU</p>
                                <p className="text-xs font-bold text-white font-mono">{sku}</p>
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-[9px] font-black text-gray-600 uppercase tracking-widest">Serial Numbers</p>
                                <p className="text-xs font-bold text-white font-mono break-all">{serialNumbers.join(', ')}</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="space-y-3">
                <button
                    onClick={onToggleNotes}
                    className="w-full py-2 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:bg-white/10 transition-all"
                >
                    {showNotes ? 'Hide' : 'Add'} Notes
                </button>

                {showNotes && (
                    <textarea
                        value={notes}
                        onChange={(e) => onNotesChange(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-xs outline-none resize-none min-h-[80px] placeholder:text-gray-700 focus:ring-2 focus:ring-blue-500/50"
                        placeholder="Notes (optional)..."
                    />
                )}

                <button
                    onClick={onPrint}
                    disabled={isPosting}
                    className="w-full py-5 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-2xl text-sm font-black uppercase tracking-[0.2em] hover:from-blue-500 hover:to-blue-400 disabled:opacity-50 transition-all shadow-xl shadow-blue-600/20"
                >
                    {isPosting ? (
                        <span className="flex items-center justify-center gap-2">
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            {mode === 'print' ? 'Saving & Printing...' : 'Logging...'}
                        </span>
                    ) : (
                        mode === 'print' ? (
                            <span className="flex items-center justify-center gap-2">
                                <Check className="w-5 h-5" /> Print Label
                            </span>
                        ) : (
                            <span className="flex items-center justify-center gap-2">
                                <Check className="w-5 h-5" /> Log to Sheet
                            </span>
                        )
                    )}
                </button>
            </div>
        </div>
    );
}
