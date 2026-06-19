/**
 * Types for the Quick Access bottom-right popover. All data lives in
 * localStorage on the user's device for now; the `version` field on the
 * settings record lets us migrate to account-bound sync later without
 * breaking existing installs.
 */

export interface ActionToggles {
  /** Open the phone-history popover (recent packed orders, tap to resume). */
  phoneHistory: boolean;
  /**
   * Show "Install desktop app" in the actions list. Auto-hidden when the
   * app is already running inside Electron, or when no download URL is
   * configured. Default true.
   */
  installDesktopApp?: boolean;
  /** Show "Switch staff" in the popover action list. Default true. */
  switchStaff?: boolean;
  /** Show "Log warranty claim" quick-action row (shown only for warranty.manage holders). */
  warrantyCheckin?: boolean;
}

export interface PinnedPage {
  /** Stable client-generated id (crypto.randomUUID). */
  id: string;
  /** User-editable display name. */
  label: string;
  /** Path + search params, e.g. '/receiving?warehouse=SAL'. */
  href: string;
  /** Optional icon hint (route key, looked up at render). */
  iconKey?: string;
  /** Epoch ms when added. Used for sort + diagnostics. */
  addedAt: number;
}

export interface QuickAccessSettings {
  version: 1;
  enabled: boolean;
  hotkey: 'cmdk' | 'off';
  showRecent: boolean;
  /**
   * When true (default), the FAB shows the signed-in staff's initials in their
   * theme colour. When false, the FAB always renders the Zap icon — useful for
   * users who prefer the original look. Only meaningful while signed in.
   */
  showStaffChipOnFab?: boolean;
  actions: ActionToggles;
  pinned: PinnedPage[];
}

export interface RecentVisit {
  href: string;
  label: string;
  visitedAt: number;
}

export const MAX_PINS = 30;
export const MAX_RECENTS = 12;
