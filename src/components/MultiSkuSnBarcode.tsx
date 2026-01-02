'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";

declare global {
    interface Window {
        JsBarcode: any;
    }
}

interface Props {
    apiBaseUrl?: string;
    sheetTitleFallback?: string;
    lineColor?: string;
    backgroundColor?: string;
}

interface ApiResponse {
    success?: boolean;
    error?: string;
    title?: string;
    currentSku?: string;
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

export default function MultiSkuSnBarcode({
    apiBaseUrl = "https://stripe-checkout-server-three.vercel.app",
    sheetTitleFallback = "",
    lineColor = "#000000",
    backgroundColor = "#FFFFFF",
}: Props) {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [sku, setSku] = useState<string>("");
    const [snInput, setSnInput] = useState<string>("");
    const [serialNumbers, setSerialNumbers] = useState<string[]>([]);
    const [uniqueSku, setUniqueSku] = useState<string>("");
    const [title, setTitle] = useState<string>(sheetTitleFallback);
    const [stock, setStock] = useState<string>("");
    const [isLibraryLoaded, setIsLibraryLoaded] = useState<boolean>(false);
    const [loadingAttempts, setLoadingAttempts] = useState<number>(0);
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

    const makeApiCall = useCallback(async (endpoint: string, options?: RequestInit): Promise<ApiResponse> => {
        if (!apiBaseUrl) {
            throw new Error('API base URL not configured');
        }

        try {
            const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${endpoint}`, {
                headers: {
                    'Content-Type': 'application/json',
                },
                mode: 'cors',
                credentials: 'omit',
                ...options,
            });

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    if (errorData?.error) {
                        errorMessage = errorData.error;
                    }
                } catch (e) {
                    // Use default error message
                }
                throw new Error(errorMessage);
            }

            return await response.json();
        } catch (error) {
            console.error(`API call failed for ${endpoint}:`, error);
            throw error;
        }
    }, [apiBaseUrl]);

    const getCurrentSkuFromDB = useCallback(async (baseSku: string): Promise<string> => {
        if (!baseSku) return "";

        try {
            const normalizedSku = normalizeSku(baseSku);
            const data = await makeApiCall(`/api/sku-manager?baseSku=${encodeURIComponent(normalizedSku)}&action=current`);
            return data.currentSku || "";
        } catch (error) {
            console.error('Error getting current SKU:', error);
            return "";
        }
    }, [normalizeSku, makeApiCall]);

    const incrementSkuInDB = useCallback(async (baseSku: string): Promise<boolean> => {
        if (!baseSku) return false;

        try {
            const normalizedSku = normalizeSku(baseSku);
            await makeApiCall(`/api/sku-manager?baseSku=${encodeURIComponent(normalizedSku)}&action=increment`);
            return true;
        } catch (error) {
            console.error('Error incrementing SKU:', error);
            return false;
        }
    }, [normalizeSku, makeApiCall]);

    useEffect(() => {
        const load = () => {
            if (typeof window !== "undefined") {
                if (window.JsBarcode) {
                    setIsLibraryLoaded(true);
                    return;
                }
                if (loadingAttempts < 50) {
                    setLoadingAttempts((p) => p + 1);
                    setTimeout(load, 100);
                } else {
                    const existing = document.querySelector('script[src*="jsbarcode"]');
                    if (!existing) {
                        const script = document.createElement("script");
                        script.src = "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js";
                        script.onload = () => setIsLibraryLoaded(true);
                        document.head.appendChild(script);
                    }
                }
            }
        };
        load();
    }, [loadingAttempts]);

    const renderBarcode = useCallback((canvas: HTMLCanvasElement | null, value: string) => {
        if (!canvas || !isLibraryLoaded || !window.JsBarcode || !value.trim()) return;

        try {
            window.JsBarcode(canvas, value, {
                format: "CODE128",
                lineColor,
                background: backgroundColor,
                width: 2,
                height: 50,
                displayValue: false,
                margin: 6,
            });
        } catch (error) {
            console.warn('Barcode rendering failed:', error);
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }
    }, [isLibraryLoaded, lineColor, backgroundColor]);

    const barcodeConfig = useMemo(() => ({
        format: "CODE128",
        lineColor,
        background: backgroundColor,
        width: 2,
        height: 25,
        displayValue: false,
        margin: 0,
    }), [lineColor, backgroundColor]);

    useEffect(() => {
        renderBarcode(barcodeCanvasRef.current, uniqueSku);
    }, [uniqueSku, renderBarcode]);

    const fetchTitleAndStock = useCallback(async (skuValue: string): Promise<{ title: string, stock: string }> => {
        if (!skuValue) {
            return { title: sheetTitleFallback || "", stock: "0" };
        }

        try {
            const normalizedSku = normalizeSku(skuValue);
            const data = await makeApiCall(`/api/get-title-by-sku?sku=${encodeURIComponent(normalizedSku)}`);
            return {
                title: data.title || sheetTitleFallback || "",
                stock: data.stock !== undefined && data.stock !== null ? String(data.stock) : "0"
            };
        } catch (error) {
            console.error('Title/Stock fetch error:', error);
            throw new Error("Failed to load product information");
        }
    }, [sheetTitleFallback, normalizeSku, makeApiCall]);

    const fetchTitle = useCallback(async (skuValue: string): Promise<string> => {
        const result = await fetchTitleAndStock(skuValue);
        return result.title;
    }, [fetchTitleAndStock]);

    const handleSkuChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setSku(e.target.value);
        setError("");
    }, []);

    const handleNextStepSku = useCallback(async () => {
        if (!sku.trim()) {
            setError("Please enter a SKU first");
            return;
        }

        setStep(2);
        setError("");
        setIsLoadingTitle(true);

        try {
            const result = await fetchTitleAndStock(sku);
            setTitle(result.title);
            setStock(result.stock);
        } catch (error) {
            console.error('Error fetching title/stock:', error);
            setTitle(sheetTitleFallback);
            setStock("0");
        } finally {
            setIsLoadingTitle(false);
        }

        setTimeout(() => {
            snInputRef.current?.focus();
        }, 100);
    }, [sku, fetchTitleAndStock, sheetTitleFallback]);

    const handleChangeSku = useCallback(() => {
        setStep(1);
        setSnInput("");
        setSerialNumbers([]);
        setUniqueSku("");
        setTitle(sheetTitleFallback);
        setStock("");
        setError("");

        setTimeout(() => {
            skuInputRef.current?.focus();
            skuInputRef.current?.select();
        }, 100);
    }, [sheetTitleFallback]);

    const handleChangeSn = useCallback(() => {
        setStep(2);
        setUniqueSku("");
        setIsGenerating(false);
        setError("");

        setTimeout(() => {
            snInputRef.current?.focus();
        }, 100);
    }, []);

    const handleSnInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (step !== 2) return;

        const value = e.target.value;
        setSnInput(value);

        const sns = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
        setSerialNumbers(sns);
        setError("");
    }, [step]);

    const handleSnKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            setSnInput((prev) => (prev.endsWith(', ') || prev === '' ? prev : prev + ', '));
        }
    }, []);

    const handleSkuKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (step === 1 && sku.trim()) {
                handleNextStepSku();
            }
        }
    }, [sku, step, handleNextStepSku]);

    const handleNextStepSn = useCallback(async () => {
        if (!sku || serialNumbers.length === 0) {
            setError("SKU and at least one serial number are required");
            return;
        }

        setIsGenerating(true);
        setError("");

        try {
            const fetchedTitle = await fetchTitle(sku);
            const currentSku = await getCurrentSkuFromDB(sku);

            if (!currentSku) {
                throw new Error("Failed to generate SKU - database connection issue");
            }

            setTitle(fetchedTitle);
            setUniqueSku(currentSku);
            setStep(3);
            setError("");
        } catch (error) {
            console.error('Generate label error:', error);
            setError(error instanceof Error ? error.message : "Failed to generate label");
        } finally {
            setIsGenerating(false);
        }
    }, [sku, serialNumbers, fetchTitle, getCurrentSkuFromDB]);

    const postToSheets = useCallback(async (): Promise<boolean> => {
        if (!uniqueSku || serialNumbers.length === 0) return false;

        const payload: PostDataPayload = {
            sku: uniqueSku,
            serialNumbers,
            notes: notes.trim(),
            productTitle: title,
            size: selectedSize,
            location: location.trim()
        };

        try {
            setIsPosting(true);
            const response = await makeApiCall('/api/post-multi-sn', {
                method: 'POST',
                body: JSON.stringify(payload),
            });

            return response.success === true;
        } catch (error) {
            console.error('Post error:', error);
            return false;
        } finally {
            setIsPosting(false);
        }
    }, [uniqueSku, serialNumbers, notes, title, selectedSize, location, makeApiCall]);

    const createPrintHtml = useCallback(() => {
        const serialDisplay = serialNumbers.length > 0
            ? `<div class="serial-text">SN: ${getSerialLast6(serialNumbers)}</div>`
            : '';

        return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
    <style>
      @page { size: auto; margin: 0; }
      html, body { padding: 0; margin: 0; }
      .print-label { 
        width: 100%; 
        max-width: 480px; 
        margin: 0 auto; 
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0;
        padding: 10px 2px 0 2px;
        background: #fff;
        color: #000;
      }
      .barcode { max-width: 100%; margin: 0; }
      .sku-text { 
        text-align: center;
        width: 100%;
        font-family: monospace; 
        font-size: 12px;
        margin: 0 0 2px 0;
      }
      .title-text { 
        text-align: center;
        width: 100%;
        font-family: Arial; 
        font-size: 16px; 
        margin: 0 0 1px 0;
      }
      .serial-text {
        text-align: center;
        width: 100%;
        font-family: monospace; 
        font-size: 12px; 
        margin: 0;
      }
    </style>
  </head>
  <body>
    <div class="print-label">
      <canvas id="barcode" class="barcode"></canvas>
      <div class="sku-text">${uniqueSku || ''}</div>
      <div class="title-text">${title || ''}</div>
      ${serialDisplay}
    </div>
    <script>
      window.onload = function() {
        try {
          if (window.JsBarcode && '${uniqueSku}') {
            JsBarcode('#barcode', '${uniqueSku}', ${JSON.stringify(barcodeConfig)});
          }
        } catch (e) {
          console.error('Barcode generation error:', e);
        }
        
        setTimeout(function() {
          window.focus();
          window.print();
          setTimeout(function(){ window.close(); }, 50);
        }, 100);
      };
    <\/script>
  </body>
</html>`;
    }, [uniqueSku, title, serialNumbers, getSerialLast6, barcodeConfig]);

    const printLabelFn = useCallback(async () => {
        if (!printRef.current) return;

        const printWindow = window.open('', '', 'width=800,height=600,menubar=no,toolbar=no,location=no,status=no,scrollbars=no');

        if (!printWindow) {
            const originalContent = document.body.innerHTML;
            const printContent = printRef.current.outerHTML;

            document.body.innerHTML = printContent;
            window.print();
            document.body.innerHTML = originalContent;
            return;
        }

        try {
            printWindow.document.open();
            printWindow.document.write(createPrintHtml());
            printWindow.document.close();
        } catch (error) {
            console.error('Print window error:', error);
            printWindow.close();
        }
    }, [createPrintHtml]);

    const onPrint = useCallback(async () => {
        if (step !== 3 || !uniqueSku || !sku || serialNumbers.length === 0) {
            setError("Please complete all steps first");
            return;
        }

        try {
            const posted = await postToSheets();
            if (!posted) {
                setError("Failed to save to Google Sheets");
                return;
            }

            const incremented = await incrementSkuInDB(sku);
            if (!incremented) {
                console.warn('Failed to increment SKU in database');
            }

            await printLabelFn();
        } catch (error) {
            setError(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }, [step, uniqueSku, sku, serialNumbers, postToSheets, incrementSkuInDB, printLabelFn]);

    const containerStyle: React.CSSProperties = {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        alignItems: "center",
        justifyContent: "flex-start",
        backgroundColor,
        color: lineColor,
        padding: 12,
        boxSizing: "border-box",
        overflowY: "auto",
    };

    const inputStyle: React.CSSProperties = {
        padding: "8px 12px",
        border: `1px solid ${lineColor}`,
        borderRadius: 4,
        background: "#fff",
        color: "#000",
        fontFamily: "monospace",
        fontSize: 14,
    };

    const buttonStyle: React.CSSProperties = {
        padding: "6px 12px",
        border: `1px solid ${lineColor}`,
        borderRadius: 4,
        background: "#f5f5f5",
        color: "#000",
        cursor: "pointer",
        fontSize: 12,
    };

    return (
        <div style={containerStyle}>
            {step === 1 && (
                <>
                    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
                        <div style={{ fontSize: 16, fontWeight: "bold", color: lineColor, marginBottom: 4 }}>
                            Step 1: Enter SKU
                        </div>

                        <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "stretch" }}>
                            <input
                                ref={skuInputRef}
                                value={sku}
                                onChange={handleSkuChange}
                                onKeyDown={handleSkuKeyDown}
                                placeholder="Enter SKU"
                                autoFocus
                                style={{ flex: 1, ...inputStyle, fontSize: 16, padding: "12px 16px" }}
                            />
                            <button
                                onClick={handleNextStepSku}
                                disabled={!sku.trim()}
                                style={{
                                    ...buttonStyle,
                                    padding: "12px 24px",
                                    fontSize: 14,
                                    fontWeight: "bold",
                                    background: sku.trim() ? "#4CAF50" : "#ccc",
                                    color: sku.trim() ? "#fff" : "#666",
                                    cursor: sku.trim() ? "pointer" : "not-allowed",
                                    minWidth: "120px",
                                }}
                            >
                                Next Step →
                            </button>
                        </div>

                        {sku.trim() && (
                            <div style={{ fontSize: 12, color: "#666", fontStyle: "italic" }}>
                                Press Enter or click "Next Step" to continue
                            </div>
                        )}
                    </div>

                    {error && (
                        <div style={{
                            color: "#d00",
                            fontSize: 12,
                            textAlign: "center",
                            fontWeight: "bold",
                            padding: "8px",
                            background: "#ffebee",
                            borderRadius: 4,
                            width: "100%"
                        }}>
                            {error}
                        </div>
                    )}
                </>
            )}

            {step >= 2 && (
                <>
                    <div style={{ width: "100%", marginBottom: 8, paddingBottom: 8, borderBottom: `2px solid ${lineColor}20` }}>
                        <div style={{ fontSize: 16, fontWeight: "bold", color: lineColor }}>
                            {step === 2 ? "Step 2: Enter Details" : "Step 3: Label Generated"}
                        </div>
                    </div>

                    <div style={{
                        display: "flex",
                        gap: 8,
                        width: "100%",
                        alignItems: "center",
                        padding: "12px",
                        background: "#f8f9fa",
                        borderRadius: 6,
                        border: `1px solid ${lineColor}30`
                    }}>
                        <div style={{
                            flex: 1,
                            padding: "8px 12px",
                            background: "#fff",
                            borderRadius: 4,
                            border: `1px solid ${lineColor}40`,
                            fontWeight: "bold",
                            fontSize: 14,
                            color: lineColor,
                        }}>
                            {sku}
                        </div>

                        <button
                            onClick={handleChangeSku}
                            style={{ ...buttonStyle, background: "#e0e0e0", color: "#000", fontWeight: "bold", padding: "8px 16px" }}
                        >
                            Change SKU
                        </button>
                    </div>

                    <div style={{
                        width: "100%",
                        padding: "12px",
                        background: "#fff",
                        borderRadius: 6,
                        border: `1px solid ${lineColor}30`,
                        marginBottom: 8
                    }}>
                        <div style={{ fontSize: 13, fontWeight: "600", color: lineColor, marginBottom: 6 }}>
                            Product Title:
                        </div>
                        {isLoadingTitle ? (
                            <div style={{ fontSize: 14, color: "#666", fontStyle: "italic" }}>Loading...</div>
                        ) : (
                            <div style={{ fontSize: 14, color: "#333", lineHeight: "1.4", marginBottom: 8 }}>
                                {title && title !== sheetTitleFallback ? title : "Not found in Google Sheets"}
                            </div>
                        )}

                        {!isLoadingTitle && (
                            <div style={{
                                fontSize: 14,
                                fontWeight: "bold",
                                color: parseInt(stock || "0") > 0 ? lineColor : "#d32f2f",
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop: `1px solid ${lineColor}20`
                            }}>
                                {stock || "0"} - Current Stock
                            </div>
                        )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <label style={{ fontSize: 14, fontWeight: "600", color: lineColor, marginLeft: 4 }}>
                                Serial Numbers <span style={{ color: "#666", fontWeight: "normal" }}>(required)</span>
                            </label>

                            {step === 3 && (
                                <button
                                    onClick={handleChangeSn}
                                    style={{ ...buttonStyle, background: "#ff9800", color: "#fff", padding: "4px 8px", fontSize: 11 }}
                                >
                                    Change SN
                                </button>
                            )}
                        </div>

                        {step === 2 ? (
                            <input
                                ref={snInputRef}
                                value={snInput}
                                onChange={handleSnInputChange}
                                onKeyDown={handleSnKeyDown}
                                placeholder="Serial Numbers (SN123, SN456)"
                                style={{ ...inputStyle, fontSize: 14, padding: "10px 14px" }}
                            />
                        ) : (
                            <div style={{
                                padding: "10px 14px",
                                background: "#f0f0f0",
                                border: `1px solid ${lineColor}20`,
                                borderRadius: 4,
                                color: "#333",
                                fontSize: 14
                            }}>
                                {serialNumbers.join(', ')}
                            </div>
                        )}

                        {step === 2 && (
                            <div style={{ fontSize: 11, color: "#666", marginLeft: 4, fontStyle: "italic" }}>
                                Press Enter after each serial number to add a comma
                            </div>
                        )}
                    </div>

                    <div style={{
                        width: "100%",
                        padding: "12px",
                        background: "#f8f9fa",
                        borderRadius: 6,
                        border: `1px solid ${lineColor}20`,
                        marginTop: 8
                    }}>
                        <div style={{ fontSize: 13, fontWeight: "600", color: "#666", marginBottom: 12 }}>
                            Optional Fields
                        </div>

                        <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "center", marginBottom: 12 }}>
                            <label style={{ minWidth: "60px", fontSize: 14, fontWeight: "500" }}>Size:</label>
                            {["Small", "Medium", "Big"].map((size) => {
                                let bgColor = "#f5f5f5";
                                let textColor = "#000";

                                if (selectedSize === size) {
                                    if (size === "Small") bgColor = "#4CAF50";
                                    else if (size === "Medium") bgColor = "#ff9800";
                                    else if (size === "Big") bgColor = "#f44336";
                                    textColor = "#fff";
                                }

                                return (
                                    <button
                                        key={size}
                                        onClick={() => setSelectedSize(size)}
                                        style={{
                                            ...buttonStyle,
                                            background: bgColor,
                                            color: textColor,
                                            flex: 1,
                                            padding: "10px",
                                            fontSize: 13,
                                            fontWeight: selectedSize === size ? "bold" : "normal",
                                        }}
                                    >
                                        {size}
                                    </button>
                                );
                            })}
                        </div>

                        <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "center" }}>
                            <label style={{ minWidth: "60px", fontSize: 14, fontWeight: "500" }}>Location:</label>
                            <input
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                placeholder="Enter location"
                                style={{ flex: 1, ...inputStyle, fontSize: 13 }}
                            />
                        </div>
                    </div>

                    <div style={{ width: "100%", marginTop: 8 }}>
                        <button
                            onClick={() => setShowNotes(!showNotes)}
                            style={{
                                ...buttonStyle,
                                background: showNotes ? "#e0e0e0" : "#f5f5f5",
                                color: "#000",
                                padding: "6px 12px",
                                fontSize: 12,
                                width: "100%"
                            }}
                        >
                            {showNotes ? "Hide Notes" : "Add Notes"}
                        </button>
                        {showNotes && (
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Enter notes..."
                                style={{
                                    width: "100%",
                                    height: "60px",
                                    resize: "vertical",
                                    ...inputStyle,
                                    marginTop: 8
                                }}
                            />
                        )}
                    </div>

                    {serialNumbers.length > 0 && step === 2 && (
                        <div style={{
                            width: "100%",
                            padding: "8px",
                            background: "#e8f5e9",
                            borderRadius: 6,
                            border: `1px solid #4CAF50`,
                            fontSize: 12,
                            color: "#2e7d32",
                            marginTop: 8
                        }}>
                            {serialNumbers.length} Serial Number{serialNumbers.length > 1 ? 's' : ''} Entered
                        </div>
                    )}

                    {error && (
                        <div style={{ color: "#d00", fontSize: 12, textAlign: "center", fontWeight: "bold", marginTop: 8 }}>{error}</div>
                    )}

                    {step === 2 && (
                        <div style={{ display: "flex", gap: 8, width: "100%", marginTop: 12 }}>
                            <button
                                onClick={handleNextStepSn}
                                disabled={isGenerating || !sku || serialNumbers.length === 0}
                                style={{
                                    flex: 1,
                                    ...buttonStyle,
                                    background: (isGenerating || !sku || serialNumbers.length === 0) ? "#ccc" : "#4CAF50",
                                    color: (isGenerating || !sku || serialNumbers.length === 0) ? "#666" : "#fff",
                                    cursor: (isGenerating || !sku || serialNumbers.length === 0) ? "not-allowed" : "pointer",
                                    fontWeight: "bold",
                                    padding: "12px 24px",
                                    fontSize: 14,
                                    minWidth: "160px",
                                }}
                            >
                                {isGenerating ? "Generating..." : "Next Step →"}
                            </button>
                        </div>
                    )}

                    {step === 3 && (
                        <div style={{ width: "100%", marginTop: 12 }}>
                            <button
                                onClick={onPrint}
                                disabled={isPosting || !!error || !uniqueSku}
                                style={{
                                    width: "100%",
                                    ...buttonStyle,
                                    background: (isPosting || error || !uniqueSku) ? "#ccc" : "#2196F3",
                                    color: (isPosting || error || !uniqueSku) ? "#666" : "#fff",
                                    cursor: (isPosting || error || !uniqueSku) ? "not-allowed" : "pointer",
                                    fontWeight: "bold",
                                    padding: "12px 24px",
                                    fontSize: 14,
                                }}
                            >
                                {isPosting ? "Saving..." : error ? "Cannot Print" : "Print Label"}
                            </button>
                        </div>
                    )}

                    {step === 3 && (
                        <div
                            ref={printRef}
                            className="print-label"
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 0,
                                padding: 8,
                                background: "#fff",
                                color: "#000",
                                width: "100%",
                                maxWidth: 480,
                                boxShadow: "0 0 0 1px rgba(0,0,0,0.1)",
                                marginTop: 16
                            }}
                        >
                            {uniqueSku ? (
                                <canvas ref={barcodeCanvasRef} style={{ maxWidth: "100%" }} />
                            ) : (
                                <div style={{ height: 50 }} />
                            )}
                            <div style={{ fontFamily: "monospace", marginTop: 0, marginBottom: 4 }}>{uniqueSku}</div>
                            <div style={{ fontFamily: "Arial", fontSize: 14, textAlign: "center", marginTop: 0, marginBottom: 2 }}>
                                {title}
                            </div>
                            {serialNumbers.length > 0 && (
                                <div style={{
                                    fontFamily: "monospace",
                                    fontSize: 12,
                                    textAlign: "center",
                                    marginTop: 2,
                                    marginBottom: 4,
                                    color: "#333"
                                }}>
                                    SN: {getSerialLast6(serialNumbers)}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

