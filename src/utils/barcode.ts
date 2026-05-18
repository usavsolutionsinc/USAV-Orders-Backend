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

// ─── QR CODE (GS1 Digital Link) ─────────────────────────────────────────────
//
// Used by the unit-label flow (MultiSkuSnBarcode, BarcodePreview,
// printProductLabel). 1D barcode helpers above remain in service for
// receiving labels, walk-in receipts, and ProductLabelPreview.
//
// The `qrcode` npm package is dynamically imported so its ~30KB doesn't
// land in the initial JS bundle for pages that don't print labels.

export interface QrOptions {
    /** Pixel width of the rendered QR. Library auto-scales modules to fit. */
    width?: number;
    /** Error correction level. 'M' is the default; bump to 'H' if labels
     *  will be physically damaged in use. */
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    /** Quiet-zone width in modules. GS1 minimum is 4. */
    margin?: number;
    /** Foreground / background color. */
    color?: { dark?: string; light?: string };
}

export const DEFAULT_QR_OPTIONS: QrOptions = {
    width: 200,
    errorCorrectionLevel: 'M',
    margin: 4,
    color: { dark: '#000000', light: '#ffffff' },
};

let cachedQrLib: typeof import('qrcode') | null = null;

/**
 * Dynamically import the qrcode library. Cached after first call.
 */
export async function loadQrLibrary(): Promise<typeof import('qrcode')> {
    if (cachedQrLib) return cachedQrLib;
    const mod = await import('qrcode');
    cachedQrLib = mod;
    return mod;
}

/**
 * Render a QR onto a canvas. Returns true on success.
 */
export async function renderQr(
    canvas: HTMLCanvasElement | null,
    payload: string,
    options: QrOptions = {},
): Promise<boolean> {
    if (!canvas || !payload || !payload.trim()) return false;
    try {
        const QR = await loadQrLibrary();
        const config = { ...DEFAULT_QR_OPTIONS, ...options };
        await QR.toCanvas(canvas, payload, {
            width: config.width,
            margin: config.margin,
            errorCorrectionLevel: config.errorCorrectionLevel,
            color: config.color,
        });
        return true;
    } catch (err) {
        console.warn('QR rendering failed:', err);
        return false;
    }
}

/**
 * Generate a QR as a PNG data URL. Useful for print templates and
 * server-side rendering.
 */
export async function generateQrDataUrl(
    payload: string,
    options: QrOptions = {},
): Promise<string | null> {
    if (!payload || !payload.trim()) return null;
    try {
        const QR = await loadQrLibrary();
        const config = { ...DEFAULT_QR_OPTIONS, ...options };
        return await QR.toDataURL(payload, {
            width: config.width,
            margin: config.margin,
            errorCorrectionLevel: config.errorCorrectionLevel,
            color: config.color,
        });
    } catch (err) {
        console.warn('QR data-URL generation failed:', err);
        return null;
    }
}
