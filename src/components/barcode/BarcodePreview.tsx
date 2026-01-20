'use client';

import React from 'react';
import { Check, X } from '../Icons';

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
    location,
    showNotes,
    barcodeCanvasRef,
    isPosting,
    isActive, 
    getSerialLast6,
    onToggleNotes,
    onNotesChange,
    onPrint 
}: BarcodePreviewProps) {
    const isPrintMode = mode === 'print' || mode === 'reprint';
    const isLocationMode = mode === 'change-location';

    return (
        <div className={`space-y-6 transition-all duration-300 ${!isActive ? 'opacity-10 pointer-events-none' : ''}`}>
            <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-900 flex items-center justify-center text-sm font-black border border-gray-200">
                    3
                </div>
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500">
                    {isLocationMode ? 'Confirm Location' : `Review & ${mode === 'print' ? 'Print' : mode === 'reprint' ? 'Reprint' : 'Log'}`}
                </h3>
            </div>

            <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-[2.5rem] p-8 flex flex-col items-center gap-6 text-center">
                {isPrintMode ? (
                    <>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <canvas ref={barcodeCanvasRef} className="max-w-full" />
                        </div>
                        <div className="space-y-3 w-full">
                            <div className="flex flex-col items-center gap-2">
                                <p className="font-mono text-lg font-black tracking-tighter text-gray-900">{uniqueSku}</p>
                            </div>
                            <p className="text-[11px] text-gray-500 break-words px-4 leading-relaxed font-medium">{title}</p>
                            {mode !== 'reprint' && (
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 rounded-full">
                                    <div className={`w-1.5 h-1.5 ${mode === 'reprint' ? 'bg-purple-500' : 'bg-blue-500'} rounded-full animate-pulse`} />
                                    <p className={`text-[9px] ${mode === 'reprint' ? 'text-purple-600' : 'text-blue-600'} font-black uppercase tracking-widest`}>
                                        SN: {getSerialLast6(serialNumbers)}
                                    </p>
                                </div>
                            )}
                        </div>
                    </>
                ) : isLocationMode ? (
                    <div className="py-4 space-y-4 w-full">
                        <div className="p-6 bg-orange-50 text-orange-700 rounded-[2rem] border border-orange-100">
                            <p className="text-[10px] font-black uppercase tracking-widest mb-1.5 opacity-60">Location Update</p>
                            <p className="text-sm font-black">{sku}</p>
                        </div>
                        <div className="text-left space-y-4 px-4">
                            <div className="flex flex-col gap-1">
                                <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">New Location</p>
                                <p className="text-sm font-black text-orange-600 bg-orange-50/50 px-3 py-2 rounded-xl border border-orange-100/50 font-mono inline-block w-fit">
                                    {location || 'Not specified'}
                                </p>
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest italic">This will update the master location in Sku-Stock</p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="py-4 space-y-4 w-full">
                        <div className="p-6 bg-emerald-50 text-emerald-700 rounded-[2rem] border border-emerald-100">
                            <p className="text-[10px] font-black uppercase tracking-widest mb-1.5 opacity-60">Logging Mode</p>
                            <p className="text-sm font-black">Static SKU + {serialNumbers.length} SNs</p>
                        </div>
                        <div className="text-left space-y-3 px-4">
                            <div className="flex flex-col gap-1">
                                <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Selected SKU</p>
                                <p className="text-xs font-bold text-gray-900 font-mono">{sku}</p>
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Serial Numbers</p>
                                <p className="text-xs font-bold text-gray-900 font-mono break-all">{serialNumbers.join(', ')}</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="space-y-3">
                {!isLocationMode && (
                    <>
                        <button
                            onClick={onToggleNotes}
                            className="w-full py-2 bg-gray-50 border border-gray-200 rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-400 hover:bg-gray-100 transition-all"
                        >
                            {showNotes ? 'Hide' : 'Add'} Notes
                        </button>

                        {showNotes && (
                            <textarea
                                value={notes}
                                onChange={(e) => onNotesChange(e.target.value)}
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs outline-none resize-none min-h-[80px] placeholder:text-gray-400 text-gray-900 focus:ring-2 focus:ring-blue-500"
                                placeholder="Notes (optional)..."
                            />
                        )}
                    </>
                )}

                <button
                    onClick={onPrint}
                    disabled={isPosting}
                    className={`w-full py-5 ${
                        isLocationMode 
                            ? 'bg-gradient-to-r from-orange-600 to-orange-500 shadow-orange-600/10' 
                            : mode === 'reprint'
                                ? 'bg-gradient-to-r from-purple-600 to-purple-500 shadow-purple-600/10'
                                : 'bg-gradient-to-r from-blue-600 to-blue-500 shadow-blue-600/10'
                    } text-white rounded-2xl text-sm font-black uppercase tracking-[0.2em] hover:brightness-110 disabled:opacity-50 transition-all shadow-xl`}
                >
                    {isPosting ? (
                        <span className="flex items-center justify-center gap-2">
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            {isLocationMode ? 'Updating...' : mode === 'print' ? 'Saving & Printing...' : mode === 'reprint' ? 'Reprinting...' : 'Logging...'}
                        </span>
                    ) : (
                        <span className="flex items-center justify-center gap-2">
                            <Check className="w-5 h-5" /> 
                            {isLocationMode ? 'Update Location' : mode === 'print' ? 'Print Label' : mode === 'reprint' ? 'Reprint Label' : 'Log to Sheet'}
                        </span>
                    )}
                </button>
            </div>
        </div>
    );
}
