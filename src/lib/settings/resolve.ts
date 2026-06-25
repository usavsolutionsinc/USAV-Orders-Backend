/**
 * Settings Registry — the effective-value resolver.
 *
 * resolveSetting() layers, most-specific wins:
 *   1. entitlement missing on plan  → LOCKED (→ schema default, disabled)
 *   2. scope 'staff'                → staff value ?? default
 *   3. scope 'org' + personalizable → staff value ?? org value ?? default
 *   4. scope 'org'                  → org value ?? default  (hard policy)
 *
 * Stored values are validated against the registry schema; an invalid or
 * plan-locked option falls back rather than crashing. Pure — give it plain
 * record bags + the plan features. See docs/settings-registry.md.
 */

import type { Entitlements } from '@/lib/billing/plans';
import { settingsForPage } from './registry';
import type {
  ResolvedSetting,
  SettingDef,
  SettingPage,
  SettingSource,
  SettingValue,
} from './types';

type Features = Entitlements['features'];

export interface ResolveContext {
  orgSettings: Record<string, unknown>;
  staffPrefs: Record<string, unknown>;
  features: Features;
}

/** The default baked into a setting's schema (every schema declares `.default()`). */
export function settingDefault(def: SettingDef): SettingValue {
  const r = def.schema.safeParse(undefined);
  return (r.success ? r.data : undefined) as SettingValue;
}

/** Validate a stored raw value against the schema; undefined when absent/invalid. */
function coerce(def: SettingDef, raw: unknown): SettingValue | undefined {
  if (raw === undefined || raw === null) return undefined;
  const r = def.schema.safeParse(raw);
  return r.success ? (r.data as SettingValue) : undefined;
}

export function resolveSetting(def: SettingDef, ctx: ResolveContext): ResolvedSetting {
  const fallback = settingDefault(def);

  // Option values the plan can't use (e.g. NAS `direct` without nasArchive).
  const lockedOptions: SettingValue[] = [];
  if (def.optionEntitlements) {
    for (const [optKey, feat] of Object.entries(def.optionEntitlements)) {
      if (!ctx.features[feat]) {
        const parsed = def.schema.safeParse(optKey);
        if (parsed.success) lockedOptions.push(parsed.data as SettingValue);
      }
    }
  }

  // Whole-setting entitlement lock → always the free default.
  if (def.entitlement && !ctx.features[def.entitlement]) {
    return {
      key: def.key,
      value: fallback,
      orgValue: def.scope === 'org' ? fallback : undefined,
      source: 'locked',
      locked: true,
      lockedOptions,
    };
  }

  const usable = (v: SettingValue | undefined): SettingValue | undefined =>
    v !== undefined && lockedOptions.some((lv) => lv === v) ? undefined : v;

  const staffVal = usable(coerce(def, ctx.staffPrefs[def.key]));
  const orgVal = usable(coerce(def, ctx.orgSettings[def.key]));

  if (def.scope === 'staff') {
    const value = staffVal ?? fallback;
    const source: SettingSource = staffVal !== undefined ? 'staff' : 'default';
    return { key: def.key, value, source, locked: false, lockedOptions };
  }

  // org scope (incl. personalizable)
  const orgResolved = orgVal ?? fallback;
  let value: SettingValue;
  let source: SettingSource;
  if (def.personalizable && staffVal !== undefined) {
    value = staffVal;
    source = 'staff';
  } else if (orgVal !== undefined) {
    value = orgVal;
    source = 'org';
  } else {
    value = fallback;
    source = 'default';
  }
  return { key: def.key, value, orgValue: orgResolved, source, locked: false, lockedOptions };
}

export function resolvePageSettings(page: SettingPage, ctx: ResolveContext): ResolvedSetting[] {
  return settingsForPage(page).map((def) => resolveSetting(def, ctx));
}
