/**
 * Per-staff and per-role mobile UI configuration.
 *
 * The mobile shell (everything under /m/*) reads the resolved config from
 * AuthContext and uses it to decide:
 *   - whether to render the bottom nav at all
 *   - which tabs to show, in what order
 *
 * Source of truth is the database (staff.mobile_display_config JSONB layered
 * over roles.mobile_defaults JSONB). This file owns the TypeScript shape,
 * defaults, and the merge resolver used by both server and client.
 *
 * Resolution order (each later step wins for the fields it sets):
 *   1. DEFAULT_MOBILE_DISPLAY_CONFIG (everyone — bottom nav off)
 *   2. roles.mobile_defaults — UNION across every assigned role (later role
 *      keys in the input order take precedence; callers pass roles already
 *      sorted by position ASC so the primary role wins).
 *   3. staff.mobile_display_config — per-row override.
 *
 * Missing top-level keys inherit. Inside a top-level group (e.g. bottomNav)
 * we treat the whole object as one unit: if the override specifies bottomNav
 * at all, it fully replaces the inherited bottomNav. Keeps the merge
 * obviously-correct and matches how admins reason about it ("set bottom nav
 * for this staff" is one decision, not a per-field decision).
 */

export type MobileNavTabId = 'home' | 'scan' | 'receiving' | 'picks' | 'signout';

export const MOBILE_NAV_TAB_IDS: ReadonlyArray<MobileNavTabId> = [
  'home',
  'scan',
  'receiving',
  'picks',
  'signout',
];

/**
 * Tabs that occupy the raised center slot in the bottom nav. The big center
 * button is the universal QR/barcode scanner ('scan' → /m/scan). 'receiving'
 * is a normal tab (→ /m/receive, the receiving-door scan), NOT a center tab.
 */
export const MOBILE_NAV_CENTER_TAB_IDS: ReadonlyArray<MobileNavTabId> = ['scan'];

/** Default center tab when none is configured — the universal scanner. */
const DEFAULT_CENTER_TAB: MobileNavTabId = 'scan';

export interface MobileBottomNavConfig {
  /** When false, the bar is suppressed entirely. */
  enabled: boolean;
  /** Tab IDs in display order. The center tab ('scan' or 'receive') is raised. */
  tabs: ReadonlyArray<MobileNavTabId>;
}

export interface MobileDisplayConfig {
  bottomNav: MobileBottomNavConfig;
}

/** Partial input — what we accept from the DB or the admin API. */
export type MobileDisplayConfigInput = Partial<{
  bottomNav: Partial<MobileBottomNavConfig>;
}>;

export const DEFAULT_MOBILE_DISPLAY_CONFIG: MobileDisplayConfig = {
  bottomNav: {
    enabled: false,
    tabs: ['home', 'receiving', 'scan', 'picks', 'signout'],
  },
};

/**
 * Validate + normalize a partial config (e.g. from JSONB or API body).
 * Returns null for unparseable input. Drops unknown fields silently so the
 * stored JSON can drift older than the code without crashing the resolver.
 */
export function sanitizeMobileDisplayConfig(
  raw: unknown,
): MobileDisplayConfigInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: MobileDisplayConfigInput = {};
  const obj = raw as Record<string, unknown>;

  if (obj.bottomNav && typeof obj.bottomNav === 'object') {
    const bn = obj.bottomNav as Record<string, unknown>;
    const next: Partial<MobileBottomNavConfig> = {};
    if (typeof bn.enabled === 'boolean') next.enabled = bn.enabled;
    if (Array.isArray(bn.tabs)) {
      const centers = MOBILE_NAV_CENTER_TAB_IDS as ReadonlyArray<string>;
      const seen = new Set<string>();
      let hasCenter = false;
      const tabs: MobileNavTabId[] = [];
      for (const t of bn.tabs) {
        if (typeof t !== 'string') continue;
        if (!(MOBILE_NAV_TAB_IDS as ReadonlyArray<string>).includes(t)) continue;
        if (seen.has(t)) continue;
        // Only one center tab may render — keep the first, drop any others.
        if (centers.includes(t)) {
          if (hasCenter) continue;
          hasCenter = true;
        }
        seen.add(t);
        tabs.push(t as MobileNavTabId);
      }
      // Always keep a center tab if any tabs are present — the raised center
      // button is the headline action. If the admin somehow saves an empty
      // list we treat it as "fall back to defaults".
      if (tabs.length > 0 && !hasCenter) tabs.unshift(DEFAULT_CENTER_TAB);
      if (tabs.length > 0) next.tabs = tabs;
    }
    if (Object.keys(next).length > 0) out.bottomNav = next;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Merge a partial input over a fully-resolved base. Top-level groups are
 * replaced wholesale when present in the input.
 */
function mergeOver(
  base: MobileDisplayConfig,
  patch: MobileDisplayConfigInput | null,
): MobileDisplayConfig {
  if (!patch) return base;
  const next: MobileDisplayConfig = { ...base };
  if (patch.bottomNav) {
    next.bottomNav = {
      enabled:
        typeof patch.bottomNav.enabled === 'boolean'
          ? patch.bottomNav.enabled
          : base.bottomNav.enabled,
      tabs:
        patch.bottomNav.tabs && patch.bottomNav.tabs.length > 0
          ? patch.bottomNav.tabs
          : base.bottomNav.tabs,
    };
  }
  return next;
}

/**
 * Resolve the effective mobile config for one staff. Pass every role assigned
 * to the staff (ordered by position ASC, so the primary role's defaults win
 * within the role tier) and the per-staff override blob from
 * staff.mobile_display_config.
 */
export function resolveMobileDisplayConfig(args: {
  roles: ReadonlyArray<{ key?: string | null; mobile_defaults?: unknown }>;
  staffOverride: unknown;
}): MobileDisplayConfig {
  let current: MobileDisplayConfig = DEFAULT_MOBILE_DISPLAY_CONFIG;

  // Walk roles from least-primary to most-primary so the primary (first)
  // role's defaults win at the role tier. We iterate in reverse and let
  // each successive merge override the previous.
  const reversed = [...args.roles].reverse();
  for (const r of reversed) {
    const patch = sanitizeMobileDisplayConfig(r.mobile_defaults);
    if (patch) current = mergeOver(current, patch);
  }

  const override = sanitizeMobileDisplayConfig(args.staffOverride);
  if (override) current = mergeOver(current, override);

  return current;
}
