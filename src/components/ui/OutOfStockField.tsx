'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { dmSans } from '@/lib/fonts';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

export interface OutOfStockFieldProps {
  value: string;
  editable?: boolean;
  onChange?: (value: string) => void;
  onCancel?: () => void;
  onSubmit?: () => void;
  isSaving?: boolean;
  autoFocus?: boolean;
  className?: string;
  onEdit?: () => void;
  dividerClassName?: string;
}

export function OutOfStockField({
  value,
  editable = false,
  onChange,
  onCancel,
  onSubmit,
  autoFocus = false,
  className = '',
  onEdit,
}: OutOfStockFieldProps) {
  const [showSaved, setShowSaved] = useState(false);
  const lastSubmittedValueRef = useRef('');

  const submitIfNeeded = useCallback(() => {
    if (!editable) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed === lastSubmittedValueRef.current) return;
    lastSubmittedValueRef.current = trimmed;
    onSubmit?.();
    setShowSaved(true);
  }, [editable, onSubmit, value]);

  useEffect(() => {
    if (!showSaved) return;
    const t = setTimeout(() => setShowSaved(false), 1600);
    return () => clearTimeout(t);
  }, [showSaved]);

  useEffect(() => {
    if (!value.trim()) {
      lastSubmittedValueRef.current = '';
    }
  }, [value]);

  if (editable) {
    return (
      <div className={`border-b border-red-100 pb-2 ${className}`}>
        <div className="mb-1.5 flex items-center justify-between">
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
              className="flex h-5 w-5 items-center justify-center text-red-400 hover:text-red-600"
              ariaLabel="Cancel"
              icon={<X className="h-3.5 w-3.5" />}
            />
          </div>
        </div>

        <input
          type="text"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={submitIfNeeded}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitIfNeeded();
            }
          }}
          placeholder="Describe missing parts..."
          autoFocus={autoFocus}
          className={`w-full bg-transparent text-sm font-normal text-text-default outline-none placeholder:text-text-soft ${dmSans.className}`}
        />
      </div>
    );
  }

  return (
    <div className={`border-b border-red-100 pb-2 ${className}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className={`${sectionLabel} text-red-500 leading-none`}>
          What needs to be ordered?
        </span>
        {onEdit ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onEdit}
            icon={<Pencil className="h-3 w-3" />}
            ariaLabel="Edit need-to-order note"
            className="h-auto gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-micro font-black uppercase tracking-[0.18em] text-red-700 ring-0 hover:border-red-300 hover:bg-red-100"
          >
            Edit Note
          </Button>
        ) : null}
      </div>

      <p className={`text-sm font-medium text-text-default ${dmSans.className}`}>
        {value || 'N/A'}
      </p>
    </div>
  );
}
