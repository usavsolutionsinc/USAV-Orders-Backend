'use client';

import { useUIMode } from '@/design-system/providers/UIModeProvider';
import { Monitor, Smartphone } from '@/components/Icons';

/**
 * Compact toggle that lets users switch between mobile and desktop mode.
 * Sits at the bottom of the sidebar. When set, the override persists in
 * localStorage so the preference survives refreshes/sessions.
 *
 * Tap the active mode icon again (or "Auto") to clear the override and
 * fall back to automatic device detection.
 */
export function DeviceModeToggle() {
  const { mode, modeOverride, setModeOverride, isMobileDevice } = useUIMode();

  const isAutoMode = modeOverride === null;
  const isMobileMode = mode === 'mobile';

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-t border-gray-100 bg-gray-50/60">
      {/* Desktop button */}
      <button
        type="button"
        onClick={() => setModeOverride(modeOverride === 'desktop' ? null : 'desktop')}
        title={modeOverride === 'desktop' ? 'Desktop mode (locked) — click to auto-detect' : 'Switch to desktop mode'}
        className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
          !isMobileMode
            ? 'bg-gray-900 text-white shadow-sm'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
        }`}
      >
        <Monitor className="h-3.5 w-3.5" />
        Desktop
      </button>

      {/* Mobile button */}
      <button
        type="button"
        onClick={() => setModeOverride(modeOverride === 'mobile' ? null : 'mobile')}
        title={modeOverride === 'mobile' ? 'Mobile mode (locked) — click to auto-detect' : 'Switch to mobile mode'}
        className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
          isMobileMode
            ? 'bg-blue-600 text-white shadow-sm'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
        }`}
      >
        <Smartphone className="h-3.5 w-3.5" />
        Mobile
      </button>

      {/* Auto indicator / reset */}
      <div className="ml-auto flex items-center gap-1.5">
        {!isAutoMode && (
          <button
            type="button"
            onClick={() => setModeOverride(null)}
            title="Reset to auto-detect"
            className="rounded-lg px-2 py-1 text-[8px] font-black uppercase tracking-widest text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            Auto
          </button>
        )}
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            isAutoMode ? 'bg-emerald-400' : 'bg-amber-400'
          }`}
          title={isAutoMode
            ? `Auto-detected: ${isMobileDevice ? 'mobile device' : 'desktop device'}`
            : `Manual override: ${modeOverride}`
          }
        />
      </div>
    </div>
  );
}
