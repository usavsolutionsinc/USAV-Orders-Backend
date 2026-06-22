'use client';

import { useEffect, useState } from 'react';
import {
  DENSITY_OPTIONS,
  FONT_SCALE_OPTIONS,
  getAppearance,
  setAppearance,
  type AppearanceSettings,
  type Density,
} from '@/lib/settings/appearance';
import { useStaffPreferences } from '@/hooks/useStaffPreferences';
import { applyTheme, type AppTheme } from '@/lib/theme/theme';

const THEME_OPTIONS: { value: AppTheme; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Bright — the default.' },
  { value: 'dark', label: 'Dark', hint: 'Low-light — easier on the eyes.' },
];

const DENSITY_LABELS: Record<Density, string> = {
  compact: 'Compact',
  cozy: 'Cozy',
  comfortable: 'Comfortable',
};

const DENSITY_HINTS: Record<Density, string> = {
  compact: 'Tighter spacing — fits more rows.',
  cozy: 'Balanced spacing.',
  comfortable: 'Roomier — easier to read.',
};

export function AppearanceSection() {
  const [settings, setSettings] = useState<AppearanceSettings>({
    density: 'cozy',
    fontScale: 1.0,
  });

  useEffect(() => { setSettings(getAppearance()); }, []);

  const { prefs, update } = useStaffPreferences();
  const currentTheme: AppTheme = prefs?.theme === 'dark' ? 'dark' : 'light';

  function updateTheme(t: AppTheme) {
    applyTheme(t); // instant local feedback
    update({ theme: t }); // durable, cross-device via staff_preferences
  }

  function updateDensity(d: Density) {
    setSettings(setAppearance({ density: d }));
  }

  function updateFontScale(s: number) {
    setSettings(setAppearance({ fontScale: s }));
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="sr-only">Appearance</h2>
        <p className="mt-1 text-sm text-text-soft">How the interface looks on this device.</p>
      </header>

      <div className="rounded-2xl border border-border-soft bg-surface-card p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-text-default">UI density</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {DENSITY_OPTIONS.map((d) => {
            const isActive = settings.density === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => updateDensity(d)}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  isActive
                    ? 'border-blue-500 bg-blue-50 text-text-default ring-2 ring-blue-500/20'
                    : 'border-border-soft bg-surface-card text-gray-700 hover:border-border-default hover:bg-surface-canvas'
                }`}
                aria-pressed={isActive}
              >
                <div className="text-sm font-semibold">{DENSITY_LABELS[d]}</div>
                <div className="mt-1 text-caption text-text-soft">{DENSITY_HINTS[d]}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-border-soft bg-surface-card p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-text-default">Text size</h3>
        <div className="flex flex-wrap items-center gap-2">
          {FONT_SCALE_OPTIONS.map((scale) => {
            const isActive = Math.abs(settings.fontScale - scale) < 0.01;
            return (
              <button
                key={scale}
                type="button"
                onClick={() => updateFontScale(scale)}
                className={`min-w-16 rounded-xl border px-4 py-2 font-medium transition ${
                  isActive
                    ? 'border-blue-500 bg-blue-50 text-text-default ring-2 ring-blue-500/20'
                    : 'border-border-soft bg-surface-card text-gray-700 hover:border-border-default hover:bg-surface-canvas'
                }`}
                style={{ fontSize: `${14 * scale}px` }}
                aria-pressed={isActive}
              >
                {Math.round(scale * 100)}%
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-caption text-text-soft">
          Applies globally. 100% is the default; higher values are easier to read from across the warehouse.
        </p>
      </div>

      <div className="rounded-2xl border border-border-soft bg-surface-card p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-text-default">Theme</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {THEME_OPTIONS.map((opt) => {
            const isActive = currentTheme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateTheme(opt.value)}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  isActive
                    ? 'border-blue-500 bg-blue-50 text-text-default ring-2 ring-blue-500/20'
                    : 'border-border-soft bg-surface-card text-gray-700 hover:border-border-default hover:bg-surface-canvas'
                }`}
                aria-pressed={isActive}
              >
                <div className="text-sm font-semibold">{opt.label}</div>
                <div className="mt-1 text-caption text-text-soft">{opt.hint}</div>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-caption text-text-soft">
          Saved to your account — follows you across devices.
        </p>
      </div>
    </div>
  );
}
