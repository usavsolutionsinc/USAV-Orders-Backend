/**
 * Warranty claim state machine — pure, so the allowed transitions are locked by
 * a unit test and shared by every verb in mutations.ts.
 *
 *   LOGGED → SUBMITTED → APPROVED → IN_REPAIR → REPAIRED → CLOSED
 *                      ↘ DENIED → CLOSED
 *   (EXPIRED is set by the cron; CLOSED is terminal.)
 */

import type { WarrantyClaimStatus } from './types';

export type WarrantyLifecycleVerb = 'submit' | 'approve' | 'deny' | 'close';

export const WARRANTY_LIFECYCLE: Record<
  WarrantyLifecycleVerb,
  { from: WarrantyClaimStatus[]; to: WarrantyClaimStatus }
> = {
  submit: { from: ['LOGGED'], to: 'SUBMITTED' },
  approve: { from: ['SUBMITTED'], to: 'APPROVED' },
  deny: { from: ['SUBMITTED'], to: 'DENIED' },
  close: { from: ['APPROVED', 'DENIED', 'REPAIRED', 'EXPIRED'], to: 'CLOSED' },
};

/** States a repair attempt can be logged from. */
export const REPAIR_ALLOWED_FROM: WarrantyClaimStatus[] = ['APPROVED', 'IN_REPAIR'];

/** Where a claim lands after a repair attempt: FIXED closes out repair, else in-progress. */
export function repairNextStatus(outcome: string | null | undefined): WarrantyClaimStatus {
  return outcome === 'FIXED' ? 'REPAIRED' : 'IN_REPAIR';
}

export function canTransition(verb: WarrantyLifecycleVerb, from: WarrantyClaimStatus): boolean {
  return WARRANTY_LIFECYCLE[verb].from.includes(from);
}
