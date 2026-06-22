/**
 * Plan catalog — single source of truth for what a tenant gets at each
 * tier. Pricing lives in Stripe (we never duplicate price strings here);
 * what a plan ENTITLES the tenant to is owned by the app.
 *
 * Add a plan by:
 *   1. Creating a Stripe Product + Price.
 *   2. Wiring its price id into PLAN_PRICE_IDS via env (one env var per plan
 *      keeps the catalog config-driven without redeploy).
 *   3. Updating ENTITLEMENTS to declare what the plan unlocks.
 */

import type { PlatformPlan } from '../tenancy/constants';

export interface Entitlements {
  // Hard ceilings the app enforces.
  maxStaff: number;                  // 0 = unlimited
  maxMonthlyOrders: number;          // 0 = unlimited
  maxIntegrations: number;           // count of distinct provider rows in organization_integrations
  maxWarehouses: number;
  // Feature toggles — gate the corresponding routes/pages with hasEntitlement().
  features: {
    fba: boolean;
    repair: boolean;
    walkIn: boolean;
    aiCopilot: boolean;
    advancedRoles: boolean;          // editable roles + per-staff overrides
    automations: boolean;            // workflow builder (future)
    webhooksOut: boolean;            // outbound webhook subscriptions (future)
    sso: boolean;                    // SAML / OIDC tenant SSO
    auditLogExport: boolean;
    prioritySupport: boolean;
    customBranding: boolean;
    // Operations Studio capability (entitlement tiers — Part-2 Track 2).
    //
    // For now this is a single boolean that simply EXISTS so the studio gate
    // has something to read; it is TRUE on every plan below so the mechanism
    // is permissive and revokes nothing. The eventual Tracker / Ops / Studio
    // tiering maps onto the existing RBAC perms rather than this flag:
    //   - Tracker (read-only)  → studio.view only
    //   - Ops (templated edit) → studio.view + a future template-only restriction
    //   - Studio (full edit)   → studio.view + studio.manage
    // i.e. WHAT you can do inside Studio stays an RBAC concern; this flag only
    // gates WHETHER the plan includes the Studio surface at all. Splitting the
    // plan ladder into Tracker/Ops/Studio prices is an unmade owner decision
    // (Stripe catalog) and is intentionally out of scope here.
    //
    // NOTE: enforcement of this flag is OFF by default (gated behind
    // STUDIO_ENTITLEMENT_ENFORCED) and the dogfood/internal org is exempt, so
    // this is "cosmetic until the Part-3 RLS work" — it provides no real tenant
    // isolation on its own. See src/lib/billing/studio-gate.ts.
    studio: boolean;
  };
}

const STARTER_FEATURES: Entitlements['features'] = {
  fba: false,
  repair: false,
  walkIn: true,
  aiCopilot: false,
  advancedRoles: false,
  automations: false,
  webhooksOut: false,
  sso: false,
  auditLogExport: false,
  prioritySupport: false,
  customBranding: false,
  // Studio is granted on EVERY plan by default (it spreads up through
  // GROWTH/PRO/ENTERPRISE) so turning the mechanism on never revokes Studio
  // from an existing trial/internal org. Tighten per-tier later if/when the
  // plan ladder is split — see the Entitlements interface comment.
  studio: true,
};

const GROWTH_FEATURES: Entitlements['features'] = {
  ...STARTER_FEATURES,
  fba: true,
  repair: true,
  advancedRoles: true,
  aiCopilot: true,
  customBranding: true,
};

const PRO_FEATURES: Entitlements['features'] = {
  ...GROWTH_FEATURES,
  automations: true,
  webhooksOut: true,
  auditLogExport: true,
};

const ENTERPRISE_FEATURES: Entitlements['features'] = {
  ...PRO_FEATURES,
  sso: true,
  prioritySupport: true,
};

export const ENTITLEMENTS: Record<PlatformPlan, Entitlements> = {
  trial: {
    maxStaff: 5,
    maxMonthlyOrders: 100,
    maxIntegrations: 2,
    maxWarehouses: 1,
    features: STARTER_FEATURES,
  },
  starter: {
    maxStaff: 10,
    maxMonthlyOrders: 1_000,
    maxIntegrations: 3,
    maxWarehouses: 1,
    features: STARTER_FEATURES,
  },
  growth: {
    maxStaff: 50,
    maxMonthlyOrders: 10_000,
    maxIntegrations: 8,
    maxWarehouses: 3,
    features: GROWTH_FEATURES,
  },
  pro: {
    maxStaff: 250,
    maxMonthlyOrders: 100_000,
    maxIntegrations: 0,
    maxWarehouses: 10,
    features: PRO_FEATURES,
  },
  enterprise: {
    maxStaff: 0,
    maxMonthlyOrders: 0,
    maxIntegrations: 0,
    maxWarehouses: 0,
    features: ENTERPRISE_FEATURES,
  },
};

export function entitlementsForPlan(plan: PlatformPlan): Entitlements {
  return ENTITLEMENTS[plan] ?? ENTITLEMENTS.trial;
}

/**
 * Stripe price ids per plan, resolved at runtime from env so we can change
 * the catalog without a redeploy. Trial doesn't have a price; it's just a
 * status.
 */
export const PLAN_PRICE_IDS: Record<Exclude<PlatformPlan, 'trial'>, string | undefined> = {
  starter:    process.env.STRIPE_PRICE_STARTER,
  growth:     process.env.STRIPE_PRICE_GROWTH,
  pro:        process.env.STRIPE_PRICE_PRO,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
};

export function planFromPriceId(priceId: string): PlatformPlan | null {
  for (const [plan, id] of Object.entries(PLAN_PRICE_IDS) as Array<[PlatformPlan, string | undefined]>) {
    if (id && id === priceId) return plan;
  }
  return null;
}
