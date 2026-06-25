'use client';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface InlineSaveIndicatorProps {
  state: SaveState;
  errorLabel?: string;
  idleLabel?: string | null;
  savingLabel?: string;
  savedLabel?: string;
  className?: string;
}

export function InlineSaveIndicator({
  state,
  errorLabel = 'Save failed',
  idleLabel = null,
  savingLabel = 'Saving...',
  savedLabel = 'Saved',
  className = '',
}: InlineSaveIndicatorProps) {
  if (state === 'idle' && !idleLabel) return null;

  const label = state === 'saving'
    ? savingLabel
    : state === 'saved'
      ? savedLabel
      : state === 'error'
        ? errorLabel
        : idleLabel;

  const toneClassName = state === 'saving'
    ? 'text-blue-600'
    : state === 'saved'
      ? 'text-emerald-600'
      : state === 'error'
        ? 'text-red-600'
        : 'text-gray-400';

  return (
    <span
      role="status"
      className={`shrink-0 text-eyebrow font-black uppercase tracking-[0.10rem] leading-none ${toneClassName} ${className}`.trim()}
    >
      {label}
    </span>
  );
}
