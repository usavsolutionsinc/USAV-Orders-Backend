'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil, X } from '@/components/Icons';
import { dmSans } from '@/lib/fonts';

interface OutOfStockFieldProps {
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
  dividerClassName,
}: OutOfStockFieldProps) {
  const [showSaved, setShowSaved] = useState(false);
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);

  useEffect(() => {
    if (!editable || !value.trim()) return;
    const t = setTimeout(() => {
      onSubmitRef.current?.();
      setShowSaved(true);
    }, 700);
    return () => clearTimeout(t);
  }, [editable, value]);

  useEffect(() => {
    if (!showSaved) return;
    const t = setTimeout(() => setShowSaved(false), 1600);
    return () => clearTimeout(t);
  }, [showSaved]);

  if (editable) {
    return (
      <div className={`border-b border-red-100 pb-2 ${className}`}>
        {/* Row 1 — label + saved feedback + X */}
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-black uppercase tracking-widest text-red-500 leading-none">
            What needs to be ordered?
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`text-[9px] font-bold uppercase tracking-wide text-emerald-500 transition-opacity duration-300 ${
                showSaved ? 'opacity-100' : 'opacity-0'
              }`}
            >
              Saved
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="flex h-5 w-5 items-center justify-center text-red-400 hover:text-red-600 transition-colors"
              aria-label="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Row 2 — input only */}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder="Describe missing parts…"
          autoFocus={autoFocus}
          className={`w-full bg-transparent text-sm font-normal text-gray-900 outline-none placeholder:text-gray-400 ${dmSans.className}`}
        />
      </div>
    );
  }

  return (
    <div className={`border-b border-red-100 pb-2 ${className}`}>
      {/* Row 1 — label + edit */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-black uppercase tracking-widest text-red-500 leading-none">
          What needs to be ordered?
        </span>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex h-5 w-5 items-center justify-center text-gray-400 hover:text-red-600 transition-colors"
            aria-label="Edit need-to-order note"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Row 2 — value */}
      <p className={`text-sm font-medium text-gray-800 ${dmSans.className}`}>
        {value || 'N/A'}
      </p>
    </div>
  );
}
