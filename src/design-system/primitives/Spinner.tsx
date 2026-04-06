'use client';

import { Loader2 } from '@/components/Icons';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  fullScreen?: boolean;
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
};

export function Spinner({ size = 'md', className = '', fullScreen = false }: SpinnerProps) {
  const spinner = (
    <Loader2 className={`animate-spin ${sizeClasses[size]} ${className}`} />
  );

  if (fullScreen) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-[200px]">
        {spinner}
      </div>
    );
  }

  return spinner;
}
