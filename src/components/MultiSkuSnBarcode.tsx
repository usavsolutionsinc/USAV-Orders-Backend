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
    size: string;
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
    const [selectedSize, setSelectedSize] = useState<string>("");
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
        setStep(2);
        setTimeout(() => snInputRef.current?.focus(), 100);
    };

    const handleNextStepSn = async () => {
        if (serialNumbers.length === 0) {
            setError("Serial numbers required");
            return;
        }

        if (mode === 'print') {
            setIsGenerating(true);
            try {
                const res = await fetch(`/api/sku-manager?baseSku=${encodeURIComponent(normalizeSku(sku))}&action=current`);
                const data = await res.json();
                setUniqueSku(data.currentSku);
                setStep(3);
            } catch (e) {
                setError("Failed to generate SKU");
            } finally {
                setIsGenerating(false);
            }
        } else {
            // SN to SKU mode - we use static SKU + SN
            setUniqueSku(sku); // In this mode, we just use the base SKU
            setStep(3);
        }
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
                    size: selectedSize,
                    location
                }),
            });
            const data = await res.json();
            if (data.success) {
                if (mode === 'print') {
                    // Only increment if we printed a unique label
                    await fetch(`/api/sku-manager?baseSku=${encodeURIComponent(normalizeSku(sku))}&action=increment`);
                }
                return true;
            }
            return false;
        } catch (e) {
            return false;
        } finally {
            setIsPosting(false);
        }
    };

    const handleFinalAction = async () => {
        const success = await postToSheets();
        if (success) {
            if (mode === 'print') {
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
            // Reset after success
            setStep(1);
            setSku("");
            setSnInput("");
            setSerialNumbers([]);
            setTitle("");
            setUniqueSku("");
            setNotes("");
            setLocation("");
            setSelectedSize("");
        } else {
            setError("Failed to save data");
        }
    };

    return (
        <div className="h-full flex flex-col bg-white">
            <div className="p-4 border-b border-gray-100 flex gap-2">
                <button 
                    onClick={() => { setMode('print'); setStep(1); }}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${mode === 'print' ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                    <Printer className="w-3 h-3 inline-block mr-2" />
                    Print Label
                </button>
                <button 
                    onClick={() => { setMode('sn-to-sku'); setStep(1); }}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${mode === 'sn-to-sku' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                    <Database className="w-3 h-3 inline-block mr-2" />
                    SN to SKU
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Step 1: SKU */}
                <div className={`space-y-4 transition-all duration-300 ${step > 1 ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-black">1</div>
                        <h3 className="text-sm font-black uppercase tracking-widest">Identify SKU</h3>
                    </div>
                    <div className="flex gap-2">
                        <input
                            ref={skuInputRef}
                            value={sku}
                            onChange={handleSkuChange}
                            onKeyDown={(e) => e.key === 'Enter' && handleNextStepSku()}
                            className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono"
                            placeholder="Scan or enter SKU..."
                        />
                        <button 
                            onClick={handleNextStepSku}
                            className="p-3 bg-gray-900 text-white rounded-xl hover:bg-blue-600 transition-all"
                        >
                            <Search className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Step 2: SN & Details */}
                <div className={`space-y-4 transition-all duration-300 ${step === 1 ? 'opacity-20 pointer-events-none grayscale' : step > 2 ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-black">2</div>
                        <h3 className="text-sm font-black uppercase tracking-widest">Details & SN</h3>
                    </div>
                    
                    <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-3">
                        <div className="flex justify-between items-start">
                            <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Product</p>
                                <p className="text-xs font-bold text-gray-900 truncate">{isLoadingTitle ? 'Loading...' : title}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Stock</p>
                                <p className={`text-xs font-black ${parseInt(stock) > 0 ? 'text-blue-600' : 'text-red-500'}`}>{stock}</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <input
                            ref={snInputRef}
                            value={snInput}
                            onChange={(e) => {
                                setSnInput(e.target.value);
                                setSerialNumbers(e.target.value.split(',').map(s => s.trim()).filter(s => !!s));
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && handleNextStepSn()}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono"
                            placeholder="Comma-separated SNs..."
                        />
                        
                        <div className="grid grid-cols-3 gap-2">
                            {['Small', 'Medium', 'Big'].map(size => (
                                <button
                                    key={size}
                                    onClick={() => setSelectedSize(size)}
                                    className={`py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all ${selectedSize === size ? 'bg-gray-900 text-white border-gray-900 shadow-md' : 'bg-white text-gray-400 border-gray-100 hover:border-gray-200'}`}
                                >
                                    {size}
                                </button>
                            ))}
                        </div>

                        <input
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                            placeholder="Location (optional)"
                        />

                        <button
                            onClick={handleNextStepSn}
                            className="w-full py-3 bg-gray-900 text-white rounded-xl text-xs font-black uppercase tracking-[0.2em] hover:bg-blue-600 transition-all shadow-xl shadow-gray-200"
                        >
                            Next Step
                        </button>
                    </div>
                </div>

                {/* Step 3: Review & Action */}
                <div className={`space-y-4 transition-all duration-300 ${step < 3 ? 'opacity-20 pointer-events-none grayscale' : ''}`}>
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-black">3</div>
                        <h3 className="text-sm font-black uppercase tracking-widest">Review & {mode === 'print' ? 'Print' : 'Log'}</h3>
                    </div>

                    <div className="bg-white border-2 border-dashed border-gray-200 rounded-3xl p-6 flex flex-col items-center gap-4 text-center">
                        {mode === 'print' ? (
                            <>
                                <canvas ref={barcodeCanvasRef} className="max-w-full" />
                                <div className="space-y-1">
                                    <p className="font-mono text-sm font-black">{uniqueSku}</p>
                                    <p className="text-xs text-gray-500 line-clamp-2 px-4">{title}</p>
                                    <p className="text-[10px] text-blue-600 font-bold uppercase tracking-widest">SN: {getSerialLast6(serialNumbers)}</p>
                                </div>
                            </>
                        ) : (
                            <div className="py-4 space-y-3 w-full">
                                <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl border border-emerald-100">
                                    <p className="text-[10px] font-black uppercase tracking-widest mb-1">Logging Mode</p>
                                    <p className="text-sm font-bold">Static SKU + {serialNumbers.length} SNs</p>
                                </div>
                                <div className="text-left space-y-2 px-2">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Selected SKU: <span className="text-gray-900">{sku}</span></p>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Serials: <span className="text-gray-900">{serialNumbers.join(', ')}</span></p>
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleFinalAction}
                            disabled={isPosting}
                            className={`w-full py-4 ${mode === 'print' ? 'bg-blue-600 shadow-blue-200' : 'bg-emerald-600 shadow-emerald-200'} text-white rounded-2xl text-sm font-black uppercase tracking-[0.2em] transition-all hover:scale-[1.02] shadow-2xl flex items-center justify-center gap-3`}
                        >
                            {isPosting ? 'Processing...' : (
                                <>
                                    {mode === 'print' ? <Printer className="w-4 h-4" /> : <Database className="w-4 h-4" />}
                                    {mode === 'print' ? 'Save & Print' : 'Log to Sheet'}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {error && (
                <div className="mx-6 mb-6 p-3 bg-red-50 text-red-600 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-red-100 flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError("")} className="p-1 hover:bg-red-100 rounded-full transition-colors">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            )}
        </div>
    );
}
