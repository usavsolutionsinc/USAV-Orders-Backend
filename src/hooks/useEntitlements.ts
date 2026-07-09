'use client';

import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { entitlementsForPlan, type Entitlements } from '@/lib/billing/plans';
import type { PlatformPlan } from '@/lib/tenancy/constants';

/**
 * The current tenant's resolved entitlements, computed CLIENT-SIDE from the
 * plan carried on the session (no fetch — `plans.ts` is a pure catalog). Use it
 * to lock/upsell a control the plan doesn't unlock. The server still enforces
 * the gate on write, so this is presentation only.
 */
export function useEntitlements(): Entitlements {
  const { user } = useAuth();
  const plan = (user?.organizationPlan ?? 'trial') as PlatformPlan;
  return useMemo(() => entitlementsForPlan(plan), [plan]);
}
