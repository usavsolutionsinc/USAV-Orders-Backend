'use client';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface InlineSaveIndicatorProps {
  state: SaveState;
  errorLabel?: string;
  idleLabel?: string | null;
  className?: string;
}

export function InlineSaveIndicator({
  state,
  errorLabel = 'Save failed',
  idleLabel = null,
  className = '',
}: InlineSaveIndicatorProps) {
  if (state === 'idle' && !idleLabel) return null;

  const label = state === 'saving'
    ? 'Saving...'
    : state === 'saved'
      ? 'Saved'
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
    <span className={`shrink-0 text-[9px] font-black uppercase tracking-[0.10rem] leading-none ${toneClassName} ${className}`.trim()}>
      {label}
    </span>
  );
}
