/**
 * Single source of truth for the mobile bottom-nav tab list.
 *
 * Replaces the hardcoded tab grid that used to live inside
 * `MobileBottomNav.tsx`. Each entry declares a route plus the permission
 * required to see it — the bar renders only the items the signed-in user
 * actually has access to, so a packer sees only "Pack", a technician only
 * "Test", and an admin sees the full strip.
 *
 * Sign out is intentionally NOT modeled here — it's an action, not a route,
 * and the bar always appends it as the trailing tab regardless of role.
 *
 * Future steps (see plan): replace `MOBILE_RESTRICTED_SIDEBAR_IDS` and
 * `isMobileAllowedPath` in `sidebar-navigation.ts` with derivations from this
 * list so route-gating, sidebar-filtering, and bottom-nav rendering all
 * agree.
 */

import {
  Barcode,
  ClipboardList,
  LayoutDashboard,
  ShoppingCart,
  User,
  Wrench,
} from '@/components/Icons';
import type { SidebarIconComponent } from '@/lib/sidebar-navigation';

export interface MobileNavItem {
  id: string;
  href: string;
  label: string;
  icon: SidebarIconComponent;
  /**
   * Permission string from the registry (e.g. `receiving.view`). When omitted,
   * the item is visible to any signed-in user. Mirrors the convention used by
   * `SidebarNavItem.requires` in `sidebar-navigation.ts`.
   */
  requires?: string;
  /**
   * When true, the tab renders with the raised-circle "headline action"
   * treatment (lifted above the bar). Reserved for Scan today; at most one
   * item should set this.
   */
  raised?: boolean;
}

export const MOBILE_NAV_ITEMS: ReadonlyArray<MobileNavItem> = [
  // Always-visible cockpit entry.
  { id: 'home',      href: '/m/home',    label: 'Home',    icon: LayoutDashboard },
  // Station entries — gated by the same permissions the sidebar uses.
  { id: 'receiving', href: '/receiving', label: 'Receive', icon: ClipboardList, requires: 'receiving.view' },
  { id: 'packing',   href: '/packer',    label: 'Pack',    icon: User,          requires: 'packing.view' },
  { id: 'tech',      href: '/tech',      label: 'Test',    icon: Wrench,        requires: 'tech.view' },
  // Headline action — raised centre treatment.
  { id: 'scan',      href: '/m/scan',    label: 'Scan',    icon: Barcode,       raised: true },
  // Picker queue — available to anyone in the mobile cockpit (no registry
  // permission exists for picking today).
  { id: 'picks',     href: '/m/pick',    label: 'Picks',   icon: ShoppingCart },
];

/**
 * Filter the canonical tab list against the signed-in user's permissions.
 *
 * Returns an empty array when permissions are undefined (still hydrating
 * AuthContext or unauthenticated) — callers should render nothing in that
 * case so the bar doesn't flash with the wrong tabs.
 */
export function getMobileNavForUser(
  permissions: ReadonlySet<string> | undefined,
): MobileNavItem[] {
  if (!permissions) return [];
  return MOBILE_NAV_ITEMS.filter((i) => !i.requires || permissions.has(i.requires));
}
