'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/utils/_cn';

interface StationRowProps {
  icon?: React.ReactNode;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  badge?: React.ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  borderBottom?: boolean;
  disabled?: boolean;
  className?: string;
}

export function StationRow({
  icon,
  iconColor,
  title,
  subtitle,
  value,
  badge,
  onClick,
  chevron = true,
  borderBottom = true,
  disabled = false,
  className,
}: StationRowProps) {
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      onClick={disabled ? undefined : onClick}
      disabled={onClick ? disabled : undefined}
      className={cn(
        'w-full flex items-center gap-3 px-4 text-left transition-colors touch-manipulation',
        subtitle ? 'min-h-[72px] py-3' : 'min-h-[56px] py-2',
        borderBottom && 'border-b border-gray-100',
        onClick && !disabled && 'hover:bg-navy-50 active:bg-navy-100 cursor-pointer',
        disabled && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      {/* Icon */}
      {icon && (
        <div
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-station"
          style={iconColor ? { color: iconColor } : undefined}
        >
          {icon}
        </div>
      )}

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate font-sans">{title}</p>
        {subtitle && (
          <p className="text-xs text-gray-500 truncate mt-0.5 font-sans">{subtitle}</p>
        )}
      </div>

      {/* Trailing */}
      <div className="shrink-0 flex items-center gap-2">
        {badge}
        {value && (
          <span className="text-xs font-mono text-gray-500">{value}</span>
        )}
        {chevron && onClick && (
          <ChevronRight size={15} className="text-gray-400" />
        )}
      </div>
    </Tag>
  );
}
