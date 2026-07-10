/**
 * Onboarding step catalog — the single source of truth for activation
 * (onboarding-foundational-plan §4/§5).
 *
 * Steps are READ-TIME DERIVED, never stored: a step is complete iff the data
 * that proves it exists (`doneWhen` over {@link OnboardingStats} from
 * GET /api/onboarding/stats). This self-heals — an org that connected a channel
 * before onboarding shipped already shows that step done — and there is nothing
 * to migrate.
 *
 * Plan gating: steps are filtered by the tenant's plan entitlements
 * (`entitlementsForPlan`, src/lib/billing/plans.ts) via the optional `showWhen`
 * predicate, so a plan never surfaces a step it can't act on. This module is
 * pure (no server imports) so client components can consume it directly.
 */

import { entitlementsForPlan, type Entitlements } from '@/lib/billing/plans';
import type { PlatformPlan } from '@/lib/tenancy/constants';
import { UNBOX_SURFACE_ROUTE } from '@/lib/receiving/surface-path';

/** Org-scoped activation counts returned by GET /api/onboarding/stats. */
export interface OnboardingStats {
  /** Orders ingested (synced or imported), capped for cheapness. */
  orders: number;
  /** Receiving lines (expected or received cartons/items), capped. */
  receivingLines: number;
  /** Staff members in the org (the signup admin counts as 1). */
  staff: number;
  /** organization_integrations rows currently `active`. */
  integrationsConnected: number;
  /** True once any inventory event exists — the org scanned its first unit. */
  firstScanDone: boolean;
}

/** All-zero stats — the degrade-not-fail fallback and the brand-new-org shape. */
export const EMPTY_ONBOARDING_STATS: OnboardingStats = {
  orders: 0,
  receivingLines: 0,
  staff: 0,
  integrationsConnected: 0,
  firstScanDone: false,
};

export type OnboardingStepId = 'connect' | 'order' | 'receive' | 'scan' | 'invite';

export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  /** One-line teaching subtitle shown while the step is pending. */
  description: string;
  /** Deep link to the real surface that satisfies the step. */
  href: string;
  /** Derived completion — true iff the underlying data exists. */
  doneWhen: (stats: OnboardingStats) => boolean;
  /** Plan gate — absent means every plan sees the step. */
  showWhen?: (entitlements: Entitlements) => boolean;
}

/**
 * The v1 catalog, in recommended order. Append plan-gated steps here (e.g. a
 * Growth-only "Set up a workflow" → /studio) — the array is plan-filtered, so
 * extensions are additive config, not a redesign.
 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'connect',
    label: 'Connect a sales channel',
    description: 'Orders flow in automatically once a channel is linked.',
    href: '/settings/integrations',
    doneWhen: (s) => s.integrationsConnected > 0,
  },
  {
    id: 'order',
    label: 'Bring in your first order',
    description: 'Sync from a channel or import manually.',
    href: '/dashboard?unshipped',
    doneWhen: (s) => s.orders > 0,
  },
  {
    id: 'receive',
    label: 'Receive your first carton',
    description: 'Log an inbound delivery at the unbox station.',
    href: UNBOX_SURFACE_ROUTE,
    doneWhen: (s) => s.receivingLines > 0,
  },
  {
    id: 'scan',
    label: 'Scan your first unit',
    description: 'Push a unit through your seeded workflow.',
    href: UNBOX_SURFACE_ROUTE,
    doneWhen: (s) => s.firstScanDone,
  },
  {
    id: 'invite',
    label: 'Invite a teammate',
    description: 'Add staff so the whole line can clock work.',
    href: '/settings/organization',
    doneWhen: (s) => s.staff > 1,
    // Hidden on a (hypothetical) single-seat plan; maxStaff 0 = unlimited.
    showWhen: (e) => e.maxStaff === 0 || e.maxStaff > 1,
  },
];

/** Steps visible under a resolved entitlements object. */
export function stepsForEntitlements(entitlements: Entitlements): OnboardingStep[] {
  return ONBOARDING_STEPS.filter((step) => !step.showWhen || step.showWhen(entitlements));
}

/** Steps visible for a plan (reads the plan catalog's entitlements). */
export function stepsForPlan(plan: PlatformPlan): OnboardingStep[] {
  return stepsForEntitlements(entitlementsForPlan(plan));
}

/** How many of the given steps the stats prove complete. */
export function completedStepCount(steps: readonly OnboardingStep[], stats: OnboardingStats): number {
  return steps.reduce((n, step) => n + (step.doneWhen(stats) ? 1 : 0), 0);
}
