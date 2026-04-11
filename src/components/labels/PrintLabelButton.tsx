'use client';

import React from 'react';
import { Printer } from '@/components/Icons';
import { printProductLabel, printProductLabels } from '@/lib/print/printProductLabel';

type Variant = 'primary' | 'ghost' | 'icon';

type Props = {
  sku: string;
  title?: string;
  serialNumber?: string;
  serialNumbers?: string[];
  variant?: Variant;
  label?: string;
  className?: string;
  disabled?: boolean;
};

const variantClass: Record<Variant, string> = {
  primary:
    'rounded-xl bg-gray-900 text-white px-4 py-2 text-[10px] hover:bg-black shadow-lg shadow-gray-900/20',
  ghost:
    'rounded-lg border border-gray-200 bg-white text-gray-600 px-3 py-1.5 text-[10px] hover:border-gray-300 hover:text-gray-800',
  icon:
    'rounded-lg border border-gray-200 bg-white text-gray-500 h-8 w-8 justify-center hover:border-gray-300 hover:text-gray-800',
};

export function PrintLabelButton({
  sku,
  title,
  serialNumber,
  serialNumbers,
  variant = 'ghost',
  label = 'Print Label',
  className = '',
  disabled = false,
}: Props) {
  const noSerial = !serialNumber?.trim() && !serialNumbers?.some((s) => s?.trim());
  const isDisabled = disabled || !sku?.trim() || noSerial;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (isDisabled) return;

    if (serialNumbers && serialNumbers.length > 0) {
      printProductLabels({ sku, title, serialNumbers });
    } else if (serialNumber) {
      printProductLabel({ sku, title, serialNumber });
    }
  };

  const base =
    'inline-flex items-center gap-1.5 font-black uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      className={`${base} ${variantClass[variant]} ${className}`}
      title={label}
      aria-label={label}
    >
      <Printer className="h-3.5 w-3.5" />
      {variant !== 'icon' && <span>{label}</span>}
    </button>
  );
}
