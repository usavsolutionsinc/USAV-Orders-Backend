'use client';

import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Import refactored sub-components
import { ModeSelector, BarcodeMode } from './barcode/ModeSelector';
import { SkuInput } from './barcode/SkuInput';
import { SerialNumberInput } from './barcode/SerialNumberInput';
import { BarcodePreview } from './barcode/BarcodePreview';

// Import utilities
import { normalizeSku, getSerialLast6 } from '@/utils/sku';
import { loadBarcodeLibrary, renderBarcode } from '@/utils/barcode';

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

    const handleSkuChange = (value: string) => {
        setSku(value);
        setUniqueSku("");
        setError("");
    };

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

    const handleNextStepSn = async () => {
        if (mode !== 'change-location' && serialNumbers.length === 0) {
            setError("Serial numbers required");
            return;
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
            printLabel(uniqueSku, title, serialNumbers);
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
                
                printLabel(uniqueSku, title, serialNumbers);
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

    const printLabel = (skuToPrint: string, titleToPrint: string, snList: string[]) => {
        const printWindow = window.open('', '', 'width=800,height=600');
        if (printWindow) {
            const html = `
                <html>
                    <head>
                        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
                        <style>
                            body { font-family: Arial, sans-serif; padding: 0; margin: 0; text-align: center; }
                            canvas { margin: 2px 0; }
                            .sku { font-size: 22px; font-weight: bold; margin: 2px 0; }
                            .title { font-size: 11px; color: #666; margin: 2px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; padding: 0 4px; }
                            .sn { font-size: 10px; color: #999; margin: 2px 0; }
                        </style>
                    </head>
                    <body>
                        <canvas id="barcode"></canvas>
                        <div class="sku">${skuToPrint}</div>
                        <div class="title">${titleToPrint}</div>
                        ${snList.length > 0 ? `<div class="sn">SN: ${getSerialLast6(snList)}</div>` : ''}
                        <script>
                            window.onload = function() {
                                JsBarcode("#barcode", "${skuToPrint}", {
                                    format: "CODE128",
                                    lineColor: "#000",
                                    width: 2,
                                    height: 50,
                                    displayValue: false
                                });
                                setTimeout(() => { window.print(); window.close(); }, 500);
                            };
                        </script>
                    </body>
                </html>
            `;
            printWindow.document.write(html);
            printWindow.document.close();
        }
    };

    const handleModeChange = (newMode: BarcodeMode) => {
        setMode(newMode);
        setStep(1);
    };

    return (
        <div className="h-full flex flex-col bg-white text-gray-900">
            {/* Mode Selector - Using Refactored Component */}
            <ModeSelector mode={mode} onModeChange={handleModeChange} />

            <div className="flex-1 overflow-hidden p-8 relative">
                <motion.div 
                    animate={{ y: step === 1 ? 0 : step === 2 ? -280 : -600 }}
                    transition={{ type: 'spring', damping: 30, stiffness: 200 }}
                    className="space-y-12 pb-40"
                >
                    {/* Step 1: SKU - Using Refactored Component */}
                    <motion.div
                        animate={{ 
                            opacity: step === 1 ? 1 : 0.4,
                            scale: step === 1 ? 1 : 0.95,
                            filter: step === 1 ? 'blur(0px)' : 'blur(2px)'
                        }}
                    >
                        <SkuInput
                            sku={sku}
                            uniqueSku={uniqueSku}
                            mode={mode}
                            skuInputRef={skuInputRef}
                            isActive={step >= 1}
                            onChange={handleSkuChange}
                            onNext={handleNextStepSku}
                        />
                    </motion.div>

                    {/* Step 2: Serial Numbers & Details - Using Refactored Component */}
                    {mode !== 'reprint' && (
                        <motion.div
                            animate={{ 
                                opacity: step === 2 ? 1 : 0.4,
                                scale: step === 2 ? 1 : 0.95,
                                filter: step === 2 ? 'blur(0px)' : 'blur(2px)'
                            }}
                        >
                            <SerialNumberInput
                                sku={sku}
                                mode={mode}
                                title={title}
                                stock={stock}
                                snInput={snInput}
                                location={location}
                                currentLocation={currentLocation}
                                snInputRef={snInputRef}
                                isLoadingTitle={isLoadingTitle}
                                isActive={step >= 2}
                                showChangeSku={mode === 'print' && step === 2}
                                onSnInputChange={handleSnInputChange}
                                onLocationChange={setLocation}
                                onNext={handleNextStepSn}
                                onFinalAction={handleFinalAction}
                                isPosting={isPosting}
                                onChangeSku={handleChangeSku}
                            />
                        </motion.div>
                    )}

                    {/* Step 3: Preview & Print - Using Refactored Component */}
                    {mode !== 'change-location' && (
                        <motion.div
                            animate={{ 
                                opacity: step === 3 ? 1 : 0.4,
                                scale: step === 3 ? 1 : 0.95,
                                filter: step === 3 ? 'blur(0px)' : 'blur(2px)'
                            }}
                        >
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
                        </motion.div>
                    )}
                </motion.div>
            </div>

            {error && (
                <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-xl">
                    {error}
                </div>
            )}
        </div>
    );
}
