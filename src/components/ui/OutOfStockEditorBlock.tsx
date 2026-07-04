'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { dmSans } from '@/lib/fonts';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

interface OutOfStockEditorBlockProps {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  isSaving?: boolean;
  autoFocus?: boolean;
  autoSaveOnChange?: boolean;
  saveHint?: string;
  className?: string;
}

export function OutOfStockEditorBlock({
  value,
  onChange,
  onCancel,
  onSubmit,
  autoFocus = false,
  autoSaveOnChange = true,
  saveHint,
  className = '',
}: OutOfStockEditorBlockProps) {
  const [showSaved, setShowSaved] = useState(false);
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);

  useEffect(() => {
    if (!autoSaveOnChange) return;
    if (!value.trim()) return;
    const t = setTimeout(() => {
      onSubmitRef.current();
      setShowSaved(true);
    }, 700);
    return () => clearTimeout(t);
  }, [autoSaveOnChange, value]);

  useEffect(() => {
    if (!showSaved) return;
    const t = setTimeout(() => setShowSaved(false), 1600);
    return () => clearTimeout(t);
  }, [showSaved]);

  return (
    <div className={className}>
      <div className="border-b border-red-100 pb-2">
        {/* Row 1 — label + saved feedback + X */}
        <div className="flex items-center justify-between mb-1.5">
          <span className={`${sectionLabel} text-red-500 leading-none`}>
            What needs to be ordered?
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`text-eyebrow font-bold uppercase tracking-wide text-emerald-500 transition-opacity duration-300 ${
                showSaved ? 'opacity-100' : 'opacity-0'
              }`}
            >
              Saved
            </span>
            <IconButton
              type="button"
              onClick={onCancel}
              ariaLabel="Cancel"
              icon={<X className="w-3.5 h-3.5" />}
              className="flex h-5 w-5 items-center justify-center text-red-400 hover:text-red-600"
            />
          </div>
        </div>

        {/* Row 2 — input only */}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe missing parts…"
          autoFocus={autoFocus}
          className={`w-full bg-transparent text-sm font-normal text-text-default outline-none placeholder:text-text-soft ${dmSans.className}`}
        />
      </div>

      {/* Save hint — smaller copy, sits below the red rule */}
      {!autoSaveOnChange && saveHint ? (
        <p className="mt-1 text-eyebrow font-bold tracking-wide text-text-soft">
          {saveHint}
        </p>
      ) : null}
    </div>
  );
}
