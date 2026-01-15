'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { ChevronRight, ChevronLeft, Check, X, Printer, Database, Search } from './Icons';

declare global {
    interface Window {
        JsBarcode: any;
    }
}

interface ApiResponse {
    success?: boolean;
    error?: string;
    title?: string;
    currentSku?: string;
    nextSku?: string;
    stock?: string;
}

interface PostDataPayload {
    sku: string;
    serialNumbers: string[];
    notes: string;
    productTitle: string;
    location: string;
}

type Mode = 'print' | 'sn-to-sku';

export default function MultiSkuSnBarcode() {
    const [mode, setMode] = useState<Mode>('print');
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [sku, setSku] = useState<string>("");
    const [snInput, setSnInput] = useState<string>("");
    const [serialNumbers, setSerialNumbers] = useState<string[]>([]);
    const [uniqueSku, setUniqueSku] = useState<string>("");
    const [title, setTitle] = useState<string>("");
    const [stock, setStock] = useState<string>("");
    const [isLibraryLoaded, setIsLibraryLoaded] = useState<boolean>(false);
    const [error, setError] = useState<string>("");
    const [isPosting, setIsPosting] = useState<boolean>(false);
    const [isGenerating, setIsGenerating] = useState<boolean>(false);
    const [isLoadingTitle, setIsLoadingTitle] = useState<boolean>(false);
    const [showNotes, setShowNotes] = useState<boolean>(false);
    const [notes, setNotes] = useState<string>("");
    const [location, setLocation] = useState<string>("");

    const barcodeCanvasRef = useRef<HTMLCanvasElement>(null);
    const printRef = useRef<HTMLDivElement>(null);
    const skuInputRef = useRef<HTMLInputElement>(null);
    const snInputRef = useRef<HTMLInputElement>(null);

    const normalizeSku = useCallback((sku: string): string => {
        return sku.replace(/^0+/, '') || '0';
    }, []);

    const getSerialLast6 = useCallback((serialNumbers: string[]) => {
        return serialNumbers.map(sn => sn.slice(-6)).join(', ');
    }, []);

    useEffect(() => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js";
        script.onload = () => setIsLibraryLoaded(true);
        document.head.appendChild(script);
    }, []);

    const renderBarcode = useCallback((canvas: HTMLCanvasElement | null, value: string) => {
        if (!canvas || !isLibraryLoaded || !window.JsBarcode || !value.trim()) return;
        try {
            window.JsBarcode(canvas, value, {
                format: "CODE128",
                lineColor: "#000000",
                background: "#ffffff",
                width: 2,
                height: 50,
                displayValue: false,
                margin: 6,
            });
        } catch (e) {
            console.warn('Barcode failed:', e);
        }
    }, [isLibraryLoaded]);

    useEffect(() => {
        if (mode === 'print' && step === 3) {
            renderBarcode(barcodeCanvasRef.current, uniqueSku);
        }
    }, [uniqueSku, step, mode, renderBarcode]);

    const handleSkuChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSku(e.target.value);
        setUniqueSku(""); // Reset unique SKU when base SKU changes
        setError("");
    };

    const fetchProductInfo = async (skuValue: string) => {
        setIsLoadingTitle(true);
        try {
            const res = await fetch(`/api/get-title-by-sku?sku=${encodeURIComponent(normalizeSku(skuValue))}`);
            const data = await res.json();
            setTitle(data.title || "Not found");
            setStock(data.stock || "0");
        } catch (e) {
            setTitle("Error loading info");
        } finally {
            setIsLoadingTitle(false);
        }
    };

    const handleNextStepSku = async () => {
        if (!sku.trim()) {
            setError("SKU required");
            return;
        }
        await fetchProductInfo(sku);
        
        // Auto-fetch current SKU if not already set
        if (mode === 'print' && !uniqueSku) {
            setIsGenerating(true);
            try {
                const res = await fetch(`/api/sku-manager?baseSku=${encodeURIComponent(normalizeSku(sku))}&action=current`);
                const data = await res.json();
                setUniqueSku(data.currentSku);
            } catch (e) {
                console.error("Failed to pre-fetch SKU");
            } finally {
                setIsGenerating(false);
            }
        }
        
        setStep(2);
        setTimeout(() => snInputRef.current?.focus(), 100);
    };

    const handleNextStepSn = async () => {
        if (serialNumbers.length === 0) {
            setError("Serial numbers required");
            return;
        }

        if (mode === 'print') {
            // Only generate a new SKU if we don't have one already
            if (!uniqueSku) {
                setIsGenerating(true);
                try {
                    const res = await fetch(`/api/sku-manager?baseSku=${encodeURIComponent(normalizeSku(sku))}&action=current`);
                    const data = await res.json();
                    setUniqueSku(data.currentSku);
                } catch (e) {
                    setError("Failed to generate SKU");
                    return;
                } finally {
                    setIsGenerating(false);
                }
            }
            setStep(3);
        } else {
            // SN to SKU mode - we use static SKU + SN
            setUniqueSku(sku); 
            setStep(3);
        }
    };

    const handleChangeSku = () => {
        // Reset to step 1 to allow re-entering SKU
        setSku("");
        setUniqueSku("");
        setTitle("");
        setStock("");
        setSnInput("");
        setSerialNumbers([]);
        setStep(1);
        setError("");
        setTimeout(() => skuInputRef.current?.focus(), 100);
    };

    const postToSheets = async () => {
        setIsPosting(true);
        try {
            const res = await fetch('/api/post-multi-sn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sku: uniqueSku,
                    serialNumbers,
                    notes,
                    productTitle: title,
                    location
                }),
            });
            const data = await res.json();
            return data.success;
        } catch (e) {
            return false;
        } finally {
            setIsPosting(false);
        }
    };

    const handleFinalAction = async () => {
        const success = await postToSheets();
        if (success) {
            // Increment SKU in database for next scan (only in print mode)
            if (mode === 'print') {
                try {
                    await fetch(`/api/sku-manager?baseSku=${encodeURIComponent(normalizeSku(sku))}&action=increment`);
                } catch (e) {
                    console.error("Failed to increment SKU in DB:", e);
                }
                
                // Print logic
                const printWindow = window.open('', '', 'width=800,height=600');
                if (printWindow) {
                    const html = `
                        <html>
                            <head>
                                <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
                                <style>
                                    body { display: flex; flex-direction: column; align-items: center; text-align: center; font-family: sans-serif; padding: 20px; }
                                    .barcode { max-width: 100%; }
                                    .sku { font-family: monospace; font-size: 14px; font-weight: bold; }
                                    .title { font-size: 16px; margin: 5px 0; }
                                    .sns { font-family: monospace; font-size: 12px; }
                                </style>
                            </head>
                            <body>
                                <canvas id="barcode"></canvas>
                                <div class="sku">${uniqueSku}</div>
                                <div class="title">${title}</div>
                                <div class="sns">SN: ${getSerialLast6(serialNumbers)}</div>
                                <script>
                                    window.onload = function() {
                                        JsBarcode('#barcode', '${uniqueSku}', { format: "CODE128", width: 2, height: 50, displayValue: false });
                                        window.print();
                                        setTimeout(() => window.close(), 500);
                                    }
                                </script>
                            </body>
                        </html>
                    `;
                    printWindow.document.write(html);
                    printWindow.document.close();
                }
            }
            
            // Reset after success and fetch next SKU for display
            setSnInput("");
            setSerialNumbers([]);
            
            if (mode === 'print') {
                // Fetch the new current SKU for display
                try {
                    const res = await fetch(`/api/sku-manager?baseSku=${encodeURIComponent(normalizeSku(sku))}&action=current`);
                    const data = await res.json();
                    setUniqueSku(data.currentSku);
                } catch (e) {
                    console.error("Failed to fetch next SKU:", e);
                }
            }
            
            setStep(2); // Stay on details step but clear serials
        } else {
            setError("Failed to save data");
        }
    };

    return (
        <div className="h-full flex flex-col bg-gray-950 text-white">
            <div className="p-6 flex gap-2">
                <button 
                    onClick={() => { setMode('print'); setStep(1); }}
                    className={`flex-1 py-3 px-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${mode === 'print' ? 'bg-blue-600 text-white shadow-[0_10px_20px_rgba(37,99,235,0.2)]' : 'bg-white/5 text-gray-500 hover:bg-white/10'}`}
                >
                    <Printer className="w-3 h-3 inline-block mr-2" />
                    Print Label
                </button>
                <button 
                    onClick={() => { setMode('sn-to-sku'); setStep(1); }}
                    className={`flex-1 py-3 px-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${mode === 'sn-to-sku' ? 'bg-emerald-600 text-white shadow-[0_10px_20px_rgba(16,185,129,0.2)]' : 'bg-white/5 text-gray-500 hover:bg-white/10'}`}
                >
                    <Database className="w-3 h-3 inline-block mr-2" />
                    SN to SKU
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-hide">
                {/* Step 1: SKU */}
                <div className={`space-y-4 transition-all duration-300 ${step > 1 ? 'opacity-30 pointer-events-none' : ''}`}>
                    <div className="flex items-center gap-4">
                        <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center text-sm font-black border border-white/10">1</div>
                        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-400">Identify SKU</h3>
                    </div>
                    <div className="flex gap-2">
                        <input
                            ref={skuInputRef}
                            value={sku}
                            onChange={handleSkuChange}
                            onKeyDown={(e) => e.key === 'Enter' && handleNextStepSku()}
                            className="flex-1 px-5 py-4 bg-white/5 border border-white/10 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/50 outline-none transition-all font-mono placeholder:text-gray-700"
                            placeholder="Scan or enter SKU..."
                        />
                        <button 
                            onClick={handleNextStepSku}
                            className="p-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20"
                        >
                            <Search className="w-5 h-5" />
                        </button>
                    </div>

                    {sku && mode === 'print' && (
                        <div className="flex flex-col gap-3 p-4 bg-white/5 rounded-2xl border border-white/10">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Active SKU</p>
                                    <p className="font-mono text-sm font-black text-blue-400">{uniqueSku || 'Not Generated'}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Step 2: SN & Details */}
                <div className={`space-y-5 transition-all duration-300 ${step === 1 ? 'opacity-10 pointer-events-none grayscale' : step > 2 ? 'opacity-30 pointer-events-none' : ''}`}>
                    <div className="flex items-center gap-4">
                        <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center text-sm font-black border border-white/10">2</div>
                        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-400">Details & SN</h3>
                    </div>
                    
                    {sku && mode === 'print' && step === 2 && (
                        <div className="flex justify-end">
                            <button
                                onClick={handleChangeSku}
                                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-[10px] font-black uppercase tracking-widest rounded-2xl transition-all active:scale-95 shadow-lg shadow-blue-600/20"
                            >
                                Change SKU
                            </button>
                        </div>
                    )}

                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 space-y-4">
                        <div className="flex justify-between items-start">
                            <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-1.5">Product</p>
                                <p className="text-sm font-bold text-white leading-relaxed break-words">{isLoadingTitle ? 'Loading...' : title}</p>
                            </div>
                            <div className="text-right ml-4">
                                <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-1.5">Stock</p>
                                <p className={`text-xs font-black px-2 py-0.5 rounded-md ${parseInt(stock) > 0 ? 'text-blue-400 bg-blue-400/10' : 'text-red-400 bg-red-400/10'}`}>{stock}</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <input
                            ref={snInputRef}
                            value={snInput}
                            onChange={(e) => {
                                setSnInput(e.target.value);
                                setSerialNumbers(e.target.value.split(',').map(s => s.trim()).filter(s => !!s));
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && handleNextStepSn()}
                            className="w-full px-5 py-4 bg-white/5 border border-white/10 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/50 outline-none transition-all font-mono placeholder:text-gray-700"
                            placeholder="Comma-separated SNs..."
                        />

                        <input
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            className="w-full px-5 py-3 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest focus:ring-2 focus:ring-blue-500/50 outline-none transition-all placeholder:text-gray-700"
                            placeholder="Location (optional)"
                        />

                        <button
                            onClick={handleNextStepSn}
                            className="w-full py-4 bg-white text-gray-950 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] hover:bg-blue-500 hover:text-white transition-all shadow-xl shadow-black/20"
                        >
                            Continue to Final
                        </button>
                    </div>
                </div>

                {/* Step 3: Review & Action */}
                <div className={`space-y-6 transition-all duration-300 ${step < 3 ? 'opacity-10 pointer-events-none' : ''}`}>
                    <div className="flex items-center gap-4">
                        <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center text-sm font-black border border-white/10">3</div>
                        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-400">Review & {mode === 'print' ? 'Print' : 'Log'}</h3>
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
                                        <p className="text-[9px] text-blue-400 font-black uppercase tracking-widest">SN: {getSerialLast6(serialNumbers)}</p>
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
                                        <p className="text-[9px] font-black text-gray-600 uppercase tracking-widest">Serials</p>
                                        <p className="text-xs font-bold text-white font-mono break-all">{serialNumbers.join(', ')}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleFinalAction}
                            disabled={isPosting}
                            className={`w-full py-5 ${mode === 'print' ? 'bg-blue-600 shadow-[0_15px_30px_rgba(37,99,235,0.3)]' : 'bg-emerald-600 shadow-[0_15px_30px_rgba(16,185,129,0.3)]'} text-white rounded-3xl text-xs font-black uppercase tracking-[0.2em] transition-all hover:scale-[1.02] flex items-center justify-center gap-3 active:scale-95`}
                        >
                            {isPosting ? 'Processing...' : (
                                <>
                                    {mode === 'print' ? <Printer className="w-4 h-4" /> : <Database className="w-4 h-4" />}
                                    {mode === 'print' ? 'Save & Print Label' : 'Log Data to Sheet'}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {error && (
                <div className="mx-8 mb-8 p-4 bg-red-500/10 text-red-400 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-red-500/20 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                        {error}
                    </span>
                    <button onClick={() => setError("")} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            )}
        </div>
    );
}
