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
    if (t.startsWith('96') || t.startsWith('39')) return 'FedEx';
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

/**
 * Build a carrier tracking URL when the carrier is already known (e.g. from a
 * stored "status" field in receiving logs). Falls back to a Google search when
 * the carrier is unrecognised.
 *
 * @param tracking - The full tracking number
 * @param carrier  - Carrier string as stored in the DB ("UPS", "FedEx", "USPS", etc.)
 * @returns Tracking URL string
 */
export function getTrackingUrlByCarrier(tracking: string, carrier: string): string {
    const c = String(carrier || '').toUpperCase().trim();
    if (c.includes('UPS'))    return `https://www.ups.com/track?tracknum=${tracking}`;
    if (c.includes('FEDEX'))  return `https://www.fedex.com/apps/fedextrack/?tracknumbers=${tracking}`;
    if (c.includes('USPS'))   return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`;
    if (c.includes('DHL'))    return `https://www.dhl.com/en/express/tracking.html?AWB=${tracking}`;
    if (c.includes('AMAZON')) return `https://www.amazon.com/progress-tracker/package/ref=pt_redirect_from_gp?trackingId=${tracking}`;
    return `https://www.google.com/search?q=${encodeURIComponent(tracking)}`;
}

/**
 * Build a carrier tracking URL by auto-detecting the carrier from the tracking
 * number format. Returns null when the tracking number is empty/invalid.
 *
 * @param tracking - The full tracking number
 * @returns Tracking URL string, or null if the tracking number is unusable
 */
export function getTrackingUrl(tracking: string): string | null {
    if (!tracking || tracking === 'Not available' || tracking === 'N/A') return null;
    const carrier = getCarrier(tracking);
    switch (carrier) {
        case 'UPS':    return `https://www.ups.com/track?track=yes&trackNums=${tracking}&loc=en_US&requester=ST/trackdetails`;
        case 'USPS':   return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${tracking}`;
        case 'FedEx':  return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`;
        case 'DHL':    return `https://www.dhl.com/en/express/tracking.html?AWB=${tracking}`;
        case 'AMAZON': return `https://www.amazon.com/progress-tracker/package/ref=pt_redirect_from_gp?trackingId=${tracking}`;
        default:       return null;
    }
}
