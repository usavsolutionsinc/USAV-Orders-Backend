'use client';

import React, { useState } from 'react';
import { ScanLine, Loader2 } from 'lucide-react';
import { cn } from '@/utils/_cn';

interface ScanButtonProps {
  onPress: () => void;
  active?: boolean;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function ScanButton({
  onPress,
  active = false,
  label,
  disabled = false,
  className,
}: ScanButtonProps) {
  const [pressed, setPressed] = useState(false);

  const handlePointerDown = () => setPressed(true);
  const handlePointerUp = () => {
    setPressed(false);
    if (!active && !disabled) onPress();
  };

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setPressed(false)}
      disabled={active || disabled}
      className={cn(
        'relative flex items-center justify-center gap-2',
        'w-16 h-16 rounded-full',
        'bg-navy-800 text-white shadow-md',
        'transition-all duration-100 touch-manipulation select-none',
        'disabled:cursor-not-allowed',
        pressed && !active && 'scale-90',
        active && 'bg-green-600 scale-95',
        disabled && !active && 'opacity-40',
        className,
      )}
      aria-label={label ?? 'Scan'}
    >
      {active ? (
        <Loader2 size={22} className="animate-spin" />
      ) : (
        <ScanLine size={22} strokeWidth={1.75} />
      )}
      {label && (
        <span className="sr-only">{label}</span>
      )}
    </button>
  );
}
