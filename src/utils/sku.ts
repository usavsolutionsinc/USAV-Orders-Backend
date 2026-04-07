/**
 * SKU validation and formatting utilities
 */

/**
 * Normalize SKU by removing leading zeros
 * @param sku - The SKU to normalize
 * @returns Normalized SKU
 */
export function normalizeSku(sku: string): string {
    return sku.replace(/^0+/, '') || '0';
}

/**
 * Validate if a string is a valid SKU format
 * @param sku - The SKU to validate
 * @returns True if SKU is valid
 */
export function isValidSku(sku: string): boolean {
    if (!sku || sku.trim() === '') return false;
    // SKUs should contain at least some alphanumeric characters
    return /[a-zA-Z0-9]/.test(sku);
}

/**
 * Format SKU for display (uppercase, trimmed)
 * @param sku - The SKU to format
 * @returns Formatted SKU
 */
export function formatSku(sku: string): string {
    return sku.trim().toUpperCase();
}

/**
 * Get the last 6 characters of serial numbers for display
 * @param serialNumbers - Array of serial numbers
 * @returns Comma-separated string of last 6 characters
 */
export function getSerialLast6(serialNumbers: string[]): string {
    return serialNumbers.map(sn => sn.slice(-6)).join(', ');
}

/**
 * Parse SKU and extract numeric portion
 * @param sku - The SKU to parse
 * @returns Numeric portion of SKU
 */
export function getSkuNumber(sku: string): number {
    const match = sku.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
}

/**
 * Check if a SKU is a Repair Service item (ends with -RS, case-insensitive).
 * Also matches variant patterns like -RS-1, -RS-2.
 */
export function isRepairSku(sku: string | null | undefined): boolean {
    const s = String(sku || '').trim().toUpperCase();
    return s.endsWith('-RS') || /\-RS-\d+$/.test(s);
}

/**
 * Strip the -RS suffix from a repair SKU to get the base product SKU.
 * e.g. "1810-RS-1" → "1810", "244021Q-RS" → "244021Q"
 */
export function getSkuBase(sku: string): string {
    return sku.trim().replace(/-RS(-\d+)?$/i, '');
}
