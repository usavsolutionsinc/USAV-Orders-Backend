/**
 * Warranty clock — the single source of truth for when a warranty starts and
 * expires. Pure + isomorphic (no DB, no env, no Date.now side effects beyond an
 * optional injected `now`), so it runs the same in a route, a cron, and a test.
 *
 * Rule (confirmed 2026-06-06):
 *   expiry = (carrier DELIVERED date, else packed/scanned date + 4 days) + term
 *
 * The DELIVERED date is authoritative. When no carrier delivered status exists
 * yet, we fall back to the packed/scanned date plus a delivery estimate — this
 * yields a *provisional* window (basis = PACKED_PLUS_ESTIMATE) that the tracking
 * cron later recomputes (basis → DELIVERED) once a real delivered date lands.
 *
 * Term is per-org (default 30); callers resolve it from organizations.settings
 * and pass it in as `warrantyDays`, keeping this module free of tenancy lookups.
 */

export const DEFAULT_WARRANTY_DAYS = 30;
/** Days added to the packed/scanned date as an in-transit estimate when no
 *  carrier DELIVERED status is available. */
export const DELIVERY_ESTIMATE_DAYS = 4;

export type WarrantyClockBasis = 'DELIVERED' | 'PACKED_PLUS_ESTIMATE';

export interface WarrantyClockInput {
  /** Carrier DELIVERED timestamp (from shipping_tracking_numbers) — authoritative. */
  deliveredAt?: Date | string | null;
  /** Packed/scanned timestamp — fallback anchor when delivered is unknown. */
  packedScannedAt?: Date | string | null;
  /** Per-org warranty term in days. Defaults to DEFAULT_WARRANTY_DAYS. */
  warrantyDays?: number | null;
  /** Override the in-transit estimate (test seam). Defaults to DELIVERY_ESTIMATE_DAYS. */
  estimateDays?: number | null;
}

export interface WarrantyClockResult {
  /** When the warranty period begins, or null when neither anchor is known. */
  startsAt: Date | null;
  /** When the warranty period ends, or null when undeterminable. */
  expiresAt: Date | null;
  /** Which anchor drove the calculation. null when neither anchor is known. */
  basis: WarrantyClockBasis | null;
  /** The term actually applied (resolved, never null). */
  warrantyDays: number;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function resolvePositiveInt(value: number | null | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

/**
 * Compute the warranty window. Delivered wins; otherwise packed + estimate;
 * otherwise nothing can be computed (UI flags this as "unknown").
 */
export function computeWarranty(input: WarrantyClockInput): WarrantyClockResult {
  const warrantyDays = resolvePositiveInt(input.warrantyDays, DEFAULT_WARRANTY_DAYS);
  const estimateDays = resolvePositiveInt(input.estimateDays, DELIVERY_ESTIMATE_DAYS);

  const delivered = toDate(input.deliveredAt);
  const packed = toDate(input.packedScannedAt);

  let startsAt: Date | null = null;
  let basis: WarrantyClockBasis | null = null;

  if (delivered) {
    startsAt = delivered;
    basis = 'DELIVERED';
  } else if (packed) {
    startsAt = addDays(packed, estimateDays);
    basis = 'PACKED_PLUS_ESTIMATE';
  }

  const expiresAt = startsAt ? addDays(startsAt, warrantyDays) : null;
  return { startsAt, expiresAt, basis, warrantyDays };
}

/**
 * Whole days remaining until expiry relative to `now` (default: real clock).
 * Negative once expired; null when the window is undeterminable. UI-facing.
 */
export function daysUntilExpiry(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  const exp = toDate(expiresAt);
  if (!exp) return null;
  const ms = exp.getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** True when the window is known and already past. */
export function isExpired(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  const exp = toDate(expiresAt);
  return exp ? exp.getTime() <= now.getTime() : false;
}

export interface ClockRecomputeDecision {
  /** Whether the stored clock should be written. */
  changed: boolean;
  /** True when the basis moved from provisional (or unknown) to DELIVERED. */
  flippedToDelivered: boolean;
}

/**
 * Pure decision for the recompute sweep: compare a claim's currently-stored clock
 * against a freshly-computed one and report whether to persist + whether the
 * basis just became authoritative (provisional → DELIVERED).
 *
 * Same-millisecond expiry + same basis ⇒ no write (keeps the sweep cheap).
 */
export function decideClockRecompute(
  current: { basis: WarrantyClockBasis | null; expiresAt: Date | string | null },
  next: WarrantyClockResult,
): ClockRecomputeDecision {
  const currentExp = toDate(current.expiresAt);
  const nextExp = next.expiresAt;
  const sameExpiry =
    (currentExp == null && nextExp == null) ||
    (currentExp != null && nextExp != null && currentExp.getTime() === nextExp.getTime());
  const sameBasis = current.basis === next.basis;

  const flippedToDelivered = current.basis !== 'DELIVERED' && next.basis === 'DELIVERED';
  return { changed: !(sameExpiry && sameBasis), flippedToDelivered };
}
