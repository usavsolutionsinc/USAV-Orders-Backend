'use client';

import type { ComponentType, SVGProps } from 'react';
import { STATION_SCAN_BAR_DEFAULT_ICON_CLASS } from './tokens';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface StationScanLeadingIconProps {
  Icon: IconComponent;
  tintClassName?: string;
  ariaLabel: string;
  title: string;
}

/** Left indicator glyph — always uses the shared icon box geometry. */
export function StationScanLeadingIcon({
  Icon,
  tintClassName = 'text-gray-400',
  ariaLabel,
  title,
}: StationScanLeadingIconProps) {
  return (
    <HoverTooltip label={title} asChild focusable={false}>
      <span
        className={`flex items-center justify-center ${tintClassName}`}
        role="status"
        aria-label={ariaLabel}
      >
        <Icon className={`${STATION_SCAN_BAR_DEFAULT_ICON_CLASS} transition-colors`} />
      </span>
    </HoverTooltip>
  );
}
