/**
 * Appearance settings — UI density and font scale. Theme switching is intentionally
 * deferred; the app is currently dark-only and switching it is a design-system
 * refactor, not a settings checkbox.
 *
 * Values are stored in localStorage and reflected as CSS variables on
 * <html> so any component can read them via var(--ui-density) / etc.
 */

const KEY = 'usav.appearance';

export type Density = 'compact' | 'cozy' | 'comfortable';

export interface AppearanceSettings {
  density: Density;
  fontScale: number;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  density: 'cozy',
  fontScale: 1.0,
};

export const FONT_SCALE_OPTIONS = [0.9, 1.0, 1.1, 1.2] as const;
export const DENSITY_OPTIONS: Density[] = ['compact', 'cozy', 'comfortable'];

export function getAppearance(): AppearanceSettings {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
    const density: Density = DENSITY_OPTIONS.includes(parsed.density as Density)
      ? (parsed.density as Density)
      : DEFAULT_APPEARANCE.density;
    const fontScaleRaw = Number(parsed.fontScale);
    const fontScale = Number.isFinite(fontScaleRaw) && fontScaleRaw >= 0.8 && fontScaleRaw <= 1.4
      ? fontScaleRaw
      : DEFAULT_APPEARANCE.fontScale;
    return { density, fontScale };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function setAppearance(patch: Partial<AppearanceSettings>): AppearanceSettings {
  const next = { ...getAppearance(), ...patch };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  applyAppearance(next);
  return next;
}

export function applyAppearance(a: AppearanceSettings = getAppearance()): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-ui-density', a.density);
  root.style.setProperty('--ui-density', a.density);
  root.style.setProperty('--ui-font-scale', String(a.fontScale));
  // Scale the root font-size so rem-based components grow proportionally
  root.style.fontSize = `${16 * a.fontScale}px`;
}
