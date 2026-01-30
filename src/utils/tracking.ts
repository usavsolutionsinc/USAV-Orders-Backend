/**
 * Carrier detection and tracking utilities
 */

export type Carrier = 'UPS' | 'USPS' | 'FedEx' | 'DHL' | 'AMAZON' | 'Unknown';

/**
 * Determine the carrier based on tracking number format
 * Mirroring Working GAS detectCarrier logic
 * @param tracking - The tracking number to analyze
 * @returns The detected carrier
 */
export function getCarrier(tracking: string): Carrier {
    const t = tracking.trim().toUpperCase();
    
    if (t.startsWith('1Z')) return 'UPS';
    if (t.startsWith('94') || t.startsWith('92') || t.startsWith('93') || t.startsWith('42') || t.startsWith('04')) return 'USPS';
    if (t.startsWith('96')) return 'FedEx';
    if (t.startsWith('JD') || t.startsWith('JJD')) return 'DHL';
    if (t.startsWith('TBA')) return 'AMAZON';
    
    // Fallback for numeric only formats
    if (/^\d{12}$|^\d{15}$/.test(t)) return 'FedEx';
    if (/^\d{20,22}$/.test(t)) return 'USPS';
    
    return 'Unknown';
}

/**
 * Format tracking number for display (show last 8 digits)
 * @param tracking - The tracking number
 * @returns Formatted tracking number
 */
export function formatTrackingNumber(tracking: string): string {
    if (!tracking) return '';
    return tracking.length > 8 ? tracking.slice(-8) : tracking;
}

/**
 * Validate if a tracking number contains actual numbers
 * @param tracking - The tracking number to validate
 * @returns True if tracking contains at least one digit
 */
export function hasNumbers(str: string): boolean {
    if (!str) return false;
    return /\d/.test(String(str));
}

/**
 * Get the last 8 characters of a string (useful for tracking comparisons)
 * @param str - The string to process
 * @returns Last 8 characters in lowercase
 */
export function getLastEightDigits(str: string): string {
    if (!str) return '';
    return String(str).trim().slice(-8).toLowerCase();
}

/**
 * Clean and normalize tracking number (remove non-alphanumeric, uppercase)
 * @param tracking - The tracking number to clean
 * @returns Cleaned tracking number
 */
export function cleanTrackingNumber(tracking: string): string {
    return tracking.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}
