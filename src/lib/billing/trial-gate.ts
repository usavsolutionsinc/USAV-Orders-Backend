/**
 * Trial-expiry enforcement — the "no free tier" gate.
 *
 * A tenant on the `trial` plan whose `trial_ends_at` has passed is blocked
 * from the app until it subscribes. The predicate ONLY fires on
 * `plan === 'trial'`, so enterprise/paid orgs (USAV included) are
 * structurally immune — they can never be locked out by this.
 *
 * OFF BY DEFAULT. Set `TRIAL_ENFORCEMENT=1` (or true/on/yes) to enable. When
 * off, `isTrialBlocked` returns immediately with NO database read, so the hot
 * auth path pays nothing for a feature that isn't turned on.
 *
 * Wired into the two Node-runtime choke points (proxy.ts is Edge and can't
 * read the DB, so it can't host this):
 *   - withAuth (API)            → 402 PAYMENT_REQUIRED JSON
 *   - requirePermission (pages) → redirect to /settings/billing
 *
 * Billing + auth paths are exempt so an expired-trial tenant can always reach
 * checkout and there's no redirect loop.
 */

import { getOrganization } from '../tenancy/organizations';
import type { OrgId } from '../tenancy/constants';

export function trialEnforcementOn(): boolean {
  const v = (process.env.TRIAL_ENFORCEMENT ?? '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

// Paths that must stay reachable even with an expired trial: billing (to pay),
// auth (to sign in/out), and the not-authorized page.
const EXEMPT_PREFIXES = [
  '/settings/billing',
  '/api/billing',
  '/api/auth',
  '/signin',
  '/not-authorized',
];

export function isTrialPathExempt(pathname: string): boolean {
  return EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isTrialExpired(org: { plan: string; trialEndsAt: Date | null }): boolean {
  return org.plan === 'trial' && org.trialEndsAt != null && org.trialEndsAt.getTime() < Date.now();
}

/**
 * True if this org should be blocked from `pathname`. No DB read when
 * enforcement is off or the path is exempt — the flag check short-circuits
 * first.
 */
export async function isTrialBlocked(orgId: OrgId, pathname: string): Promise<boolean> {
  if (!trialEnforcementOn()) return false;
  if (isTrialPathExempt(pathname)) return false;
  const org = await getOrganization(orgId);
  if (!org) return false;
  return isTrialExpired(org);
}
