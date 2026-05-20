/**
 * Tenancy constants.
 *
 * USAV is org #1 with a fixed UUID so transitional code paths — the ones
 * that haven't been refactored to read `ctx.organizationId` yet — can
 * reference the tenant they implicitly meant. New code MUST NOT import
 * USAV_ORG_ID; it should use the tenant id from CurrentUser.
 *
 * Treat any new use of USAV_ORG_ID as a migration debt that needs to be
 * paid down before the second customer onboards.
 */

export const USAV_ORG_ID = '00000000-0000-0000-0000-000000000001' as const;

export type OrgId = string;

export const PLATFORM_PLANS = ['trial', 'starter', 'growth', 'pro', 'enterprise'] as const;
export type PlatformPlan = (typeof PLATFORM_PLANS)[number];

export const ORG_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];
