export function normalizeTrackingLast8(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length >= 8) {
    return digitsOnly.slice(-8);
  }

  return trimmed;
}

export function last8FromStoredTracking(input: string): string {
  const digitsOnly = String(input || '').replace(/\D/g, '');
  return digitsOnly.slice(-8);
}

export function normalizeTrackingKey18(input: string): string {
  const normalized = normalizeTrackingCanonical(input);
  if (!normalized) return '';
  return normalized.length > 18 ? normalized.slice(-18) : normalized;
}

export function key18FromStoredTracking(input: string): string {
  const normalized = normalizeTrackingCanonical(input);
  if (!normalized) return '';
  return normalized.length > 18 ? normalized.slice(-18) : normalized;
}

export function normalizeTrackingCanonical(input: string): string {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
