/**
 * Barcode generation and rendering utilities
 */

declare global {
    interface Window {
        JsBarcode: any;
    }
}

export interface BarcodeOptions {
    format?: string;
    lineColor?: string;
    background?: string;
    width?: number;
    height?: number;
    displayValue?: boolean;
    margin?: number;
}

/**
 * Default barcode configuration
 */
export const DEFAULT_BARCODE_CONFIG: BarcodeOptions = {
    format: 'CODE128',
    lineColor: '#000000',
    background: '#ffffff',
    width: 2,
    height: 50,
    displayValue: false,
    margin: 6,
};

/**
 * Load JsBarcode library dynamically
 * @returns Promise that resolves when library is loaded
 */
export function loadBarcodeLibrary(): Promise<void> {
    return new Promise((resolve, reject) => {
        // Check if already loaded
        if (window.JsBarcode) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load JsBarcode library'));
        document.head.appendChild(script);
    });
}

/**
 * Render a barcode on a canvas element
 * @param canvas - The canvas element to render on
 * @param value - The value to encode
 * @param options - Optional barcode configuration
 * @returns True if successful, false otherwise
 */
export function renderBarcode(
    canvas: HTMLCanvasElement | null,
    value: string,
    options: BarcodeOptions = {}
): boolean {
    if (!canvas || !window.JsBarcode || !value.trim()) {
        return false;
    }

    try {
        const config = { ...DEFAULT_BARCODE_CONFIG, ...options };
        window.JsBarcode(canvas, value, config);
        return true;
    } catch (error) {
        console.warn('Barcode rendering failed:', error);
        return false;
    }
}

/**
 * Check if JsBarcode library is loaded
 * @returns True if library is available
 */
export function isBarcodeLibraryLoaded(): boolean {
    return typeof window !== 'undefined' && !!window.JsBarcode;
}

/**
 * Generate barcode as data URL
 * @param value - The value to encode
 * @param options - Optional barcode configuration
 * @returns Data URL of the barcode image, or null if failed
 */
export function generateBarcodeDataUrl(
    value: string,
    options: BarcodeOptions = {}
): string | null {
    const canvas = document.createElement('canvas');
    const success = renderBarcode(canvas, value, options);
    return success ? canvas.toDataURL('image/png') : null;
}
