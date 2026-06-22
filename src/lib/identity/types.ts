/**
 * Identity-layer shared types. Lives outside AuthContext (no 'use client') so
 * both server resolvers and client components can import it.
 *
 * See docs/identity-layer-plan.md.
 */

/**
 * One workspace a signed-in account can act in. Powers the Settings →
 * Organization switcher. `staffId` is the per-org PROFILE row that the session
 * points at when this membership is active.
 */
export interface OrgMembership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string | null;
  plan: string | null;
  /** The staff (profile) row id for this account in this org. */
  staffId: number;
  /** Primary role key in this org, if resolvable. */
  role: string | null;
  /** True for the org this session is currently scoped to. */
  isCurrent: boolean;
}
