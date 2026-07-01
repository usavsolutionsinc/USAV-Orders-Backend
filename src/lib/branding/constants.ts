/**
 * Platform-fixed branding constants — the same for every tenant.
 *
 * Anything that answers "whose warehouse is this?" (org name, letterhead,
 * warehouse labels) comes from the database instead — see
 * `src/lib/branding/letterhead.ts` and `organizations.name`.
 * See docs/cycle-forge-branding-spec.md for the full product/workspace split.
 */

export const PRODUCT_NAME = 'Cycle Forge';
export const PRODUCT_NAME_AI = 'Cycle Forge AI';
export const PLATFORM_SUPPORT_EMAIL = 'support@cycleforge.ai';
export const WEBAUTHN_RP_NAME_DEFAULT = PRODUCT_NAME;
