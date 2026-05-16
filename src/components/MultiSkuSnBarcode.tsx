'use client';

import React, { useEffect, useRef, useState, useCallback } from "react";

// Import refactored sub-components
import { ModeSelector, BarcodeMode } from './barcode/ModeSelector';
import { SkuInput } from './barcode/SkuInput';
import { SerialNumberInput } from './barcode/SerialNumberInput';
import { BarcodePreview } from './barcode/BarcodePreview';
import { BinLabelPrinter } from './barcode/BinLabelPrinter';

// Import utilities
import { normalizeSku, getSerialLast6 } from '@/utils/sku';
import { loadBarcodeLibrary, renderBarcode } from '@/utils/barcode';
import { printProductLabels } from '@/lib/print/printProductLabel';

declare global {
    interface Window {
        JsBarcode: any;
    }
}

export default function MultiSkuSnBarcode() {
    const [mode, setMode] = useState<BarcodeMode>('print');
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
    const [currentLocation, setCurrentLocation] = useState<string>("");

    const barcodeCanvasRef = useRef<HTMLCanvasElement>(null);
    const printRef = useRef<HTMLDivElement>(null);
    const skuInputRef = useRef<HTMLInputElement>(null);
    const snInputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        loadBarcodeLibrary()
            .then(() => setIsLibraryLoaded(true))
            .catch(err => console.error('Failed to load barcode library:', err));
    }, []);

    const renderBarcodeCanvas = useCallback((canvas: HTMLCanvasElement | null, value: string) => {
        if (!canvas || !isLibraryLoaded || !window.JsBarcode || !value.trim()) return;
        renderBarcode(canvas, value);
    }, [isLibraryLoaded]);

    useEffect(() => {
        if (mode === 'print' && step === 3) {
            renderBarcodeCanvas(barcodeCanvasRef.current, uniqueSku);
        }
    }, [uniqueSku, step, mode, renderBarcodeCanvas]);

    // Scroll to bottom when a new step becomes visible
    useEffect(() => {
        if (step >= 2) {
            setTimeout(() => {
                scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
            }, 50);
        }
    }, [step]);

    const handleSkuChange = (value: string) => {
        setSku(value);
        setUniqueSku("");
        setError("");
    };

    // Called when a SKU is injected from the right panel or clipboard paste
    const handleSkuFillAndSearch = useCallback(async (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        // Reset to step 1 clean state first
        setSku(trimmed);
        setUniqueSku("");
        setTitle("");
        setStock("");
        setSnInput("");
        setSerialNumbers([]);
        setStep(1);
        setError("");

        // Give React one tick to flush state, then kick off the lookup
        await new Promise(r => setTimeout(r, 0));

        // Inline the same logic as handleNextStepSku but with the fresh value
        setIsLoadingTitle(true);
        try {
            const baseSku = trimmed.includes(':') ? trimmed.split(':')[0] : trimmed;
            const res = await fetch(`/api/get-title-by-sku?sku=${encodeURIComponent(normalizeSku(baseSku))}`);
            const data = await res.json();
            setTitle(data.title || "Not found");
            setStock(data.stock || "0");
            setCurrentLocation(data.location || "");
            setLocation(data.location || "");
        } catch {
            setTitle("Error loading info");
        } finally {
            setIsLoadingTitle(false);
        }

        if (mode === 'reprint') {
            setUniqueSku(trimmed);
            setStep(3);
            return;
        }

        if (mode === 'print') {
            try {
                const res = await fetch(`/api/sku-manager?baseSku=${encodeURIComponent(normalizeSku(trimmed))}&action=current`);
                const data = await res.json();
                setUniqueSku(data.currentSku);
            } catch {
                console.error("Failed to pre-fetch SKU");
            }
        }

        setStep(2);
        setTimeout(() => snInputRef.current?.focus(), 100);
    }, [mode]);

    // Listen for sku:fill events dispatched by the right-panel SKU table
    useEffect(() => {
        const handler = (e: Event) => {
            const skuValue = (e as CustomEvent<{ sku: string }>).detail?.sku;
            if (skuValue) handleSkuFillAndSearch(skuValue);
        };
        window.addEventListener('sku:fill', handler);
        return () => window.removeEventListener('sku:fill', handler);
    }, [handleSkuFillAndSearch]);

    const fetchProductInfo = async (skuValue: string) => {
        setIsLoadingTitle(true);
        try {
            const baseSku = skuValue.includes(':') ? skuValue.split(':')[0] : skuValue;
            const res = await fetch(`/api/get-title-by-sku?sku=${encodeURIComponent(normalizeSku(baseSku))}`);
            const data = await res.json();
            setTitle(data.title || "Not found");
            setStock(data.stock || "0");
            setCurrentLocation(data.location || "");
            if (!location) setLocation(data.location || "");
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

        if (mode === 'reprint') {
            // Reprint exact same label value; no increment/current backend calls.
            setUniqueSku(sku.trim());
            setStep(3);
            return;
        }

        if (mode === 'print' && !uniqueSku) {
            setIsGenerating(true);
            try {
                const res = await fetch(`/api/sku-manager?baseSku=${encodeURIComponent(normalizeSku(sku))}&action=current`);
                const data = await res.json();
                setUniqueSku(data.currentSku);
            } catch (e) {
                console.error("Failed to pre-fetch SKU");
            } finally {
                setIsGenerating(true); // Should be false, wait I see a bug in the original code? 
                // Line 97 in original was setIsGenerating(false). 
                // Ah, I see line 97 was false. I'll fix it to false.
                setIsGenerating(false);
            }
        }

        setStep(2);
        setTimeout(() => snInputRef.current?.focus(), 100);
    };

    const handleNextStepSn = async (pendingSn?: string) => {
        const allSns = pendingSn ? [...serialNumbers, pendingSn] : serialNumbers;

        if (mode !== 'change-location' && allSns.length === 0) {
            setError("Serial numbers required");
            return;
        }

        // Flush any pending SN (typed/scanned but not yet Enter-confirmed) into state
        if (pendingSn) {
            setSerialNumbers(allSns);
            setSnInput(allSns.join(', '));
        }

        if (mode === 'print') {
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
        } else if (mode === 'reprint') {
            setUniqueSku(sku);
            setStep(3);
        } else {
            setUniqueSku(sku);
            setStep(3);
        }
    };

    const handleChangeSku = () => {
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

    const handleSnInputChange = (value: string) => {
        setSnInput(value);
        setSerialNumbers(value.split(',').map(s => s.trim()).filter(s => !!s));
    };

    // Called by SerialNumberInput on each Enter scan — appends a single SN
    const handleSnAdd = (sn: string) => {
        const trimmed = sn.trim();
        if (!trimmed) return;
        setSerialNumbers(prev => {
            const next = [...prev, trimmed];
            setSnInput(next.join(', '));
            return next;
        });
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
        if (mode === 'reprint') {
            // Just print, no DB/Sheet updates
            printProductLabels({ sku: uniqueSku, title, serialNumbers });
            setStep(1);
            setSku("");
            setUniqueSku("");
            setSerialNumbers([]);
            setSnInput("");
            return;
        }

        if (mode === 'change-location') {
            setIsPosting(true);
            try {
                const res = await fetch('/api/update-sku-location', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sku, location }),
                });
                const data = await res.json();
                if (data.success) {
                    setCurrentLocation(location);
                    setStep(1);
                    setSku("");
                    setLocation("");
                    setError("");
                } else {
                    setError(data.error || "Failed to update location");
                }
            } catch (e) {
                setError("Failed to update location");
            } finally {
                setIsPosting(false);
            }
            return;
        }

        const success = await postToSheets();
        if (success) {
            if (mode === 'print') {
                try {
                    await fetch(`/api/sku-manager?baseSku=${encodeURIComponent(normalizeSku(sku))}&action=increment`);
                } catch (e) {
                    console.error("Failed to increment SKU in DB:", e);
                }

                printProductLabels({ sku: uniqueSku, title, serialNumbers });
            }
            
            setSnInput("");
            setSerialNumbers([]);
            
            if (mode === 'print') {
                try {
                    const res = await fetch(`/api/sku-manager?baseSku=${encodeURIComponent(normalizeSku(sku))}&action=current`);
                    const data = await res.json();
                    setUniqueSku(data.currentSku);
                } catch (e) {
                    console.error("Failed to fetch next SKU:", e);
                }
            }
            
            setStep(2);
        } else {
            setError("Failed to save data");
        }
    };

    const handleModeChange = (newMode: BarcodeMode) => {
        setMode(newMode);
        setStep(1);
    };

    return (
        <div className="flex h-full min-w-0 flex-col bg-white text-gray-900">
            {/* Mode Selector — full-width tab slider */}
            <ModeSelector mode={mode} onModeChange={handleModeChange} />

            <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                {/* Step 1: SKU (hidden in bin-labels mode) */}
                {mode !== 'bin-labels' && (
                <SkuInput
                    sku={sku}
                    uniqueSku={uniqueSku}
                    mode={mode}
                    skuInputRef={skuInputRef}
                    isActive={step >= 1}
                    onChange={handleSkuChange}
                    onNext={handleNextStepSku}
                    onFillAndSearch={handleSkuFillAndSearch}
                />
                )}

                {/* Step 2: Serial Numbers & Details */}
                {mode !== 'reprint' && mode !== 'bin-labels' && step >= 2 && (
                    <SerialNumberInput
                        sku={sku}
                        mode={mode}
                        title={title}
                        stock={stock}
                        snInput={snInput}
                        serialNumbers={serialNumbers}
                        location={location}
                        currentLocation={currentLocation}
                        snInputRef={snInputRef}
                        isLoadingTitle={isLoadingTitle}
                        isActive={step >= 2}
                        showChangeSku={mode === 'print' && step === 2}
                        onSnInputChange={handleSnInputChange}
                        onSnAdd={handleSnAdd}
                        onLocationChange={setLocation}
                        onNext={handleNextStepSn}
                        onFinalAction={handleFinalAction}
                        isPosting={isPosting}
                        onChangeSku={handleChangeSku}
                    />
                )}

                {/* Step 3: Preview & Print */}
                {mode !== 'change-location' && mode !== 'bin-labels' && step >= 3 && (
                    <BarcodePreview
                        mode={mode}
                        uniqueSku={uniqueSku}
                        sku={sku}
                        title={title}
                        serialNumbers={serialNumbers}
                        notes={notes}
                        location={location}
                        showNotes={showNotes}
                        barcodeCanvasRef={barcodeCanvasRef}
                        isPosting={isPosting}
                        isActive={step >= 3}
                        getSerialLast6={getSerialLast6}
                        onToggleNotes={() => setShowNotes(!showNotes)}
                        onNotesChange={setNotes}
                        onPrint={handleFinalAction}
                    />
                )}

                {/* Bin Labels mode: standalone bulk printer */}
                {mode === 'bin-labels' && (
                    <BinLabelPrinter isActive={true} />
                )}
            </div>

            {error && (
                <div
                    className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-5 py-2.5 text-xs font-black uppercase tracking-widest shadow-lg"
                    onClick={() => setError("")}
                >
                    {error}
                </div>
            )}
        </div>
    );
}
