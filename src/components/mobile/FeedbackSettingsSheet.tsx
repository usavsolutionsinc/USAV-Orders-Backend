'use client';

/**
 * FeedbackSettingsSheet — single-tap toggles for haptic and sound feedback.
 *
 * Persists via the shared `prefs.ts` module so every haptic + sound surface
 * in the app (the `useFeedback()` hook AND the legacy `successFeedback` /
 * `errorFeedback` primitives) respect the choice immediately.
 *
 * Designed to drop into any mobile screen as a quick settings sheet — open
 * from a gear icon in the toolbar or from a long-press on a status chip.
 */

import { BottomSheet } from '@/components/ui/BottomSheet';
import { useFeedback } from '@/hooks/useFeedback';

interface FeedbackSettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

interface ToggleRowProps {
  label: string;
  hint: string;
  enabled: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({ label, hint, enabled, onChange }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left active:bg-gray-50 min-h-[56px]"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500">{hint}</span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
          enabled ? 'bg-emerald-500' : 'bg-gray-300'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}

export function FeedbackSettingsSheet({ open, onClose }: FeedbackSettingsSheetProps) {
  const feedback = useFeedback();
  const { prefs, setPref } = feedback;

  return (
    <BottomSheet open={open} onClose={onClose} title="Feedback">
      <p className="mb-4 text-center text-xs text-gray-500">
        Tactile and audio cues for scans, confirms, and errors. Changes apply instantly across the app.
      </p>

      <div className="space-y-2">
        <ToggleRow
          label="Haptics"
          hint="Vibrate on scans, confirms, and errors"
          enabled={prefs.haptic}
          onChange={(next) => {
            setPref('haptic', next);
            if (next) feedback('confirm');
          }}
        />
        <ToggleRow
          label="Sound"
          hint="Play a tone for scans and confirms"
          enabled={prefs.sound}
          onChange={(next) => {
            setPref('sound', next);
            if (next) feedback('confirm');
          }}
        />
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => feedback('confirm')}
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-gray-100 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200"
        >
          Test feedback
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-100"
        >
          Done
        </button>
      </div>
    </BottomSheet>
  );
}
