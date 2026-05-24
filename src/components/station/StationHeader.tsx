'use client';

import React from 'react';
import { PageHeader } from '@/components/ui/pane-header';
import { cn } from '@/utils/_cn';

interface StationHeaderProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  onBack?: () => void;
  rightActions?: React.ReactNode;
  className?: string;
}

export function StationHeader({
  title,
  subtitle,
  backHref,
  onBack,
  rightActions,
  className,
}: StationHeaderProps) {
  return (
    <PageHeader
      className={cn('z-40 pt-[env(safe-area-inset-top,0px)]', className)}
      backHref={backHref}
      onBack={onBack}
      eyebrow={subtitle}
      value={title}
      valueTitle={title}
      rightSlot={rightActions}
    />
  );
}
