/**
 * Pure permission-matrix logic for the StaffAccessDetail `.access` card.
 *
 * This was previously inlined inside the component — the effective-permission
 * set was computed in the render body (former lines 370–392) and the per-page
 * grant/revoke reconciliation lived inside a `.map()` callback in JSX (former
 * lines 659–683), reachable only by clicking a toggle. Pulled out here it is
 * plain, synchronous, and unit-tested (see page-access-matrix.test.ts).
 *
 * No React — import-light on purpose so the test runner (node --test --import
 * tsx) doesn't pull the React renderer in.
 */

import { APP_SIDEBAR_NAV } from '@/lib/sidebar-navigation';
import type { DetailEnvelope } from './staff-access-shared';

/**
 * Where a page's *effective* on/off state comes from, for the badge column:
 *   - 'role'        : granted by an assigned role
 *   - 'revoked'     : granted by role but explicitly removed via override
 *   - 'granted'     : not in any role; granted via override
 *   - 'role-denies' : not in any role and no override (effective: off)
 */
export type PermissionSource = 'role' | 'granted' | 'revoked' | 'role-denies';

export function classifyPermissionSource(
  inRole: boolean,
  isAdded: boolean,
  isRemoved: boolean,
): PermissionSource {
  if (inRole && isRemoved) return 'revoked';
  if (inRole) return 'role';
  if (isAdded) return 'granted';
  return 'role-denies';
}

export interface PageAccessRow {
  /** The APP_SIDEBAR_NAV item this row toggles. */
  item: (typeof APP_SIDEBAR_NAV)[number];
  permission: string;
  inRole: boolean;
  isAdded: boolean;
  isRemoved: boolean;
  /** Effective state shown by the switch. */
  enabled: boolean;
  source: PermissionSource;
}

export interface PageAccessMatrix {
  rows: PageAccessRow[];
  /** Union of every assigned role's DB permissions. */
  roleDbPermissions: Set<string>;
  /**
   * Effective permission set: role union + added − removed (admin ⇒ all).
   * Used by the Landing Page card to filter the desktop dropdown.
   */
  effectivePermissions: Set<string>;
  /**
   * Compute the next override payload when a page is toggled. Pure — returns
   * the `{ add, remove }` to PATCH; callers feed it straight to the mutation.
   */
  toggle: (permission: string) => { add: string[]; remove: string[] };
}

/**
 * Build the full page-access view-model for one staffer.
 *
 * @param envelope  The detail envelope (staff overrides + assigned roles).
 * @param isAdmin   Admin short-circuits every page to enabled / source 'role'.
 */
export function buildPageAccessMatrix(
  envelope: DetailEnvelope,
  isAdmin: boolean,
): PageAccessMatrix {
  const added = envelope.staff.permissions_added ?? [];
  const removed = envelope.staff.permissions_removed ?? [];

  // Union of every assigned role's DB permissions — source of truth is the
  // roles.permissions column, not any static seed matrix.
  const roleDbPermissions = new Set<string>();
  for (const r of envelope.roles) {
    for (const p of r.permissions) roleDbPermissions.add(p);
  }

  const rows: PageAccessRow[] = APP_SIDEBAR_NAV.filter((item) => item.requires).map(
    (item) => {
      const permission = item.requires as string;
      const inRole = roleDbPermissions.has(permission);
      const isAdded = added.includes(permission);
      const isRemoved = removed.includes(permission);
      const enabled = isAdmin || (inRole && !isRemoved) || isAdded;
      return {
        item,
        permission,
        inRole,
        isAdded,
        isRemoved,
        enabled,
        source: classifyPermissionSource(inRole, isAdded, isRemoved),
      };
    },
  );

  const effectivePermissions = new Set<string>();
  if (isAdmin) {
    for (const item of APP_SIDEBAR_NAV) {
      if (item.requires) effectivePermissions.add(item.requires);
    }
  } else {
    for (const p of roleDbPermissions) effectivePermissions.add(p);
    for (const p of added) effectivePermissions.add(p);
    for (const p of removed) effectivePermissions.delete(p);
  }

  const toggle = (permission: string): { add: string[]; remove: string[] } => {
    const inRole = roleDbPermissions.has(permission);
    const enabled = (inRole && !removed.includes(permission)) || added.includes(permission);
    let nextAdd = [...added];
    let nextRemove = [...removed];

    if (enabled) {
      // Turning off
      if (inRole) {
        if (!nextRemove.includes(permission)) nextRemove.push(permission);
        nextAdd = nextAdd.filter((p) => p !== permission);
      } else {
        // It was on via override-add only
        nextAdd = nextAdd.filter((p) => p !== permission);
      }
    } else {
      // Turning on
      if (inRole) {
        // It was off via override-remove only
        nextRemove = nextRemove.filter((p) => p !== permission);
      } else {
        if (!nextAdd.includes(permission)) nextAdd.push(permission);
        nextRemove = nextRemove.filter((p) => p !== permission);
      }
    }
    return { add: nextAdd, remove: nextRemove };
  };

  return { rows, roleDbPermissions, effectivePermissions, toggle };
}
