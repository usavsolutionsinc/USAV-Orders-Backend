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
import { applyTheme, type ThemeName } from '@/lib/theme/theme';
import {
  THEME_NAMES,
  THEME_PALETTES,
  resolveTheme,
  type ThemePalette,
} from '@/design-system/themes/registry';

/**
 * True palette miniature — a tiny "app" rendered from the theme's actual
 * variables (canvas, card, text bars, accent chip, status-dot triad), so the
 * preview IS the theme, not an approximation. Inline styles are required
 * here: these are cross-theme colors shown while a different theme is active.
 */
function ThemePreviewMini({ palette }: { palette: ThemePalette }) {
  const { vars } = palette;
  const accent = palette.accent?.bg ?? palette.preview.accent;
  return (
    <span
      aria-hidden
      className="block h-16 w-full overflow-hidden rounded-lg border border-border-soft"
      style={{ backgroundColor: vars['background-canvas'] }}
    >
      <span
        className="mx-2 mt-2 block rounded-md p-1.5 shadow-sm"
        style={{
          backgroundColor: vars['background-surface'],
          border: `1px solid ${vars['border-subtle']}`,
        }}
      >
        <span className="block h-1.5 w-10 rounded-full" style={{ backgroundColor: vars['text-primary'] }} />
        <span className="mt-1 block h-1 w-16 rounded-full" style={{ backgroundColor: vars['text-faint'] }} />
        <span className="mt-1.5 flex items-center gap-1">
          <span className="h-2 w-6 rounded-full" style={{ backgroundColor: accent }} />
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: vars['fill-success'] }} />
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: vars['fill-warning'] }} />
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: vars['fill-danger'] }} />
        </span>
      </span>
    </span>
  );
}

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
  // Unknown/stale stored names resolve to light, so the switcher never shows
  // an impossible selection.
  const currentTheme: ThemeName = resolveTheme(prefs?.theme).name;

  function updateTheme(t: ThemeName) {
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
                className={`ds-raw-button rounded-xl border px-4 py-3 text-left transition ${
                  isActive
                    ? 'border-blue-500 bg-blue-50 text-text-default ring-2 ring-blue-500/20'
                    : 'border-border-soft bg-surface-card text-text-muted hover:border-border-default hover:bg-surface-canvas'
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
                className={`ds-raw-button min-w-16 rounded-xl border px-4 py-2 font-medium transition ${
                  isActive
                    ? 'border-blue-500 bg-blue-50 text-text-default ring-2 ring-blue-500/20'
                    : 'border-border-soft bg-surface-card text-text-muted hover:border-border-default hover:bg-surface-canvas'
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
        {/* Options come straight from the theme registry — registering a new
            palette (src/design-system/themes/registry.ts) lists it here with
            zero switcher changes. Grouped by scheme: light-family first, then
            dark-family (which also flips native widgets + the neutral remap). */}
        <div className="space-y-4">
          {(['light', 'dark'] as const).map((scheme) => {
            const names = THEME_NAMES.filter((n) => THEME_PALETTES[n].scheme === scheme);
            if (names.length === 0) return null;
            return (
              <div key={scheme}>
                <p className="mb-2 text-eyebrow font-black uppercase tracking-widest text-text-soft">
                  {scheme === 'light' ? 'Light themes' : 'Dark themes'}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {names.map((name) => {
                    const palette = THEME_PALETTES[name];
                    const isActive = currentTheme === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => updateTheme(name)}
                        className={`ds-raw-button rounded-xl border p-2 text-left transition ${
                          isActive
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/20'
                            : 'border-border-soft bg-surface-card hover:border-border-default hover:bg-surface-canvas'
                        }`}
                        aria-pressed={isActive}
                      >
                        <ThemePreviewMini palette={palette} />
                        <span className="mt-2 flex items-center justify-between px-0.5">
                          <span className="text-caption font-bold text-text-default">{palette.label}</span>
                          {isActive ? (
                            <span className="h-2 w-2 rounded-full bg-blue-500" aria-hidden />
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate px-0.5 text-micro text-text-soft">
                          {palette.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
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
