/**
 * Settings Registry — shared types.
 *
 * A "setting" is one declarative entry that drives storage, validation, UI, plan
 * gating, and audit. See docs/settings-registry.md. The registry array lives in
 * ./registry.ts; the effective-value resolver in ./resolve.ts; typed server
 * accessors in ./accessors.ts.
 *
 * EntitlementFeature is derived from the plan catalog (pure module — safe to
 * import on the client) so a setting's `entitlement` can only name a real plan
 * feature.
 */

import type { ZodTypeAny } from 'zod';
import type { Entitlements } from '@/lib/billing/plans';

export type EntitlementFeature = keyof Entitlements['features'];

export type SettingScope = 'org' | 'staff';

export type SettingControl = 'toggle' | 'segmented' | 'select' | 'number' | 'text';

/** Pages a setting can attach to. Extend as the registry grows to new surfaces. */
export type SettingPage = 'receiving';

export type SettingValue = string | number | boolean;

export interface SettingOption {
  value: SettingValue;
  label: string;
  hint?: string;
}

export interface SettingDef {
  /** Unique, page-namespaced, 1:1 with its JSONB storage key (e.g. 'receiving.photoPolicy'). */
  key: string;
  page: SettingPage;
  /** UI grouping within the page panel (e.g. 'Photos', 'Scanning'). */
  group: string;
  /** 'org' → organizations.settings; 'staff' → staff_preferences.prefs. */
  scope: SettingScope;
  /** org-scope only: when true a staffer may keep a personal override of the org default. */
  personalizable?: boolean;
  label: string;
  description?: string;
  control: SettingControl;
  /** Validation + the default. Every schema MUST use `.default(…)` (guarded by the test). */
  schema: ZodTypeAny;
  /** For 'segmented' / 'select'. */
  options?: readonly SettingOption[];
  /** Number-control bounds (advisory hints; the schema is the real guard). */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Permission required to write the ORG value of this setting. */
  permission?: string;
  /** Whole-setting plan gate. Locked (→ default, disabled) when the plan lacks it. */
  entitlement?: EntitlementFeature;
  /** Per-option plan gates (e.g. the `direct` NAS mode). Those options lock individually. */
  optionEntitlements?: Readonly<Record<string, EntitlementFeature>>;
  /** Declared but not yet wired — render disabled with a "Coming soon" chip; writes refused. */
  comingSoon?: boolean;
  /** Collapse under an "Advanced" disclosure in the panel. */
  advanced?: boolean;
}

export type SettingSource = 'staff' | 'org' | 'default' | 'locked';

/** Resolved view of one setting for a given (org, staff) — what the API GET returns per key. */
export interface ResolvedSetting {
  key: string;
  /** Effective value for the staffer (staff override → org default → schema default). */
  value: SettingValue;
  /** Raw org-scope value (the org default). Present for org-scope settings only. */
  orgValue?: SettingValue;
  source: SettingSource;
  /** Whole-setting entitlement lock. */
  locked: boolean;
  /** Option values locked individually by optionEntitlements (subset of def.options values). */
  lockedOptions: SettingValue[];
}
