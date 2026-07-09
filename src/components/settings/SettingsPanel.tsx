'use client';

/**
 * Settings Registry — the one generic renderer for a page's settings.
 *
 * Filters the registry by page, splits Personal (staff + personalizable) from
 * Organization policy (org-scope; shown only to admins), groups by `group`, and
 * renders each setting through <SettingControl>. Effective values + entitlement
 * locks come from usePageSettings (resolved server-side). See
 * docs/settings-registry.md.
 */

import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { settingsForPage, SETTING_PAGES } from '@/lib/settings/registry';
import type { ResolvedSetting, SettingDef, SettingPage, SettingValue } from '@/lib/settings/types';
import { usePageSettings } from '@/hooks/useSettings';
import { SettingControl } from './controls/SettingControl';

/** Lowest plan that unlocks each gated feature — shown on the upgrade badge. */
const FEATURE_PLAN: Record<string, string> = {
  nasArchive: 'Growth',
  advancedVision: 'Pro',
  automations: 'Pro',
};

function Badge({ tone, children }: { tone: 'amber' | 'gray'; children: React.ReactNode }) {
  const cls =
    tone === 'amber'
      ? 'bg-amber-50 text-amber-700 ring-amber-200'
      : 'bg-surface-sunken text-text-muted ring-border-soft';
  return (
    <span className={`rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset ${cls}`}>
      {children}
    </span>
  );
}

interface RowProps {
  def: SettingDef;
  resolved: ResolvedSetting;
  value: SettingValue;
  caption?: string;
  onChange: (value: SettingValue) => void;
}

function SettingRow({ def, resolved, value, caption, onChange }: RowProps) {
  const upgradeFor = resolved.locked && def.entitlement ? FEATURE_PLAN[def.entitlement] : undefined;
  const lockedOptionPlan =
    !resolved.locked && resolved.lockedOptions.length > 0 && def.optionEntitlements
      ? FEATURE_PLAN[Object.values(def.optionEntitlements)[0] ?? '']
      : undefined;

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-text-default">{def.label}</span>
          {resolved.locked && <Badge tone="amber">Upgrade</Badge>}
          {def.comingSoon && <Badge tone="gray">Coming soon</Badge>}
        </div>
        {def.description && <p className="mt-0.5 text-caption text-text-soft">{def.description}</p>}
        {upgradeFor && (
          <p className="mt-0.5 text-caption font-medium text-amber-600">Available on the {upgradeFor} plan.</p>
        )}
        {lockedOptionPlan && (
          <p className="mt-0.5 text-caption font-medium text-amber-600">Direct mode needs the {lockedOptionPlan} plan.</p>
        )}
        {caption && <p className="mt-0.5 text-caption font-medium text-text-faint">{caption}</p>}
      </div>
      <div className="flex-shrink-0 pt-0.5">
        <SettingControl
          def={def}
          value={value}
          disabled={resolved.locked || def.comingSoon}
          lockedOptions={resolved.lockedOptions}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

function groupDefs(defs: SettingDef[]): Array<{ group: string; defs: SettingDef[] }> {
  const order: string[] = [];
  const byGroup = new Map<string, SettingDef[]>();
  for (const d of defs) {
    if (!byGroup.has(d.group)) {
      byGroup.set(d.group, []);
      order.push(d.group);
    }
    byGroup.get(d.group)!.push(d);
  }
  return order.map((group) => ({ group, defs: byGroup.get(group)! }));
}

interface SectionProps {
  title: string;
  subtitle: string;
  defs: SettingDef[];
  byKey: (key: string) => ResolvedSetting | undefined;
  /** Which value to show + which home to write. */
  variant: 'personal' | 'org';
  onChange: (def: SettingDef, value: SettingValue) => void;
}

function PanelSection({ title, subtitle, defs, byKey, variant, onChange }: SectionProps) {
  if (defs.length === 0) return null;
  const groups = groupDefs(defs);

  return (
    <section className="space-y-3">
      <header>
        <h3 className="text-sm font-bold uppercase tracking-widest text-text-soft">{title}</h3>
        <p className="mt-0.5 text-caption text-text-soft">{subtitle}</p>
      </header>
      <div className="space-y-4">
        {groups.map(({ group, defs: groupDefsList }) => (
          <div key={group} className="rounded-2xl border border-border-soft bg-surface-card px-5 shadow-sm">
            <div className="border-b border-border-hairline py-2.5">
              <span className="text-eyebrow font-black uppercase tracking-widest text-text-faint">{group}</span>
            </div>
            <div className="divide-y divide-border-hairline">
              {groupDefsList.map((def) => {
                const resolved = byKey(def.key);
                if (!resolved) return null;
                const value =
                  variant === 'org' ? resolved.orgValue ?? resolved.value : resolved.value;
                const caption =
                  variant === 'personal' && def.personalizable && resolved.source !== 'staff'
                    ? 'Using the organization default — change to set your own.'
                    : undefined;
                return (
                  <SettingRow
                    key={def.key}
                    def={def}
                    resolved={resolved}
                    value={value}
                    caption={caption}
                    onChange={(v) => onChange(def, v)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SettingsPanel({ page }: { page: SettingPage }) {
  const { canManageOrg, isLoading, isError, byKey, setSetting } = usePageSettings(page);
  const defs = useMemo(() => settingsForPage(page), [page]);
  const meta = SETTING_PAGES.find((p) => p.id === page);

  const personalDefs = useMemo(
    () => defs.filter((d) => d.scope === 'staff' || d.personalizable),
    [defs],
  );
  const orgDefs = useMemo(() => defs.filter((d) => d.scope === 'org'), [defs]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-1 py-6 text-sm text-text-soft">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-600">
        Could not load settings. Refresh to try again.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-lg font-semibold text-text-default">{meta?.label ?? 'Settings'}</h2>
        <p className="mt-1 text-sm text-text-soft">{meta?.description}</p>
      </header>

      <PanelSection
        title="Your preferences"
        subtitle="Personal to you — saved to your account and synced across devices."
        defs={personalDefs}
        byKey={byKey}
        variant="personal"
        onChange={(def, value) => setSetting({ key: def.key, value, target: 'staff' })}
      />

      {canManageOrg && (
        <PanelSection
          title="Organization policy"
          subtitle="Applies to everyone in your workspace. Admins only."
          defs={orgDefs}
          byKey={byKey}
          variant="org"
          onChange={(def, value) => setSetting({ key: def.key, value, target: 'org' })}
        />
      )}
    </div>
  );
}
