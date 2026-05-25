import { looksLikeFnsku } from '@/lib/scan-resolver';

/**
 * Raised when callers try to INSERT a stub/mapping row keyed by something that is
 * not a valid Amazon FNSKU (`X00` + 7) or ASIN (`B0` + 8) after normalization.
 * Existing catalog rows keyed by legacy values are unaffected (find + touch only).
 */
export class InvalidFbaCatalogKeyError extends Error {
  constructor(public readonly normalizedKey: string) {
    super(
      `Not a valid Amazon FBA catalog key "${normalizedKey}". Use an FNSKU (X00 plus seven characters) or an ASIN (B0 plus eight characters).`,
    );
    this.name = 'InvalidFbaCatalogKeyError';
  }
}

/** True when {@link normalizedCleanKey} matches Amazon X00/B0 barcode shape after canonical normalization. */
export function isValidAmazonCatalogKey(normalizedCleanKey: string): boolean {
  return looksLikeFnsku(normalizedCleanKey);
}

export function assertValidAmazonCatalogKeyForInsert(normalizedCleanKey: string): void {
  if (!looksLikeFnsku(normalizedCleanKey)) {
    throw new InvalidFbaCatalogKeyError(normalizedCleanKey);
  }
}
