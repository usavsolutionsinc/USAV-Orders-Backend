/**
 * Returns true if the value is a non-empty string after trimming.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Returns true if the value is a finite number (not NaN or Infinity).
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value);
}

/**
 * Returns true if the string is a valid email address.
 */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Returns true if the string matches a US phone number pattern.
 */
export function isPhoneNumber(value: string): boolean {
  return /^\+?[\d\s\-().]{7,15}$/.test(value.trim());
}

/**
 * Returns true if the value is a valid UUID v4.
 */
export function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Returns true if a value is null or undefined.
 */
export function isNullish(value: unknown): value is null | undefined {
  return value == null;
}

/**
 * Returns true if the string only contains digits.
 */
export function isNumericString(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

/**
 * Validates that a required field is present and non-empty.
 * Returns an error message string, or null if valid.
 */
export function required(value: unknown, fieldName = 'Field'): string | null {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    return `${fieldName} is required`;
  }
  return null;
}
