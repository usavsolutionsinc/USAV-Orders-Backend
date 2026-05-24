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

  function updateDensity(d: Density) {
    setSettings(setAppearance({ density: d }));
  }

  function updateFontScale(s: number) {
    setSettings(setAppearance({ fontScale: s }));
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-gray-900">Appearance</h2>
        <p className="mt-1 text-sm text-gray-500">How the interface looks on this device.</p>
      </header>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">UI density</h3>
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
                    ? 'border-blue-500 bg-blue-50 text-gray-900 ring-2 ring-blue-500/20'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
                aria-pressed={isActive}
              >
                <div className="text-sm font-semibold">{DENSITY_LABELS[d]}</div>
                <div className="mt-1 text-caption text-gray-500">{DENSITY_HINTS[d]}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Text size</h3>
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
                    ? 'border-blue-500 bg-blue-50 text-gray-900 ring-2 ring-blue-500/20'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
                style={{ fontSize: `${14 * scale}px` }}
                aria-pressed={isActive}
              >
                {Math.round(scale * 100)}%
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-caption text-gray-500">
          Applies globally. 100% is the default; higher values are easier to read from across the warehouse.
        </p>
      </div>

      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5 text-gray-500">
        <h3 className="text-sm font-semibold text-gray-700">Theme</h3>
        <p className="mt-1 text-xs">Dark theme coming soon.</p>
      </div>
    </div>
  );
}
