'use client';

/**
 * ConfirmDock — the 96px bottom action dock for mobile task screens.
 *
 *   ┌───────────────────────────────────────────┐
 *   │           [ Primary action ]              │  56–64px tall button
 *   │            secondary text-link            │  optional, 32px tall
 *   └───────────────────────────────────────────┘
 *
 * Slots into MobileShell's `bottomDock` slot. Caller is responsible for
 * choosing the dock variant ('inset' for a separated white strip, 'overlay'
 * when content scrolls beneath).
 *
 * Loading state shows a centered spinner inside the button and disables both
 * actions. Tone presets keep the brand palette consistent across screens.
 */


export type ConfirmDockTone = 'primary' | 'success' | 'warning' | 'neutral';

interface ConfirmDockProps {
  /** Primary action label, e.g. "Confirm Pick". */
  label: string;
  /** Called on primary press. Fire-and-forget — caller manages async state via `loading`. */
  onConfirm: () => void;
  /** Disable both actions (e.g., not enough info to confirm). */
  disabled?: boolean;
  /** Spinner + locked while a network call is in flight. */
  loading?: boolean;
  /** Primary button color family. Default `primary` (blue). */
  tone?: ConfirmDockTone;
  /** Optional secondary action shown below the primary as a text link. */
  secondary?: {
    label: string;
    onPress: () => void;
    /** Make the secondary visually destructive (red text). */
    destructive?: boolean;
  };
}

const TONE_CLASSES: Record<ConfirmDockTone, string> = {
  primary: 'bg-gradient-to-br from-blue-500 to-blue-700 shadow-blue-600/30',
  success: 'bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-emerald-600/30',
  warning: 'bg-gradient-to-br from-amber-500 to-amber-700 shadow-amber-600/30',
  neutral: 'bg-gradient-to-br from-gray-700 to-gray-900 shadow-gray-700/30',
};

export function ConfirmDock({
  label,
  onConfirm,
  disabled = false,
  loading = false,
  tone = 'primary',
  secondary,
}: ConfirmDockProps) {
  const blocked = disabled || loading;

  const handlePrimary = () => {
    if (blocked) return;
    onConfirm();
  };

  const handleSecondary = () => {
    if (loading || !secondary) return;
    secondary.onPress();
  };

  return (
    <div
      className="border-t border-gray-100 bg-white px-4 pt-3"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
    >
      <button
        type="button"
        onClick={handlePrimary}
        disabled={blocked}
        aria-busy={loading || undefined}
        className={`flex h-14 w-full items-center justify-center rounded-2xl text-sm font-semibold tracking-wide text-white shadow-md transition-transform active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 ${TONE_CLASSES[tone]}`}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
            <span>Working…</span>
          </span>
        ) : (
          label
        )}
      </button>
      {secondary && (
        <button
          type="button"
          onClick={handleSecondary}
          disabled={loading}
          className={`mt-2 flex h-8 w-full items-center justify-center text-xs font-semibold transition-colors disabled:opacity-50 ${
            secondary.destructive ? 'text-red-600 active:text-red-700' : 'text-gray-500 active:text-gray-700'
          }`}
        >
          {secondary.label}
        </button>
      )}
    </div>
  );
}
